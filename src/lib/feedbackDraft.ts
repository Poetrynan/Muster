// One-shot hand-off from an error spot ("Report this problem") to the feedback form.
// The form takes it once on mount, so a stale context never leaks into a later report.
let pending: string | null = null;

export function setFeedbackContext(context: string): void {
  pending = context;
}

export function takeFeedbackContext(): string | null {
  const c = pending;
  pending = null;
  return c;
}
