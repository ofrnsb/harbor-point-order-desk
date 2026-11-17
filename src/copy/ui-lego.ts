// Catalog views (tables, boards, calendars, charts) and the agent's built answers (bata).
export const LEGO = {
  noMatch: (q: string) => `No rows match "${q}".`,
  scrollAria: (title: string) => `${title}, scroll for more columns`,
  laneAria: (title: string, lane: string) => `${title}, by ${lane}`,
  moveKeys: "Drag to another lane, or press Alt and an arrow key",
  moveRequested: (lane: string) => `Move to ${lane} requested`,
  moveAsk: (card: string, key: string, column: string, from: string, to: string) => `Move ${card} (${key}) from ${from} to ${to}: change its ${column} in the system.`,
  hidePast: "Hide past",
  showPast: (n: number) => `Show past (${n})`,
  noDates: "No dates to show.",
  events: "events",
  lastValue: (v: string) => `, latest ${v}`,
  chartAria: (title: string, series: string, x: string) => `${title}. ${series} by ${x}. Use View table for the full figures.`,
} as const;

export const BATA = {
  share: (a: string, b: string) => `${a} of ${b}`,
  list: "list",
  table: "table",
  noChartData: "No data to draw.",
  chartAria: (series: string, x: string) => `${series} by ${x}`,
  showingFirst: "Showing the first",
  firstPointsOf: "points of",
  sources: "Sources",
  sourceOf: (where: string, rows: string) => `${where} · ${rows} ${rows === "1" ? "row" : "rows"}`,
} as const;
