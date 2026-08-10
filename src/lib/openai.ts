import OpenAI from "openai";
import {
  collectKeys,
  currentKey,
  getKeyPool,
  isQuotaOrAuthError,
  keyLabel,
  rotateKey,
} from "./key-pool";

export type LlmProvider =
  | "groq"
  | "ollama"
  | "gemini"
  | "openrouter"
  | "cerebras"
  | "deepseek"
  | "openai";

function isPlaceholder(key: string | undefined): boolean {
  if (!key) return true;
  const k = key.trim();
  return (
    !k ||
    k.includes("your-key") ||
    k.includes("your_key") ||
    k.includes("paste_here") ||
    k === "sk-your-key-here" ||
    k === "gsk_your-key-here"
  );
}

export type ResolvedProvider = {
  provider: LlmProvider;
  apiKey: string;
  baseURL?: string;
  model: string;
  defaultMaxTokens: number;
  engineerMaxTokens: number;
  supportsJsonMode: boolean;
  keyCount: number;
};

/**
 * Speed-first: Groq (~70B llama-3.3) when keys exist.
 * Multi-key: GROQ_API_KEYS=key1,key2,key3 — auto-rotates on quota/expiry.
 * Fallback: Ollama local DeepSeek R1 when no cloud keys / all keys fail.
 */
export function resolveProvider(): ResolvedProvider {
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase().trim();

  // Init Groq key pool
  const groqKeys = getKeyPool("groq", "GROQ_API_KEY", "GROQ_API_KEYS", "GROQ_API_KEY");
  const geminiKeys = getKeyPool(
    "gemini",
    "GEMINI_API_KEY",
    "GEMINI_API_KEYS",
    "GEMINI_API_KEY"
  );

  const buildGroq = (): ResolvedProvider | null => {
    const key = currentKey("groq") || groqKeys[0];
    if (!key) return null;
    return {
      provider: "groq",
      apiKey: key,
      baseURL: "https://api.groq.com/openai/v1",
      // Closest free "80B-class" on Groq: Llama 3.3 70B (very fast)
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      defaultMaxTokens: 1500,
      engineerMaxTokens: 4500,
      supportsJsonMode: true,
      keyCount: groqKeys.length,
    };
  };

  const buildGemini = (): ResolvedProvider | null => {
    const key =
      currentKey("gemini") ||
      geminiKeys[0] ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;
    if (isPlaceholder(key)) return null;
    return {
      provider: "gemini",
      apiKey: key!.trim(),
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash-lite",
      defaultMaxTokens: 1200,
      engineerMaxTokens: 4500,
      supportsJsonMode: true,
      keyCount: Math.max(1, geminiKeys.length),
    };
  };

  const buildOllama = (): ResolvedProvider => ({
    provider: "ollama",
    apiKey: "ollama",
    baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
    model: process.env.OLLAMA_MODEL || "deepseek-r1:8b",
    defaultMaxTokens: 1024,
    engineerMaxTokens: 4096,
    supportsJsonMode: false,
    keyCount: 1,
  });

  const buildOpenRouter = (): ResolvedProvider | null => {
    const key = process.env.OPENROUTER_API_KEY;
    if (isPlaceholder(key)) return null;
    return {
      provider: "openrouter",
      apiKey: key!.trim(),
      baseURL: "https://openrouter.ai/api/v1",
      model: process.env.OPENROUTER_MODEL || "qwen/qwen3-coder:free",
      defaultMaxTokens: 2048,
      engineerMaxTokens: 6000,
      supportsJsonMode: false,
      keyCount: 1,
    };
  };

  const buildCerebras = (): ResolvedProvider | null => {
    const key = process.env.CEREBRAS_API_KEY;
    if (isPlaceholder(key)) return null;
    return {
      provider: "cerebras",
      apiKey: key!.trim(),
      baseURL: "https://api.cerebras.ai/v1",
      model: process.env.CEREBRAS_MODEL || "gpt-oss-120b",
      defaultMaxTokens: 2048,
      engineerMaxTokens: 6000,
      supportsJsonMode: true,
      keyCount: 1,
    };
  };

  const byName: Record<string, () => ResolvedProvider | null> = {
    groq: buildGroq,
    gemini: buildGemini,
    ollama: () => buildOllama(),
    openrouter: buildOpenRouter,
    cerebras: buildCerebras,
    deepseek: () => {
      const key = process.env.DEEPSEEK_API_KEY;
      if (isPlaceholder(key)) return null;
      return {
        provider: "deepseek",
        apiKey: key!.trim(),
        baseURL: "https://api.deepseek.com",
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        defaultMaxTokens: 2048,
        engineerMaxTokens: 8192,
        supportsJsonMode: true,
        keyCount: 1,
      };
    },
    openai: () => {
      const key = process.env.OPENAI_API_KEY;
      if (isPlaceholder(key)) return null;
      return {
        provider: "openai",
        apiKey: key!.trim(),
        model: process.env.OPENAI_MODEL || "gpt-4o",
        defaultMaxTokens: 2500,
        engineerMaxTokens: 8192,
        supportsJsonMode: true,
        keyCount: 1,
      };
    },
  };

  if (forced && byName[forced]) {
    const r = byName[forced]();
    if (r) return r;
    if (forced === "ollama") return buildOllama();
    throw new Error(
      `LLM_PROVIDER=${forced} but no keys configured. For Groq speed: set GROQ_API_KEYS=key1,key2 in .env.local`
    );
  }

  // Auto priority: Groq (fast ~70B) → Gemini → OpenRouter → Ollama local
  return (
    buildGroq() ||
    buildGemini() ||
    buildOpenRouter() ||
    buildCerebras() ||
    buildOllama()
  );
}

/** Call after a quota/auth failure — switches to next key in the pool. */
export function rotateProviderKey(provider: LlmProvider): ResolvedProvider | null {
  const next = rotateKey(provider);
  if (!next) return null;
  // Force re-resolve with new index
  return resolveProvider();
}

export function getOpenAI(cfg?: ResolvedProvider) {
  const resolved = cfg || resolveProvider();
  const { apiKey, baseURL, provider } = resolved;
  const headers: Record<string, string> = {};
  if (provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_SITE_URL || "http://localhost:3000";
    headers["X-Title"] = "DigitalSofts AI Employee";
  }
  return new OpenAI({
    apiKey,
    timeout: provider === "ollama" ? 15 * 60 * 1000 : 90 * 1000,
    maxRetries: 0, // we handle key rotation ourselves
    ...(baseURL ? { baseURL } : {}),
    ...(Object.keys(headers).length ? { defaultHeaders: headers } : {}),
  });
}

export function getProviderConfig(): ResolvedProvider {
  return resolveProvider();
}

export function hasApiKey(): boolean {
  try {
    resolveProvider();
    return true;
  } catch {
    return false;
  }
}

export function missingKeyHelp(): string {
  return (
    "For speed: add Groq keys at https://console.groq.com/keys — set " +
    "GROQ_API_KEYS=key1,key2,key3 and LLM_PROVIDER=groq (llama-3.3-70b). " +
    "Keys auto-rotate when one hits rate limits. Or use local Ollama (LLM_PROVIDER=ollama)."
  );
}

export function describeActiveKey(cfg: ResolvedProvider): string {
  if (cfg.provider === "ollama") return "local (no key)";
  return `${keyLabel(cfg.apiKey)} (${cfg.keyCount} key(s) in pool)`;
}

// re-export helpers used by orchestrator
export { isQuotaOrAuthError, keyLabel, collectKeys };
