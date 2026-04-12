import { Terminal, MessageSquare, Globe, ExternalLink, Search } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface Props {
  onOpenTerminal: () => void;
  onOpenChat: () => void;
}

interface Action {
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  onClick?: () => void;
  disabled?: boolean;
}

export function WorkspaceHub({ onOpenTerminal, onOpenChat }: Props) {
  const { workspaces, activeId } = useWorkspaceStore();
  const workspace = workspaces.find((ws) => ws.id === activeId) ?? null;

  const actions: Action[] = [
    {
      icon: <Terminal size={16} />,
      label: "Open Terminal",
      shortcut: "⌘T",
      onClick: onOpenTerminal,
    },
    {
      icon: <MessageSquare size={16} />,
      label: "Open Chat",
      shortcut: "⌘⇧C",
      onClick: onOpenChat,
    },
    {
      icon: <Globe size={16} />,
      label: "Open Browser",
      shortcut: "⌘⇧B",
      disabled: true,
    },
    {
      icon: <ExternalLink size={16} />,
      label: "Open in Cursor",
      shortcut: "⌘⇧O",
      disabled: true,
    },
    {
      icon: <Search size={16} />,
      label: "Search Files",
      shortcut: "⌘⇧P",
      disabled: true,
    },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center bg-octo-bg">
      <div className="w-full max-w-sm px-4">
        {/* Bracket icon + workspace name */}
        <div className="mb-8 text-center">
          <div className="mb-3 font-mono text-5xl font-bold tracking-tight text-octo-accent/30 select-none">
            {"{ }"}
          </div>
          {workspace && (
            <>
              <div className="text-base font-semibold text-zinc-200">
                {workspace.name}
              </div>
              <div className="mt-1 font-mono text-xs text-zinc-500">
                {workspace.branch}
              </div>
            </>
          )}
        </div>

        {/* Action list */}
        <div className="flex flex-col gap-1.5">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              className="flex items-center gap-3 rounded-md border border-octo-border bg-octo-panel px-4 py-2.5 text-sm transition
                hover:border-zinc-700 hover:bg-zinc-900/60
                disabled:cursor-not-allowed disabled:opacity-40
                disabled:hover:border-octo-border disabled:hover:bg-octo-panel"
            >
              <span className="text-zinc-400">{action.icon}</span>
              <span className="flex-1 text-left text-zinc-200">{action.label}</span>
              <kbd className="rounded border border-octo-border bg-octo-bg px-1.5 py-0.5 text-[10px] text-zinc-500">
                {action.shortcut}
              </kbd>
            </button>
          ))}
        </div>

        {/* Delete workspace link */}
        {workspace && (
          <div className="mt-6 text-center">
            <button className="text-xs text-zinc-600 transition hover:text-octo-danger">
              Delete workspace
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
