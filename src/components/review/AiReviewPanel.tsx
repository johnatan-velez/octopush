import { useMemo } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useAiReview, diffHash } from "../../stores/aiReviewStore";
import { AiFindingCard } from "./AiFindingCard";
import { FadeSwap } from "../primitives/FadeSwap";
import { ModelPicker } from "../ModelPicker";

export function AiReviewPanel({
  workspaceId,
  gitDiff,
  onJump,
  onEdit,
  embedded = false,
  onClose,
}: {
  workspaceId: string;
  gitDiff: string;
  onJump: (file: string, line: number | null) => void;
  /** Open a finding's file in the editor at its line, to fix it directly. */
  onEdit?: (file: string, line: number | null) => void;
  /** Embedded in the Diff canvas drawer: always-open body, no collapse chevron,
   *  optional close affordance. Default (companion-style) keeps the collapse. */
  embedded?: boolean;
  onClose?: () => void;
}) {
  // Collapse lives in the store (per workspace) so it survives the
  // mode-switch remount; a local useState would reopen/reclose on return.
  const collapsed = useAiReview((s) => s.collapsedFor(workspaceId));
  const setCollapsed = useAiReview((s) => s.setCollapsed);
  const model = useAiReview((s) => s.modelFor(workspaceId));
  const setModel = useAiReview((s) => s.setModel);
  const review = useAiReview((s) => s.reviewFor(workspaceId));
  const run = useAiReview((s) => s.run);

  const hasDiff = gitDiff.trim().length > 0;
  const dh = useMemo(() => diffHash(gitDiff), [gitDiff]);
  const stale = review.status === "done" && review.diffHash !== dh;

  const start = () => {
    if (!hasDiff) return;
    setCollapsed(workspaceId, false);
    void run(workspaceId, gitDiff);
  };

  // One discriminant per mutually-exclusive body view, so FadeSwap
  // crossfades between them instead of teleporting the subtree.
  const bodyKey = !hasDiff ? "no-diff" : review.status;

  const body = (
    <FadeSwap swapKey={bodyKey} className="px-4 pb-3">
      {!hasDiff ? (
        <p className="text-[11px] text-octo-mute">Nothing to review.</p>
      ) : review.status === "running" ? (
        <div className="flex items-center gap-2 text-[11px] text-octo-sage">
          <Loader2 size={12} className="animate-spin" /> Reading the change…
        </div>
      ) : review.status === "error" ? (
        <p className="text-[11px] text-octo-rouge">
          {review.error}{" "}
          <button onClick={start} className="text-octo-brass focus-visible:ring-1 focus-visible:ring-octo-brass">Retry</button>
        </p>
      ) : review.status === "done" ? (
        <div className="space-y-1.5">
          {stale && (
            <button onClick={start} className="font-mono text-[10px] text-octo-brass focus-visible:ring-1 focus-visible:ring-octo-brass">
              diff changed — re-run ⟶
            </button>
          )}
          <p className="text-[11px] leading-[1.5] text-octo-sage">{review.result!.summary}</p>
          {review.result!.findings.map((f, i) => (
            <AiFindingCard key={`${f.file ?? ""}:${f.line ?? ""}:${f.title}:${i}`} finding={f} onJump={onJump} onEdit={onEdit} />
          ))}
          {review.result!.findings.length === 0 && (
            <p className="text-[11px] text-octo-verdigris">No issues found.</p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-octo-mute">Run an AI review of the current change.</p>
      )}
    </FadeSwap>
  );

  const count = review.status === "done" ? review.result!.findings.length : null;
  const countLabel =
    count != null ? `${count} finding${count !== 1 ? "s" : ""}` : null;

  return (
    <div className={embedded ? "flex min-h-0 flex-1 flex-col" : "border-b border-octo-hairline"}>
      <div className="flex h-11 shrink-0 items-center gap-2 px-4">
        {embedded ? (
          <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.3em] text-octo-brass">
            § AI Review
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(workspaceId, !collapsed)}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand AI review" : "Collapse AI review"}
            className="flex items-center gap-1.5 rounded font-mono text-[9px] uppercase tracking-[0.3em] text-octo-brass transition hover:bg-[var(--brass-ghost)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
          >
            <span>§ AI Review</span>
            <ChevronDown
              size={12}
              aria-hidden
              className={`text-octo-mute transition-transform duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.3,1)] ${collapsed ? "-rotate-90" : ""}`}
            />
          </button>
        )}
        {countLabel && (
          <span className="font-mono text-[9px] text-octo-mute">{countLabel}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <ModelPicker activeModel={model} onSelectModel={(m) => setModel(workspaceId, m)} />
          {hasDiff && review.status !== "running" && (
            <button
              type="button"
              onClick={start}
              className="rounded font-mono text-[10px] text-octo-brass transition hover:text-octo-ivory focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
            >
              {review.status === "done" ? "re-review ⟶" : "review this change ⟶"}
            </button>
          )}
          {embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close AI review"
              title="Close AI review"
              className="flex h-6 w-6 items-center justify-center rounded text-octo-mute transition-colors hover:bg-octo-panel-2 hover:text-octo-sage focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-octo-brass"
            >
              <X size={14} />
            </button>
          )}
        </span>
      </div>

      {embedded ? (
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      ) : (
        <div
          className="grid transition-[grid-template-rows] duration-[var(--dur-standard)]"
          style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
        >
          <div className="min-h-0 overflow-hidden">{body}</div>
        </div>
      )}
    </div>
  );
}
