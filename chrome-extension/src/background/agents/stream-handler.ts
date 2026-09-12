import { buildHeadlessSystemPrompt, dbModelToChatModel, runAgent } from './agent-setup';
import { chatMessagesToPiMessages, makeConvertToLlm } from './message-adapter';
import { sanitizeHistory } from '../context/history-sanitization';
import { createTransformContext } from '../context/transform';
import { createLogger } from '../logging/logger-buffer';
import { runMemoryFlushIfNeeded } from '../memory/memory-flush';
import { MODEL_PRIORITY_CONFIG, scoreModel } from './model-priority-config';
import { AUTO_MODEL_ID } from './default-models';
import { activeAgentStorage, customModelsStorage, saveArtifact } from '@extension/storage';
import type { chatModelToPiModel } from './model-adapter';
import type {
  ChatMessagePart,
  ChatModel,
  LLMRequestMessage,
  LLMStreamChunk,
  LLMStreamEnd,
  LLMStepFinish,
  LLMStreamError,
  LLMStreamRetry,
  LLMTtsAudio,
  ModelProvider,
} from '@extension/shared';
import type { DbArtifact } from '@extension/storage';
import type { AssistantMessage } from '@mariozechner/pi-ai';

const streamLog = createLogger('stream');

// ── Rate-limit state ──────────────────────────────────────────────────────────
// Persists for the lifetime of the service worker (resets on browser restart).
// Key: model DB id, Value: timestamp when backoff expires.
const rateLimitedUntil = new Map<string, number>();

const isRateLimited = (modelDbId: string): boolean => {
  const until = rateLimitedUntil.get(modelDbId);
  if (!until) return false;
  if (Date.now() >= until) {
    rateLimitedUntil.delete(modelDbId);
    return false;
  }
  return true;
};

const markRateLimited = (modelDbId: string, backoffMs = MODEL_PRIORITY_CONFIG.rateLimitBackoffMs): void => {
  const expiresAt = Date.now() + backoffMs;
  rateLimitedUntil.set(modelDbId, expiresAt);
  streamLog.warn('Model rate-limited', {
    modelDbId, backoffMs, retryAt: new Date(expiresAt).toISOString(),
  });
};

const isRateLimitError = (error: string): boolean =>
  error.includes('429') ||
  error.toLowerCase().includes('rate_limit') ||
  error.toLowerCase().includes('too many requests') ||
  error.toLowerCase().includes('quota exceeded');

/** Parse retryDelay from a 429 error body (e.g. Google "retryDelay": "14.7s" or "905ms").
 *  Handles both plain and backslash-escaped quotes (the field is often inside double-encoded JSON). */
const parseRetryDelayMs = (error: string): number | null => {
  const match = error.match(/\\?"retryDelay\\?"\s*:\s*\\?"([\d.]+)(ms|s)\\?"/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2];
  return unit === 'ms' ? Math.ceil(value) : Math.ceil(value * 1000);
};

/**
 * Build the model chain for a request.
 *
 * - Auto mode (primaryModel.id === AUTO_MODEL_ID): returns selected real models
 *   (or all if none selected) sorted by capability score; rate-limited models are pushed to the back.
 * - Specific model selected: returns only that model — no fallback.
 */
