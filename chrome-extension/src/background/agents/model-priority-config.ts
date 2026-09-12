/**
 * Model priority config for browser automation.
 * Edit scores here and rebuild — no Chrome storage involved.
 *
 * Rules are evaluated top-to-bottom; first match wins.
 * Higher score = tried first. Rate-limited models drop to end of queue.
 */

export interface ModelCapabilityRule {
  provider?: string;
  modelIdPattern?: string; // case-insensitive substring match on modelId
  baseUrlPattern?: string; // case-insensitive substring match on baseUrl
  score: number;
}

export interface ModelPriorityConfig {
  rules: ModelCapabilityRule[];
  // How long (ms) to back off a 429-rate-limited model before retrying it as top candidate
  rateLimitBackoffMs: number;
}

export const MODEL_PRIORITY_CONFIG: ModelPriorityConfig = {
  rateLimitBackoffMs: 60_000,

  rules: [
    // ── Anthropic ──────────────────────────────────────────────────────────
    { provider: 'anthropic', modelIdPattern: 'opus',   score: 1000 },
    { provider: 'anthropic', modelIdPattern: 'sonnet', score:  950 },
    { provider: 'anthropic', modelIdPattern: 'haiku',  score:  900 },
    { provider: 'anthropic',                           score:  920 },

    // ── OpenAI native ──────────────────────────────────────────────────────
    { provider: 'openai', modelIdPattern: 'o3',    score: 980 },
    { provider: 'openai', modelIdPattern: 'o1',    score: 960 },
    { provider: 'openai', modelIdPattern: 'gpt-4o', score: 880 },
    { provider: 'openai', modelIdPattern: 'gpt-4', score: 860 },
    { provider: 'openai', modelIdPattern: 'gpt-3.5', score: 700 },
    { provider: 'openai',                          score: 750 },

    // ── Google / Gemini (multimodal, decent free rate limits) ─────────────
    { provider: 'google', modelIdPattern: 'pro',        score: 870 },
    { provider: 'google', modelIdPattern: '2.5-flash',  score: 830 },
    { provider: 'google', modelIdPattern: '3.5-flash',  score: 830 },
    { provider: 'google', modelIdPattern: 'flash-lite', score: 800 },
    { provider: 'google',                               score: 810 },

    // ── OpenRouter ────────────────────────────────────────────────────────
    { provider: 'openrouter', modelIdPattern: 'claude',       score: 870 },
    { provider: 'openrouter', modelIdPattern: 'gpt-4',        score: 840 },
    { provider: 'openrouter', modelIdPattern: 'gemini',       score: 810 },
    { provider: 'openrouter', modelIdPattern: 'llama-3.3-70b', score: 720 },
    { provider: 'openrouter',                                  score: 650 },

    // ── Custom: Groq ──────────────────────────────────────────────────────
    { baseUrlPattern: 'api.groq.com', modelIdPattern: 'gpt-oss-120b',  score: 760 },
    { baseUrlPattern: 'api.groq.com', modelIdPattern: 'gpt-oss-20b',   score: 730 },
    { baseUrlPattern: 'api.groq.com', modelIdPattern: 'llama-3.3-70b', score: 720 },
    { baseUrlPattern: 'api.groq.com', modelIdPattern: 'llama-3.1-70b', score: 715 },
    { baseUrlPattern: 'api.groq.com',                                   score: 700 },

    // ── Custom: Mistral ───────────────────────────────────────────────────
    { baseUrlPattern: 'mistral.ai', modelIdPattern: 'large',  score: 790 },
    { baseUrlPattern: 'mistral.ai', modelIdPattern: 'medium', score: 750 },
    { baseUrlPattern: 'mistral.ai',                           score: 720 },

    // ── Custom: Cloudflare Workers AI (context-limited — scored lower) ────
    { baseUrlPattern: 'api.cloudflare.com', modelIdPattern: 'deepseek-v4',   score: 720 },
    { baseUrlPattern: 'api.cloudflare.com', modelIdPattern: 'kimi-k2',       score: 710 },
    { baseUrlPattern: 'api.cloudflare.com', modelIdPattern: 'llama-3.1-70b', score: 680 },
    { baseUrlPattern: 'api.cloudflare.com', modelIdPattern: 'llama-3.3-70b', score: 660 },
    { baseUrlPattern: 'api.cloudflare.com',                                   score: 600 },

    // ── Web session providers (no API key) ────────────────────────────────
    { provider: 'web', modelIdPattern: 'claude', score: 850 },
    { provider: 'web', modelIdPattern: 'gpt',    score: 820 },
    { provider: 'web', modelIdPattern: 'gemini', score: 800 },
    { provider: 'web',                           score: 700 },

    // ── Local / WebGPU ────────────────────────────────────────────────────
    { provider: 'local', score: 300 },
  ],
};

/** Score a model for browser automation. Higher = tried first. */
export const scoreModel = (model: { provider?: string; id?: string; baseUrl?: string }): number => {
  const provider = (model.provider ?? '').toLowerCase();
  const modelId  = (model.id ?? '').toLowerCase();
  const baseUrl  = (model.baseUrl ?? '').toLowerCase();

  for (const rule of MODEL_PRIORITY_CONFIG.rules) {
    const providerMatch  = !rule.provider       || rule.provider.toLowerCase() === provider;
    const modelIdMatch   = !rule.modelIdPattern || modelId.includes(rule.modelIdPattern.toLowerCase());
    const baseUrlMatch   = !rule.baseUrlPattern || baseUrl.includes(rule.baseUrlPattern.toLowerCase());
    if (providerMatch && modelIdMatch && baseUrlMatch) return rule.score;
  }
  return 0;
};
