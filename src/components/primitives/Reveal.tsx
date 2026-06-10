// src/components/primitives/Reveal.tsx
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  className?: string;
  children: ReactNode;
}

/** Stability rule S4 — height changes are animated. Expand/collapse on the
 *  sanctioned grid-rows 0fr↔1fr idiom (design-system §6). Content stays
 *  mounted; the closed state is inert so nothing inside is interactive. */
export function Reveal({ open, className = "", children }: Props) {
  return (
    <div
      aria-hidden={!open}
      className={`grid ${className}`}
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        transition:
          "grid-template-rows var(--dur-standard) var(--ease-octo), opacity var(--dur-standard) var(--ease-octo)",
      }}
    >
      <div className="min-h-0 overflow-hidden" inert={!open}>
        {children}
      </div>
    </div>
  );
}
