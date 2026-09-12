/**
 * Preset model configurations bundled at build time.
 *
 * How to use:
 *   1. Put your API keys in .env (gitignored) under the CEB_* keys below.
 *   2. Run `pnpm build` — keys are baked into the extension at compile time.
 *   3. On every service-worker start, any preset model missing from Chrome
 *      storage is automatically (re)added. Chrome storage is NOT required
 *      to persist these; rebuild always restores them.
 *
 * Add/remove models here to change what gets auto-configured.
 * The `id` must be stable (prefix "preset-") so the merger can match them.
 */

// These are replaced at build time by vite's `define: { 'process.env': env }`.
declare const process: { env: Record<string, string | undefined> };

/** Sentinel modelId for the Auto selector — never sent to any provider. */
export const AUTO_MODEL_ID = '__auto__';

export interface PresetModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  contextWindow?: number;
  routingMode?: string;
}

export const PRESET_MODELS: PresetModel[] = [
  // ── Auto selector — always appears first in dropdown ──────────────────────
  // Not a real model; tells the background to pick the best available model
  // based on capability scores in model-priority-config.ts.
  {
    id: 'preset-auto',
    name: 'Auto (Smart Fallback)',
    provider: 'custom',
    modelId: AUTO_MODEL_ID,
    apiKey: 'auto', // non-empty so initPresetModels stores it; never used for inference
    supportsTools: true,
    routingMode: 'direct',
  },

  // ── Google Gemini (best free-tier option, multimodal, good tool calling) ──
  {
    id: 'preset-google-gemini-flash-lite',
    name: 'gemini',
    provider: 'google',
    modelId: 'gemini-3.5-flash-lite',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: process.env.CEB_GOOGLE_API_KEY || '',
    supportsTools: true,
    supportsReasoning: true,
    routingMode: 'direct',
  },

  // ── Groq — gpt-oss-120b (second best: fast, 120B params) ──────────────────
  // Free tier: 6000 TPM hard limit. contextWindow set to 6000 so compaction
  // kicks in before the request reaches the model.
  {
    id: 'preset-groq-gpt-oss-120b',
    name: 'openai/gpt-oss-120b',
    provider: 'custom',
    modelId: 'openai/gpt-oss-120b',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: process.env.CEB_GROQ_API_KEY || '',
    supportsTools: true,
    supportsReasoning: true,
    contextWindow: 6000,
    routingMode: 'direct',
  },

  // ── Groq — gpt-oss-20b (third: lighter, still fast) ──────────────────────
  {
    id: 'preset-groq-gpt-oss-20b',
    name: 'openai/gpt-oss-20b',
    provider: 'custom',
    modelId: 'openai/gpt-oss-20b',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: process.env.CEB_GROQ_API_KEY || '',
    supportsTools: true,
    supportsReasoning: true,
    contextWindow: 6000,
    routingMode: 'direct',
  },

  // ── Cloudflare Workers AI — last resort (single tool-call only, small context) ──
  // Cloudflare llama only supports one tool call per response, so it's only
  // useful for simple non-agentic queries. contextWindow capped at 4096 to avoid
  // context overflow; the model will refuse multi-tool requests.
  {
    id: 'preset-cloudflare-llama-70b',
    name: 'llama-3.3-70b-instruct-fp8-fast',
    provider: 'custom',
    modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${process.env.CEB_CLOUDFLARE_ACCOUNT_ID || ''}/ai/v1`,
    apiKey: process.env.CEB_CLOUDFLARE_API_KEY || '',
    supportsTools: true,
    supportsReasoning: false,
    contextWindow: 4096,
    routingMode: 'direct',
  },
];
