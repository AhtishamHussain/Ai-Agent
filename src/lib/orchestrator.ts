import type { AgentId, AgentMessage, ProjectFile, SseEvent } from "./types";
import { getAgent } from "./types";
import {
  describeActiveKey,
  getOpenAI,
  getProviderConfig,
  isQuotaOrAuthError,
  rotateProviderKey,
  type ResolvedProvider,
} from "./openai";
import { systemPromptFor, userPromptFor } from "./agents/prompts";
import { mergeFiles, needsFix, parseFilesFromResponse } from "./parse-files";

export type Emit = (event: SseEvent) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keep transcript short so free-tier TPM/TPD lasts a full agent run. */
function formatTranscript(messages: AgentMessage[], maxChars = 4500): string {
  if (!messages.length) return "";
  const recent = messages.slice(-3);
  let text = recent
    .map((m) => {
      const body =
        m.content.length > 900
          ? `${m.content.slice(0, 900)}…[truncated]`
          : m.content;
      return `[${m.agentName}]: ${body}`;
    })
    .join("\n\n---\n\n");
  if (text.length > maxChars) text = text.slice(-maxChars);
  return text;
}

function filesSummary(files: ProjectFile[], maxPerFile = 1800): string {
  if (!files.length) return "(no files yet)";
  return files
    .map((f) => {
      const body =
        f.content.length > maxPerFile
          ? `${f.content.slice(0, maxPerFile)}\n…[truncated]`
          : f.content;
      return `### ${f.path}\n\`\`\`\n${body}\n\`\`\``;
    })
    .join("\n\n");
}

/** Free-tier cloud: fewer API calls. Local Ollama runs the full team. */
const CLOUD_LITE_AGENTS = new Set<AgentId>([
  "ceo",
  "cto",
  "engineer",
  "reviewer",
  "devops",
]);

function useFullPipeline(provider: string): boolean {
  // 8B R1 on CPU is slow — default to lean team. Set OLLAMA_FULL_TEAM=true for all 9.
  if (provider === "ollama") {
    return process.env.OLLAMA_FULL_TEAM === "true";
  }
  return false;
}

function skipNote(agentId: AgentId): string {
  const notes: Partial<Record<AgentId, string>> = {
    research:
      "Local skip: Research folded into CEO (faster on DeepSeek R1 8B).",
    pm: "Local skip: Product scope covered by CEO/CTO.",
    qa: "Local skip: QA covered lightly by Reviewer.",
    marketing: "Local skip: Marketing deferred for speed on local 8B.",
  };
  return notes[agentId] || "Free-tier skip.";
}

