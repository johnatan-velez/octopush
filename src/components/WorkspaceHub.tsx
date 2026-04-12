import { useState } from "react";
import { Terminal, MessageSquare, Globe, ExternalLink, Search } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useProjectStore } from "../stores/projectStore";

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
  const { workspaces, activeId, remove } = useWorkspaceStore();
  const project = useProjectStore((s) => s.current);
  const workspace = workspaces.find((ws) => ws.id === activeId) ?? null;
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        {workspace && !confirm && (
          <div className="mt-6 text-center">
            <button
              onClick={() => setConfirm(true)}
              className="text-xs text-zinc-600 transition hover:text-octo-danger"
            >
              Delete workspace
            </button>
          </div>
        )}
        {workspace && confirm && (
          <div className="mt-6 rounded-md border border-red-900/40 bg-red-950/30 p-3 text-center">
            <p className="text-xs text-zinc-300">
              Delete <strong>{workspace.name}</strong> ({workspace.branch})?
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              This will delete the branch and worktree. Cannot be undone.
            </p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                disabled={deleting}
                onClick={async () => {
                  if (!project) return;
                  setDeleting(true);
                  try {
                    await remove(workspace.id, project.path, workspace.branch, workspace.worktreePath ?? null);
                    setConfirm(false);
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Confirm Delete"}
              </button>
              <button
                onClick={() => setConfirm(false)}
                className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 transition hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
