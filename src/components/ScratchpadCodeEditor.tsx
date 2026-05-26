import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";
import { useScratchpadStore } from "../stores/scratchpadStore";

export function ScratchpadCodeEditor() {
  const activeTabId = useScratchpadStore((s) => s.activeTabId);
  const tabs = useScratchpadStore((s) => s.tabs);
  const setContent = useScratchpadStore((s) => s.setContent);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-octo-onyx">
        <p className="text-octo-mute">No tab selected</p>
      </div>
    );
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (activeTabId) {
      setContent(activeTabId, e.target.value);
    }
  };

  // Get highlighted code
  let highlightedCode = activeTab.content;
  if (activeTab.language !== "plaintext" && activeTab.content) {
    try {
      const highlighted = hljs.highlight(activeTab.content, {
        language: activeTab.language,
        ignoreIllegals: true,
      });
      highlightedCode = highlighted.value;
    } catch {
      // Fallback to plain text if highlighting fails
      highlightedCode = activeTab.content;
    }
  }

  return (
    <div className="h-full w-full bg-octo-onyx overflow-hidden flex flex-col relative">
      {/* Empty state placeholder */}
      {!activeTab.content && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <p className="font-serif italic text-[14px] text-octo-brass text-center px-4">
            Paste code here, or start typing…
          </p>
        </div>
      )}

      {/* Textarea for editing */}
      <textarea
        value={activeTab.content}
        onChange={handleChange}
        className="absolute inset-0 w-full h-full bg-transparent text-octo-ivory font-mono text-[12px] p-4 resize-none focus:outline-none z-20"
        style={{
          fontFamily: "JetBrains Mono, monospace",
          lineHeight: 1.5,
          caretColor: "var(--color-octo-brass)",
        }}
        spellCheck="false"
        wrap="off"
      />

      {/* Syntax highlighted code display (read-only, behind textarea) */}
      <pre className="absolute inset-0 w-full h-full bg-octo-onyx text-octo-ivory font-mono text-[12px] p-4 overflow-auto pointer-events-none m-0">
        <code
          className={`hljs language-${activeTab.language}`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
    </div>
  );
}
