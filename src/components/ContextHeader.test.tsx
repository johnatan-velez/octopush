import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextHeader } from "./ContextHeader";

describe("ContextHeader", () => {
  it("renders the workspace name", () => {
    render(<ContextHeader workspaceName="auth-refactor" branch="feat/auth" gitStatus={null} />);
    expect(screen.getByText("auth-refactor")).toBeInTheDocument();
  });

  it("renders the branch", () => {
    render(<ContextHeader workspaceName="X" branch="feat/auth" gitStatus={null} />);
    expect(screen.getByText(/feat\/auth/)).toBeInTheDocument();
  });

  it("renders the unstaged count when git status is provided", () => {
    render(
      <ContextHeader
        workspaceName="X"
        branch="main"
        gitStatus={{
          branch: "main",
          changedFiles: [
            { path: "a.ts", status: "modified" },
            { path: "b.ts", status: "new" },
          ],
          ahead: 0,
          behind: 0,
        }}
      />,
    );
    expect(screen.getByText(/2 unstaged/)).toBeInTheDocument();
  });

  it("does not render the unstaged count when changedFiles is empty", () => {
    render(
      <ContextHeader
        workspaceName="X"
        branch="main"
        gitStatus={{ branch: "main", changedFiles: [], ahead: 0, behind: 0 }}
      />,
    );
    expect(screen.queryByText(/unstaged/)).not.toBeInTheDocument();
  });
});
