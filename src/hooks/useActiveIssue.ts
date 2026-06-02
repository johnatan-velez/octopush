import { useEffect } from "react";
import type { Issue } from "../lib/types";
import { useIssuesStore } from "../stores/issuesStore";

/**
 * Resolve an issue by key, prioritizing the detailed cache (which has
 * `blocks` / `blockedBy` / `subtasks` populated by `get_issue`) over the
 * lightweight `issues` list (which only carries the rows needed for the
 * "Mine" pill). Triggers a `loadDetail` whenever the key changes so the
 * detailed copy is always in flight when something downstream needs it.
 *
 * Returns null until either lookup hits or the fetch completes.
 *
 * Shared between ContextHeader (renders the active ticket chip) and
 * WorkContextPanel (derives Blocking / Blocked by / Subtasks pills from
 * the detailed Issue). Threading both through one store entry guarantees
 * exactly one network call per active-key change.
 */
export function useActiveIssue(key: string | null): Issue | null {
  const detail = useIssuesStore((s) => (key ? s.detailByKey[key] : undefined));
  const listHit = useIssuesStore((s) =>
    key ? (s.issues ?? []).find((i) => i.key === key) : undefined,
  );
  const loadDetail = useIssuesStore((s) => s.loadDetail);

  useEffect(() => {
    if (!key) return;
    void loadDetail(key);
  }, [key, loadDetail]);

  if (!key) return null;
  return detail ?? listHit ?? null;
}
