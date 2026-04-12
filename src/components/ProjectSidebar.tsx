import { clsx } from "clsx";
import { ArrowLeft, GitBranch, Plus } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { Workspace } from "../lib/types";

interface Props {
  onNewWorkspace: () => void;
}

export function ProjectSidebar({ onNewWorkspace }: Props) {
  const project = useProjectStore((s) => s.current);
  const close = useProjectStore((s) => s.close);
  const { workspaces, activeId, select, notifications, clearNotification } = useWorkspaceStore();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-octo-border bg-octo-panel">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-octo-border px-3 py-3">
        <button
          onClick={close}
          className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          title="Back to projects"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="flex-1 truncate text-sm font-semibold tracking-tight">
          {project?.name ?? "Project"}
        </span>
      </header>

      {/* New Workspace button */}
      <div className="px-2 py-2">
        <button
          onClick={onNewWorkspace}
          className="flex w-full items-center gap-2 rounded-md border border-octo-accent/30 bg-octo-accent/10 px-3 py-1.5 text-sm font-medium text-octo-accent transition hover:bg-octo-accent/20"
        >
          <Plus size={14} />
          <span className="flex-1 text-left">New Workspace</span>
          <kbd className="rounded border border-octo-border bg-octo-bg px-1.5 py-0.5 text-[10px] text-zinc-500">
            ⌘N
          </kbd>
        </button>
      </div>

      {/* Workspace list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {workspaces.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-zinc-600">
            No workspaces yet
          </div>
        ) : (
          workspaces.map((ws) => (
            <WorkspaceRow
              key={ws.id}
              workspace={ws}
              active={ws.id === activeId}
              hasNotification={(notifications[ws.id] ?? 0) > 0}
              onSelect={() => {
                select(ws.id);
                clearNotification(ws.id);
              }}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-octo-border px-4 py-2.5">
        <span className="text-xs text-zinc-600 transition hover:text-zinc-400 cursor-default">
          Add repository
        </span>
      </footer>
    </aside>
  );
}

function WorkspaceRow({
  workspace,
  active,
  hasNotification,
  onSelect,
}: {
  workspace: Workspace;
  active: boolean;
  hasNotification: boolean;
  onSelect: () => void;
}) {
  const isActive = workspace.status === "active";

  return (
    <div
      onClick={onSelect}
      className={clsx(
        "mb-1 cursor-pointer rounded-lg border px-3 py-2.5 transition",
        active
          ? "border-octo-accent/40 bg-octo-accent/10"
          : "border-transparent hover:border-octo-border hover:bg-zinc-900/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            "h-2 w-2 shrink-0 rounded-full",
            isActive ? "bg-octo-success" : "bg-zinc-600",
          )}
        />
        <span className="flex-1 truncate text-sm font-medium">
          {workspace.name}
        </span>
        {hasNotification && (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#a78bfa",
              flexShrink: 0,
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 pl-4 text-[11px] text-zinc-500">
        <GitBranch size={10} className="shrink-0 text-zinc-600" />
        <span className="truncate font-mono text-xs">{workspace.branch}</span>
      </div>
    </div>
  );
}
