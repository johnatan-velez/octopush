import { useMemo } from "react";
import type { RunStage } from "../lib/ipc";
import { labelForRole } from "./RunTrack";

interface ParsedArtifact {
  kind: string;
  text: string;
  refsWorktree?: boolean;
}

interface Props {
  stage: RunStage | null;
}

export function StageFocus({ stage }: Props) {
  const artifact = useMemo<ParsedArtifact | null>(() => {
    if (!stage?.artifact) return null;
    try {
      return JSON.parse(stage.artifact) as ParsedArtifact;
    } catch {
      return null;
    }
  }, [stage?.artifact]);

  if (!stage) {
    return (
      <div className="flex flex-1 items-center justify-center text-octo-mute font-mono text-sm">
        Select a stage to inspect it.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden octo-fade-in">
      <div className="flex items-center gap-2 border-b border-octo-hairline px-4 py-2.5 font-mono text-xs text-octo-sage">
        <span className="text-octo-brass">§ {stage.role.toUpperCase()}</span>
        <span>· {labelForRole(stage.role)} · {stage.agentModel}</span>
        <span className="ml-auto text-octo-brass">${stage.costUsd.toFixed(2)}</span>
      </div>
      <div className="flex-1 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-octo-sage whitespace-pre-wrap">
        {stage.status === "failed" && stage.error ? (
          <span className="text-octo-rouge">{stage.error}</span>
        ) : artifact ? (
          <>
            {artifact.refsWorktree && (
              <div className="mb-2 text-octo-mute">
                ⟶ Code changes are in the workspace; open Review to see the diff.
              </div>
            )}
            {artifact.text || "(no output text)"}
          </>
        ) : stage.status === "running" ? (
          <span className="text-octo-brass">working…</span>
        ) : (
          <span className="text-octo-mute">No artifact yet.</span>
        )}
      </div>
    </div>
  );
}
