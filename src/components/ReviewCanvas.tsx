/**
 * ReviewCanvas — diff-first canvas for the Review mode.
 *
 * Renders hunks as Accept/Reject/Why? cards. Includes a toolbar with
 * Diff/Editor toggle, test runner, and Accept-all button.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  GitBranch,
  CheckCircle,
  XCircle,
  HelpCircle,
  ChevronRight,
  X,
  Play,
  Loader2,
  PenLine,
  LayoutList,
  CheckSquare,
  AlertCircle,
} from "lucide-react";
import { ipc } from "../lib/ipc";
import { parseFullDiff, type DiffFile, type DiffHunk } from "../lib/diffParser";
import type { ChatMessage, FileEdit, GitStatus, TestRunResult } from "../lib/types";

// ─── Types ─────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  workspacePath: string;
  gitStatus: GitStatus | null;
  gitDiff: string;
  /** Callback to request parent to re-fetch diff (after Accept/Reject). */
  onDiffChange?: () => void;
  /** Default test command (pre-fill before the user saves one). */
  initialTestCommand?: string | null;
  /** Render children (Editor mode) when not in diff view. */
  children?: React.ReactNode;
}

// ─── Hunk card ─────────────────────────────────────────────────────

interface HunkCardProps {
  file: DiffFile;
  hunk: DiffHunk;
  workspacePath: string;
  workspaceId: string;
  fileEdits: FileEdit[];
  onAccepted: () => void;
  onRejected: () => void;
}

