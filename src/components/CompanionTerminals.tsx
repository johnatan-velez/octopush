export interface CompanionTerminal {
  id: string;
  label: string;
  meta: string;
}

interface Props {
  terminals: CompanionTerminal[];
  activeTerminalId: string | null;
  onSelectTerminal: (id: string) => void;
  onNewTerminal: () => void;
}

export function CompanionTerminals({
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onNewTerminal,
}: Props) {
  return (
    <section>
      <div className="flex items-center justify-between border-b border-octo-hairline pb-2">
        <h3 className="font-mono text-[8px] uppercase tracking-[0.3em] text-octo-brass">
          Terminals
        </h3>
        <button
          type="button"
          onClick={onNewTerminal}
          className="font-mono text-[10px] text-octo-mute transition hover:text-octo-brass"
          title="New terminal"
        >
          +
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {terminals.length === 0 && (
          <li className="px-2 py-1 text-[11px] italic text-octo-mute">No active terminals.</li>
        )}
        {terminals.map((t) => {
          const active = t.id === activeTerminalId;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelectTerminal(t.id)}
                className="w-full rounded-md px-2 py-1.5 text-left transition"
                style={
                  active
                    ? { borderLeft: "1px solid var(--brass-dim)", background: "var(--brass-ghost)" }
                    : undefined
                }
              >
                <div className="font-serif italic text-[12px] leading-tight text-octo-ivory">
                  {t.label}
                </div>
                <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.15em] text-octo-mute">
                  {t.meta}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