const buildModelChain = async (primaryModel: ChatModel): Promise<ChatModel[]> => {
  // Specific model selected → single-entry chain, no fallback
  if (primaryModel.id !== AUTO_MODEL_ID) {
    return [primaryModel];
  }

  // Auto mode → get selected models from storage
  const { autoModeSelectedModelsStorage } = await import('@extension/storage');
  const selection = await autoModeSelectedModelsStorage.get();
  const selectedModelIds = selection.selectedModelIds.length > 0 ? selection.selectedModelIds : null;

  // Get all real models
  const allDbModels = await customModelsStorage.get() ?? [];
  let realModels: ChatModel[] = allDbModels
    .filter(m => m.modelId !== AUTO_MODEL_ID)
    .map(dbModelToChatModel);

  // Filter to selected models if any are selected
  if (selectedModelIds) {
    realModels = realModels.filter(m => selectedModelIds.includes(m.dbId ?? m.id));
  }

  return realModels.sort((a, b) => {
    const aLimited = isRateLimited(a.dbId ?? a.id);
    const bLimited = isRateLimited(b.dbId ?? b.id);
    if (aLimited !== bLimited) return aLimited ? 1 : -1;
    return scoreModel({ provider: b.provider, id: b.id, baseUrl: b.baseUrl }) -
           scoreModel({ provider: a.provider, id: a.id, baseUrl: a.baseUrl });
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const safeSend = (port: chrome.runtime.Port, msg: Record<string, unknown>): boolean => {
  try {
    port.postMessage(msg);
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.includes('disconnected port')) return false;
    throw err;
  }
};

const sendChunk     = (port: chrome.runtime.Port, chunk: Omit<LLMStreamChunk, 'type'>): boolean =>
  safeSend(port, { type: 'LLM_STREAM_CHUNK', ...chunk });
const sendEnd       = (port: chrome.runtime.Port, end:   Omit<LLMStreamEnd,   'type'>): boolean =>
  safeSend(port, { type: 'LLM_STREAM_END',   ...end });
const sendStepFinish = (port: chrome.runtime.Port, step: Omit<LLMStepFinish, 'type'>): boolean =>
  safeSend(port, { type: 'LLM_STEP_FINISH', ...step });
const sendError     = (port: chrome.runtime.Port, chatId: string, error: string): boolean =>
  safeSend(port, { type: 'LLM_STREAM_ERROR', chatId, error });

const maybeSendTtsAudio = async (
  port: chrome.runtime.Port,
  chatId: string,
  responseText: string,
  modelConfig: Parameters<typeof chatModelToPiModel>[0],
): Promise<void> => {
  try {
    const { ttsConfigStorage } = await import('@extension/storage');
    const ttsConfig = await ttsConfigStorage.get();
    if (ttsConfig.engine === 'off' || !ttsConfig.chatUiAutoPlay) return;

    const { maybeApplyTtsStreaming } = await import('../tts');
    const { arrayBufferToBase64 } = await import('../tts/providers/kokoro-bridge');

    await maybeApplyTtsStreaming({
      text: responseText,
      config: ttsConfig,
      inboundHadAudio: false,
      modelConfig,
      onChunk: chunk => {
        port.postMessage({
          type: 'LLM_TTS_AUDIO', chatId,
          audioBase64: arrayBufferToBase64(chunk.audio),
          contentType: chunk.contentType,
          provider: chunk.provider,
          chunkIndex: chunk.chunkIndex,
          isLastChunk: false,
        } satisfies LLMTtsAudio);
      },
      onComplete: () => {
        port.postMessage({
          type: 'LLM_TTS_AUDIO', chatId,
          audioBase64: '', contentType: '', provider: '', isLastChunk: true,
        } satisfies LLMTtsAudio);
      },
    });
  } catch {
    // TTS failure is non-fatal
  }
};

// ── Main handler ──────────────────────────────────────────────────────────────

const handleLLMStream = async (
  port: chrome.runtime.Port,
  request: LLMRequestMessage,
): Promise<void> => {
  const { chatId, messages, model: modelConfig, assistantMessageId, thinkingLevel } = request;
  const assistantParts: ChatMessagePart[] = [];

  streamLog.info('Stream started', { chatId, model: modelConfig.id });
  streamLog.trace('Stream request detail', {
    chatId, modelId: modelConfig.id, provider: modelConfig.provider,
    messageCount: messages.length, ...(thinkingLevel ? { thinkingLevel } : {}),
  });

  try {
    const sanitizedMessages = sanitizeHistory(messages, modelConfig.provider as ModelProvider);
    const piMessages = chatMessagesToPiMessages(sanitizedMessages);
    const history = piMessages.slice(0, -1);
    const prompt  = piMessages[piMessages.length - 1];

    if (!prompt) { sendError(port, chatId, 'No messages to send'); return; }

    let currentAgentId: string | undefined;
    try {
      const id = await activeAgentStorage.get();
      currentAgentId = id || undefined;
    } catch { /* not available in test context */ }

    // Build capability-ranked model chain (rate-limited models go to the back)
    const modelsToTry = await buildModelChain(modelConfig);
    streamLog.info('Model chain', {
      chatId,
      chain: modelsToTry.map(m => ({
        id: m.id,
        score: scoreModel({ provider: m.provider, id: m.id, baseUrl: m.baseUrl }),
        rateLimited: isRateLimited(m.dbId ?? m.id),
      })),
    });

    let persistedModel = modelConfig;
    let streamSucceeded = false;
    // Tracks which models already got a short-wait retry so we don't loop forever
    const waitedModels = new Set<string>();

    // Determine retry behavior based on number of selected models
    const isSingleModelMode = modelsToTry.length === 1;
    const singleModelMaxRetries = 3;
    const singleModelWaitMs = 120_000; // 2 minutes
    const singleModelRetryCount = new Map<string, number>();

    for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
      const currentModel = modelsToTry[modelIdx];
      const modelKey     = currentModel.dbId ?? currentModel.id;
      const hasMoreModels = modelIdx < modelsToTry.length - 1;

      assistantParts.length = 0;

      const isAutoMode = modelConfig.id === AUTO_MODEL_ID;
      const modelDisplayName = currentModel.name || currentModel.id;

      // Build chain hint: show failed models with ✗ prefix so user knows what was tried
      const failedNames = modelsToTry.slice(0, modelIdx).map(m => m.name || m.id);
      const chainHint = modelIdx === 0
        ? modelDisplayName
        : `${failedNames.join(' ✗ ')} ✗ → ${modelDisplayName}`;

      if (isAutoMode) {
        safeSend(port, {
          type: 'LLM_STREAM_RETRY', chatId,
          attempt: modelIdx, maxAttempts: modelsToTry.length,
          reason: modelIdx === 0 ? `Auto → ${modelDisplayName}` : `Fallback: ${chainHint}`,
          strategy: 'model-fallback',
          activeModel: chainHint,
        } satisfies LLMStreamRetry);
        if (modelIdx > 0) {
          const prev = modelsToTry[modelIdx - 1];
          streamLog.info('Model fallback', {
            chatId, from: prev.id, to: currentModel.id, attempt: modelIdx + 1, total: modelsToTry.length,
          });
        }
      }

      const freshSystemPrompt = await buildHeadlessSystemPrompt(currentModel, currentAgentId);
      const freshSystemPromptTokens = Math.ceil(freshSystemPrompt.length / 4);

      streamLog.trace('System prompt built', {
        chatId, systemPromptTokens: freshSystemPromptTokens,
        agentId: currentAgentId, modelId: currentModel.id,
      });

      const { transformContext, getResult: getCompactionResult, setProviderLimit } =
        createTransformContext({
          chatId, modelConfig: currentModel,
          systemPromptTokens: freshSystemPromptTokens, agentId: currentAgentId,
        });

      let compactionNotified = false;
      const notifyingTransformContext: typeof transformContext = async (msgs, signal) => {
        if (!compactionNotified) {
          compactionNotified = true;
          safeSend(port, {
            type: 'LLM_STREAM_RETRY', chatId,
            attempt: 0, maxAttempts: 1,
            reason: 'Compacting conversation context...',
            strategy: 'compaction',
          } satisfies LLMStreamRetry);
        }
        return transformContext(msgs, signal);
      };

      if (modelIdx === 0) {
        await runMemoryFlushIfNeeded({
          chatId, modelConfig: currentModel,
          systemPrompt: freshSystemPrompt,
          systemPromptTokens: freshSystemPromptTokens,
        });
      }

      let accInputTokens = 0, accOutputTokens = 0;
      let lastInputTokens = 0, lastOutputTokens = 0;
      let lastResponseText = '';
      let ttsEndPromise: Promise<void> | undefined;
      let capturedError: string | null = null;
      let attemptSucceeded = false;
      let shortWaitMs: number | null = null; // set by onAgentEnd for short rate-limit waits

      try {
      await runAgent({
        model: currentModel,
        systemPrompt: freshSystemPrompt,
        prompt,
        messages: history,
        convertToLlm: makeConvertToLlm(currentModel),
        transformContext: notifyingTransformContext,
        chatId,
        thinkingLevel,
        onProviderLimitDetected: setProviderLimit,
        onRetry: info => {
          assistantParts.length = 0;
          safeSend(port, {
            type: 'LLM_STREAM_RETRY', chatId,
            attempt: info.attempt, maxAttempts: info.maxAttempts,
            reason: info.reason, strategy: info.strategy,
          });
        },
        onTextDelta: delta => {
          const last = assistantParts[assistantParts.length - 1];
          if (last?.type === 'text') (last as { type: 'text'; text: string }).text += delta;
          else assistantParts.push({ type: 'text', text: delta });
          sendChunk(port, { chatId, delta });
        },
        onReasoningDelta: delta => {
          const last = assistantParts[assistantParts.length - 1];
          if (last?.type === 'reasoning') (last as { type: 'reasoning'; text: string }).text += delta;
          else assistantParts.push({ type: 'reasoning', text: delta });
          sendChunk(port, { chatId, reasoning: delta });
        },
        onToolCallEnd: tc => {
          streamLog.info('Tool call', { toolName: tc.name, toolCallId: tc.id });
          assistantParts.push({
            type: 'tool-call', toolCallId: tc.id, toolName: tc.name,
            args: tc.args, state: 'input-available',
          });
          sendChunk(port, { chatId, toolCall: tc, state: 'input-available' });
        },
        onToolResult: tr => {
          if (!tr.isError && tr.details && tr.toolName === 'create_document') {
            const d = tr.details as { id: string; title?: string; kind?: string; content?: string };
            if (d.id && d.content) {
              const now = Date.now();
              saveArtifact({
                id: d.id, chatId, title: d.title ?? 'Untitled',
                kind: (d.kind ?? 'text') as DbArtifact['kind'],
                content: d.content, createdAt: now, updatedAt: now,
              }).catch(() => {});
            }
          }
          const tcPart = assistantParts.find(p => p.type === 'tool-call' && p.toolCallId === tr.toolCallId);
          if (tcPart?.type === 'tool-call') {
            (tcPart as { result?: unknown; state?: string }).result = tr.result;
            (tcPart as { state?: string }).state = tr.isError ? 'output-error' : 'output-available';
          }
          if (tr.images?.length) {
            for (let i = 0; i < tr.images.length; i++) {
              assistantParts.push({
                type: 'file', url: '',
                filename: `tool-image-${tr.toolCallId}-${i}.jpg`,
                mediaType: tr.images[i].mimeType, data: tr.images[i].data,
              });
            }
          }
          sendChunk(port, {
            chatId,
            toolResult: {
              id: tr.toolCallId, result: tr.result,
              files: tr.images?.map((img, i) => ({
                data: img.data, mimeType: img.mimeType,
                filename: `tool-image-${tr.toolCallId}-${i}.jpg`,
              })),
            },
            state: tr.isError ? 'output-error' : 'output-available',
          });
        },
        onTurnEnd: info => {
          const msg = info.message;
          if (msg.role === 'assistant') {
            const assistantMsg = msg as AssistantMessage;
            let reasoningIdx = 0;
            for (const c of assistantMsg.content) {
              if (c.type === 'thinking' && c.thinkingSignature) {
                while (reasoningIdx < assistantParts.length) {
                  const part = assistantParts[reasoningIdx];
                  if (part.type === 'reasoning') {
                    (part as { signature?: string }).signature = c.thinkingSignature;
                    reasoningIdx++;
                    break;
                  }
                  reasoningIdx++;
                }
              }
            }
            if (assistantMsg.usage) {
              lastInputTokens  = assistantMsg.usage.input;
              lastOutputTokens = assistantMsg.usage.output;
            }
            for (const c of assistantMsg.content) {
              if (c.type === 'text' && c.text) lastResponseText = c.text;
            }
          }
          accInputTokens  = info.usage.input;
          accOutputTokens = info.usage.output;
          sendStepFinish(port, {
            chatId, stepNumber: info.stepCount,
            usage: {
              promptTokens: lastInputTokens, completionTokens: lastOutputTokens,
              totalTokens: lastInputTokens + lastOutputTokens,
            },
          });
        },
        onAgentEnd: info => {
          const agentError = info.agent.state.error;

          if (agentError && !info.timedOut) {
            capturedError = agentError;

            if (isRateLimitError(agentError)) {
              const retryDelayMs = parseRetryDelayMs(agentError);
              const backoffMs = retryDelayMs ?? MODEL_PRIORITY_CONFIG.rateLimitBackoffMs;
              markRateLimited(modelKey, backoffMs);

              // Single model mode: retry up to 3 times with 2-minute wait
              if (isSingleModelMode) {
                const retryCount = singleModelRetryCount.get(modelKey) ?? 0;
                if (retryCount < singleModelMaxRetries && !waitedModels.has(modelKey)) {
                  singleModelRetryCount.set(modelKey, retryCount + 1);
                  waitedModels.add(modelKey);
                  streamLog.info('Rate limit: single model mode, retrying with 2-min wait', {
                    chatId, model: currentModel.id, attempt: retryCount + 1, maxAttempts: singleModelMaxRetries,
                  });
                  safeSend(port, {
                    type: 'LLM_STREAM_RETRY', chatId,
                    attempt: retryCount, maxAttempts: singleModelMaxRetries,
                    reason: `Rate limited — retrying in 2 minutes (${retryCount + 1}/${singleModelMaxRetries})…`,
                    strategy: 'model-fallback',
                    activeModel: `${modelDisplayName} (retry ${retryCount + 1}/${singleModelMaxRetries} in 2m)`,
                  } satisfies LLMStreamRetry);
                  shortWaitMs = singleModelWaitMs;
                  return;
                }
              }
              // Multi-model mode: short delay (≤60s) and haven't waited for this model yet → wait and retry
              else if (retryDelayMs !== null && retryDelayMs <= 60_000 && !waitedModels.has(modelKey)) {
                waitedModels.add(modelKey);
                streamLog.info('Rate limit: short wait, retrying same model', {
                  chatId, model: currentModel.id, waitMs: retryDelayMs,
                });
                safeSend(port, {
                  type: 'LLM_STREAM_RETRY', chatId,
                  attempt: modelIdx, maxAttempts: modelsToTry.length,
                  reason: `Rate limited — retrying in ${Math.ceil(retryDelayMs / 1000)}s…`,
                  strategy: 'model-fallback',
                  activeModel: `${modelDisplayName} (retry in ${Math.ceil(retryDelayMs / 1000)}s)`,
                } satisfies LLMStreamRetry);
                shortWaitMs = retryDelayMs;
                return;
              }
            }

            if (hasMoreModels || shortWaitMs !== null) {
              streamLog.warn('Model failed, trying next in chain', {
                chatId, failedModel: currentModel.id, error: agentError,
              });
            } else {
              streamLog.warn('Agent error — all models exhausted', {
                chatId, error: agentError, steps: info.stepCount,
              });
              sendError(port, chatId, agentError);
            }
            return;
          }

          attemptSucceeded = true;
          persistedModel   = currentModel;

          const lastAssistant = info.messages
            .filter((m): m is AssistantMessage => m.role === 'assistant')
            .pop();
          let finishReason = 'stop';
          if (info.timedOut) finishReason = 'timeout';
          else if (lastAssistant?.stopReason === 'length') finishReason = 'length';

          const compactionResult = getCompactionResult();
          streamLog.info('Stream complete', {
            chatId, steps: info.stepCount, finishReason,
            timedOut: info.timedOut, modelId: currentModel.id,
          });

          const sendEndPayload = {
            chatId, finishReason,
            usage: {
              promptTokens: accInputTokens, completionTokens: accOutputTokens,
              totalTokens: accInputTokens + accOutputTokens,
            },
            contextUsage: {
              promptTokens: lastInputTokens, completionTokens: lastOutputTokens,
              totalTokens: lastInputTokens + lastOutputTokens,
            },
            wasCompacted: compactionResult.wasCompacted,
            compactionMethod: compactionResult.compactionMethod as
              'summary' | 'sliding-window' | 'none' | undefined,
            compactionTokensBefore:  compactionResult.tokensBefore,
            compactionTokensAfter:   compactionResult.tokensAfter,
            compactionDurationMs:    compactionResult.durationMs,
            persistedByBackground:   true,
          };

          if (lastResponseText) {
            ttsEndPromise = maybeSendTtsAudio(port, chatId, lastResponseText, currentModel)
              .then(() => sendEnd(port, sendEndPayload))
              .catch(() => sendEnd(port, sendEndPayload));
          } else {
            sendEnd(port, sendEndPayload);
          }
        },
      });

      } catch (runErr) {
        // runAgent threw (e.g. API error before onAgentEnd fires) — treat same as agentError
        const runErrMsg = runErr instanceof Error ? runErr.message : String(runErr);
        capturedError = runErrMsg;
        streamLog.warn('runAgent threw', { chatId, model: currentModel.id, error: runErrMsg });
        if (isRateLimitError(runErrMsg)) {
          const retryDelayMs = parseRetryDelayMs(runErrMsg);
          const backoffMs = retryDelayMs ?? MODEL_PRIORITY_CONFIG.rateLimitBackoffMs;
          markRateLimited(modelKey, backoffMs);

          if (isSingleModelMode) {
            const retryCount = singleModelRetryCount.get(modelKey) ?? 0;
            if (retryCount < singleModelMaxRetries && !waitedModels.has(modelKey)) {
              singleModelRetryCount.set(modelKey, retryCount + 1);
              waitedModels.add(modelKey);
              shortWaitMs = singleModelWaitMs;
            }
          } else if (retryDelayMs !== null && retryDelayMs <= 60_000 && !waitedModels.has(modelKey)) {
            waitedModels.add(modelKey);
            shortWaitMs = retryDelayMs;
          }
        }
        if (!hasMoreModels && shortWaitMs === null) {
          sendError(port, chatId, runErrMsg);
        }
        // Don't re-throw — loop continues to next model
      }

      if (ttsEndPromise) await ttsEndPromise;

      // Short rate-limit wait: pause then re-run the same model index
      if (shortWaitMs !== null) {
        const waitMs = shortWaitMs;
        shortWaitMs = null;
        streamLog.info('Waiting for rate limit to clear', { chatId, model: currentModel.id, waitMs });
        await new Promise(r => setTimeout(r, waitMs + 500)); // 500ms buffer
        modelIdx--; // for-loop will increment back to same index
        continue;
      }

      if (attemptSucceeded) { streamSucceeded = true; break; }
    }

    // Persist the assistant message from the background SW
    if (assistantParts.length > 0 && assistantMessageId) {
      try {
        const { addMessage, touchChat } = await import('@extension/storage');
        await addMessage({
          id: assistantMessageId, chatId, role: 'assistant',
          parts: assistantParts, createdAt: Date.now(), model: persistedModel.id,
        });
        await touchChat(chatId);
      } catch (persistErr) {
        streamLog.warn('Failed to persist assistant message from background', {
          chatId, error: persistErr instanceof Error ? persistErr.message : String(persistErr),
        });
      }
    }

    void streamSucceeded;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    streamLog.error('Stream error', { chatId, error: errorMsg });
    sendError(port, chatId, errorMsg);

    if (assistantParts.length > 0 && assistantMessageId) {
      try {
        const { addMessage, touchChat } = await import('@extension/storage');
        await addMessage({
          id: assistantMessageId, chatId, role: 'assistant',
          parts: assistantParts, createdAt: Date.now(), model: modelConfig.id,
        });
        await touchChat(chatId);
      } catch { /* best-effort */ }
    }
  }
};

export { handleLLMStream };
