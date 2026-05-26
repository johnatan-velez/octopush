import { Plus } from "lucide-react";
import { useScratchpadStore } from "../stores/scratchpadStore";
import { ScratchpadTab } from "./ScratchpadTab";

export function ScratchpadTabsBar() {
  const tabs = useScratchpadStore((s) => s.tabs);
  const activeTabId = useScratchpadStore((s) => s.activeTabId);
  const createTab = useScratchpadStore((s) => s.createTab);
  const deleteTab = useScratchpadStore((s) => s.deleteTab);
  const renameTab = useScratchpadStore((s) => s.renameTab);
  const setActiveTab = useScratchpadStore((s) => s.setActiveTab);

  return (
    <div className="flex items-center gap-0 bg-octo-onyx border-t border-octo-hairline h-10 overflow-x-auto">
      {tabs.map((tab) => (
        <ScratchpadTab
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onSelect={() => setActiveTab(tab.id)}
          onDelete={() => deleteTab(tab.id)}
          onRename={(newName) => renameTab(tab.id, newName)}
        />
      ))}

      {/* Add tab button */}
      <button
        type="button"
        onClick={createTab}
        className="ml-auto flex items-center justify-center h-10 w-10 text-octo-brass hover:bg-[var(--brass-ghost)] transition flex-shrink-0"
        title="New tab"
        aria-label="New tab"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
