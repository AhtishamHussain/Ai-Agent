import type { AgentId, AgentMessage, ProjectFile, SseEvent } from "./types";
import { getAgent } from "./types";
import { getOpenAI, getProviderConfig } from "./openai";
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

/** Free-tier: only these agents call the API (avoids 429 mid-run). */
const API_AGENTS = new Set<AgentId>([
  "ceo",
  "cto",
  "engineer",
  "reviewer",
  "devops",
]);

function skipNote(agentId: AgentId): string {
  const notes: Partial<Record<AgentId, string>> = {
    research:
      "Free-tier skip: Research folded into CEO vision. Proceeding to architecture.",
    pm: "Free-tier skip: Product scope covered by CEO/CTO. Proceeding.",
    qa: "Free-tier skip: QA checks covered lightly by Reviewer. Proceeding to DevOps.",
    marketing:
      "Free-tier skip: Marketing deferred to keep within free API limits.",
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
  const cfg = getProviderConfig();
  const client = getOpenAI();

  const wantJson = Boolean(opts?.jsonMode);
  const useJsonMode = wantJson && cfg.supportsJsonMode;
  const maxTokens =
    opts?.maxTokens ??
    (agentId === "engineer" ? cfg.engineerMaxTokens : cfg.defaultMaxTokens);

  emit({ type: "agent_start", agentId, agentName: agent.name });

  let userExtra = extra || "";
  if (wantJson && !useJsonMode) {
    userExtra +=
      `\n\nIMPORTANT: Reply with ONLY valid JSON (no markdown fences). ` +
      `Shape: {"files":[{"path":"...","content":"..."}]}`;
  }

  const maxAttempts = 4;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) {
          content += delta;
          emit({ type: "agent_delta", agentId, delta });
        }
      }

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
      const is429 = /429|rate|limit|quota/i.test(message);
      if (is429 && attempt < maxAttempts) {
        const waitSec = attempt * 20;
        emit({
          type: "status",
          message: `Free quota busy — waiting ${waitSec}s then retrying ${agent.name} (${attempt}/${maxAttempts})…`,
        });
        await sleep(waitSec * 1000);
        continue;
      }

      let hint = "";
      if (/402|payment required/i.test(message)) {
        hint =
          ` ${cfg.provider} needs billing. Stay on free Gemini or OpenRouter :free models.`;
      } else if (is429) {
        hint =
          ` Free rate limit on ${cfg.provider} (${cfg.model}). Wait 1–2 minutes and try again, or create a fresh key at https://aistudio.google.com/apikey (keys usually start with AIza).`;
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
  const gapMs = cfg.provider === "gemini" || cfg.provider === "groq" ? 2500 : 400;

  emit({ type: "run_start", idea });
  emit({
    type: "status",
    message: `Using ${cfg.provider} · ${cfg.model} (free-friendly mode)`,
  });

  const messages: AgentMessage[] = [];
  let files: ProjectFile[] = [];

  try {
    for (const agentId of PIPELINE) {
      if (!API_AGENTS.has(agentId)) {
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
