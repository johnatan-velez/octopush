// src/components/controls/Listbox.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Listbox } from "./Listbox";

const OPTIONS = [
  { value: "plan", label: "Plan", description: "Outline the approach" },
  { value: "implement", label: "Implement" },
];

describe("Listbox", () => {
  it("shows the current label, opens a portal listbox, selects, and closes", () => {
    const onChange = vi.fn();
    render(<Listbox value="plan" options={OPTIONS} onChange={onChange} ariaLabel="Stage role" />);
    const anchor = screen.getByRole("button", { name: "Stage role" });
    expect(anchor).toHaveTextContent("Plan");
    fireEvent.click(anchor);
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(document.body.contains(listbox)).toBe(true); // portaled
    expect(screen.getByText("Outline the approach")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Implement/ }));
    expect(onChange).toHaveBeenCalledWith("implement");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows the placeholder when value is null and closes on Escape", () => {
    render(<Listbox value={null} options={OPTIONS} onChange={() => {}} placeholder="— linear —" ariaLabel="Loop target" />);
    expect(screen.getByRole("button", { name: "Loop target" })).toHaveTextContent("— linear —");
    fireEvent.click(screen.getByRole("button", { name: "Loop target" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("marks the active option aria-selected", () => {
    render(<Listbox value="plan" options={OPTIONS} onChange={() => {}} ariaLabel="Stage role" />);
    fireEvent.click(screen.getByRole("button", { name: "Stage role" }));
    expect(screen.getByRole("option", { name: /Plan/ })).toHaveAttribute("aria-selected", "true");
  });
});
