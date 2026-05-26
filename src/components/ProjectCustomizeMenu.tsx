import { useState } from 'react';
import { X } from 'lucide-react';
import type { TintName } from '@/lib/types';
import { TINTS, TINT_NAMES } from '@/lib/monogram';

export interface ProjectCustomizeMenuProps {
  projectId: string;
  currentName: string;
  currentTint: TintName | null;
  onCustomized: (name: string, tint: TintName) => void;
  onCancel: () => void;
}

export function ProjectCustomizeMenu({
  currentName,
  currentTint,
  onCustomized,
  onCancel,
}: ProjectCustomizeMenuProps) {
  const [name, setName] = useState(currentName);
  const [tint, setTint] = useState<TintName>(currentTint ?? 'brass');
  const [saving, setSaving] = useState(false);

  const isNameEmpty = name.trim().length === 0;
  const isSaveDisabled = isNameEmpty || saving;

  const handleSave = async () => {
    if (isSaveDisabled) return;

    setSaving(true);
    try {
      onCustomized(name, tint);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        className="bg-octo-bg rounded-lg shadow-lg p-6 w-96 border border-octo-border"
        style={{
          borderColor: `var(--octo-border)`,
          backgroundColor: `var(--octo-bg)`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[16px] font-sans font-semibold tracking-[-0.005em] text-octo-text">
            Customize Project
          </h2>
          <button
            onClick={handleCancel}
            className="text-octo-mute hover:text-octo-text transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Name Input */}
        <div className="mb-6">
          <label className="block text-[11px] font-sans font-normal text-octo-text mb-2">
            Project Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter project name…"
            className="w-full px-3 py-2 bg-octo-panel border border-octo-border rounded text-octo-text placeholder:font-serif placeholder:italic placeholder-octo-mute focus:outline-none focus:ring-2 focus:ring-octo-brass"
            style={{
              backgroundColor: `var(--octo-panel)`,
              borderColor: `var(--octo-border)`,
              color: `var(--octo-text)`,
            }}
          />
          {isNameEmpty && (
            <p className="text-xs text-red-500 mt-1">
              Project name is required
            </p>
          )}
        </div>

        {/* Tint Picker */}
        <div className="mb-6">
          <label className="block text-[11px] font-sans font-normal text-octo-text mb-3">
            Tint
          </label>
          <div className="grid grid-cols-7 gap-2">
            {TINT_NAMES.map((tintName) => (
              <button
                key={tintName}
                onClick={() => setTint(tintName)}
                className={`w-full h-10 rounded border-2 transition-all ${
                  tint === tintName
                    ? 'border-octo-brass'
                    : 'border-octo-border'
                }`}
                style={{
                  backgroundColor: TINTS[tintName].accent,
                  borderColor:
                    tint === tintName ? `var(--octo-brass)` : `var(--octo-border)`,
                }}
                title={tintName}
              />
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleCancel}
            className="px-4 py-2 bg-octo-panel border border-octo-border rounded text-octo-text hover:bg-octo-sage transition-colors"
            style={{
              backgroundColor: `var(--octo-panel)`,
              borderColor: `var(--octo-border)`,
              color: `var(--octo-text)`,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaveDisabled}
            className={`px-4 py-2 rounded text-octo-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isSaveDisabled
                ? 'bg-octo-mute'
                : 'bg-octo-brass hover:bg-opacity-90'
            }`}
            style={
              !isSaveDisabled
                ? {
                    backgroundColor: `var(--octo-brass)`,
                    color: `var(--octo-bg)`,
                  }
                : {
                    backgroundColor: `var(--octo-mute)`,
                    color: `var(--octo-bg)`,
                  }
            }
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
