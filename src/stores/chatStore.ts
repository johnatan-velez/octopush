import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import type { ChatMessage, ChatStreamEvent } from "../lib/types";

export interface ToolExecution {
  toolName: string;
  toolInput: Record<string, unknown>;
  result: string;
}

export interface ToolUseEvent {
  workspaceId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  result: string;
}

/** A display item in the conversation — either a regular message or a tool execution. */
export type ConversationItem =
  | { kind: "message"; message: ChatMessage }
  | { kind: "tool"; tool: ToolExecution; id: number };

interface ChatState {
  /** The raw messages from DB. */
  messages: ChatMessage[];
  streaming: boolean;
  streamBuffer: string;
  model: string;
  error: string | null;
  /** Tool executions accumulated during the current agentic turn. */
  liveTools: ToolExecution[];

  /** Compute the conversation timeline (messages + tool cards interleaved). */
  getTimeline: () => ConversationItem[];

  loadHistory: (workspaceId: string) => Promise<void>;
  send: (
    workspaceId: string,
    workspacePath: string,
    content: string,
    systemPrompt?: string,
  ) => Promise<void>;
  setModel: (model: string) => void;
  clear: () => void;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => {
  // Listen for streaming text events.
  listen<ChatStreamEvent>("chat://stream", (ev) => {
    const payload = ev.payload;
    if (payload.done) {
      // When the agentic loop finishes, add the final assistant message
      // (if any) to the existing local state. DO NOT reload from DB here
      // — that would replace local messages (including tool cards from
      // live events) with DB content that may have different IDs, causing
      // React to re-render and the scroll to jump. The local state
      // already has: user msg + tool msgs (from events) + now the
      // assistant msg. DB is used only for initial workspace load.
      const buffer = get().streamBuffer;
      const assistantMsg = buffer.trim()
        ? [
            {
              id: Date.now(),
              workspaceId: payload.workspaceId,
              role: "assistant" as const,
              content: buffer,
              model: get().model,
              inputTokens: payload.inputTokens,
              outputTokens: payload.outputTokens,
              costUsd: null,
              createdAt: new Date().toISOString(),
            },
          ]
        : [];
      set((s) => ({
        streaming: false,
        messages: [...s.messages, ...assistantMsg],
        streamBuffer: "",
        liveTools: [],
      }));
    } else {
      set((s) => ({ streamBuffer: s.streamBuffer + payload.delta }));
    }
  });

  // Listen for tool use events (live, during agentic loop).
  listen<ToolUseEvent>("chat://tool-use", (ev) => {
    const tool: ToolExecution = {
      toolName: ev.payload.toolName,
      toolInput: ev.payload.toolInput,
      result: ev.payload.result,
    };
    // Add to liveTools AND persist in messages array as role="tool".
    set((s) => ({
      liveTools: [...s.liveTools, tool],
      messages: [
        ...s.messages,
        {
          id: Date.now() + Math.random(),
          workspaceId: ev.payload.workspaceId,
          role: "tool" as "user" | "assistant", // We'll handle this in the timeline
          content: JSON.stringify(tool),
          model: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
  });

  return {
    messages: [],
    streaming: false,
    streamBuffer: "",
    model: "claude-sonnet-4-6",
    error: null,
    liveTools: [],

    getTimeline: () => {
      const items: ConversationItem[] = [];
      const msgs = get().messages;
      for (const msg of msgs) {
        // Detect tool messages (role="tool" with JSON content).
        const role = msg.role as string;
        if (role === "tool") {
          try {
            const tool: ToolExecution = JSON.parse(msg.content);
            items.push({ kind: "tool", tool, id: msg.id });
          } catch {
            // Fallback: show as regular message if JSON parse fails.
            items.push({ kind: "message", message: msg });
          }
        } else {
          items.push({ kind: "message", message: msg });
        }
      }
      return items;
    },

    loadHistory: async (workspaceId) => {
      const messages = await ipc.listChatMessages(workspaceId);
      set({ messages: messages as ChatMessage[] });
    },

    send: async (workspaceId, workspacePath, content, systemPrompt) => {
      const userMsg: ChatMessage = {
        id: Date.now(),
        workspaceId,
        role: "user",
        content,
        model: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        createdAt: new Date().toISOString(),
      };

      set((s) => ({
        messages: [...s.messages, userMsg],
        streaming: true,
        streamBuffer: "",
        error: null,
        liveTools: [],
      }));

      try {
        await ipc.sendChatMessage({
          workspaceId,
          workspacePath,
          model: get().model,
          userMessage: content,
          system: systemPrompt,
          maxTokens: 8192,
        });
      } catch (e) {
        set({ streaming: false, streamBuffer: "", error: String(e) });
      }
    },

    setModel: (model) => set({ model }),
    clear: () => set({ messages: [], streamBuffer: "", error: null, liveTools: [] }),
    clearError: () => set({ error: null }),
  };
});
