import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import type { PtyDataEvent, PtyExitEvent } from "../lib/types";

interface Props {
  sessionId: string;
  /** When false the terminal stays alive in the DOM but hidden via CSS. */
  visible: boolean;
}

/**
 * Persistent xterm.js instance bound to a PTY session.
 *
 * The terminal is created once on mount and kept alive across tab switches.
 * Only the `visible` prop toggles CSS visibility — no teardown/rebuild.
 * The component unmounts only when the session is deleted.
 */
export function TerminalPane({ sessionId, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);

  // Refit + focus when becoming visible or when the container resizes.
  const doFit = useCallback(() => {
    const fit = fitRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    try {
      fit.fit();
      ipc.resizeSession(sessionId, term.rows, term.cols).catch(() => {});
    } catch {
      /* container not measured yet */
    }
  }, [sessionId]);

  // Create terminal once.
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      theme: {
        background: "#0a0a0b",
        foreground: "#e4e4e7",
        cursor: "#a78bfa",
        cursorAccent: "#0a0a0b",
        selectionBackground: "#3f3f46",
        black: "#18181b",
        red: "#f87171",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#a78bfa",
        cyan: "#22d3ee",
        white: "#d4d4d8",
        brightBlack: "#3f3f46",
        brightRed: "#fca5a5",
        brightGreen: "#6ee7b7",
        brightYellow: "#fcd34d",
        brightBlue: "#93c5fd",
        brightMagenta: "#c4b5fd",
        brightCyan: "#67e8f9",
        brightWhite: "#fafafa",
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    // ResizeObserver for auto-fit.
    const ro = new ResizeObserver(() => {
      if (containerRef.current?.offsetParent !== null) {
        try {
          fit.fit();
          ipc.resizeSession(sessionId, term.rows, term.cols).catch(() => {});
        } catch { /* */ }
      }
    });
    ro.observe(containerRef.current);

    // PTY → term: stream bytes from backend event bus.
    let unlistenData: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;

    listen<PtyDataEvent>("pty://data", (ev) => {
      if (ev.payload.sessionId !== sessionId) return;
      term.write(new Uint8Array(ev.payload.bytes));
    }).then((u) => {
      unlistenData = u;
    });

    listen<PtyExitEvent>("pty://exit", (ev) => {
      if (ev.payload.sessionId !== sessionId) return;
      term.writeln("\r\n\x1b[2;37m[session exited]\x1b[0m");
    }).then((u) => {
      unlistenExit = u;
    });

    // term → PTY: forward user keystrokes.
    const dataDisp = term.onData((data) => {
      ipc.writeTextToSession(sessionId, data).catch((err) => {
        console.error("write to pty failed", err);
      });
    });

    const resizeDisp = term.onResize(({ rows, cols }) => {
      ipc.resizeSession(sessionId, rows, cols).catch(() => {});
    });

    return () => {
      dataDisp.dispose();
      resizeDisp.dispose();
      ro.disconnect();
      unlistenData?.();
      unlistenExit?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  // Refit + focus when becoming visible.
  useEffect(() => {
    if (visible) {
      // Delay slightly so the container has layout dimensions.
      const id = requestAnimationFrame(() => {
        doFit();
        termRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [visible, doFit]);

  return (
    <div
      ref={containerRef}
      className="xterm-container h-full w-full"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