async function runAgent(
  agentId: AgentId,
  idea: string,
  messages: AgentMessage[],
  emit: Emit,
  extra?: string,
  opts?: { jsonMode?: boolean; maxTokens?: number }
): Promise<string> {
  const agent = getAgent(agentId);
  let cfg: ResolvedProvider = getProviderConfig();

  const wantJson = Boolean(opts?.jsonMode);
  let userExtra = extra || "";
  if (wantJson && !cfg.supportsJsonMode) {
    userExtra +=
      `\n\nIMPORTANT: Reply with ONLY valid JSON (no markdown fences). ` +
      `Shape: {"files":[{"path":"...","content":"..."}]}`;
  }

  emit({ type: "agent_start", agentId, agentName: agent.name });

  const maxAttempts = 6;
  let lastError = "";
  let keysTried = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    cfg = getProviderConfig();
    const client = getOpenAI(cfg);
    const useJsonMode = wantJson && cfg.supportsJsonMode;
    const maxTokens =
      opts?.maxTokens ??
      (agentId === "engineer" ? cfg.engineerMaxTokens : cfg.defaultMaxTokens);

    try {
      const stream = await client.chat.completions.create({
        model: cfg.model,
        temperature: agentId === "engineer" ? 0.15 : 0.3,
        max_tokens: maxTokens,
        stream: true,
        ...(useJsonMode
          ? { response_format: { type: "json_object" as const } }
          : {}),
        messages: [
          { role: "system", content: systemPromptFor(agentId) },
          {
            role: "user",
            content: userPromptFor(
              agentId,
              idea,
              formatTranscript(messages),
              userExtra
            ),
          },
        ],
      });

      let content = "";
      let reasoning = "";
      for await (const chunk of stream) {
        // Ollama reasoning models (e.g. deepseek-r1) stream thought tokens via
        // `delta.reasoning` before any real `delta.content`. Stream them so the
        // agent card stays live (not stuck) while the model thinks.
        const choice = chunk.choices[0]?.delta as { content?: string | null } & {
          reasoning?: string;
          reasoning_content?: string;
        };
        const thought = choice?.reasoning || choice?.reasoning_content || "";
        if (thought) {
          reasoning += thought;
          emit({ type: "agent_delta", agentId, delta: thought });
        }
        const delta = choice?.content || "";
        if (delta) {
          content += delta;
          emit({ type: "agent_delta", agentId, delta });
        }
      }

      if (!content && reasoning) content = reasoning;

      emit({ type: "agent_done", agentId, content });

      messages.push({
        id: `${agentId}-${Date.now()}`,
        agentId,
        agentName: agent.name,
        content,
        timestamp: new Date().toISOString(),
      });

      return content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;

      if (isQuotaOrAuthError(message) && cfg.keyCount > 1) {
        const rotated = rotateProviderKey(cfg.provider);
        if (rotated) {
          keysTried += 1;
          emit({
            type: "status",
            message: `Key limit/expired on ${cfg.provider} — switched API key (${keysTried}/${cfg.keyCount}) and retrying ${agent.name}…`,
          });
          await sleep(500);
          continue;
        }
      }

      const is429 = /429|rate|limit|quota/i.test(message);
      if (is429 && attempt < maxAttempts) {
        const waitSec = Math.min(attempt * 8, 30);
        emit({
          type: "status",
          message: `Quota busy — waiting ${waitSec}s then retrying ${agent.name} (${attempt}/${maxAttempts})…`,
        });
        await sleep(waitSec * 1000);
        continue;
      }

      // Last resort: fall back to local Ollama if cloud keys all fail
      if (
        isQuotaOrAuthError(message) &&
        cfg.provider !== "ollama" &&
        process.env.OLLAMA_FALLBACK !== "false"
      ) {
        process.env.LLM_PROVIDER = "ollama";
        emit({
          type: "status",
          message: `Cloud keys exhausted — falling back to local Ollama deepseek-r1:8b…`,
        });
        continue;
      }

      let hint = "";
      if (/402|payment required/i.test(message)) {
        hint = ` Add another Groq key to GROQ_API_KEYS (comma-separated) for auto-rotate.`;
      } else if (is429) {
        hint = ` Add more keys in GROQ_API_KEYS=key1,key2,key3 so the app can auto-switch.`;
      }
      throw new Error(`${message}${hint}`);
    }
  }

  throw new Error(lastError || "Agent call failed");
}

async function skipAgent(
  agentId: AgentId,
  messages: AgentMessage[],
  emit: Emit
) {
  const agent = getAgent(agentId);
  const content = skipNote(agentId);
  emit({ type: "agent_start", agentId, agentName: agent.name });
  emit({ type: "agent_delta", agentId, delta: content });
  emit({ type: "agent_done", agentId, content });
  messages.push({
    id: `${agentId}-${Date.now()}`,
    agentId,
    agentName: agent.name,
    content,
    timestamp: new Date().toISOString(),
  });
}

const PIPELINE: AgentId[] = [
  "ceo",
  "research",
  "pm",
  "cto",
  "engineer",
  "reviewer",
  "qa",
  "devops",
  "marketing",
];

