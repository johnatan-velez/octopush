/**
 * UpdateNotifier — silent auto-check for new Octopush releases.
 *
 * Polls the Tauri updater on mount and every 6h. When a new version is
 * available, shows a brass toast with "Install" / "Later" — neither
 * blocks the app. "Install" downloads + verifies the Ed25519 signature,
 * applies the update in-place, and relaunches the app.
 *
 * Silent on failure: if the network is unavailable or the manifest is
 * missing, we log to console and stay quiet — there's nothing the user
 * can do, and an error toast every 6h would be annoying.
 */

import { useEffect, useRef, useState } from "react";
import { Download, X, Loader2 } from "lucide-react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

export function UpdateNotifier() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [installError, setInstallError] = useState<string | null>(null);
  const checkedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const doCheck = async () => {
      try {
        const result = await check();
        if (cancelled) return;
        if (result?.available) {
          setUpdate(result);
          setDismissed(false);
        }
      } catch (e) {
        // Silent — usually network/endpoint issues, not actionable.
        if (!checkedOnce.current) {
          console.warn("update check failed:", e);
        }
      } finally {
        checkedOnce.current = true;
      }
    };

    doCheck();
    const id = setInterval(doCheck, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!update || dismissed) return null;

  async function handleInstall() {
    if (!update) return;
    setInstalling(true);
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (total > 0) setProgress(Math.round((downloaded / total) * 100));
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });
      // After the install completes, relaunch into the new version.
      await relaunch();
    } catch (e) {
      console.error("update install failed:", e);
      setInstalling(false);
      // Keep the toast visible so the user can retry; surface the error
      // inline.
      setInstallError(String(e));
    }
  }

  const err = installError;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-[340px] rounded-xl bg-octo-panel"
      style={{
        border: "1px solid var(--brass-dim)",
        boxShadow:
          "0 20px 50px -10px rgba(0,0,0,0.6), 0 0 0 6px rgba(212, 165, 116, 0.04)",
      }}
    >
      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
        <Download
          size={14}
          className="mt-0.5 shrink-0 text-octo-brass"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-octo-brass">
            Update available
          </div>
          <div className="mt-0.5 font-serif italic text-[14px] leading-tight text-octo-ivory">
            Octopush {update.version} is ready.
          </div>
          {update.body && (
            <div className="mt-1 line-clamp-3 text-[11px] leading-[1.5] text-octo-sage">
              {update.body}
            </div>
          )}
          {err && (
            <div className="mt-1.5 text-[11px] leading-[1.45] text-octo-rouge">
              Install failed: {err}
            </div>
          )}
        </div>
        {!installing && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-octo-mute transition-colors hover:bg-octo-panel-2 hover:text-octo-sage"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {installing && progress > 0 && progress < 100 && (
        <div className="px-4 pb-2">
          <div
            className="h-[3px] overflow-hidden rounded-sm"
            style={{ background: "var(--color-octo-hairline)" }}
          >
            <div
              className="h-full transition-all"
              style={{
                width: `${progress}%`,
                background: "var(--color-octo-brass)",
              }}
            />
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-octo-mute">
            Downloading · {progress}%
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-octo-hairline px-3 py-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          disabled={installing}
          className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-octo-mute transition-colors hover:text-octo-sage disabled:opacity-40"
        >
          Later
        </button>
        <button
          type="button"
          onClick={handleInstall}
          disabled={installing}
          className="ml-auto flex items-center gap-1.5 rounded px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-octo-brass transition-colors disabled:opacity-40"
          style={{
            background: "var(--brass-ghost)",
            border: "1px solid var(--brass-dim)",
          }}
        >
          {installing ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Download size={11} />
          )}
          {installing ? "Installing…" : "Install & restart"}
        </button>
      </div>
    </div>
  );
}
