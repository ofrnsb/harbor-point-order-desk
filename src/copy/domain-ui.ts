// Words the domain's own browser components show (kept apart from domain.ts so agent prompts stay out of the client bundle).

export const SLIP = {
  waiting: "Sent to the approver",
  done: "Execution receipt",
  waitingStamp: "Awaiting approval",
  rowsSep: " · ",
  /** Receipt fields are matched by label so the slip can place them, whatever the executor called them. */
  match: {
    system: /sistem|system|objek|tabel/i,
    rows: /baris|rows|affected/i,
    confirmed: /konfirmasi|confirmed/i,
    approver: /approver|approved|approval/i,
    audit: /audit/i,
    status: /status/i,
    waiting: /waiting|awaiting/i,
  },
} as const;
