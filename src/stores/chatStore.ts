import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import type { ChatMessage, ChatStreamEvent } from "../lib/types";

interface ChatState {
  messages: ChatMessage[];
  streaming: boolean;
  streamBuffer: string;
  model: string;
  error: string | null;

  loadHistory: (workspaceId: string) => Promise<void>;
  send: (workspaceId: string, content: string, systemPrompt?: string) => Promise<void>;
  setModel: (model: string) => void;
  clear: () => void;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => {
  // Listen for streaming events from the Rust backend.
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
      }));
    } else {
      set((s) => ({ streamBuffer: s.streamBuffer + payload.delta }));
    }
  });

  return {
    messages: [],
    streaming: false,
    streamBuffer: "",
    model: "claude-sonnet-4-6",
    error: null,

    loadHistory: async (workspaceId) => {
      const messages = await ipc.listChatMessages(workspaceId);
      set({ messages: messages as ChatMessage[] });
    },

    send: async (workspaceId, content, systemPrompt) => {
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

      const allMessages = [...get().messages, userMsg];
      set({ messages: allMessages, streaming: true, streamBuffer: "", error: null });

      try {
        await ipc.sendChatMessage({
          workspaceId,
          model: get().model,
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
          system: systemPrompt,
          maxTokens: 8192,
        });
      } catch (e) {
        set({ streaming: false, streamBuffer: "", error: String(e) });
      }
    },

    setModel: (model) => set({ model }),
    clear: () => set({ messages: [], streamBuffer: "", error: null }),
    clearError: () => set({ error: null }),
  };
});
