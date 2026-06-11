/**
 * HistoryModal — commit log browser for the Review mode (G7 slice III).
 *
 * A ModalShell over a windowed, paginated `git log`: mono rows (short sha ·
 * summary · author + relative time), click-to-expand inline commit diff
 * (vs first parent), a quiet "More" for the next page, and a per-row
 * copy-SHA affordance.
 */

import { useEffect, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { ipc } from "../lib/ipc";
import type { CommitInfo } from "../lib/ipc";
import { copyToClipboard } from "../lib/clipboard";
import { pushToast } from "./Toasts";
import { ModalShell } from "./ModalShell";
import { Reveal } from "./primitives/Reveal";

/** Page size for the log walk — a full page implies "there may be more". */
export const HISTORY_PAGE = 50;

interface Props {
  projectPath: string;
  onClose: () => void;
}

function formatRelTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function HistoryModal({ projectPath, onClose }: Props) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [diffBySha, setDiffBySha] = useState<Record<string, string>>({});

  async function loadPage(skip: number) {
    try {
      const page = await ipc.gitLog(projectPath, HISTORY_PAGE, skip);
      setCommits((prev) => (skip === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === HISTORY_PAGE);
    } catch (e) {
      pushToast({ level: "error", title: "Couldn't load history", body: String(e) });
    } finally {
      setLoaded(true);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  async function toggleExpand(c: CommitInfo) {
    if (expandedSha === c.sha) {
      setExpandedSha(null);
      return;
    }
    setExpandedSha(c.sha);
    if (diffBySha[c.sha] === undefined) {
      try {
        const diff = await ipc.commitDiff(projectPath, c.sha);
        setDiffBySha((prev) => ({ ...prev, [c.sha]: diff }));
      } catch (e) {
        setDiffBySha((prev) => ({ ...prev, [c.sha]: `Couldn't load this diff: ${e}` }));
      }
    }
  }

  return (
    <ModalShell onClose={onClose} ariaLabel="Commit history" panelClassName="w-[680px] max-w-[92vw]">
      <div className="flex max-h-[72vh] flex-col overflow-hidden rounded-lg border border-octo-hairline bg-octo-panel">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-octo-hairline px-4">
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-octo-brass">
            History
          </span>
          {loaded && commits.length > 0 && (
            <span className="font-mono text-[10px] text-octo-mute">
              {commits.length}
              {hasMore ? "+" : ""} commit{commits.length === 1 && !hasMore ? "" : "s"}
            </span>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!loaded ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={14} className="animate-spin text-octo-mute" />
            </div>
          ) : commits.length === 0 ? (
            <div className="px-4 py-10 text-center font-serif text-[13px] text-octo-mute">
              No commits yet on this branch.
            </div>
          ) : (
            <ul>
              {commits.map((c) => {
                const open = expandedSha === c.sha;
                return (
                  <li key={c.sha} className="octo-rise-in border-b border-octo-hairline/60 last:border-b-0">
                    <div
                      className={`group flex items-center gap-2 px-4 transition-colors ${
                        open ? "bg-[var(--brass-ghost)]" : "hover:bg-octo-panel-2"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void toggleExpand(c)}
                        title={open ? "Collapse this commit's diff" : "Show this commit's diff"}
                        className="flex min-w-0 flex-1 items-baseline gap-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
                      >
                        <span
                          className="shrink-0 font-mono text-[10.5px]"
                          style={{ color: "var(--brass-dim)" }}
                        >
                          {c.shaShort}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-octo-ivory">
                          {c.summary}
                        </span>
                        <span className="shrink-0 font-mono text-[9.5px] text-octo-mute">
                          {c.authorName} · {formatRelTime(c.timestampMs)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="Copy SHA"
                        title={`Copy ${c.sha}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyToClipboard(c.sha, "SHA copied");
                        }}
                        className="shrink-0 rounded p-1 text-octo-mute opacity-0 transition group-hover:opacity-70 hover:!text-octo-brass focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                    <Reveal open={open}>
                      <div className="border-t border-octo-hairline/60 bg-octo-onyx px-4 py-2">
                        {diffBySha[c.sha] === undefined ? (
                          <div className="flex items-center gap-2 py-1 font-mono text-[10px] text-octo-mute">
                            <Loader2 size={10} className="animate-spin" /> loading diff
                          </div>
                        ) : diffBySha[c.sha] === "" ? (
                          <div className="py-1 font-serif text-[12px] text-octo-mute">
                            This commit introduces no textual changes.
                          </div>
                        ) : (
                          <pre className="max-h-72 overflow-auto whitespace-pre font-mono text-[11px] leading-[1.55] text-octo-sage">
                            {diffBySha[c.sha]}
                          </pre>
                        )}
                      </div>
                    </Reveal>
                  </li>
                );
              })}
            </ul>
          )}

          {loaded && hasMore && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  void loadPage(commits.length);
                }}
                title="Load older commits"
                className="rounded px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-octo-mute transition-colors hover:text-octo-brass disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
              >
                {loadingMore ? "…" : "More"}
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
