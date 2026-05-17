import type { FileChange } from "../lib/types";

interface Props {
  changedFiles: FileChange[];
}

export function CompanionChanged({ changedFiles }: Props) {
  return (
    <section>
      <h3 className="border-b border-octo-hairline pb-2 font-mono text-[8px] uppercase tracking-[0.3em] text-octo-brass">
        Changed · {changedFiles.length}
      </h3>
      <ul className="mt-2 space-y-1">
        {changedFiles.length === 0 && (
          <li className="px-2 py-1 text-[11px] italic text-octo-mute">
            No unstaged changes.
          </li>
        )}
        {changedFiles.map((f) => (
          <li key={f.path} className="px-2 py-1 font-mono text-[10px] text-octo-sage">
            <span className="text-octo-brass">●</span> {f.path}
            <span className="ml-2 text-octo-mute">[{f.status}]</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
