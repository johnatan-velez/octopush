import type { ReactNode } from "react";

interface Props {
  active: boolean;
  children: ReactNode;
}

/** The positioned, opacity-gated container shared by every workspace-mode canvas overlay. */
export function ModeOverlay({ active, children }: Props) {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-200 ease-out"
      style={{
        opacity: active ? 1 : 0,
        pointerEvents: active ? "auto" : "none",
        visibility: active ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
}
