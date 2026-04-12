import { useState, useEffect } from "react";
import { Settings, Eye, EyeOff, Check } from "lucide-react";
import { ipc } from "../lib/ipc";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: Props) {
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      ipc.getSettings().then((s) => {
        setAnthropicKey(s.anthropicApiKey ?? "");
        setOpenaiKey(s.openaiApiKey ?? "");
        setSaved(false);
      });
    }
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    await ipc.saveSettings({
      anthropicApiKey: anthropicKey || null,
      openaiApiKey: openaiKey || null,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => onClose(), 800);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] rounded-xl border border-octo-border bg-octo-panel p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center gap-2">
          <Settings size={18} className="text-octo-accent" />
          <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">
              Anthropic API Key
            </label>
            <div className="relative">
              <input
                type={showAnthropic ? "text" : "password"}
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                className="w-full rounded-md border border-octo-border bg-octo-bg px-3 py-2 pr-10 font-mono text-sm outline-none focus:border-octo-accent"
              />
              <button
                type="button"
                onClick={() => setShowAnthropic((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
              >
                {showAnthropic ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-zinc-600">
              Required for Claude chat. Get yours at console.anthropic.com
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">
              OpenAI API Key
              <span className="ml-1 text-zinc-700">(optional)</span>
            </label>
            <div className="relative">
              <input
                type={showOpenai ? "text" : "password"}
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-md border border-octo-border bg-octo-bg px-3 py-2 pr-10 font-mono text-sm outline-none focus:border-octo-accent"
              />
              <button
                type="button"
                onClick={() => setShowOpenai((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
              >
                {showOpenai ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-octo-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-octo-accent-dim disabled:opacity-50"
          >
            {saved ? (
              <>
                <Check size={14} /> Saved
              </>
            ) : saving ? (
              "Saving..."
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
