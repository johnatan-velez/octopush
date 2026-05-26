import { useEffect, useRef } from "react";
import { Pencil, Trash2 } from "lucide-react";

interface Props {
  x: number;
  y: number;
  workspaceName: string;
  onCustomize: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function WorkspaceContextMenu({
  x,
  y,
  workspaceName: _workspaceName,
  onCustomize,
  onDelete,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Close on outside click (capture phase so it fires before bubbling)
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      // Ignore right-click (button 2) to allow context menu to fire
      if (e.button === 2) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    return () => window.removeEventListener("mousedown", onMouseDown, true);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Workspace actions"
      className="absolute z-50 w-[180px] rounded-md border border-octo-hairline bg-octo-panel shadow-2xl"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onCustomize();
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-t-md px-3 py-2 font-mono text-[11px] text-octo-sage transition hover:bg-[var(--brass-ghost)] hover:text-octo-brass"
      >
        <Pencil size={12} className="shrink-0" />
        Customize…
      </button>

      <div className="h-px bg-octo-hairline" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onDelete();
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-b-md px-3 py-2 font-mono text-[11px] text-octo-rouge transition hover:bg-[var(--rouge-ghost,rgba(209,139,139,0.08))] hover:text-octo-rouge"
      >
        <Trash2 size={12} className="shrink-0" />
        Delete workspace
      </button>
    </div>
  );
}
