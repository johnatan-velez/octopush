import { useState } from "react";
import { X } from "lucide-react";
import type { ScratchpadTab as ScratchpadTabType } from "../stores/scratchpadStore";

interface Props {
  tab: ScratchpadTabType;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
}

export function ScratchpadTab({
  tab,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.name);

  const handleDoubleClick = () => {
    setIsEditing(true);
    setEditValue(tab.name);
  };

  const handleSave = () => {
    if (editValue.trim()) {
      onRename(editValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 border-b-2 transition cursor-pointer ${
        isActive
          ? "border-octo-brass bg-octo-panel text-octo-ivory"
          : "border-transparent bg-octo-onyx text-octo-mute hover:text-octo-sage"
      }`}
      onClick={onSelect}
    >
      {isEditing ? (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1 bg-octo-onyx border border-octo-brass text-octo-ivory font-mono text-[11px] px-1 outline-none"
        />
      ) : (
        <>
          <span
            className="flex-1 font-mono text-[11px] truncate select-none"
            onDoubleClick={handleDoubleClick}
          >
            {tab.name}
          </span>
          <span className="text-[8px] text-octo-mute opacity-50 whitespace-nowrap">
            {tab.language}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-0 text-octo-mute hover:text-octo-brass transition opacity-0 hover:opacity-100"
            aria-label="Close tab"
          >
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );
}