function HunkCard({
  file,
  hunk,
  workspacePath,
  workspaceId,
  fileEdits,
  onAccepted,
  onRejected,
}: HunkCardProps) {
  const [status, setStatus] = useState<"idle" | "accepting" | "rejecting" | "accepted" | "rejected">("idle");
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyMessage, setWhyMessage] = useState<ChatMessage | null>(null);
  const [whyLoading, setWhyLoading] = useState(false);
  const [whyError, setWhyError] = useState<string | null>(null);

  async function handleAccept() {
    setStatus("accepting");
    try {
      await ipc.stageHunk(workspacePath, hunk.rawText);
      setStatus("accepted");
      onAccepted();
    } catch (e) {
      console.error("stage hunk failed:", e);
      setStatus("idle");
    }
  }

  async function handleReject() {
    setStatus("rejecting");
    try {
      await ipc.revertHunk(workspacePath, hunk.rawText);
      setStatus("rejected");
      setTimeout(onRejected, 400); // brief delay so user sees the state change
    } catch (e) {
      console.error("revert hunk failed:", e);
      setStatus("idle");
    }
  }

  async function handleWhy() {
    setWhyOpen(true);
    if (whyMessage || whyLoading) return;
    setWhyLoading(true);
    setWhyError(null);
    try {
      const edits = await ipc.listFileEdits(workspaceId);
      const relevant = edits.find((e) => e.filePath === file.filePath || file.filePath.endsWith(e.filePath));
      if (relevant?.messageId != null) {
        const msg = await ipc.getMessage(relevant.messageId);
        setWhyMessage(msg);
      } else {
        // Try to find in already-loaded fileEdits prop
        const fromProp = fileEdits.find(
          (e) => e.filePath === file.filePath || file.filePath.endsWith(e.filePath),
        );
        if (fromProp?.messageId != null) {
          const msg = await ipc.getMessage(fromProp.messageId);
          setWhyMessage(msg);
        } else {
          setWhyError("No agent message linked to this file. Was it edited by an agent?");
        }
      }
    } catch (e) {
      setWhyError(String(e));
    } finally {
      setWhyLoading(false);
    }
  }

  if (status === "rejected") return null;

  const isAccepted = status === "accepted";

  return (
    <div
      className={[
        "rounded-md border transition-all duration-200",
        isAccepted
          ? "border-octo-hairline bg-octo-panel/40 opacity-60"
          : "border-octo-hairline bg-octo-panel",
      ].join(" ")}
    >
      {/* Hunk header */}
      <div className="flex items-center gap-2 border-b border-octo-hairline px-3 py-1.5">
        <span className="font-mono text-[10px] text-octo-textMuted">{hunk.header}</span>
        <span className="ml-auto flex items-center gap-2 text-[10px]">
          {hunk.additions > 0 && (
            <span className="text-octo-success">+{hunk.additions}</span>
          )}
          {hunk.deletions > 0 && (
            <span className="text-octo-danger">-{hunk.deletions}</span>
          )}
          {isAccepted && (
            <span className="rounded-sm bg-octo-brass/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-octo-brass">
              Staged
            </span>
          )}
        </span>
      </div>

      {/* Diff lines */}
      <div className="overflow-x-auto">
        <pre className="px-0 font-mono text-xs leading-relaxed">
          {hunk.lines.map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </pre>
      </div>

      {/* Action bar */}
      {!isAccepted && (
        <div className="flex items-center justify-end gap-2 border-t border-octo-hairline px-3 py-2">
          <button
            onClick={handleWhy}
            disabled={whyLoading}
            className="flex items-center gap-1 rounded px-2.5 py-1 text-xs text-octo-textMuted transition-colors hover:bg-octo-bg hover:text-octo-text"
          >
            <HelpCircle size={12} />
            Why?
          </button>
          <button
            onClick={handleReject}
            disabled={status === "rejecting" || status === "accepting"}
            className="flex items-center gap-1 rounded px-2.5 py-1 text-xs text-octo-danger/80 transition-colors hover:bg-octo-danger/10 hover:text-octo-danger"
          >
            {status === "rejecting" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <XCircle size={12} />
            )}
            Reject
          </button>
          <button
            onClick={handleAccept}
            disabled={status === "rejecting" || status === "accepting"}
            className="flex items-center gap-1 rounded bg-octo-brass/10 px-2.5 py-1 text-xs text-octo-brass transition-colors hover:bg-octo-brass/20"
          >
            {status === "accepting" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CheckCircle size={12} />
            )}
            Accept
          </button>
        </div>
      )}

      {/* Why? drawer */}
      {whyOpen && (
        <div className="border-t border-octo-hairline bg-octo-bg/60 px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-octo-brass">
              § Agent origin
            </span>
            <button
              onClick={() => setWhyOpen(false)}
              className="rounded p-0.5 text-octo-textMuted hover:text-octo-text"
            >
              <X size={12} />
            </button>
          </div>
          {whyLoading && (
            <div className="flex items-center gap-2 text-xs text-octo-textMuted">
              <Loader2 size={12} className="animate-spin" />
              Looking up agent message…
            </div>
          )}
          {whyError && (
            <p className="text-xs text-octo-danger">{whyError}</p>
          )}
          {whyMessage && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[10px] text-octo-textMuted">
                <span className="font-mono">{whyMessage.role}</span>
                <span>·</span>
                <span>{new Date(whyMessage.createdAt).toLocaleTimeString()}</span>
                {whyMessage.model && (
                  <>
                    <span>·</span>
                    <span>{whyMessage.model}</span>
                  </>
                )}
              </div>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-octo-text">
                {whyMessage.content.length > 800
                  ? whyMessage.content.slice(0, 800) + "…"
                  : whyMessage.content}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Diff line ─────────────────────────────────────────────────────

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("@@")) {
    return (
      <div className="bg-blue-950/20 px-3 text-blue-400/80">{line}</div>
    );
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return (
      <div className="bg-emerald-950/25 px-3 text-emerald-300">{line}</div>
    );
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return (
      <div className="bg-red-950/25 px-3 text-red-300">{line}</div>
    );
  }
  return <div className="px-3 text-octo-textMuted">{line}</div>;
}

// ─── Test drawer ───────────────────────────────────────────────────

function TestDrawer({
  result,
  onClose,
}: {
  result: TestRunResult;
  onClose: () => void;
}) {
  const isPass = result.exitCode === 0;

  return (
    <div className="border-t border-octo-hairline bg-octo-bg">
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="font-mono text-xs font-semibold text-octo-text">Test output</span>
        <span
          className={[
            "ml-1 rounded px-2 py-0.5 font-mono text-[10px] font-semibold",
            isPass
              ? "bg-octo-success/20 text-octo-success"
              : "bg-octo-danger/20 text-octo-danger",
          ].join(" ")}
        >
          exit {result.exitCode}
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-octo-textMuted hover:text-octo-text"
          title="Dismiss (Esc)"
        >
          <X size={14} />
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto px-4 pb-3">
        {result.stdout && (
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-octo-text">
            {result.stdout}
          </pre>
        )}
        {result.stderr && (
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-octo-danger/80">
            {result.stderr}
          </pre>
        )}
        {!result.stdout && !result.stderr && (
          <p className="text-xs text-octo-textMuted">(no output)</p>
        )}
      </div>
    </div>
  );
}

// ─── ReviewCanvas ──────────────────────────────────────────────────

export function ReviewCanvas({
  workspaceId,
  workspacePath,
  gitStatus,
  gitDiff,
  onDiffChange,
  initialTestCommand,
  children,
}: Props) {
  const [viewMode, setViewMode] = useState<"diff" | "editor">("diff");
  const [fileEdits, setFileEdits] = useState<FileEdit[]>([]);

  // Test runner state
  const [testCommand, setTestCommand] = useState<string>("");
  const [testCommandEditing, setTestCommandEditing] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestRunResult | null>(null);
  const testInputRef = useRef<HTMLInputElement>(null);

  // Parse diff
  const diffFiles = parseFullDiff(gitDiff);

  // Load file edits for this workspace
  useEffect(() => {
    if (!workspaceId) return;
    ipc.listFileEdits(workspaceId).then(setFileEdits).catch(() => {});
  }, [workspaceId]);

  // Detect/load test command
  useEffect(() => {
    if (initialTestCommand) {
      setTestCommand(initialTestCommand);
      return;
    }
    ipc.detectDefaultTestCommand(workspacePath).then((cmd) => {
      if (cmd) setTestCommand(cmd);
    }).catch(() => {});
  }, [workspacePath, initialTestCommand]);

  // Dismiss test drawer on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setTestResult(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleTestCommandBlur = useCallback(async () => {
    setTestCommandEditing(false);
    if (testCommand.trim()) {
      try {
        await ipc.setWorkspaceTestCommand(workspaceId, testCommand.trim());
      } catch (e) {
        console.error("save test command failed:", e);
      }
    }
  }, [workspaceId, testCommand]);

  async function handleRunTests() {
    if (!testCommand.trim()) return;
    setTestRunning(true);
    setTestResult(null);
    try {
      const result = await ipc.runTestCommand(workspacePath, testCommand.trim());
      setTestResult(result);
    } catch (e) {
      setTestResult({ stdout: "", stderr: String(e), exitCode: -1 });
    } finally {
      setTestRunning(false);
    }
  }

  async function handleAcceptAll() {
    try {
      await ipc.stageAllChanges(workspacePath);
      onDiffChange?.();
    } catch (e) {
      console.error("stage all failed:", e);
    }
  }

  const branch = gitStatus?.branch ?? null;
  const fileCount = gitStatus?.changedFiles.length ?? 0;
  const addCount = gitDiff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const delCount = gitDiff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-octo-hairline px-4 py-2">
        {/* Branch + summary */}
        <div className="flex items-center gap-2 text-xs text-octo-textMuted">
          {branch && (
            <span className="flex items-center gap-1.5 rounded bg-zinc-800/80 px-2 py-0.5 font-mono">
              <GitBranch size={11} className="text-octo-brass" />
              <span className="text-octo-text">{branch}</span>
            </span>
          )}
          {fileCount > 0 && (
            <span>
              {fileCount} file{fileCount !== 1 ? "s" : ""}
              {" · "}
              <span className="text-emerald-400">+{addCount}</span>
              {" / "}
              <span className="text-red-400">-{delCount}</span>
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-octo-hairline">
            <button
              onClick={() => setViewMode("diff")}
              className={[
                "flex items-center gap-1 rounded-l-md px-2.5 py-1 text-xs transition-colors",
                viewMode === "diff"
                  ? "bg-octo-brass/10 text-octo-brass"
                  : "text-octo-textMuted hover:text-octo-text",
              ].join(" ")}
            >
              <LayoutList size={12} />
              Diff view
            </button>
            <button
              onClick={() => setViewMode("editor")}
              className={[
                "flex items-center gap-1 rounded-r-md border-l border-octo-hairline px-2.5 py-1 text-xs transition-colors",
                viewMode === "editor"
                  ? "bg-octo-brass/10 text-octo-brass"
                  : "text-octo-textMuted hover:text-octo-text",
              ].join(" ")}
            >
              <PenLine size={12} />
              Editor
            </button>
          </div>

          {/* Test runner */}
          <div className="flex items-center gap-1 rounded-md border border-octo-hairline px-1">
            {testCommandEditing ? (
              <input
                ref={testInputRef}
                value={testCommand}
                onChange={(e) => setTestCommand(e.target.value)}
                onBlur={handleTestCommandBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") testInputRef.current?.blur();
                  if (e.key === "Escape") {
                    setTestCommandEditing(false);
                  }
                }}
                className="w-32 bg-transparent px-1.5 py-1 font-mono text-xs text-octo-text outline-none placeholder-octo-textMuted"
                placeholder="npm test"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setTestCommandEditing(true)}
                className="px-1.5 py-1 font-mono text-xs text-octo-textMuted hover:text-octo-text"
                title="Click to edit test command"
              >
                {testCommand || "no test command"}
              </button>
            )}
            <button
              onClick={handleRunTests}
              disabled={!testCommand.trim() || testRunning}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-octo-textMuted transition-colors hover:bg-octo-bg hover:text-octo-text disabled:opacity-40"
              title="Run tests"
            >
              {testRunning ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
            </button>
          </div>

          {/* Accept all */}
          {fileCount > 0 && viewMode === "diff" && (
            <button
              onClick={handleAcceptAll}
              className="flex items-center gap-1.5 rounded-md bg-octo-brass/10 px-3 py-1 text-xs text-octo-brass transition-colors hover:bg-octo-brass/20"
              title="Stages every change. Commit from the left panel."
            >
              <CheckSquare size={12} />
              Accept all
            </button>
          )}
        </div>
      </header>

      {/* ── Content area ────────────────────────────────────────── */}
      <div className="relative min-h-0 flex-1">
        {/* Diff view */}
        {viewMode === "diff" && (
          <div className="absolute inset-0 overflow-y-auto">
            {diffFiles.length === 0 ? (
              <EmptyDiffState />
            ) : (
              <div className="space-y-6 px-4 py-4">
                {diffFiles.map((file) => (
                  <FileDiffSection
                    key={file.filePath}
                    file={file}
                    workspacePath={workspacePath}
                    workspaceId={workspaceId}
                    fileEdits={fileEdits}
                    onDiffChange={onDiffChange}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Editor mode — render children (EditorTabs + EditorPane) */}
        {viewMode === "editor" && (
          <div className="absolute inset-0 flex flex-col">{children}</div>
        )}
      </div>

      {/* ── Test result drawer ───────────────────────────────────── */}
      {testResult && (
        <div className="shrink-0">
          <TestDrawer result={testResult} onClose={() => setTestResult(null)} />
        </div>
      )}
    </div>
  );
}

// ─── File diff section ─────────────────────────────────────────────

interface FileDiffSectionProps {
  file: DiffFile;
  workspacePath: string;
  workspaceId: string;
  fileEdits: FileEdit[];
  onDiffChange?: () => void;
}

function FileDiffSection({
  file,
  workspacePath,
  workspaceId,
  fileEdits,
  onDiffChange,
}: FileDiffSectionProps) {
  const [visibleHunks, setVisibleHunks] = useState(() => file.hunks.map((_, i) => i));

  function removeHunk(idx: number) {
    setVisibleHunks((prev) => prev.filter((i) => i !== idx));
    onDiffChange?.();
  }

  if (visibleHunks.length === 0) return null;

  const typeLabel =
    file.changeType === "new"
      ? "new file"
      : file.changeType === "deleted"
        ? "deleted"
        : "modified";

  const typeColor =
    file.changeType === "new"
      ? "text-octo-success"
      : file.changeType === "deleted"
        ? "text-octo-danger"
        : "text-octo-textMuted";

  return (
    <div className="space-y-2">
      {/* File header */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-octo-text">{file.filePath}</span>
        <span className={`text-xs ${typeColor}`}>({typeLabel})</span>
        <ChevronRight size={13} className="text-octo-textMuted" />
        <span className="text-xs text-octo-textMuted">
          {visibleHunks.length} hunk{visibleHunks.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Hunk cards */}
      <div className="space-y-2">
        {visibleHunks.map((hunkIdx) => (
          <HunkCard
            key={hunkIdx}
            file={file}
            hunk={file.hunks[hunkIdx]}
            workspacePath={workspacePath}
            workspaceId={workspaceId}
            fileEdits={fileEdits}
            onAccepted={() => onDiffChange?.()}
            onRejected={() => removeHunk(hunkIdx)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────

function EmptyDiffState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <AlertCircle size={28} className="text-octo-textMuted opacity-40" />
      <p className="text-sm text-octo-textMuted">No changes to review</p>
      <p className="max-w-xs text-xs text-octo-textMuted opacity-60">
        Differences between this workspace and the base branch will appear here
        when the agent writes files.
      </p>
    </div>
  );
}
