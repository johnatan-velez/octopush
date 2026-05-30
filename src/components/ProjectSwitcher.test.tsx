import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectSwitcher } from "./ProjectSwitcher";
import type { ProjectInfo } from "../lib/types";

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "proj-1",
    name: "octopus-sh",
    path: "/Users/jonathan/TYPEFY/octopus/octopus-sh",
    jiraProjectKey: null,
    ...overrides,
  };
}

describe("ProjectSwitcher", () => {
  const projects: ProjectInfo[] = [
    makeProject({ id: "a", name: "octopus-sh", path: "/path/octopus-sh" }),
    makeProject({ id: "b", name: "hyperion", path: "/path/hyperion" }),
  ];

  it("renders one row per project", () => {
    render(
      <ProjectSwitcher
        activeProjectId="a"
        projects={projects}
        onSelect={vi.fn()}
        onAddProject={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("octopus-sh")).toBeInTheDocument();
    expect(screen.getByText("hyperion")).toBeInTheDocument();
  });

  it("marks the active project with a visible indicator", () => {
    render(
      <ProjectSwitcher
        activeProjectId="a"
        projects={projects}
        onSelect={vi.fn()}
        onAddProject={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // The active dot has aria-label="active"
    expect(screen.getByLabelText("active")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked project", () => {
    const onSelect = vi.fn();
    render(
      <ProjectSwitcher
        activeProjectId="a"
        projects={projects}
        onSelect={onSelect}
        onAddProject={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("hyperion"));
    expect(onSelect).toHaveBeenCalledWith(projects[1]);
  });

  it("calls onAddProject when the add button is clicked", () => {
    const onAddProject = vi.fn();
    render(
      <ProjectSwitcher
        activeProjectId="a"
        projects={projects}
        onSelect={vi.fn()}
        onAddProject={onAddProject}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/Add project/));
    expect(onAddProject).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(
      <ProjectSwitcher
        activeProjectId="a"
        projects={projects}
        onSelect={vi.fn()}
        onAddProject={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders empty state when there are no projects", () => {
    render(
      <ProjectSwitcher
        activeProjectId=""
        projects={[]}
        onSelect={vi.fn()}
        onAddProject={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/No recent projects/)).toBeInTheDocument();
  });
});
