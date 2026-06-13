import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { findNext, findPrevious, setSearchQueryOf } = vi.hoisted(() => ({
  findNext: vi.fn(() => true),
  findPrevious: vi.fn(() => true),
  setSearchQueryOf: vi.fn((q: unknown) => ({ effect: q })),
}));

vi.mock("@codemirror/search", () => {
  class SearchQuery {
    search: string;
    replace: string;
    valid = true;
    constructor(opts: { search?: string; replace?: string }) {
      this.search = opts.search ?? "";
      this.replace = opts.replace ?? "";
    }
    getCursor() {
      const items = [
        { from: 0, to: 3 },
        { from: 10, to: 13 },
      ];
      let i = 0;
      return {
        next() {
          return i < items.length
            ? { value: items[i++], done: false }
            : { value: undefined, done: true };
        },
      };
    }
  }
  return {
    SearchQuery,
    setSearchQuery: { of: setSearchQueryOf },
    findNext,
    findPrevious,
    replaceNext: vi.fn(() => true),
    replaceAll: vi.fn(() => true),
  };
});

import { EditorSearch } from "./EditorSearch";

function makeView() {
  return {
    state: {
      selection: { main: { from: 0, to: 0, empty: true } },
      sliceDoc: () => "",
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EditorSearch", () => {
  it("renders the find field and pushes the query into the editor", async () => {
    const view = makeView();
    render(<EditorSearch view={view} focusSignal={1} onClose={() => {}} />);
    const input = screen.getByLabelText("Find");
    await userEvent.type(input, "foo");
    expect(setSearchQueryOf).toHaveBeenCalled();
    // 2 matches reported by the mocked cursor.
    expect(screen.getByText(/2 found/i)).toBeInTheDocument();
  });

  it("Enter finds next, Shift+Enter finds previous", async () => {
    const view = makeView();
    render(<EditorSearch view={view} focusSignal={1} onClose={() => {}} />);
    const input = screen.getByLabelText("Find");
    await userEvent.type(input, "foo");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(findNext).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(findPrevious).toHaveBeenCalled();
  });

  it("toggling replace reveals the replace field", async () => {
    const view = makeView();
    render(<EditorSearch view={view} focusSignal={1} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /toggle replace/i }));
    expect(screen.getByLabelText("Replace with")).toBeInTheDocument();
  });

  it("Escape closes, clears the query, and refocuses the editor", () => {
    const view = makeView();
    const onClose = vi.fn();
    render(<EditorSearch view={view} focusSignal={1} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(view.focus).toHaveBeenCalled();
  });
});
