import { ScratchpadTabsBar } from "./ScratchpadTabsBar";
import { ScratchpadCodeEditor } from "./ScratchpadCodeEditor";

export function ScratchpadEditor() {
  return (
    <div className="h-full w-full flex flex-col bg-octo-panel">
      <ScratchpadTabsBar />
      <ScratchpadCodeEditor />
    </div>
  );
}
