import { hasApiKey, missingKeyHelp } from "@/lib/openai";
import { runPipeline } from "@/lib/orchestrator";
import type { SseEvent } from "@/lib/types";

export const maxDuration = 300;
export const runtime = "nodejs";

function encodeSse(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  let body: { idea?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const idea = (body.idea || "").trim();
  if (!idea) {
    return Response.json({ error: "An idea prompt is required." }, { status: 400 });
  }

  if (!hasApiKey()) {
    return Response.json({ error: missingKeyHelp() }, { status: 500 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: SseEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          // stream closed
        }
      };

      try {
        await runPipeline(idea, emit);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
