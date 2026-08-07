import OpenAI from "openai";

export type LlmProvider =
  | "gemini"
  | "openrouter"
  | "cerebras"
  | "deepseek"
  | "groq"
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
};

/**
 * Default free path: Gemini (Google AI Studio).
 * Others remain available via LLM_PROVIDER=...
 */
export function resolveProvider(): ResolvedProvider {
  const forced = (process.env.LLM_PROVIDER || "gemini").toLowerCase().trim();

  const candidates: Array<() => ResolvedProvider | null> = [
    () => {
      const key =
        process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (isPlaceholder(key)) return null;
      return {
        provider: "gemini",
        apiKey: key!.trim(),
        baseURL:
          "https://generativelanguage.googleapis.com/v1beta/openai/",
        model: process.env.GEMINI_MODEL || "gemini-2.0-flash-lite",
        defaultMaxTokens: 1200,
        engineerMaxTokens: 4500,
        supportsJsonMode: true,
      };
    },
    () => {
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
      };
    },
    () => {
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
      };
    },
    () => {
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
      };
    },
    () => {
      const key = process.env.GROQ_API_KEY;
      if (isPlaceholder(key)) return null;
      return {
        provider: "groq",
        apiKey: key!.trim(),
        baseURL: "https://api.groq.com/openai/v1",
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        defaultMaxTokens: 1200,
        engineerMaxTokens: 3500,
        supportsJsonMode: true,
      };
    },
    () => {
      const key = process.env.OPENAI_API_KEY;
      if (isPlaceholder(key)) return null;
      return {
        provider: "openai",
        apiKey: key!.trim(),
        model: process.env.OPENAI_MODEL || "gpt-4o",
        defaultMaxTokens: 2500,
        engineerMaxTokens: 8192,
        supportsJsonMode: true,
      };
    },
  ];

  const resolved = candidates
    .map((fn) => fn())
    .filter((x): x is ResolvedProvider => Boolean(x));

  if (!resolved.length) {
    throw new Error(
      "No API key configured. Free: get Gemini at https://aistudio.google.com/apikey and set GEMINI_API_KEY in .env.local."
    );
  }

  if (forced) {
    const match = resolved.find((r) => r.provider === forced);
    if (match) return match;
    const geminiHint =
      forced === "gemini"
        ? "Set GEMINI_API_KEY in .env.local (key from https://aistudio.google.com/apikey)."
        : `Set the matching *_API_KEY for ${forced} in .env.local.`;
    throw new Error(`LLM_PROVIDER=${forced} but that API key is missing. ${geminiHint}`);
  }

  return resolved[0];
}

export function getOpenAI() {
  const { apiKey, baseURL, provider } = resolveProvider();
  const headers: Record<string, string> = {};
  if (provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_SITE_URL || "http://localhost:3000";
    headers["X-Title"] = "DigitalSofts AI Employee";
  }
  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(Object.keys(headers).length ? { defaultHeaders: headers } : {}),
  });
}

export function getModel() {
  return resolveProvider().model;
}

export function getProviderName(): LlmProvider {
  return resolveProvider().provider;
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
    "Fully free setup: create a Gemini API key (no credit card) at " +
    "https://aistudio.google.com/apikey — set GEMINI_API_KEY in .env.local, then restart npm run dev."
  );
}
