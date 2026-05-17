import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Companion } from "./Companion";

const defaultProps = {
  contextProps: { tokensUsed: 42000, tokensLimit: 200000, filesInFlight: 3, toolCalls: 7 },
  historyProps: { chats: [], activeChatId: null, onSelectChat: () => {}, onNewChat: () => {} },
  terminalsProps: { terminals: [], activeTerminalId: null, onSelectTerminal: () => {}, onNewTerminal: () => {} },
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
    expect(screen.getByText(/^terminals$/i)).toBeInTheDocument();
  });

  it("renders Changed section in review mode", () => {
    render(<Companion mode="review" {...defaultProps} />);
    expect(screen.getByText(/changed/i)).toBeInTheDocument();
  });
});
