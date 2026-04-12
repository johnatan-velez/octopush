import { useEffect, useRef, useState, useCallback } from "react";
import { MessageSquare, ArrowUp, AlertTriangle, Settings } from "lucide-react";
import { clsx } from "clsx";
import { useChatStore } from "../stores/chatStore";
import { AgentBar } from "./AgentBar";
import { ChatMessage } from "./ChatMessage";

interface Props {
  workspaceId: string;
  workspacePath: string;
  onOpenSettings?: () => void;
}

const AGENT_COLORS: Record<string, string> = {
  "claude-sonnet-4-6": "#cc785c",
  "claude-opus-4-6": "#cc785c",
  "gpt-4o": "#74aa9c",
  "claude-haiku-4-5": "#cc785c",
};

const AGENT_NAMES: Record<string, string> = {
  "claude-sonnet-4-6": "Claude",
  "claude-opus-4-6": "Opus",
  "gpt-4o": "GPT-4o",
  "claude-haiku-4-5": "Haiku",
};

export function ChatView({ workspaceId, workspacePath, onOpenSettings }: Props) {
  const { messages, streaming, streamBuffer, model, error, pendingTools, loadHistory, send, setModel, clearError } =
    useChatStore();

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load history on mount / workspace change
  useEffect(() => {
    loadHistory(workspaceId);
  }, [workspaceId, loadHistory]);

  // Auto-scroll to bottom when messages or stream buffer change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamBuffer]);

  // Auto-grow textarea
  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    const lineHeight = 20;
    const maxHeight = lineHeight * 6 + 24; // 6 rows + padding
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    send(workspaceId, workspacePath, trimmed);
  }, [input, streaming, send, workspaceId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const activeColor = AGENT_COLORS[model] ?? "#a78bfa";
  const activeName = AGENT_NAMES[model] ?? model;

  return (
    <div className="flex h-full flex-col">
      {/* Agent bar */}
      <AgentBar activeModel={model} onSelectModel={setModel} />

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4"
      >
        {messages.length === 0 && !streaming ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <MessageSquare size={36} className="text-zinc-700" />
            <div>
              <p className="text-sm font-medium text-zinc-400">Start a conversation</p>
              <p className="mt-1 text-xs text-zinc-600">Ask anything to get started</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            {/* Tool executions (shown inline while agent works) */}
            {pendingTools.map((tool, i) => (
              <div
                key={i}
                className="mx-auto max-w-[80%] rounded-lg border border-octo-border bg-zinc-900/50 px-4 py-3"
              >
                <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="font-mono">{">"}_</span>
                  <span>Ran command</span>
                  <span className="font-semibold text-zinc-300">{tool.toolName}</span>
                </div>
                {tool.toolInput && "command" in tool.toolInput && (
                  <div className="mb-2 rounded-md bg-zinc-950 px-3 py-1.5 font-mono text-xs text-octo-warning">
                    $ {String(tool.toolInput.command)}
                  </div>
                )}
                {tool.toolInput && "path" in tool.toolInput && (
                  <div className="mb-2 text-xs text-zinc-400">
                    {tool.toolName === "write_file" ? "Writing to: " : "Reading: "}
                    <span className="font-mono text-zinc-300">{String(tool.toolInput.path)}</span>
                  </div>
                )}
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-400">
                  {tool.result.length > 2000
                    ? tool.result.slice(0, 2000) + "\n... (truncated)"
                    : tool.result}
                </pre>
              </div>
            ))}

            {/* Streaming partial message */}
            {streaming && (
              <ChatMessage
                message={{
                  role: "assistant",
                  content: streamBuffer || (pendingTools.length > 0 ? "" : "▊"),
                  model: null,
                  inputTokens: null,
                  outputTokens: null,
                }}
              />
            )}

            {/* Error message */}
            {error && (
              <div className="mx-auto max-w-lg rounded-lg border border-octo-danger/40 bg-octo-danger/10 px-4 py-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-octo-danger" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-octo-danger">Chat error</div>
                    <div className="mt-0.5 text-xs text-zinc-400">{error}</div>
                    {error.includes("API key") && onOpenSettings && (
                      <button
                        onClick={() => { clearError(); onOpenSettings(); }}
                        className="mt-2 flex items-center gap-1.5 rounded-md border border-octo-border bg-octo-panel px-3 py-1.5 text-xs text-zinc-300 transition hover:border-octo-accent/50"
                      >
                        <Settings size={12} />
                        Configure API Key
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-octo-border bg-octo-panel px-6 py-4">
        <div
          className={clsx(
            "rounded-xl border bg-octo-bg transition",
            streaming ? "border-octo-border/50 opacity-60" : "border-octo-border",
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Ask anything…"
            rows={1}
            className="w-full resize-none bg-transparent px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none"
            style={{ maxHeight: "calc(6 * 1.25rem + 1.5rem)" }}
          />

          {/* Bottom row: model indicator + send button */}
          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: activeColor }}
              />
              <span className="text-[10px] text-zinc-600">{activeName}</span>
            </div>

            <button
              onClick={handleSend}
              disabled={streaming || !input.trim()}
              className={clsx(
                "flex h-7 w-7 items-center justify-center rounded-full transition",
                streaming || !input.trim()
                  ? "cursor-not-allowed bg-octo-accent/30 text-zinc-500"
                  : "bg-octo-accent text-white hover:bg-octo-accent-dim",
              )}
              title="Send (Enter)"
            >
              <ArrowUp size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
