import "server-only";

export interface AutopilotResult {
  ran: boolean;
  proposed: number;
  skipped: number;
  errors: string[];
}

/**
 * Autopilot: when enabled in Settings, look at the follow-up lists (people
 * waiting for my reply, follow-ups due, emails with no answer) and propose
 * emails into the approval queue (email_drafts + Gmail drafts). Never sends.
 * Runs at most once per `minIntervalHours` (default 20) unless `force`.
 */
export async function runAutopilotIfDue(options: { deadline: number; force?: boolean }): Promise<AutopilotResult> {
  void options;
  return { ran: false, proposed: 0, skipped: 0, errors: [] };
}
