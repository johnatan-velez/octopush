import {
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileLock,
  FileTerminal,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { getExtension } from "./getExtension";

// Extension table 1 of 3 — see getExtension.ts for the cross-reference
// (languageDetection.ts and editorLang.ts hold the other two).

// ─── Categories ──────────────────────────────────────────────────
//
// Every file resolves to one category, and the category — not the raw
// extension — decides both the lucide glyph AND the icon tint. Tints draw
// only from the sanctioned Atelier palette (sage / state-blue / state-purple /
// verdigris / warning-amber / mute); brass is never a category tint — it's
// reserved as the "this file changed" override applied at the row. This keeps
// the tree differentiable by language family without a generic-editor rainbow.

type FileCategory =
  | "code"
  | "web"
  | "data"
  | "docs"
  | "asset"
  | "archive"
  | "shell"
  | "config"
  | "lock"
  | "plain";

const EXT_CATEGORY: Record<string, FileCategory> = {};
const assign = (cat: FileCategory, exts: string[]) => {
  for (const e of exts) EXT_CATEGORY[e] = cat;
};

// Programming languages — the workhorse, kept in the calm sage tint.
assign("code", [
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "java", "py", "go", "rb", "c",
  "h", "cpp", "hpp", "cc", "cs", "swift", "kt", "kts", "php", "sql",
]);
// Markup & styles — split out from code so the web layer reads as its own family.
assign("web", ["html", "css", "scss", "less", "vue", "svelte"]);
assign("data", ["json", "yaml", "yml", "toml", "xml", "csv"]);
assign("docs", ["md", "mdx", "txt", "rtf", "log"]);
assign("asset", ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);
assign("archive", ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "war", "jar", "ear"]);
assign("shell", ["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"]);
assign("config", [
  "env", "ini", "conf", "cfg", "properties", "gitignore", "gitattributes",
  "editorconfig", "dockerignore", "npmrc", "nvmrc",
]);

const LOCKFILE_NAMES = new Set(["cargo.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

const CATEGORY_ICON: Record<FileCategory, LucideIcon> = {
  code: FileCode,
  web: FileCode,
  data: FileJson,
  docs: FileText,
  asset: FileImage,
  archive: FileArchive,
  shell: FileTerminal,
  config: FileCog,
  lock: FileLock,
  plain: File,
};

// Tint per category — CSS variables so the icon recolors with the active
// theme. `code` deliberately stays sage (the neutral default), so most of any
// tree reads quiet; the differentiation shows up on the non-code minority.
const CATEGORY_TINT: Record<FileCategory, string> = {
  code: "var(--color-octo-sage)",
  web: "var(--color-octo-state-blue)",
  data: "var(--color-octo-warning)",
  docs: "var(--color-octo-mute)",
  asset: "var(--color-octo-state-purple)",
  archive: "var(--color-octo-state-purple)",
  shell: "var(--color-octo-verdigris)",
  config: "var(--color-octo-warning)",
  lock: "var(--color-octo-mute)",
  plain: "var(--color-octo-mute)",
};

/** Resolve a file name to its category. Pure; safe to call per row. */
function fileCategory(name: string): FileCategory {
  const lower = name.toLowerCase();
  if (LOCKFILE_NAMES.has(lower)) return "lock";
  const ext = getExtension(name);
  if (ext === "lock") return "lock";
  return EXT_CATEGORY[ext] ?? "plain";
}

/** Map a file name to its lucide icon component. Pure; safe to call per row. */
export function fileIcon(name: string): LucideIcon {
  return CATEGORY_ICON[fileCategory(name)];
}

/** The icon tint (a CSS var) for a file's category — used when the file is
 *  unchanged. Changed files override this with brass at the row. */
export function fileIconTint(name: string): string {
  return CATEGORY_TINT[fileCategory(name)];
}
