/**
 * Multi-key pool: when one key hits rate/quota/billing limits, rotate to the next.
 */

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

/** Parse GROQ_API_KEYS=k1,k2 or GROQ_API_KEY + GROQ_API_KEY_2 ... */
export function collectKeys(
  primaryEnv: string,
  pluralEnv: string,
  numberedPrefix: string
): string[] {
  const keys: string[] = [];
  const plural = process.env[pluralEnv];
  if (plural) {
    for (const part of plural.split(/[,;\n]+/)) {
      const k = part.trim();
      if (!isPlaceholder(k)) keys.push(k);
    }
  }
  const primary = process.env[primaryEnv];
  if (!isPlaceholder(primary)) keys.push(primary!.trim());

  for (let i = 2; i <= 10; i++) {
    const k = process.env[`${numberedPrefix}${i}`] || process.env[`${numberedPrefix}_${i}`];
    if (!isPlaceholder(k)) keys.push(k!.trim());
  }

  // unique preserve order
  return [...new Set(keys)];
}

export function isQuotaOrAuthError(message: string): boolean {
  return /429|402|401|403|rate|limit|quota|payment|expired|invalid.?api.?key|insufficient/i.test(
    message
  );
}

type PoolState = {
  keys: string[];
  index: number;
};

const pools = new Map<string, PoolState>();

export function getKeyPool(
  provider: string,
  primaryEnv: string,
  pluralEnv: string,
  numberedPrefix: string
): string[] {
  let state = pools.get(provider);
  if (!state) {
    const keys = collectKeys(primaryEnv, pluralEnv, numberedPrefix);
    state = { keys, index: 0 };
    pools.set(provider, state);
  }
  return state.keys;
}

export function currentKey(provider: string): string | null {
  const state = pools.get(provider);
  if (!state || !state.keys.length) return null;
  return state.keys[state.index % state.keys.length];
}

export function rotateKey(provider: string): string | null {
  const state = pools.get(provider);
  if (!state || state.keys.length < 2) return null;
  const prev = state.index;
  state.index = (state.index + 1) % state.keys.length;
  if (state.index === prev) return null;
  // Avoid infinite loop: if we wrapped back and only tried once from start, still return next
  return state.keys[state.index];
}

export function keyLabel(key: string): string {
  if (key.length <= 10) return "***";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function resetPools() {
  pools.clear();
}
