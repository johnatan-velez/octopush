/**
 * Atelier in Onyx & Brass — CodeMirror 6 theme.
 *
 * Octopush supports runtime theme switching (see stores/themeStore.ts), which
 * repaints the app by writing the design tokens as CSS variables on :root.
 * CodeMirror's theme() API, however, takes a plain JS object — it can't read
 * `var(--…)`. So instead of hardcoding hex, we resolve the live token values
 * from the document at build time and rebuild the extension whenever the theme
 * changes (EditorPane reconfigures a compartment on the `octo:theme` event).
 *
 * The static hex below are fallbacks only — used when a token is absent
 * (first paint before themeStore runs, or non-DOM test environments).
 */

import { EditorView } from "@codemirror/view";
import {
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

// ── Static fallbacks (canonical Onyx & Brass) ─────────────────────
const FALLBACK = {
  onyx:       "#0c0a08",
  panel:      "#14110d",
  hairline:   "#2a2419",
  brass:      "#d4a574",
  ivory:      "#f4ecdb",
  sage:       "#95897a",
  mute:       "#6d6354",
  rouge:      "#d18b8b",
  verdigris:  "#8fc9a8",
  brassGhost: "rgba(212, 165, 116, 0.08)",
  brassFaint: "rgba(212, 165, 116, 0.04)",
  brassGlow:  "rgba(212, 165, 116, 0.12)",
} as const;

export interface EditorTokens {
  onyx: string;
  panel: string;
  hairline: string;
  brass: string;
  ivory: string;
  sage: string;
  mute: string;
  rouge: string;
  verdigris: string;
  brassGhost: string;
  brassFaint: string;
  brassGlow: string;
}

/** Read one CSS custom property off :root, falling back when it's empty
 *  (no document, or the token hasn't been written yet). */
function readVar(name: string, fallback: string): string {
  if (typeof document === "undefined" || !document.documentElement) return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Resolve the live editor tokens from the active Octopush theme. */
export function resolveEditorTokens(): EditorTokens {
  return {
    onyx:       readVar("--color-octo-onyx", FALLBACK.onyx),
    panel:      readVar("--color-octo-panel", FALLBACK.panel),
    hairline:   readVar("--color-octo-hairline", FALLBACK.hairline),
    brass:      readVar("--color-octo-brass", FALLBACK.brass),
    ivory:      readVar("--color-octo-ivory", FALLBACK.ivory),
    sage:       readVar("--color-octo-sage", FALLBACK.sage),
    mute:       readVar("--color-octo-mute", FALLBACK.mute),
    rouge:      readVar("--color-octo-rouge", FALLBACK.rouge),
    verdigris:  readVar("--color-octo-verdigris", FALLBACK.verdigris),
    brassGhost: readVar("--brass-ghost", FALLBACK.brassGhost),
    brassFaint: readVar("--brass-faint", FALLBACK.brassFaint),
    brassGlow:  readVar("--brass-glow", FALLBACK.brassGlow),
  };
}

const MONO_STACK =
  '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace';

// ── Editor view theme spec ────────────────────────────────────────

/** Build the CodeMirror theme spec from a set of resolved tokens. The custom
 *  EditorSearch overlay replaces CodeMirror's native panel, but the `.cm-panels`
 *  / `.cm-panel.cm-search` rules are kept so the built-in panel still reads as
 *  Atelier if it is ever surfaced (e.g. go-to-line). */
export function makeEditorThemeSpec(t: EditorTokens): Record<string, Record<string, string>> {
  return {
    "&": {
      color: t.ivory,
      backgroundColor: t.onyx,
      fontSize: "13px",
      fontFamily: MONO_STACK,
    },

    ".cm-content": {
      caretColor: t.brass,
      padding: "8px 0",
    },

    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: t.brass,
      borderLeftWidth: "2px",
    },

    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: t.brassGhost,
    },

    ".cm-gutters": {
      backgroundColor: t.panel,
      color: t.mute,
      border: "none",
      borderRight: `1px solid ${t.hairline}`,
    },

    ".cm-activeLineGutter": {
      backgroundColor: t.brassFaint,
    },

    ".cm-activeLine": {
      backgroundColor: t.brassFaint,
    },

    ".cm-lineNumbers .cm-gutterElement": {
      paddingRight: "12px",
      paddingLeft: "8px",
      minWidth: "32px",
    },

    ".cm-foldGutter .cm-gutterElement": {
      color: t.mute,
    },

    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: t.brassGlow,
    },

    ".cm-tooltip": {
      backgroundColor: t.panel,
      border: `1px solid ${t.hairline}`,
      color: t.ivory,
    },

    // ── Search / go-to-line panel (Atelier) ─────────────────────────
    ".cm-panels": {
      backgroundColor: t.panel,
      color: t.ivory,
      borderTop: `1px solid ${t.hairline}`,
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: `1px solid ${t.hairline}`,
      borderTop: "none",
    },
    ".cm-panel.cm-search": {
      padding: "6px 8px",
      fontFamily: MONO_STACK,
      fontSize: "11px",
    },
    ".cm-panel.cm-search input, .cm-panel.cm-search input[type=text]": {
      backgroundColor: t.onyx,
      color: t.ivory,
      border: `1px solid ${t.hairline}`,
      borderRadius: "4px",
      padding: "2px 6px",
      outline: "none",
    },
    ".cm-panel.cm-search input:focus": {
      borderColor: t.brass,
    },
    ".cm-panel.cm-search .cm-button": {
      backgroundColor: "transparent",
      backgroundImage: "none",
      color: t.sage,
      border: `1px solid ${t.hairline}`,
      borderRadius: "4px",
      padding: "2px 8px",
    },
    ".cm-panel.cm-search .cm-button:hover": {
      color: t.ivory,
      borderColor: t.brass,
    },
    ".cm-panel.cm-search label": {
      color: t.mute,
      fontSize: "11px",
    },
    ".cm-panel.cm-search .cm-textfield:focus": {
      borderColor: t.brass,
    },
    ".cm-searchMatch": {
      backgroundColor: t.brassGhost,
      outline: `1px solid ${t.hairline}`,
    },
    ".cm-searchMatch-selected": {
      backgroundColor: t.brassGlow,
    },
    ".cm-panel button[name=close]": {
      color: t.mute,
    },
    ".cm-panel button[name=close]:hover": {
      color: t.ivory,
    },

    ".cm-scroller": {
      fontFamily: MONO_STACK,
    },
  };
}

