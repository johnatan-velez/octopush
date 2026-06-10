// src/components/controls/Listbox.tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ListboxOption {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  value: string | null;
  options: ListboxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}

const PANEL_MAX_H = 280;

/** Anchored popover listbox in the ModelPicker's visual language.
 *  Portal + position:fixed so overflow containers never clip it (PR #8 lesson). */
export function Listbox({ value, options, onChange, placeholder = "—", ariaLabel, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const current = options.find((o) => o.value === value) ?? null;

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const estimated = Math.min(PANEL_MAX_H, options.length * 34 + 8);
    const fitsBelow = window.innerHeight - r.bottom >= estimated + 8;
    setPos({ top: fitsBelow ? r.bottom + 4 : Math.max(8, r.top - 4 - estimated), left: r.left, width: Math.max(r.width, 200) });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !anchorRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-md border border-octo-hairline bg-octo-onyx px-2.5 py-1.5 text-left transition-colors duration-[180ms] hover:border-[var(--brass-dim)] ${className}`}
      >
        <span className={`truncate font-serif text-sm ${current ? "text-octo-ivory" : "text-octo-mute"}`}>
          {current?.label ?? placeholder}
        </span>
        <span className="ml-auto font-mono text-[9px] text-octo-mute">▾</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            className="octo-menu-enter fixed z-50 overflow-auto rounded-md border border-octo-hairline bg-octo-panel py-1 shadow-xl"
            style={{ top: pos.top, left: pos.left, minWidth: pos.width, maxHeight: PANEL_MAX_H }}
          >
            {options.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors duration-[120ms] hover:bg-octo-panel-2 ${
                    active ? "bg-[var(--brass-ghost)]" : ""
                  }`}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className={`font-serif text-sm ${active ? "text-octo-brass" : "text-octo-ivory"}`}>{o.label}</span>
                    {active && <span className="ml-auto font-mono text-[10px] text-octo-brass">✓</span>}
                  </span>
                  {o.description && <span className="font-mono text-[10px] text-octo-mute">{o.description}</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
