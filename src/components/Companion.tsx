import type { WorkspaceMode } from "../lib/modes";
import { CompanionContext } from "./CompanionContext";
import { CompanionHistory, type CompanionHistoryChat } from "./CompanionHistory";
import { CompanionTerminals } from "./CompanionTerminals";
import { CompanionChanged } from "./CompanionChanged";
import type { FileChange } from "../lib/types";

interface ContextProps {
  tokensUsed: number;
  tokensLimit: number;
  filesInFlight: number;
  toolCalls: number;
}

interface HistoryProps {
  chats: CompanionHistoryChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
}

interface ChangedProps {
  changedFiles: FileChange[];
}

interface Props {
  mode: WorkspaceMode;
  workspaceId: string | null;
  contextProps: ContextProps;
  historyProps: HistoryProps;
  changedProps: ChangedProps;
}

export function Companion({
  mode,
  workspaceId,
  contextProps,
  historyProps,
  changedProps,
}: Props) {
  return (
    <aside
      className="m-4 ml-0 flex w-[280px] flex-col gap-4 rounded-xl border border-octo-hairline bg-octo-panel p-4"
      aria-label="Companion"
    >
      {mode === "talk" && (
        <>
          <CompanionContext {...contextProps} />
          <CompanionHistory {...historyProps} />
        </>
      )}
      {mode === "run" && workspaceId && (
        <CompanionTerminals workspaceId={workspaceId} />
      )}
      {mode === "review" && <CompanionChanged {...changedProps} />}
    </aside>
  );
}
