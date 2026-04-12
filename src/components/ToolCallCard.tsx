import { useState, type CSSProperties } from "react";
import { ipc } from "../lib/ipc";
import type { ToolExecution } from "../stores/chatStore";

interface Props {
  tool: ToolExecution;
  workspacePath?: string;
}

const TOOL_LABELS: Record<string, string> = {
  run_command: "Ran command",
  read_file: "Read file",
  write_file: "Wrote file",
  list_files: "Listed files",
};

const TOOL_COLORS: Record<string, string> = {
  run_command: "#fbbf24",
  read_file: "#60a5fa",
  write_file: "#34d399",
  list_files: "#a1a1aa",
};

const TOOL_ICONS: Record<string, string> = {
  run_command: "▸_",
  read_file: "◫",
  write_file: "◫+",
  list_files: "⊟",
};

// All styles defined as constants to prevent any Tailwind/cascade interference.
const cardStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: "85%",
  margin: "4px auto",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(24,24,27,0.4)",
  fontSize: 13,
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#d4d4d8",
  lineHeight: "1.4",
  boxSizing: "border-box" as const,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "10px 14px",
  gap: 10,
  cursor: "pointer",
  background: "transparent",
  border: "none",
  color: "inherit",
  fontSize: "inherit",
  fontFamily: "inherit",
  lineHeight: "inherit",
  textAlign: "left" as const,
  boxSizing: "border-box" as const,
};

export function ToolCallCard({ tool, workspacePath }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const label = TOOL_LABELS[tool.toolName] ?? tool.toolName;
  const color = TOOL_COLORS[tool.toolName] ?? "#a1a1aa";
  const icon = TOOL_ICONS[tool.toolName] ?? "•";
  const summary = buildSummary(tool);
  const filePath = getFilePath(tool);
  const isWebFile = filePath ? /\.(html?|htm)$/i.test(filePath) : false;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
          style={headerStyle}
        >
          <span style={{
            fontSize: 11,
            color: "#52525b",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 150ms",
            flexShrink: 0,
          }}>
            ▸
          </span>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 4,
            background: `${color}20`,
            color: color,
            fontSize: 11,
            fontFamily: "monospace",
            fontWeight: 600,
            flexShrink: 0,
          }}>
            {icon}
          </span>
          <span style={{ fontSize: 11, color: "#71717a", flexShrink: 0 }}>
            {label}
          </span>
          <span style={{
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            color: color,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: 1,
          }}>
            {summary}
          </span>
        </div>

        {/* Open button for HTML files */}
        {filePath && tool.toolName === "write_file" && isWebFile && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (workspacePath) ipc.openFileInSystem(`${workspacePath}/${filePath}`);
            }}
            onKeyDown={() => {}}
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "#a78bfa",
              background: "rgba(167,139,250,0.15)",
              border: "none",
              borderRadius: 4,
              padding: "4px 10px",
              cursor: "pointer",
              marginRight: 12,
              flexShrink: 0,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            Open
          </div>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "8px 14px 12px",
        }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <span
              role="button"
              tabIndex={0}
              onClick={() => {
                navigator.clipboard.writeText(tool.result);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              onKeyDown={() => {}}
              style={{
                fontSize: 10,
                color: copied ? "#34d399" : "#52525b",
                cursor: "pointer",
                padding: "2px 6px",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {copied ? "✓ Copied" : "Copy"}
            </span>
          </div>
          <pre style={{
            maxHeight: 256,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            borderRadius: 6,
            background: "rgba(0,0,0,0.4)",
            padding: "8px 12px",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 11,
            lineHeight: 1.6,
            color: "#a1a1aa",
            margin: 0,
            boxSizing: "border-box" as const,
          }}>
            {tool.result}
          </pre>
        </div>
      )}
    </div>
  );
}

function buildSummary(tool: ToolExecution): string {
  switch (tool.toolName) {
    case "run_command": {
      const cmd = String(tool.toolInput?.command ?? "");
      return `$ ${cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd}`;
    }
    case "write_file":
    case "read_file":
      return String(tool.toolInput?.path ?? "");
    case "list_files":
      return String(tool.toolInput?.path ?? ".");
    default:
      return tool.toolName;
  }
}

function getFilePath(tool: ToolExecution): string | null {
  if (tool.toolName === "write_file" || tool.toolName === "read_file") {
    return String(tool.toolInput?.path ?? "") || null;
  }
  return null;
}