/** Static spec built from the fallback palette — kept as a named export so
 *  unit tests can assert the themed selectors without a live DOM. */
export const editorThemeSpec = makeEditorThemeSpec(FALLBACK);

// ── Syntax highlighting ───────────────────────────────────────────

function makeHighlightStyle(t: EditorTokens): HighlightStyle {
  return HighlightStyle.define([
    // Keywords: brass
    { tag: tags.keyword,            color: t.brass, fontWeight: "500" },
    { tag: tags.controlKeyword,     color: t.brass },
    { tag: tags.definitionKeyword,  color: t.brass },
    { tag: tags.moduleKeyword,      color: t.brass },
    { tag: tags.operatorKeyword,    color: t.brass },

    // Strings: sage
    { tag: tags.string,             color: t.sage },
    { tag: tags.special(tags.string), color: t.sage },
    { tag: tags.regexp,             color: t.sage },
    { tag: tags.escape,             color: t.sage },

    // Numbers: rouge (distinctive)
    { tag: tags.number,             color: t.rouge },
    { tag: tags.integer,            color: t.rouge },
    { tag: tags.float,              color: t.rouge },

    // Comments: mute (upright — no cursive type anywhere in the app)
    { tag: tags.comment,            color: t.mute },
    { tag: tags.lineComment,        color: t.mute },
    { tag: tags.blockComment,       color: t.mute },

    // Functions: ivory
    { tag: tags.function(tags.variableName), color: t.ivory },
    { tag: tags.function(tags.propertyName), color: t.ivory },

    // Types / classes: brass
    { tag: tags.typeName,           color: t.brass },
    { tag: tags.className,          color: t.brass },
    { tag: tags.namespace,          color: t.brass },
    { tag: tags.definition(tags.typeName), color: t.brass },

    // Operators & punctuation: sage
    { tag: tags.operator,           color: t.sage },
    { tag: tags.punctuation,        color: t.sage },
    { tag: tags.separator,          color: t.sage },
    { tag: tags.bracket,            color: t.sage },

    // HTML tags: brass
    { tag: tags.tagName,            color: t.brass },
    { tag: tags.angleBracket,       color: t.sage },

    // HTML attributes: sage
    { tag: tags.attributeName,      color: t.sage },
    { tag: tags.attributeValue,     color: t.sage },

    // Variables / properties: ivory (base)
    { tag: tags.variableName,       color: t.ivory },
    { tag: tags.propertyName,       color: t.ivory },

    // Boolean / null / undefined: brass
    { tag: tags.bool,               color: t.brass },
    { tag: tags.null,               color: t.mute },

    // Headings (Markdown): brass
    { tag: tags.heading,            color: t.brass, fontWeight: "600" },

    // Links (Markdown): sage
    { tag: tags.link,               color: t.sage },

    // Special / meta: mute
    { tag: tags.meta,               color: t.mute },
    { tag: tags.processingInstruction, color: t.mute },
  ]);
}

// ── Exported extensions ───────────────────────────────────────────

/** Build a fresh combined extension (editor theme + syntax highlighting) from
 *  the CURRENTLY active Octopush theme tokens. Call this again — and reconfigure
 *  the editor's theme compartment — whenever the theme changes. */
export function buildEditorTheme(): Extension {
  const t = resolveEditorTokens();
  return [
    EditorView.theme(makeEditorThemeSpec(t), { dark: true }),
    syntaxHighlighting(makeHighlightStyle(t)),
  ];
}

/** Combined CodeMirror extension for the active theme, resolved at import.
 *  Prefer buildEditorTheme() inside a compartment so the editor follows live
 *  theme switches; this static export remains for back-compat. */
export const atelierTheme: Extension = buildEditorTheme();
