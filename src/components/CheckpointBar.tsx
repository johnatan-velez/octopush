import { useState } from "react";
import type { RunStage } from "../lib/ipc";
import { labelForRole } from "./RunTrack";
import { FadeSwap } from "./primitives/FadeSwap";

interface LoopState {
  iteration: number;
  max: number;
}

interface Props {
  blockedStage: RunStage;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  onAbort: () => void;
  /** Human-readable label for the loop target stage, or null when no loop applies. */
  loopTargetRole: string | null;
  /** Current loop iteration state, or null when no loop applies. */
  loopState: LoopState | null;
  onSendBack: (feedback: string) => void;
}

export function CheckpointBar({ blockedStage, onApprove, onReject, onAbort, loopTargetRole, loopState, onSendBack }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [sendBackFeedback, setSendBackFeedback] = useState("");
  const failed = blockedStage.status === "failed";

  const atCap = loopState !== null && loopState.iteration >= loopState.max;
  const canSendBack = loopTargetRole !== null && !atCap;

  function handleSendBack() {
    onSendBack(sendBackFeedback);
    setSendingBack(false);
    setSendBackFeedback("");
  }

  function handleReject() {
    onReject(rejectFeedback);
    setRejecting(false);
    setRejectFeedback("");
  }

  const mode = rejecting ? "reject" : sendingBack ? "sendback" : "decide";

  return (
    <div className={`border-t px-4 py-3 ${failed ? "border-octo-rouge bg-[var(--rouge-ghost)]" : "border-[var(--brass-dim)] bg-[var(--brass-faint)]"}`}>
      {loopState !== null && (
        <div className="mb-2 h-4 font-mono text-[10px] uppercase tracking-[0.25em]">
          {atCap ? (
            <span className="text-octo-brass">
              loop exhausted · <span className="octo-tabular">{loopState.iteration}/{loopState.max}</span> — approve or abort
            </span>
          ) : (
            <span className="text-octo-mute">
              review loop · <span className="octo-tabular">{loopState.iteration} of {loopState.max}</span> used
            </span>
          )}
        </div>
      )}

      <FadeSwap swapKey={mode}>
        {mode === "decide" ? (
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[10px] uppercase tracking-[0.25em] ${failed ? "text-octo-rouge" : "text-octo-brass"}`}>
              {failed ? "✕ stage halted" : "⟜ checkpoint"}
            </span>
            <span className="flex-1 text-sm text-octo-sage">
              {failed ? (
                <>Stage <b className="text-octo-ivory">{labelForRole(blockedStage.role)}</b> halted. Re-run it or abort the run.</>
              ) : (
                <>Review <b className="text-octo-ivory">{labelForRole(blockedStage.role)}</b> and choose how to proceed.</>
              )}
            </span>
            {!failed && (
              <button type="button" onClick={onApprove}
                className="rounded-md bg-octo-brass px-3 py-1.5 font-serif text-sm text-octo-onyx transition-colors duration-[180ms] hover:bg-octo-brass-hi">
                Approve &amp; continue
              </button>
            )}
            {canSendBack && (
              <button type="button" onClick={() => setSendingBack(true)}
                className="rounded-md border border-octo-brass px-3 py-1.5 font-serif text-sm text-octo-brass transition-colors duration-[180ms] hover:bg-[var(--brass-ghost)]">
                Send back to {loopTargetRole} ⟜
              </button>
            )}
            <button type="button" onClick={() => setRejecting(true)}
              className="rounded-md border border-octo-hairline px-3 py-1.5 font-mono text-xs text-octo-sage transition-colors duration-[180ms] hover:text-octo-ivory">
              {failed ? "Re-run" : "Reject"}
            </button>
            <button type="button" onClick={onAbort}
              className="rounded-md border border-octo-hairline px-3 py-1.5 font-mono text-xs text-octo-mute transition-colors duration-[180ms] hover:text-octo-rouge">
              Abort
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              autoFocus
              value={mode === "reject" ? rejectFeedback : sendBackFeedback}
              onChange={(e) => (mode === "reject" ? setRejectFeedback(e.target.value) : setSendBackFeedback(e.target.value))}
              placeholder={mode === "reject" ? "Optional feedback for the re-run…" : "Optional feedback for the send-back…"}
              className="h-20 resize-none rounded-md border border-octo-hairline bg-octo-onyx px-3 py-2 font-mono text-xs text-octo-ivory placeholder:font-serif placeholder:text-octo-mute"
            />
            <div className="flex gap-2">
              <button type="button" onClick={mode === "reject" ? handleReject : handleSendBack}
                className="rounded-md bg-octo-brass px-3 py-1.5 font-serif text-sm text-octo-onyx transition-colors duration-[180ms] hover:bg-octo-brass-hi">
                {mode === "reject" ? "Re-run the stage ⟶" : "Send back ⟶"}
              </button>
              <button type="button"
                onClick={() => { setRejecting(false); setSendingBack(false); setRejectFeedback(""); setSendBackFeedback(""); }}
                className="rounded-md border border-octo-hairline px-3 py-1.5 font-mono text-xs text-octo-mute">
                Cancel
              </button>
            </div>
          </div>
        )}
      </FadeSwap>
    </div>
  );
}
