"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentFeed, type FeedItem } from "@/components/AgentFeed";
import { CodePane } from "@/components/CodePane";
import { DownloadZip } from "@/components/DownloadZip";
import { FileTree } from "@/components/FileTree";
import { PromptBar } from "@/components/PromptBar";
import { StepRail } from "@/components/StepRail";
import type { AgentId, ProjectFile, SseEvent } from "@/lib/types";

export default function HomePage() {
  const [idea, setIdea] = useState("");
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<AgentId | null>(null);
  const [completed, setCompleted] = useState<Set<AgentId>>(new Set());
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, status]);

  useEffect(() => {
    if (files.length && !selectedPath) {
      setSelectedPath(files[0].path);
    }
  }, [files, selectedPath]);

  const selectedFile =
    files.find((f) => f.path === selectedPath) || files[0] || null;

  const run = useCallback(async () => {
    const trimmed = idea.trim();
    if (!trimmed || running) return;

    setRunning(true);
    setError(null);
    setItems([]);
    setFiles([]);
    setSelectedPath(null);
    setCompleted(new Set());
    setActiveId(null);
    setStatus("Starting DigitalSofts agent team…");

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          let event: SseEvent;
          try {
            event = JSON.parse(json) as SseEvent;
          } catch {
            continue;
          }
          handleEvent(event);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setRunning(false);
      setActiveId(null);
    }

    function handleEvent(event: SseEvent) {
      switch (event.type) {
        case "run_start":
          setStatus("Team assembled — agents collaborating…");
          break;
        case "agent_start":
          setActiveId(event.agentId);
          setStatus(`${event.agentName} is working…`);
          setItems((prev) => [
            ...prev,
            {
              id: `${event.agentId}-${Date.now()}`,
              agentId: event.agentId,
              content: "",
              streaming: true,
            },
          ]);
          break;
        case "agent_delta":
          setItems((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].agentId === event.agentId && next[i].streaming) {
                next[i] = {
                  ...next[i],
                  content: next[i].content + event.delta,
                };
                break;
              }
            }
            return next;
          });
          break;
        case "agent_done":
          setCompleted((prev) => new Set(prev).add(event.agentId));
          setItems((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].agentId === event.agentId && next[i].streaming) {
                next[i] = {
                  ...next[i],
                  content: event.content || next[i].content,
                  streaming: false,
                };
                break;
              }
            }
            return next;
          });
          break;
        case "files":
          setFiles(event.files);
          break;
        case "status":
          setStatus(event.message);
          break;
        case "error":
          setError(event.message);
          setStatus(null);
          break;
        case "run_complete":
          setFiles(event.files);
          setStatus("Delivery complete — download your project ZIP.");
          setActiveId(null);
          break;
      }
    }
  }, [idea, running]);

  return (
    <div className="shell">
      <div className="atmosphere" aria-hidden />

      <header className="top">
        <div className="brand-block">
          <p className="brand">DigitalSofts</p>
          <h1 className="product">AI Employee</h1>
          <p className="tagline">
            Nine specialists. One brief. Production-ready software, built in the
            open — step by step.
          </p>
        </div>
        <div className="top-actions">
          <DownloadZip files={files} disabled={running} />
        </div>
      </header>

      <main className="studio">
        <section className="studio-prompt">
          <PromptBar
            value={idea}
            onChange={setIdea}
            onSubmit={run}
            disabled={running}
          />
          {error && <p className="error-banner">{error}</p>}
        </section>

        <section className="studio-grid">
          <aside className="panel panel-steps">
            <h2 className="panel-title">Agent team</h2>
            <StepRail activeId={activeId} completed={completed} />
          </aside>

          <section className="panel panel-feed">
            <h2 className="panel-title">Live collaboration</h2>
            <div className="feed-scroll">
              <AgentFeed items={items} status={status} />
              <div ref={feedEndRef} />
            </div>
          </section>

          <section className="panel panel-code">
            <h2 className="panel-title">Project files</h2>
            <div className="code-layout">
              <FileTree
                files={files}
                selected={selectedPath}
                onSelect={setSelectedPath}
              />
              <CodePane file={selectedFile} />
            </div>
          </section>
        </section>
      </main>

      <footer className="foot">
        <span>DigitalSofts AI Employee</span>
        <span>Fast Groq 70B · auto key-rotate · local Ollama fallback</span>
      </footer>
    </div>
  );
}
