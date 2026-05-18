import type { GitStatus } from "../lib/types";

interface Props {
  projectName: string;
  onOpenProjectSwitcher: () => void;
  workspaceName: string;
  branch: string;
  gitStatus: GitStatus | null;
}

export function ContextHeader({
  projectName,
  onOpenProjectSwitcher,
  workspaceName,
  branch,
  gitStatus,
}: Props) {
  const unstaged = gitStatus?.changedFiles.length ?? 0;

  return (
    <div className="m-4 flex items-center gap-4 rounded-xl border border-octo-hairline bg-octo-panel px-4 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* Project chip — sits above the workspace row */}
        <button
          type="button"
          onClick={onOpenProjectSwitcher}
          aria-label="Switch project"
          className="group flex w-fit items-center gap-1.5 rounded px-1 -mx-1 transition hover:bg-[var(--brass-ghost)]"
        >
          <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-octo-brass">
            Project
          </span>
          <span className="font-serif italic text-[13px] leading-none text-octo-ivory">
            {projectName}
          </span>
          <span className="font-mono text-[9px] text-octo-mute transition group-hover:text-octo-brass">
            ▾
          </span>
        </button>

        {/* Workspace row — primary identity */}
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-octo-brass">
            Workspace
          </div>
          <div
            key={workspaceName}
            className="animate-name-in font-serif italic text-[15px] leading-tight tracking-[-0.005em] text-octo-ivory"
          >
            {workspaceName}
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-octo-mute">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-octo-verdigris" aria-hidden />
        <span>↳ {branch}</span>
        {unstaged > 0 && <span>· {unstaged} unstaged</span>}
      </div>
    </div>
  );
}
