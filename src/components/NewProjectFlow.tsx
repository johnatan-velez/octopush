import { useState } from "react";
import { ArrowLeft, FolderOpen, GitBranch, Copy, LayoutTemplate } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";

interface Props {
  onBack: () => void;
}

type ProjectType = "empty" | "clone" | "template";

export function NewProjectFlow({ onBack }: Props) {
  const { create, loading, error } = useProjectStore();
  const [location, setLocation] = useState("~/.octopus-sh/projects");
  const [repoName, setRepoName] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>("empty");

  async function handleCreate() {
    const trimmedLocation = location.trim();
    const trimmedName = repoName.trim();
    if (!trimmedName) return;
    await create(trimmedLocation, trimmedName);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && repoName.trim()) handleCreate();
  }

  return (
    <div
      data-tauri-drag-region
      className="flex h-full w-full flex-col items-center justify-center bg-octo-bg px-4"
    >
      <div className="w-full max-w-lg">
        {/* Back button */}
        <button
          type="button"
          onClick={onBack}
          className="mb-8 flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-zinc-200"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        {/* Heading */}
        <h1 className="mb-6 text-xl font-semibold tracking-tight text-zinc-100">
          New Project
        </h1>

        {/* Location */}
        <label className="mb-5 block">
          <span className="mb-1.5 block text-xs uppercase tracking-wider text-zinc-500">
            Location
          </span>
          <div className="flex items-center gap-2">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="~/.octopus-sh/projects"
              className="min-w-0 flex-1 rounded-md border border-octo-border bg-octo-panel px-3 py-2 text-sm font-mono text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-octo-accent"
            />
            {/* Decorative folder icon button — no-op for now */}
            <button
              type="button"
              title="Browse (not yet available)"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-octo-border bg-octo-panel text-zinc-500 transition hover:border-octo-accent/40 hover:text-zinc-200"
            >
              <FolderOpen size={15} />
            </button>
          </div>
        </label>

        {/* Project type cards */}
        <div className="mb-5">
          <span className="mb-1.5 block text-xs uppercase tracking-wider text-zinc-500">
            Type
          </span>
          <div className="grid grid-cols-3 gap-3">
            <TypeCard
              icon={<GitBranch size={20} />}
              label="Empty"
              description="New git repo"
              selected={projectType === "empty"}
              disabled={false}
              onClick={() => setProjectType("empty")}
            />
            <TypeCard
              icon={<Copy size={20} />}
              label="Clone"
              description="From URL"
              selected={projectType === "clone"}
              disabled={true}
              onClick={() => setProjectType("clone")}
            />
            <TypeCard
              icon={<LayoutTemplate size={20} />}
              label="Template"
              description="Coming soon"
              selected={projectType === "template"}
              disabled={true}
              onClick={() => setProjectType("template")}
            />
          </div>
        </div>

        {/* Repository name */}
        <label className="mb-6 block">
          <span className="mb-1.5 block text-xs uppercase tracking-wider text-zinc-500">
            Repository Name
          </span>
          <input
            autoFocus
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="my-project"
            className="w-full rounded-md border border-octo-border bg-octo-panel px-3 py-2 text-sm font-mono text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-octo-accent"
          />
        </label>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-md border border-octo-danger/40 bg-octo-danger/10 px-3 py-2 text-xs text-octo-danger">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCreate}
            disabled={!repoName.trim() || loading || projectType !== "empty"}
            className="rounded-md bg-octo-accent px-5 py-2 text-sm font-medium text-zinc-950 transition hover:bg-octo-accent-dim disabled:opacity-40"
          >
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TypeCardProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}

function TypeCard({
  icon,
  label,
  description,
  selected,
  disabled,
  onClick,
}: TypeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-center transition ${
        disabled
          ? "cursor-not-allowed border-octo-border bg-octo-panel opacity-40"
          : selected
            ? "border-octo-accent bg-octo-accent/10 text-octo-accent"
            : "border-octo-border bg-octo-panel text-zinc-400 hover:border-octo-accent/50 hover:text-zinc-200"
      }`}
    >
      <div className="text-current">{icon}</div>
      <div>
        <div className="text-sm font-medium leading-tight">{label}</div>
        <div className="mt-0.5 text-xs text-zinc-600">{description}</div>
      </div>
    </button>
  );
}
