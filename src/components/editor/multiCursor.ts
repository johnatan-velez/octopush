import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";

export interface MatchRange {
  from: number;
  to: number;
}

/** All non-overlapping occurrences of `query` in `doc`, left to right. */
export function computeOccurrenceRanges(doc: string, query: string): MatchRange[] {
  if (!query) return [];
  const out: MatchRange[] = [];
  let i = doc.indexOf(query);
  while (i !== -1) {
    out.push({ from: i, to: i + query.length });
    i = doc.indexOf(query, i + query.length); // non-overlapping
  }
  return out;
}

/**
 * Select every occurrence of the main selection's text (or the word under the
 * caret if the selection is empty). Places one cursor/selection per match.
 * Returns false (no-op) when there is nothing to expand to.
 */
export const selectAllOccurrences: Command = (view) => {
  const state = view.state;
  const main = state.selection.main;

  let query: string;
  let anchorFrom: number;
  if (main.empty) {
    const word = state.wordAt(main.head);
    if (!word) return false;
    query = state.sliceDoc(word.from, word.to);
    anchorFrom = word.from;
  } else {
    query = state.sliceDoc(main.from, main.to);
    anchorFrom = main.from;
  }

  const ranges = computeOccurrenceRanges(state.doc.toString(), query);
  if (ranges.length < 2) return false;

  const selRanges = ranges.map((r) => EditorSelection.range(r.from, r.to));
  const mainIndex = Math.max(0, ranges.findIndex((r) => r.from === anchorFrom));

  view.dispatch({
    selection: EditorSelection.create(selRanges, mainIndex),
    scrollIntoView: true,
  });
  return true;
};
