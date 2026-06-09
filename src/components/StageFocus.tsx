import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { LiveEntry, RunStage } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import { useRunsStore } from "../stores/runsStore";
import { labelForRole } from "./RunTrack";
import { DiffViewer } from "./DiffViewer";

const EMPTY_ENTRIES: LiveEntry[] = [];

interface ParsedArtifact {
  kind: string;
  text: string;
  refsWorktree?: boolean;
}

interface Props {
  stage: RunStage | null;
  workspacePath: string;
}

export function StageFocus({ stage, workspacePath }: Props) {
  const [diff, setDiff] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);
  const liveEntries = useRunsStore((s) => s.liveByStage[stage?.id ?? ""] ?? EMPTY_ENTRIES);
  const scrollRef = useRef<HTMLDivElement>(null);

  const artifact = useMemo<ParsedArtifact | null>(() => {
    if (!stage?.artifact) return null;
    try {
      return JSON.parse(stage.artifact) as ParsedArtifact;
    } catch {
      return null;
    }
  }, [stage?.artifact]);

  useEffect(() => {
    let cancelled = false;
    if (stage && artifact?.refsWorktree && workspacePath) {
      setDiff("");
      setDiffLoading(true);
      ipc.getGitDiff(workspacePath)
        .then((d) => { if (!cancelled) { setDiff(d); setDiffLoading(false); } })
        .catch(() => { if (!cancelled) { setDiff(""); setDiffLoading(false); } });
    } else {
      setDiff("");
      setDiffLoading(false);
    }
    return () => { cancelled = true; };
  }, [stage?.id, stage?.status, artifact?.refsWorktree, workspacePath]);

  // Keep the live journal pinned to the newest activity while a stage runs.
  useEffect(() => {
    if (stage?.status === "running" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveEntries, stage?.status]);

  const journal = useMemo(() => {
    const items: ReactElement[] = [];
    for (let i = 0; i < liveEntries.length; i++) {
      const e = liveEntries[i];
      if (e.kind === "text") {
        items.push(<div key={i} className="text-octo-sage">{e.text}</div>);
      } else if (e.kind === "notice") {
        items.push(<div key={i} className="font-mono text-[10px] uppercase tracking-[0.12em] text-octo-brass">{e.text}</div>);
      } else if (e.kind === "tool") {
        const next = liveEntries[i + 1];
        const res = next && next.kind === "tool_result" ? next : null;
        if (res) i++; // consume the paired result
        items.push(
          <div key={i} className="rounded-md border border-octo-hairline bg-octo-panel-2 px-3 py-2">
            <div className="flex items-center gap-2 font-mono text-[12px]">
              <span className="text-octo-brass">§</span>
              <span className="text-octo-ivory">{e.tool}</span>
              {e.hint && <><span className="text-octo-sage">·</span><span className="text-octo-sage">{e.hint}</span></>}
            </div>
            {res && (
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-octo-mute">
                <span className={res.ok ? "text-octo-verdigris" : "text-octo-rouge"}>{res.ok ? "✓" : "✕"}</span>
                <span>{res.detail}</span>
              </div>
            )}
          </div>,
        );
      } else if (e.kind === "tool_result") {
        // orphan result (no preceding tool in buffer) — render compactly
        items.push(
          <div key={i} className="flex items-center gap-1.5 font-mono text-[11px] text-octo-mute">
            <span className={e.ok ? "text-octo-verdigris" : "text-octo-rouge"}>{e.ok ? "✓" : "✕"}</span>
            <span>{e.detail}</span>
          </div>,
        );
      }
    }
    return items;
  }, [liveEntries]);

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
      <div
        ref={scrollRef}
        className="chat-selectable flex flex-1 flex-col gap-2 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-octo-sage"
      >
        {stage.status === "failed" && stage.error ? (
          <>
            <span className="text-octo-rouge">{stage.error}</span>
            {journal.length > 0 && <div className="mt-2 flex flex-col gap-2 opacity-70">{journal}</div>}
          </>
        ) : artifact ? (
          <div className="whitespace-pre-wrap">
            {artifact.text || "(no output text)"}
            {artifact.refsWorktree &&
              (diffLoading ? (
                <div className="p-4 font-mono text-xs text-octo-mute">Loading diff…</div>
              ) : (
                <DiffViewer diff={diff} />
              ))}
          </div>
        ) : stage.status === "running" ? (
          <>
            {journal}
            <div className="flex items-center gap-2 text-octo-brass"><span>working…</span></div>
          </>
        ) : (
          <span className="text-octo-mute">No artifact yet.</span>
        )}
      </div>
    </div>
  );
}
