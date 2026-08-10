import type { ProjectFile } from "./types";

/** Strip DeepSeek-R1 / thinking model chains before parsing. */
export function stripThinking(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

/**
 * Extract a files array from model output (raw JSON or fenced JSON).
 */
export function parseFilesFromResponse(raw: string): ProjectFile[] {
  const trimmed = stripThinking(raw);
  const candidates: string[] = [trimmed];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.unshift(fence[1].trim());

  const brace = trimmed.match(/\{[\s\S]*"files"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
  if (brace) candidates.unshift(brace[0]);

  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate) as { files?: unknown };
      if (!Array.isArray(data.files)) continue;
      const files: ProjectFile[] = [];
      for (const item of data.files) {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as ProjectFile).path === "string" &&
          typeof (item as ProjectFile).content === "string"
        ) {
          const path = (item as ProjectFile).path.replace(/^\/+/, "").trim();
          if (path) files.push({ path, content: (item as ProjectFile).content });
        }
      }
      if (files.length) return files;
    } catch {
      // try next candidate
    }
  }
  return [];
}

export function mergeFiles(
  existing: ProjectFile[],
  incoming: ProjectFile[]
): ProjectFile[] {
  const map = new Map<string, string>();
  for (const f of existing) map.set(f.path, f.content);
  for (const f of incoming) map.set(f.path, f.content);
  return Array.from(map.entries()).map(([path, content]) => ({ path, content }));
}

export function needsFix(verdictText: string): boolean {
  return /VERDICT:\s*NEEDS_FIX/i.test(verdictText);
}
