"use client";

import type { AgentId } from "@/lib/types";
import { getAgent } from "@/lib/types";

export interface FeedItem {
  id: string;
  agentId: AgentId;
  content: string;
  streaming?: boolean;
}

export function AgentFeed({
  items,
  status,
}: {
  items: FeedItem[];
  status?: string | null;
}) {
  return (
    <div className="agent-feed" role="log" aria-live="polite">
      {items.length === 0 && !status && (
        <div className="feed-empty">
          <p className="feed-empty-title">Team standing by</p>
          <p className="feed-empty-body">
            Describe your product idea. The CEO, Research, Product, Engineering,
            and the rest of the DigitalSofts team will collaborate in sequence —
            you will see each professional response as it streams.
          </p>
        </div>
      )}
      {items.map((item) => {
        const meta = getAgent(item.agentId);
        return (
          <article
            key={item.id}
            className={`feed-card${item.streaming ? " streaming" : ""}`}
          >
            <header className="feed-card-head">
              <span className="feed-agent">{meta.name}</span>
              <span className="feed-title">{meta.title}</span>
              {item.streaming && <span className="feed-live">thinking</span>}
            </header>
            <div className="feed-content">
              {item.content || (item.streaming ? "…" : "")}
            </div>
          </article>
        );
      })}
      {status && <p className="feed-status">{status}</p>}
    </div>
  );
}
