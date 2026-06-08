import type { Run, RunStage } from "../lib/ipc";

interface Props {
  run: Run;
  stages: RunStage[];
}

export function RunCostMeter({ run, stages }: Props) {
  const saved = Math.max(0, run.baselineUsd - run.costUsd);
  const pct = run.baselineUsd > 0 ? Math.round((saved / run.baselineUsd) * 100) : 0;
  const fillPct = run.baselineUsd > 0 ? Math.min(100, (run.costUsd / run.baselineUsd) * 100) : 0;
  return (
    <div className="m-4 rounded-lg border border-octo-hairline bg-octo-panel-2 p-4 octo-rise-in">
      <div className="mb-2 flex items-baseline gap-4">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-octo-mute">spent</div>
          <div className="font-serif text-2xl text-octo-brass">${run.costUsd.toFixed(2)}</div>
        </div>
        {run.baselineUsd > 0 && (
          <div className="font-mono text-xs text-octo-verdigris">
            ↓ saved ${saved.toFixed(2)} ({pct}%) vs all-premium
          </div>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded bg-octo-onyx">
        <div className="h-full rounded bg-octo-brass" style={{ width: `${fillPct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-octo-mute">
        {stages.filter((s) => s.costUsd > 0).map((s) => (
          <span key={s.id}>{s.role} <b className="text-octo-sage">${s.costUsd.toFixed(2)}</b></span>
        ))}
      </div>
    </div>
  );
}
