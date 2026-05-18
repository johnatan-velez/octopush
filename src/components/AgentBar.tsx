import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { ipc } from "../lib/ipc";
import type { ProviderConfig } from "../lib/types";

// Provider color palette — one accent dot per provider family.
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#cc785c",
  openai: "#74aa9c",
  deepseek: "#5c8acc",
  ollama: "#a8a8a8",
};

function providerColor(name: string): string {
  return PROVIDER_COLORS[name] ?? "var(--color-octo-sage)";
}

interface Props {
  activeModel: string;
  onSelectModel: (model: string) => void;
}

export function AgentBar({ activeModel, onSelectModel }: Props) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);

  useEffect(() => {
    ipc.listProviders().then((provs) => {
      setProviders(provs.filter((p) => p.enabled && p.models.length > 0));
    });
  }, []);

  // Flatten to groups: only enabled providers with models.
  const groups = providers;

  if (groups.length === 0) {
    return (
      <div className="flex flex-row items-center gap-1 border-b border-octo-border bg-octo-panel/50 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-octo-mute">
          No models configured · Settings
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-row items-center border-b border-octo-border bg-octo-panel/50 px-4 py-2">
      {groups.map((provider, groupIdx) => {
        const dot = providerColor(provider.name);
        return (
          <div key={provider.name} className="flex items-center">
            {/* Hairline separator between provider groups */}
            {groupIdx > 0 && (
              <div className="mx-2 h-4 w-px shrink-0 bg-octo-hairline" />
            )}

            {/* Provider label */}
            <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.25em] text-octo-mute">
              {provider.name}
            </span>

            {/* Model pills */}
            {provider.models.map((model) => {
              const isActive = activeModel === model.id;
              const label = model.displayName || model.id;
              return (
                <button
                  key={model.id}
                  onClick={() => onSelectModel(model.id)}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition",
                    isActive
                      ? "border-octo-accent/30 bg-octo-accent/10 text-octo-accent"
                      : "border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
                  )}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: dot }}
                  />
                  {label}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
