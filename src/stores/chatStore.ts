import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import type { ChatMessage, ChatStreamEvent } from "../lib/types";

export interface ToolUseEvent {
  workspaceId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  result: string;
}

interface ChatState {
  messages: ChatMessage[];
  streaming: boolean;
  streamBuffer: string;
  model: string;
  error: string | null;
  /** Tool executions shown inline during the current response. */
  pendingTools: ToolUseEvent[];

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
      set((s) => ({
        streaming: false,
        messages: [
          ...s.messages,
          {
            id: Date.now(),
            workspaceId: payload.workspaceId,
            role: "assistant" as const,
            content: s.streamBuffer,
            model: get().model,
            inputTokens: payload.inputTokens,
            outputTokens: payload.outputTokens,
            costUsd: null,
            createdAt: new Date().toISOString(),
          },
        ],
        streamBuffer: "",
        pendingTools: [],
      }));
    } else {
      set((s) => ({ streamBuffer: s.streamBuffer + payload.delta }));
    }
  });

  // Listen for tool use events.
  listen<ToolUseEvent>("chat://tool-use", (ev) => {
    set((s) => ({
      pendingTools: [...s.pendingTools, ev.payload],
    }));
  });

  return {
    messages: [],
    streaming: false,
    streamBuffer: "",
    model: "claude-sonnet-4-6",
    error: null,
    pendingTools: [],

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
        pendingTools: [],
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
    clear: () => set({ messages: [], streamBuffer: "", error: null, pendingTools: [] }),
    clearError: () => set({ error: null }),
  };
});
