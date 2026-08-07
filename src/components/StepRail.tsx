import type { AgentId } from "@/lib/types";
import { AGENTS } from "@/lib/types";

export function StepRail({
  activeId,
  completed,
}: {
  activeId: AgentId | null;
  completed: Set<AgentId>;
}) {
  return (
    <ol className="step-rail" aria-label="Agent pipeline">
      {AGENTS.map((agent, i) => {
        const done = completed.has(agent.id);
        const active = activeId === agent.id;
        return (
          <li
            key={agent.id}
            className={`step-item${done ? " done" : ""}${active ? " active" : ""}`}
          >
            <span className="step-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="step-body">
              <span className="step-name">{agent.name}</span>
              <span className="step-role">{agent.role}</span>
            </span>
            <span className="step-state" aria-hidden>
              {active ? "·" : done ? "✓" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
