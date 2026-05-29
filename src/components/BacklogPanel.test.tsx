import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BacklogPanel } from "./BacklogPanel";
import { useIssuesStore } from "../stores/issuesStore";

// Mock ipc so the store's load() call resolves without side-effects by default.
vi.mock("../lib/ipc", () => ({
  ipc: {
    listMyIssues: vi.fn().mockResolvedValue([]),
    openFileInSystem: vi.fn().mockResolvedValue(undefined),
  },
}));

beforeEach(() => {
  // Reset to clean state and replace load with a no-op so mounting
  // doesn't trigger async state changes that stomp on per-test setup.
  useIssuesStore.setState({
    issues: null,
    loading: false,
    error: null,
    load: vi.fn().mockResolvedValue(undefined),
  });
});

describe("BacklogPanel", () => {
  it("shows the BACKLOG eyebrow", () => {
    render(<BacklogPanel activeKey={null} configured />);
    expect(screen.getByText(/backlog/i)).toBeInTheDocument();
  });

  it("prompts to connect when not configured", () => {
    render(<BacklogPanel activeKey={null} configured={false} />);
    expect(screen.getByText(/connect jira/i)).toBeInTheDocument();
  });

  it("shows loading state while loading with no issues", () => {
    useIssuesStore.setState({ issues: null, loading: true, error: null });
    render(<BacklogPanel activeKey={null} configured />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error state when load fails", () => {
    useIssuesStore.setState({ issues: null, loading: false, error: "Network error" });
    render(<BacklogPanel activeKey={null} configured />);
    expect(screen.getByText(/couldn.*t reach jira/i)).toBeInTheDocument();
  });

  it("shows empty state when no issues", () => {
    useIssuesStore.setState({ issues: [], loading: false, error: null });
    render(<BacklogPanel activeKey={null} configured />);
    expect(screen.getByText(/no assigned tickets/i)).toBeInTheDocument();
  });

  it("lists issues with key + summary + status", () => {
    useIssuesStore.setState({
      issues: [
        {
          key: "PROJ-123",
          summary: "Login",
          statusName: "In Progress",
          statusCategory: "inProgress",
          issueType: "Story",
          priority: "High",
          url: "https://example.atlassian.net/browse/PROJ-123",
          parentKey: null,
        },
      ],
    });
    render(<BacklogPanel activeKey="PROJ-123" configured />);
    expect(screen.getByText("PROJ-123")).toBeInTheDocument();
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("highlights the active row with brass treatment", () => {
    useIssuesStore.setState({
      issues: [
        {
          key: "PROJ-123",
          summary: "Login",
          statusName: "In Progress",
          statusCategory: "inProgress",
          issueType: "Story",
          priority: "High",
          url: "u",
          parentKey: null,
        },
        {
          key: "PROJ-456",
          summary: "Other",
          statusName: "To Do",
          statusCategory: "todo",
          issueType: "Task",
          priority: null,
          url: "u2",
          parentKey: null,
        },
      ],
    });
    render(<BacklogPanel activeKey="PROJ-123" configured />);
    // Active row should have brass border class
    const activeKeyEl = screen.getByText("PROJ-123");
    const rowBtn = activeKeyEl.closest("button");
    expect(rowBtn?.className).toContain("border-octo-brass");
    // Inactive row should have transparent border
    const inactiveKeyEl = screen.getByText("PROJ-456");
    const inactiveBtn = inactiveKeyEl.closest("button");
    expect(inactiveBtn?.className).toContain("border-transparent");
  });
});