export async function runPipeline(idea: string, emit: Emit): Promise<void> {
  const cfg = getProviderConfig();
  const gapMs =
    cfg.provider === "gemini" || cfg.provider === "groq" ? 2500 : 200;
  const fullTeam = useFullPipeline(cfg.provider);

  emit({ type: "run_start", idea });
  emit({
    type: "status",
    message:
      cfg.provider === "groq"
        ? `Fast Groq · ${cfg.model} · ${describeActiveKey(cfg)} — auto key-rotate on limits`
        : cfg.provider === "ollama"
          ? `Local Ollama · ${cfg.model} — no API key (CPU may be slow)`
          : `Using ${cfg.provider} · ${cfg.model} · ${describeActiveKey(cfg)}`,
  });

  const messages: AgentMessage[] = [];
  let files: ProjectFile[] = [];

  try {
    for (const agentId of PIPELINE) {
      if (!fullTeam && !CLOUD_LITE_AGENTS.has(agentId)) {
        await skipAgent(agentId, messages, emit);
        continue;
      }

      if (agentId === "engineer") {
        emit({
          type: "status",
          message: "Engineer is implementing the project…",
        });
        const raw = await runAgent(
          "engineer",
          idea,
          messages,
          emit,
          `Implement a complete but LEAN project as JSON {"files":[...]}. Prefer a single polished HTML/CSS/JS login page (or few files) when the idea is a UI page. No placeholders.`,
          { jsonMode: true, maxTokens: cfg.engineerMaxTokens }
        );
        const parsed = parseFilesFromResponse(raw);
        if (parsed.length) {
          files = mergeFiles(files, parsed);
          emit({ type: "files", files });
        } else {
          emit({
            type: "status",
            message: "Engineer JSON parse failed — Reviewer will note it.",
          });
        }
        await sleep(gapMs);
        continue;
      }

      if (agentId === "reviewer") {
        emit({
          type: "status",
          message: "Reviewer is auditing…",
        });
        const raw = await runAgent(
          "reviewer",
          idea,
          messages,
          emit,
          `CURRENT FILES:\n${filesSummary(files)}\n\nBe brief. End with VERDICT: APPROVED or VERDICT: NEEDS_FIX.`
        );

        if (needsFix(raw) && files.length) {
          emit({
            type: "status",
            message: "Applying one Engineer fix pass…",
          });
          await sleep(gapMs);
          const fixRaw = await runAgent(
            "engineer",
            idea,
            messages,
            emit,
            `FIX PASS. Return JSON {"files":[...]} with corrected files only.\nFEEDBACK:\n${raw.slice(0, 1500)}\n\nFILES:\n${filesSummary(files, 1400)}`,
            { jsonMode: true, maxTokens: cfg.engineerMaxTokens }
          );
          const fixed = parseFilesFromResponse(fixRaw);
          if (fixed.length) {
            files = mergeFiles(files, fixed);
            emit({ type: "files", files });
          }
        }
        await sleep(gapMs);
        continue;
      }

      if (agentId === "devops") {
        emit({
          type: "status",
          message: "DevOps packaging README…",
        });
        const raw = await runAgent(
          "devops",
          idea,
          messages,
          emit,
          `Files: ${files.map((f) => f.path).join(", ") || "(none)"}\nReturn JSON {"files":[{"path":"README.md","content":"..."}],"notes":"..."} only.`,
          { jsonMode: true, maxTokens: Math.min(2000, cfg.engineerMaxTokens) }
        );
        const opsFiles = parseFilesFromResponse(raw);
        if (opsFiles.length) {
          files = mergeFiles(files, opsFiles);
          emit({ type: "files", files });
        }
        continue;
      }

      // CEO / CTO
      await runAgent(agentId, idea, messages, emit);
      await sleep(gapMs);
    }

    if (!files.length) {
      files = [
        {
          path: "README.md",
          content:
            `# Generated by DigitalSofts AI Employee\n\n` +
            `Idea: ${idea}\n\n` +
            `No code files were produced. Wait a minute for free quota, then retry.\n`,
        },
      ];
      emit({ type: "files", files });
    }

    emit({ type: "run_complete", files });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
  }
}
