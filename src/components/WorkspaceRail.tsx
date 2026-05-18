import { resolveMonogram, TINTS } from "../lib/monogram";
import type { Workspace } from "../lib/types";

interface Props {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCustomize: (id: string) => void;
  /** Called when the user right-clicks a workspace monogram. */
  onContextMenu?: (workspaceId: string, x: number, y: number) => void;
  onNewWorkspace: () => void;
}

export function WorkspaceRail({
  workspaces,
  activeId,
  onSelect,
  onCustomize,
  onContextMenu,
  onNewWorkspace,
}: Props) {
  return (
    <aside
      className="flex h-full w-12 flex-col items-center gap-2 border-r border-octo-hairline bg-octo-panel pb-3 pt-9"
      aria-label="Workspaces"
    >
      {workspaces.map((ws) => (
        <MonogramButton
          key={ws.id}
          workspace={ws}
          active={ws.id === activeId}
          onSelect={() => onSelect(ws.id)}
          onCustomize={() => onCustomize(ws.id)}
          onContextMenu={
            onContextMenu
              ? (x, y) => onContextMenu(ws.id, x, y)
              : undefined
          }
        />
      ))}
      <button
        type="button"
        onClick={onNewWorkspace}
        title="New workspace (⌘N)"
        aria-label="New workspace"
        className="mt-1 flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-octo-hairline font-mono text-sm text-octo-mute transition hover:border-octo-brass hover:text-octo-brass"
      >
        +
      </button>
    </aside>
  );
}

function MonogramButton({
  workspace,
  active,
  onSelect,
  onCustomize,
  onContextMenu,
}: {
  workspace: Workspace;
  active: boolean;
  onSelect: () => void;
  onCustomize: () => void;
  onContextMenu?: (x: number, y: number) => void;
}) {
  const mono = resolveMonogram(workspace);
  const tint = TINTS[mono.tint];

  return (
    <div
      className={`relative flex items-center pl-[6px] border-l-2 ${
        active ? "border-octo-brass" : "border-transparent"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault();
          if (onContextMenu) {
            onContextMenu(e.clientX, e.clientY);
          } else {
            onCustomize();
          }
        }}
        title={`${workspace.name} (right-click to customize)`}
        aria-label={workspace.name}
        aria-current={active ? "location" : undefined}
        className="flex h-7 w-7 items-center justify-center rounded-md border font-serif italic transition"
        style={{
          color: tint.accent,
          // Inline borderColor used because tint values are runtime, not Tailwind tokens.
          // Always set to keep the border 1px box-model present (prevents layout shift on activation).
          borderColor: active ? tint.accent : "transparent",
          background: active ? tint.bg : "transparent",
        }}
      >
        {mono.glyph}
      </button>
    </div>
  );
}
