import { Plus } from "lucide-react";
import { clsx } from "clsx";

interface Agent {
  id: string;
  name: string;
  color: string;
}

const AGENTS: Agent[] = [
  { id: "claude-sonnet-4-6", name: "Claude", color: "#cc785c" },
  { id: "claude-opus-4-6", name: "Opus", color: "#cc785c" },
  { id: "gpt-4o", name: "GPT-4o", color: "#74aa9c" },
  { id: "claude-haiku-4-5", name: "Haiku", color: "#cc785c" },
];

interface Props {
  activeModel: string;
  onSelectModel: (model: string) => void;
}

export function AgentBar({ activeModel, onSelectModel }: Props) {
  return (
    <div className="flex flex-row items-center gap-1 border-b border-octo-border bg-octo-panel/50 px-4 py-2">
      {AGENTS.map((agent) => {
        const isActive = activeModel === agent.id;
        return (
          <button
            key={agent.id}
            onClick={() => onSelectModel(agent.id)}
            className={clsx(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition",
              isActive
                ? "border-octo-accent/30 bg-octo-accent/10 text-octo-accent"
                : "border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
            )}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: agent.color }}
            />
            {agent.name}
          </button>
        );
      })}

      <button
        className="ml-1 flex items-center justify-center rounded-md border border-transparent p-1.5 text-zinc-600 transition hover:bg-zinc-800/60 hover:text-zinc-400"
        title="Add agent"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
