import { useState } from "react";
import { Terminal, FileText, FilePlus, FolderOpen, ChevronRight, Copy, Check } from "lucide-react";
import { clsx } from "clsx";
import type { ToolExecution } from "../stores/chatStore";

interface Props {
  tool: ToolExecution;
}

const TOOL_META: Record<
  string,
  { icon: typeof Terminal; label: string; accent: string; bgAccent: string }
> = {
  run_command: {
    icon: Terminal,
    label: "Ran command",
    accent: "text-octo-warning",
    bgAccent: "bg-octo-warning/10",
  },
  read_file: {
    icon: FileText,
    label: "Read file",
    accent: "text-blue-400",
    bgAccent: "bg-blue-400/10",
  },
  write_file: {
    icon: FilePlus,
    label: "Wrote file",
    accent: "text-octo-success",
    bgAccent: "bg-octo-success/10",
  },
  list_files: {
    icon: FolderOpen,
    label: "Listed files",
    accent: "text-zinc-400",
    bgAccent: "bg-zinc-400/10",
  },
};

export function ToolCallCard({ tool }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const meta = TOOL_META[tool.toolName] ?? TOOL_META.run_command;
  const Icon = meta.icon;

  // Build the summary line shown when collapsed.
  const summary = buildSummary(tool);

  function handleCopy() {
    navigator.clipboard.writeText(tool.result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={clsx(
        "group mx-auto w-full max-w-[85%] overflow-hidden rounded-lg border transition-all",
        expanded
          ? "border-octo-border bg-zinc-900/60"
          : "border-transparent hover:border-octo-border/50 hover:bg-zinc-900/30",
      )}
    >
      {/* Collapsed header — always visible, clickable */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <ChevronRight
          size={12}
          className={clsx(
            "shrink-0 text-zinc-600 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <div
          className={clsx(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            meta.bgAccent,
          )}
        >
          <Icon size={12} className={meta.accent} />
        </div>
        <span className="text-[11px] text-zinc-500">{meta.label}</span>
        <span className={clsx("flex-1 truncate font-mono text-xs", meta.accent)}>
          {summary}
        </span>
      </button>

      {/* Expanded: full output */}
      {expanded && (
        <div className="border-t border-octo-border/50 px-3.5 pb-3 pt-2">
          {/* Copy button */}
          <div className="mb-1.5 flex justify-end">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-400"
            >
              {copied ? (
                <>
                  <Check size={10} /> Copied
                </>
              ) : (
                <>
                  <Copy size={10} /> Copy
                </>
              )}
            </button>
          </div>

          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-950/80 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-400">
            {tool.result}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Build a short one-line summary for the collapsed state. */
function buildSummary(tool: ToolExecution): string {
  switch (tool.toolName) {
    case "run_command": {
      const cmd = String(tool.toolInput?.command ?? "");
      // Show the command, truncated.
      return `$ ${cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd}`;
    }
    case "read_file":
    case "write_file": {
      const path = String(tool.toolInput?.path ?? "");
      const sizeHint =
        tool.toolName === "write_file"
          ? ` (${String(tool.toolInput?.content ?? "").length} chars)`
          : "";
      return path + sizeHint;
    }
    case "list_files":
      return String(tool.toolInput?.path ?? ".");
    default:
      return tool.toolName;
  }
}
