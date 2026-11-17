// Tunables of the browser side: paging, caps, pacing, polling, zoom, chart geometry, and storage keys.
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS, WEEK_DAYS } from "./locale.ts";

/** Typed-out answers: speed follows what is still waiting, between a readable floor and a ceiling. */
export const TYPING = {
  cps: 90,
  maxCps: 320,
  drainS: 1.6,
  /** Longest frame step counted, so a stalled tab does not jump. */
  maxFrameMs: 64,
  /** The beat between the last character and the answer's components. */
  revealPauseMs: 200,
} as const;

/** Relative time buckets for "now", minutes, hours, days. */
export const AGO = { nowS: 60, hourS: HOUR_MS / SECOND_MS, dayS: DAY_MS / SECOND_MS, weekDays: WEEK_DAYS, minuteS: MINUTE_MS / SECOND_MS } as const;

export const EXPORT = { fileNameMax: 60 } as const;

/** Layout breakpoints, matched in script as in CSS. */
export const MEDIA = {
  narrow: "(max-width: 1120px)",
  mobile: "(max-width: 820px)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
} as const;

/** Short waits the interface takes before acting. */
export const DELAY_MS = {
  copiedFlash: 1400,
  focusAfterNew: 50,
  reopenAfterStream: 800,
  revokeDownload: 1000,
  focusSheet: 60,
  guardFirst: 600,
  guardSecond: 1000,
} as const;

/** Browser storage keys of per-viewer preferences. */
export const STORE = {
  model: "app:model",
  rail: "app:rail",
  canvas: "app:canvas",
  panel: "app:panel",
  draft: (chatId: string | null) => `app:draft:${chatId ?? "new"}`,
  focus: (chatId: string) => `app:focus:${chatId}`,
  pinned: "app:pinned",
} as const;

/** The message box: grows to a ceiling, warns near the limit, then stops. */
export const COMPOSER_LIMITS = { maxHeightPx: 148, maxChars: 2000, nearChars: 1600, warnChars: 1900 } as const;

/** Default page sizes when the agent did not choose one for the question. */
export const PAGE = {
  table: 25,
  list: 20,
  calendar: 30,
  bataRows: 15,
  bataCards: 12,
  bataChips: 30,
  bataGroup: 8,
  bataTable: 25,
  bars: 15,
  pivot: 25,
  files: 15,
  alerts: 15,
  matrix: 8,
  month: 10,
  roster: 12,
  contacts: 12,
  mapPoints: 12,
  mapList: 10,
  sla: 15,
  checklist: 20,
  kanban: 20,
  related: 10,
  activity: 15,
  timeline: 12,
} as const;

/** How many of a thing a surface shows before it pages, folds or cuts. */
export const CAP = {
  /** Characters past which a trailing text in a row is a sentence on its own line, not a glanceable meta like a date. */
  inlineText: 40,
  cards: 3,
  lane: 20,
  laneCards: 3,
  canvasTabs: 12,
  chatErrors: 3,
  attention: 2,
  homeRows: 3,
  homeFields: 3,
  homeMetrics: 4,
  boardColumns: 4,
  boardCards: 3,
  agendaRows: 6,
  wsMetrics: 4,
  recentDone: 5,
  starters: 4,
  deskWaiting: 4,
  deskRecent: 3,
  startersMax: 5,
  startersMin: 2,
  startersShown: 6,
  initials: 2,
  chartPoints: 120,
  guardIssues: 50,
  tableFoldRows: 10,
} as const;

/** Frame budget the motion probe reports against. */
export const FRAME = { slowMs: 33 } as const;

/** Dev guards: how much a report carries and the motion budget it checks. */
export const GUARD = { messageMax: 4000, minFrames: 5, p95: 0.95, p95BudgetMs: 20, layoutNodes: 4000, layoutSlackPx: 2 } as const;

/** Field lengths of the inputs the interface offers. */
export const INPUT_MAX = { reason: 300, unitName: 80, projectName: 80, projectGoal: 400, frameName: 120, tabName: 60, boardTitle: 120 } as const;

/** Access trail bars: the floor for an empty touch and for any touch with rows. */
export const TRAIL_BAR = { emptyPct: 4, minPct: 8 } as const;

/** Usage meters turn amber, then red, at these shares of the limit. */
export const METER = { warnPct: 70, badPct: 90 } as const;

/** Line-list text areas grow with their content between these rows. */
export const LINES_ROWS = { min: 3, max: 8 } as const;

/** Following a growing answer: how close counts as "at the bottom", the jump-button zone and the glide time constant. */
export const FOLLOW = { snapPx: 2, nearPx: 80, scrolledPx: 4, tauMs: 90, maxFrameMs: 64 } as const;
/** How long a new chat's highlight stays flagged, in --ap-d4 spans (the CSS flash runs three). */
export const FLASH_SPANS = 4;

/** The reasoning shown while the agent works: six 22px lines, then older lines glide out at the top. */
export const THOUGHT_MAX_PX = 132;
