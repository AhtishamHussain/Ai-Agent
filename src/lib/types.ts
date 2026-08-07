export type AgentId =
  | "ceo"
  | "research"
  | "pm"
  | "cto"
  | "engineer"
  | "reviewer"
  | "qa"
  | "devops"
  | "marketing";

export type AgentStatus = "idle" | "thinking" | "done" | "error";

export interface AgentMeta {
  id: AgentId;
  name: string;
  title: string;
  role: string;
}

export interface AgentMessage {
  id: string;
  agentId: AgentId;
  agentName: string;
  content: string;
  timestamp: string;
  kind?: "message" | "handoff" | "fix";
}

export interface ProjectFile {
  path: string;
  content: string;
}

export type SseEvent =
  | { type: "run_start"; idea: string }
  | { type: "agent_start"; agentId: AgentId; agentName: string }
  | { type: "agent_delta"; agentId: AgentId; delta: string }
  | { type: "agent_done"; agentId: AgentId; content: string }
  | { type: "files"; files: ProjectFile[] }
  | { type: "status"; message: string }
  | { type: "error"; message: string }
  | { type: "run_complete"; files: ProjectFile[] };

export const AGENTS: AgentMeta[] = [
  {
    id: "ceo",
    name: "CEO",
    title: "Chief Executive",
    role: "Vision, goals, and success criteria",
  },
  {
    id: "research",
    name: "Research",
    title: "Research Analyst",
    role: "Market and technology options",
  },
  {
    id: "pm",
    name: "Product Manager",
    title: "Product Manager",
    role: "PRD, features, and user stories",
  },
  {
    id: "cto",
    name: "CTO",
    title: "Chief Technology Officer",
    role: "Architecture, stack, and file map",
  },
  {
    id: "engineer",
    name: "Engineer",
    title: "Senior Engineer",
    role: "Production-ready multi-file code",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    title: "Code Reviewer",
    role: "Quality gate and fix requests",
  },
  {
    id: "qa",
    name: "QA",
    title: "QA Lead",
    role: "Test plan and edge cases",
  },
  {
    id: "devops",
    name: "DevOps",
    title: "DevOps Engineer",
    role: "README, scripts, and deploy config",
  },
  {
    id: "marketing",
    name: "Marketing",
    title: "Marketing Lead",
    role: "Positioning and launch copy",
  },
];

export function getAgent(id: AgentId): AgentMeta {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent: ${id}`);
  return agent;
}
