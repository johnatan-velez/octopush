import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { changesFocusSpy } = vi.hoisted(() => ({ changesFocusSpy: vi.fn() }));

// Stub the heavy panels — we only test the sidebar's tab + collapse logic.
// Each stub echoes the injected headerLeading so the tab switcher is reachable;
// the ChangesPanel stub registers a focuser so we can exercise the `c` shortcut.
vi.mock("./ChangesPanel", () => ({
  ChangesPanel: ({
    headerLeading,
    registerFocusCommit,
  }: {
    headerLeading?: React.ReactNode;
    registerFocusCommit?: (fn: () => void) => void;
  }) => {
    registerFocusCommit?.(changesFocusSpy);
    return <div data-testid="changes-panel">{headerLeading}</div>;
  },
}));
vi.mock("./CompanionFileTree", () => ({
  CompanionFileTree: ({ headerLeading }: { headerLeading?: React.ReactNode }) => (
    <div data-testid="files-tree">{headerLeading}</div>
  ),
}));

import { ReviewSidebar } from "./ReviewSidebar";

const baseProps = {
  projectPath: "/repo",
  workspaceId: "w1",
  diff: "",
  fileTree: { rootPath: "/repo", rootLabel: "repo", changedPaths: new Set<string>() },
};

beforeEach(() => {
  localStorage.clear();
  changesFocusSpy.mockClear();
});

describe("ReviewSidebar", () => {
  it("defaults to the Changes tab when there are changes", () => {
    render(<ReviewSidebar changedCount={3} {...baseProps} />);
    expect(screen.getByTestId("changes-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("files-tree")).not.toBeInTheDocument();
  });

  it("defaults to the Files tab when nothing has changed", () => {
    render(<ReviewSidebar changedCount={0} {...baseProps} />);
    expect(screen.getByTestId("files-tree")).toBeInTheDocument();
    expect(screen.queryByTestId("changes-panel")).not.toBeInTheDocument();
  });

  it("switches to Files when the Files tab is clicked", async () => {
    render(<ReviewSidebar changedCount={3} {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(await screen.findByTestId("files-tree")).toBeInTheDocument();
    // Persisted so a remount keeps the choice.
    expect(localStorage.getItem("reviewSidebarTab")).toBe("files");
  });

  it("collapses to a slim strip and a strip icon re-expands to that tab", async () => {
    render(<ReviewSidebar changedCount={2} {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /collapse changes & files/i }));

    // Panels are gone; the expand control + strip mode icons remain.
    expect(screen.queryByTestId("changes-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expand changes & files/i })).toBeInTheDocument();

    // Clicking the Files strip icon expands straight into the Files tab.
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(await screen.findByTestId("files-tree")).toBeInTheDocument();
    expect(localStorage.getItem("reviewSidebarCollapsed")).toBe("0");
  });

  it("the focus-commit shortcut reveals the Changes tab and focuses the commit box", async () => {
    let focusCommit: (() => void) | undefined;
    render(
      <ReviewSidebar
        changedCount={0}
        {...baseProps}
        registerFocusCommit={(fn) => { focusCommit = fn; }}
      />,
    );
    // changedCount 0 → starts on Files, so ChangesPanel is not mounted.
    expect(screen.queryByTestId("changes-panel")).not.toBeInTheDocument();

    // Fire the shortcut: it must switch to Changes and focus the commit box.
    act(() => focusCommit?.());
    expect(await screen.findByTestId("changes-panel")).toBeInTheDocument();
    expect(changesFocusSpy).toHaveBeenCalled();
  });
});
