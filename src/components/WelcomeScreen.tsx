import { useEffect, useState } from "react";
import { FolderOpen, Clock, ChevronRight } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";
import type { ProjectInfo } from "../lib/types";

interface Props {
  onNewProject: () => void;
}

export function WelcomeScreen({ onNewProject }: Props) {
  const { open, loadRecent, recent, loading, error } = useProjectStore();
  const [showPathInput, setShowPathInput] = useState(false);
  const [pathValue, setPathValue] = useState("");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  function handleOpenClick() {
    setShowPathInput(true);
    setPathValue("");
  }

  function handleConfirmPath() {
    const trimmed = pathValue.trim();
    if (!trimmed) return;
    open(trimmed);
  }

  function handlePathKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleConfirmPath();
    if (e.key === "Escape") {
      setShowPathInput(false);
      setPathValue("");
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    // Tauri exposes dropped file paths via dataTransfer in some versions
    const items = Array.from(e.dataTransfer.items);
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          // file.path is available in Tauri's webview
          const path = (file as File & { path?: string }).path;
          if (path) {
            open(path);
            return;
          }
        }
      }
    }
    // Fallback: show path input
    setShowPathInput(true);
  }

  return (
    <div
      data-tauri-drag-region
      className="flex h-full w-full flex-col items-center justify-center gap-8 bg-octo-bg px-4"
    >
      {/* Logo */}
      <div className="font-mono text-2xl font-bold uppercase tracking-[0.3em] text-zinc-100">
        OCTOPUS SH
      </div>

      {/* Dropzone / Open Project */}
      <div className="flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={handleOpenClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`group flex w-72 flex-col items-center gap-3 rounded-xl border-2 border-dashed px-8 py-10 transition ${
            dragOver
              ? "border-octo-accent bg-octo-accent/10"
              : "border-octo-border bg-octo-panel hover:border-octo-accent/60 hover:bg-octo-accent/5"
          }`}
        >
          <FolderOpen
            size={32}
            className={`transition ${
              dragOver
                ? "text-octo-accent"
                : "text-zinc-500 group-hover:text-octo-accent"
            }`}
          />
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-medium text-zinc-200">
              Open Project
            </span>
            <span className="text-center text-xs text-zinc-500">
              Drag a folder with .git or click to browse
            </span>
          </div>
        </button>

        {/* Path input — shown after clicking Open Project */}
        {showPathInput && (
          <div className="flex w-72 items-center gap-2">
            <input
              autoFocus
              value={pathValue}
              onChange={(e) => setPathValue(e.target.value)}
              onKeyDown={handlePathKeyDown}
              placeholder="/path/to/project"
              className="min-w-0 flex-1 rounded-md border border-octo-border bg-octo-panel px-3 py-2 text-sm font-mono text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-octo-accent"
            />
            <button
              type="button"
              onClick={handleConfirmPath}
              disabled={!pathValue.trim() || loading}
              className="rounded-md bg-octo-accent px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-octo-accent-dim disabled:opacity-40"
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPathInput(false);
                setPathValue("");
              }}
              className="rounded-md px-2 py-2 text-sm text-zinc-500 transition hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Error feedback */}
        {error && (
          <div className="w-72 rounded-md border border-octo-danger/40 bg-octo-danger/10 px-3 py-2 text-xs text-octo-danger">
            {error}
          </div>
        )}
      </div>

      {/* New project CTA */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs text-zinc-500">Or start a new project</span>
        <button
          type="button"
          onClick={onNewProject}
          className="flex items-center gap-1.5 rounded-md border border-octo-accent/40 bg-octo-accent/10 px-4 py-2 text-sm font-medium text-octo-accent transition hover:bg-octo-accent/20"
        >
          <span className="text-base leading-none">+</span>
          New Project
        </button>
      </div>

      {/* Recent projects */}
      {recent.length > 0 && (
        <div className="w-72">
          <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-zinc-600">
            <Clock size={11} />
            Recent
          </div>
          <ul className="flex flex-col gap-0.5">
            {recent.map((project: ProjectInfo) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => open(project.path)}
                  className="group flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition hover:bg-octo-panel"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-200">
                      {project.name}
                    </div>
                    <div className="truncate text-xs text-zinc-600">
                      {project.path}
                    </div>
                  </div>
                  <ChevronRight
                    size={14}
                    className="ml-2 shrink-0 text-zinc-700 transition group-hover:text-zinc-400"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
