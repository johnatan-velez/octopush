import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommitInfo } from "../lib/ipc";

const { ipcMock, copyMock } = vi.hoisted(() => ({
  ipcMock: { gitLog: vi.fn(), commitDiff: vi.fn() },
  copyMock: vi.fn().mockResolvedValue(true),
}));
vi.mock("../lib/ipc", () => ({ ipc: ipcMock }));
vi.mock("../lib/clipboard", () => ({ copyToClipboard: copyMock }));
vi.mock("./Toasts", () => ({ pushToast: vi.fn() }));

import { HistoryModal, HISTORY_PAGE } from "./HistoryModal";

function commit(n: number): CommitInfo {
  return {
    sha: `${n}`.repeat(4).padEnd(40, "0"),
    shaShort: `sha${n}xx`,
    summary: `commit number ${n}`,
    authorName: "Ada",
    timestampMs: Date.now() - n * 60_000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  copyMock.mockResolvedValue(true);
});

describe("HistoryModal", () => {
  it("renders the first page of commits (sha, summary, author)", async () => {
    ipcMock.gitLog.mockResolvedValue([commit(1), commit(2)]);
    render(<HistoryModal projectPath="/repo" onClose={() => {}} />);
    expect(await screen.findByText("commit number 1")).toBeTruthy();
    expect(screen.getByText("sha1xx")).toBeTruthy();
    expect(screen.getByText("commit number 2")).toBeTruthy();
    expect(screen.getAllByText(/Ada/).length).toBe(2);
    expect(ipcMock.gitLog).toHaveBeenCalledWith("/repo", HISTORY_PAGE, 0);
    // A short page → no More button.
    expect(screen.queryByRole("button", { name: /^more$/i })).toBeNull();
  });

  it("expanding a commit fetches and shows its diff", async () => {
    ipcMock.gitLog.mockResolvedValue([commit(1)]);
    ipcMock.commitDiff.mockResolvedValue("+added line\n-removed line");
    render(<HistoryModal projectPath="/repo" onClose={() => {}} />);
    await userEvent.click(await screen.findByText("commit number 1"));
    await waitFor(() =>
      expect(ipcMock.commitDiff).toHaveBeenCalledWith("/repo", commit(1).sha),
    );
    expect(await screen.findByText(/\+added line/)).toBeTruthy();
    // Collapse: diff stays mounted (Reveal) but the region is aria-hidden.
    await userEvent.click(screen.getByText("commit number 1"));
    expect(ipcMock.commitDiff).toHaveBeenCalledTimes(1);
  });

  it("More paginates with skip and appends the next page", async () => {
    const fullPage = Array.from({ length: HISTORY_PAGE }, (_, i) => commit(i));
    ipcMock.gitLog.mockResolvedValueOnce(fullPage);
    ipcMock.gitLog.mockResolvedValueOnce([commit(900)]);
    render(<HistoryModal projectPath="/repo" onClose={() => {}} />);
    const more = await screen.findByRole("button", { name: /^more$/i });
    await userEvent.click(more);
    await waitFor(() =>
      expect(ipcMock.gitLog).toHaveBeenLastCalledWith("/repo", HISTORY_PAGE, HISTORY_PAGE),
    );
    expect(await screen.findByText("commit number 900")).toBeTruthy();
    // Short second page → More disappears.
    expect(screen.queryByRole("button", { name: /^more$/i })).toBeNull();
  });

  it("copy icon copies the full sha", async () => {
    ipcMock.gitLog.mockResolvedValue([commit(3)]);
    render(<HistoryModal projectPath="/repo" onClose={() => {}} />);
    await screen.findByText("commit number 3");
    await userEvent.click(screen.getByRole("button", { name: /copy sha/i }));
    expect(copyMock).toHaveBeenCalledWith(commit(3).sha, "SHA copied");
    // Copying must not expand the row's diff.
    expect(ipcMock.commitDiff).not.toHaveBeenCalled();
  });

  it("empty history shows a quiet hint", async () => {
    ipcMock.gitLog.mockResolvedValue([]);
    render(<HistoryModal projectPath="/repo" onClose={() => {}} />);
    expect(await screen.findByText(/no commits yet/i)).toBeTruthy();
  });
});
