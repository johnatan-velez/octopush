export const COMMIT_SYSTEM = `You write concise git commit messages from a staged diff. Output ONLY the message — a <=50-character imperative subject line, then (only if the change warrants it) a blank line and 1-3 short body lines explaining the why. No backticks, no "Here is", no quotes around the message, no trailing notes.`;

export function buildCommitPrompt(stagedDiff: string): string {
  return `Write a commit message for this staged diff:\n\n${stagedDiff}`;
}
