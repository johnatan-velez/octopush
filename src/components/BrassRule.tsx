// Brass-gradient divider that grows from 0 to 28px on mount.
// Replaces the recurring static <div className="h-px w-7" style={{ background:
// "linear-gradient(...)" }} /> pattern across entry flows + empty states.

interface Props {
  /** Extra layout className. Pass Tailwind margin utilities to position it. */
  className?: string;
}

export function BrassRule({ className = "" }: Props) {
  return (
    <div
      aria-hidden
      className={`animate-brass-grow h-px ${className}`}
      style={{
        background: "linear-gradient(90deg, var(--color-octo-brass), transparent)",
      }}
    />
  );
}
