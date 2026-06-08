export type Severity = "high" | "medium" | "low";
export type Category = "bug" | "missing-test" | "security" | "style" | "perf" | "other";

export interface AiFinding {
  severity: Severity;
  category: Category;
  title: string;
  detail: string;
  file: string | null;
  line: number | null;
}
export interface AiReviewResult {
  summary: string;
  findings: AiFinding[];
}

export const AI_REVIEW_SYSTEM = `You are a meticulous senior code reviewer. You are given a unified git diff of a change a developer is about to commit. Review ONLY what the diff shows. Surface concrete, actionable issues: bugs, missing tests, security problems, performance regressions, and notable style problems. Do not praise; do not restate the diff.

Respond with ONLY a JSON object, no prose outside it, matching exactly:
{"summary":"<=160 chars: what the change does + the single biggest risk","findings":[{"severity":"high|medium|low","category":"bug|missing-test|security|style|perf|other","title":"<=80 chars","detail":"1-2 sentences","file":"path exactly as in the diff, or null","line":<new-file line number from the @@ header, or null>}]}
Use file/line when a finding maps to a specific changed line; use null for changeset-level findings. Order findings by severity (high first). If the change is clean, return an empty findings array with a summary saying so.`;

export function buildReviewPrompt(gitDiff: string): string {
  return `Here is the unified diff to review:\n\n${gitDiff}`;
}

const SEVERITIES = new Set<string>(["high", "medium", "low"]);
const CATEGORIES = new Set<string>(["bug", "missing-test", "security", "style", "perf", "other"]);

/** Tolerant: strips ```json fences + surrounding prose, parses the outermost
 *  object, validates shape, drops invalid findings. Throws if no parseable
 *  object is present. */
export function parseAiReview(text: string): AiReviewResult {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("AI review returned no JSON object");
  }
  const obj = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const findings: AiFinding[] = rawFindings
    .filter(
      (f): f is Record<string, unknown> =>
        !!f &&
        typeof f === "object" &&
        SEVERITIES.has((f as any).severity) &&
        CATEGORIES.has((f as any).category) &&
        typeof (f as any).title === "string" &&
        ((f as any).title as string).length > 0,
    )
    .map((f) => ({
      severity: f.severity as Severity,
      category: f.category as Category,
      title: f.title as string,
      detail: typeof f.detail === "string" ? (f.detail as string) : "",
      file: typeof f.file === "string" && f.file ? (f.file as string) : null,
      line: typeof f.line === "number" ? (f.line as number) : null,
    }));
  return { summary, findings };
}
