import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";

describe("WorkspaceContextMenu", () => {
  const baseProps = {
    x: 100,
    y: 200,
    workspaceName: "Alpha",
    onCustomize: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders Customize and Delete rows", () => {
    render(<WorkspaceContextMenu {...baseProps} />);
    expect(screen.getByText(/Customize/)).toBeInTheDocument();
    expect(screen.getByText(/Delete workspace/)).toBeInTheDocument();
  });

  it("calls onDelete and onClose when Delete row is clicked", () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkspaceContextMenu
        {...baseProps}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText(/Delete workspace/));
    expect(onDelete).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onCustomize and onClose when Customize row is clicked", () => {
    const onCustomize = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkspaceContextMenu
        {...baseProps}
        onCustomize={onCustomize}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText(/Customize/));
    expect(onCustomize).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<WorkspaceContextMenu {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking outside the menu", () => {
    const onClose = vi.fn();
    const { container } = render(
      <WorkspaceContextMenu {...baseProps} onClose={onClose} />,
    );
    // Click on the document body, outside the menu
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
    // Cleanup
    container.remove();
  });
});
