import { useEffect, useRef, useState, useCallback } from "react";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { NewProjectFlow } from "./components/NewProjectFlow";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { WorkspaceHub } from "./components/WorkspaceHub";
import { WorkspaceCreator } from "./components/WorkspaceCreator";
import { ChatView } from "./components/ChatView";
import { ChangesPanel } from "./components/ChangesPanel";
import { TerminalPane } from "./components/TerminalPane";
import { TokenDashboard } from "./components/TokenDashboard";
import { CommandPalette } from "./components/CommandPalette";
import { ToastContainer } from "./components/Toasts";
import { useProjectStore } from "./stores/projectStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useThemeStore } from "./stores/themeStore";
import { ipc } from "./lib/ipc";

type AppView = "welcome" | "new-project" | "hub" | "terminal" | "chat" | "changes";

function App() {
  const project = useProjectStore((s) => s.current);
  const loadTheme = useThemeStore((s) => s.load);
  const { workspaces, activeId: activeWorkspaceId, load: loadWorkspaces } = useWorkspaceStore();

  const [view, setView] = useState<AppView>("welcome");
  const [showSidebar, setShowSidebar] = useState(true);
  const [showTokens, setShowTokens] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showCreator, setShowCreator] = useState(false);

  // Map of workspaceId -> sessionId for terminal sessions
  const [terminalSessions, setTerminalSessions] = useState<Record<string, string>>({});
  const creatingSessionRef = useRef<Set<string>>(new Set());

  const layoutVersionRef = useRef(0);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const bumpLayout = useCallback(() => {
    layoutVersionRef.current += 1;
    setLayoutVersion(layoutVersionRef.current);
  }, []);

  // Load theme on startup
  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  // When project becomes non-null, switch to hub and load workspaces
  useEffect(() => {
    if (project) {
      setView("hub");
      setShowCreator(false);
      loadWorkspaces(project.id);
    } else {
      setView("welcome");
      setShowCreator(false);
    }
  }, [project, loadWorkspaces]);

  // When active workspace changes (sidebar click), reset to hub
  const prevWorkspaceRef = useRef(activeWorkspaceId);
  useEffect(() => {
    if (activeWorkspaceId && activeWorkspaceId !== prevWorkspaceRef.current) {
      setView("hub");
      setShowCreator(false);
    }
    prevWorkspaceRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  // Create terminal session for a workspace if needed
  const ensureTerminalSession = useCallback(async (workspaceId: string) => {
    if (terminalSessions[workspaceId]) return;
    if (creatingSessionRef.current.has(workspaceId)) return;

    creatingSessionRef.current.add(workspaceId);
    try {
      const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
      const proj = useProjectStore.getState().current;
      if (!ws || !proj) return;

      const session = await ipc.createSession({
        name: ws.name,
        projectRoot: ws.worktreePath || proj.path,
      });
      setTerminalSessions((prev) => ({ ...prev, [workspaceId]: session.id }));
    } finally {
      creatingSessionRef.current.delete(workspaceId);
    }
  }, [terminalSessions]);

  // Handle switching to terminal view
  const openTerminal = useCallback(() => {
    if (!activeWorkspaceId) return;
    setView("terminal");
    setShowCreator(false);
    ensureTerminalSession(activeWorkspaceId);
  }, [activeWorkspaceId, ensureTerminalSession]);

  const openChat = useCallback(() => {
    if (!activeWorkspaceId) return;
    setView("chat");
    setShowCreator(false);
  }, [activeWorkspaceId]);

  const openChanges = useCallback(() => {
    setView("changes");
    setShowCreator(false);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Command+T → open terminal (if in project)
      if (mod && !e.shiftKey && e.key === "t") {
        e.preventDefault();
        if (project && activeWorkspaceId) {
          openTerminal();
        }
      }

      // Command+Shift+C → open chat
      if (mod && e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        if (project && activeWorkspaceId) {
          openChat();
        }
      }

      // Command+Shift+G → open changes
      if (mod && e.shiftKey && (e.key === "G" || e.key === "g")) {
        e.preventDefault();
        if (project) {
          openChanges();
        }
      }

      // Command+N → show workspace creator
      if (mod && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        if (project) {
          setShowCreator(true);
        }
      }

      // Command+K → command palette
      if (mod && !e.shiftKey && e.key === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
      }

      // Command+\ → toggle sidebar
      if (mod && e.key === "\\") {
        e.preventDefault();
        setShowSidebar((v) => !v);
        bumpLayout();
      }

      // Command+Shift+T → toggle token dashboard
      if (mod && e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault();
        setShowTokens((v) => !v);
        bumpLayout();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, activeWorkspaceId, openTerminal, openChat, openChanges, bumpLayout]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  // Full-screen views (no sidebar)
  if (!project) {
    if (view === "new-project") {
      return (
        <div className="flex h-screen w-screen bg-octo-bg text-zinc-100">
          <NewProjectFlow onBack={() => setView("welcome")} />
          <ToastContainer />
        </div>
      );
    }

    return (
      <div className="flex h-screen w-screen bg-octo-bg text-zinc-100">
        <WelcomeScreen onNewProject={() => setView("new-project")} />
        <ToastContainer />
      </div>
    );
  }

  // Project is open — sidebar + main content layout
  function renderMainContent() {
    if (showCreator && project) {
      return (
        <WorkspaceCreator
          projectId={project.id}
          projectPath={project.path}
          onCreated={() => {
            setShowCreator(false);
            setView("hub");
          }}
          onCancel={() => setShowCreator(false)}
        />
      );
    }

    switch (view) {
      case "terminal":
        if (activeWorkspaceId && terminalSessions[activeWorkspaceId]) {
          return (
            <TerminalPane
              sessionId={terminalSessions[activeWorkspaceId]}
              visible
              layoutVersion={layoutVersion}
            />
          );
        }
        // Session still being created — show loading
        return (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Starting terminal...
          </div>
        );

      case "chat":
        if (activeWorkspaceId) {
          return <ChatView workspaceId={activeWorkspaceId} />;
        }
        return (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Select a workspace to start chatting
          </div>
        );

      case "changes":
        if (project) {
          return <ChangesPanel projectPath={project.path} />;
        }
        return null;

      case "hub":
      default:
        if (!activeWorkspace) {
          // No workspaces yet — prompt to create one
          return (
            <WorkspaceCreator
              projectId={project!.id}
              projectPath={project!.path}
              onCreated={() => {
                setShowCreator(false);
                setView("hub");
              }}
              onCancel={() => setView("hub")}
            />
          );
        }
        return (
          <WorkspaceHub
            onOpenTerminal={openTerminal}
            onOpenChat={openChat}
          />
        );
    }
  }

  return (
    <div className="flex h-screen w-screen bg-octo-bg text-zinc-100">
      {showSidebar && (
        <ProjectSidebar
          onNewWorkspace={() => setShowCreator(true)}
        />
      )}

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-hidden">
            {renderMainContent()}
          </div>

          {showTokens && <TokenDashboard />}
        </div>
      </main>

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        onNewSession={() => {
          setShowPalette(false);
          setShowCreator(true);
        }}
        onToggleTokens={() => setShowTokens((v) => !v)}
      />

      <ToastContainer />
    </div>
  );
}

export default App;
