import type { WorkspaceMode } from "../lib/modes";
import { CompanionContext } from "./CompanionContext";
import { CompanionHistory, type CompanionHistoryChat } from "./CompanionHistory";
import { CompanionTerminals, type CompanionTerminal } from "./CompanionTerminals";
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

interface TerminalsProps {
  terminals: CompanionTerminal[];
  activeTerminalId: string | null;
  onSelectTerminal: (id: string) => void;
  onNewTerminal: () => void;
}

interface ChangedProps {
  changedFiles: FileChange[];
}

interface Props {
  mode: WorkspaceMode;
  contextProps: ContextProps;
  historyProps: HistoryProps;
  terminalsProps: TerminalsProps;
  changedProps: ChangedProps;
}

export function Companion({
  mode,
  contextProps,
  historyProps,
  terminalsProps,
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
      {mode === "run" && <CompanionTerminals {...terminalsProps} />}
      {mode === "review" && <CompanionChanged {...changedProps} />}
    </aside>
  );
}
