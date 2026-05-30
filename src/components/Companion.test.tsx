import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Companion } from "./Companion";

// Minimal stubs for child components so the test focuses on structure.
vi.mock("./CompanionContext",   () => ({ CompanionContext:   () => <div data-testid="ctx" />   }));
vi.mock("./CompanionHistory",   () => ({ CompanionHistory:   () => <div data-testid="hist" />  }));
vi.mock("./CompanionTerminals", () => ({ CompanionTerminals: () => <div data-testid="term" />  }));
vi.mock("./CompanionFileTree",  () => ({ CompanionFileTree:  () => <div data-testid="tree" />  }));
vi.mock("./ActiveTicketPanel",  () => ({ ActiveTicketPanel:  () => <div data-testid="active" /> }));
vi.mock("./BacklogPanel",       () => ({ BacklogPanel:       () => <div data-testid="backlog" /> }));
vi.mock("./ElsewhereFooter",    () => ({ ElsewhereFooter:    () => <div data-testid="else" />  }));

const baseProps = {
  workspaceId: "w1",
  contextProps: { tokensUsed: 0, tokensLimit: 0, unstaged: 0, toolCalls: 0 },
  historyProps: { chats: [], activeChatId: null, onSelectChat: vi.fn(), onNewChat: vi.fn() },
  issueTrackerConfigured: true,
  workspace: {
    id: "w1", projectId: "p1", name: "x", task: "", branch: "feat/CLPNSNS-1",
    worktreePath: null, setupScript: "", status: "active",
    createdAt: "", lastActive: "", glyph: null, tint: null, testCommand: null,
    linkedIssueKey: null, issueLinkDismissed: false,
  },
  project: { id: "p1", name: "Test", path: "/tmp/repo", jiraProjectKey: null },
};

describe("Companion cross-mode visibility of issue tracker block", () => {
  it("renders ActiveTicketPanel + BacklogPanel in TALK", () => {
    render(<Companion mode="talk" {...baseProps} />);
    expect(screen.getByTestId("active")).toBeInTheDocument();
    expect(screen.getByTestId("backlog")).toBeInTheDocument();
  });

  it("renders them in RUN", () => {
    render(<Companion mode="run" {...baseProps} />);
    expect(screen.getByTestId("active")).toBeInTheDocument();
    expect(screen.getByTestId("backlog")).toBeInTheDocument();
  });

  it("renders them in REVIEW", () => {
    render(<Companion mode="review" {...baseProps} fileTree={{ rootPath: "/", rootLabel: "/", changedPaths: new Set() }} />);
    expect(screen.getByTestId("active")).toBeInTheDocument();
    expect(screen.getByTestId("backlog")).toBeInTheDocument();
  });
});
