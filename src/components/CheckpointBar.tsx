import { useState } from "react";
import type { RunStage } from "../lib/ipc";
import { labelForRole } from "./RunTrack";

interface Props {
  blockedStage: RunStage;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  onAbort: () => void;
}

export function CheckpointBar({ blockedStage, onApprove, onReject, onAbort }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const failed = blockedStage.status === "failed";

  return (
    <div className="m-4 rounded-lg border border-dashed border-octo-brass bg-[var(--brass-faint)] px-4 py-3 octo-pop-in">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-octo-brass">
          {failed ? "✕ stage failed" : "⟶ checkpoint"}
        </span>
        <span className="flex-1 text-sm text-octo-sage">
          {failed ? (
            <>Stage <b className="text-octo-ivory">{labelForRole(blockedStage.role)}</b> failed. Re-run or abort.</>
          ) : (
            <>Review <b className="text-octo-ivory">{labelForRole(blockedStage.role)}</b> and choose how to proceed.</>
          )}
        </span>
        {!rejecting && (
          <>
            {!failed && (
              <button type="button" onClick={onApprove}
                className="rounded-md bg-octo-brass px-3 py-1.5 font-serif text-sm text-octo-onyx">
                Approve &amp; continue
              </button>
            )}
            <button type="button" onClick={() => setRejecting(true)}
              className="rounded-md border border-octo-brass px-3 py-1.5 font-mono text-xs text-octo-brass">
              {failed ? "Re-run" : "Reject"}
            </button>
            <button type="button" onClick={onAbort}
              className="rounded-md border border-octo-hairline px-3 py-1.5 font-mono text-xs text-octo-mute hover:text-octo-rouge">
              Abort
            </button>
          </>
        )}
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2 octo-rise-in">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Optional feedback for the re-run…"
            className="h-20 resize-none rounded-md border border-octo-hairline bg-octo-onyx px-3 py-2 font-mono text-xs text-octo-ivory placeholder:text-octo-mute"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => { onReject(feedback); setRejecting(false); setFeedback(""); }}
              className="rounded-md bg-octo-brass px-3 py-1.5 font-serif text-sm text-octo-onyx">
              Re-run the stage ⟶
            </button>
            <button type="button" onClick={() => setRejecting(false)}
              className="rounded-md border border-octo-hairline px-3 py-1.5 font-mono text-xs text-octo-mute">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
