import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Companion } from "./Companion";

// Mock CompanionTerminals so it doesn't try to hit the real store/IPC.
vi.mock("./CompanionTerminals", () => ({
  CompanionTerminals: ({ workspaceId }: { workspaceId: string }) => (
    <div>Terminals({workspaceId})</div>
  ),
}));

const defaultProps = {
  workspaceId: "ws-1",
  contextProps: { tokensUsed: 42000, tokensLimit: 200000, filesInFlight: 3, toolCalls: 7 },
  historyProps: { chats: [], activeChatId: null, onSelectChat: () => {}, onNewChat: () => {} },
  changedProps: { changedFiles: [] },
};

describe("Companion", () => {
  it("renders Context and History sections in talk mode", () => {
    render(<Companion mode="talk" {...defaultProps} />);
    expect(screen.getByText(/^context$/i)).toBeInTheDocument();
    expect(screen.getByText(/^history$/i)).toBeInTheDocument();
  });

  it("renders Terminals section in run mode", () => {
    render(<Companion mode="run" {...defaultProps} />);
    expect(screen.getByText(/Terminals/i)).toBeInTheDocument();
  });

  it("does not render Terminals when workspaceId is null in run mode", () => {
    render(<Companion mode="run" {...defaultProps} workspaceId={null} />);
    expect(screen.queryByText(/Terminals/i)).not.toBeInTheDocument();
  });

  it("renders Changed section in review mode", () => {
    render(<Companion mode="review" {...defaultProps} />);
    expect(screen.getByText(/changed/i)).toBeInTheDocument();
  });
});
