// Words shared by many screens: yes/no, relative time, fallbacks.
export const COMMON = {
  yes: "Yes",
  no: "No",
  agoNow: "now",
  agoMin: (n: number) => `${n} min`,
  agoHour: (n: number) => `${n} h`,
  agoDay: (n: number) => `${n} d`,
  fileFallback: "data",
  noData: "No data.",
  dash: "-",
  filter: "Filter",
  filterAria: (title: string) => `Filter ${title}`,
  viewChart: "View chart",
  viewTable: "View table",
  total: "Total",
  week: (d: string) => `week of ${d}`,
  until: (d: string) => `until ${d}`,
  openRow: (object: string, key: string, system: string) => `Open ${object} ${key} in ${system} with its related data`,
  openRowTitle: "Open with related data",
} as const;

/** The shared component library (components/ui). */
export const UI = {
  empty: "Nothing here yet.",
  pages: "Pages",
  prev: "Previous page",
  next: "Next page",
  range: (from: string, to: string, total: string) => `${from}–${to} of ${total}`,
  page: (n: number, of: number) => `Page ${n} of ${of}`,
  pageOpen: (n: number) => `Page ${n}`,
  more: (n: number) => `+${n}`,
  firstPoints: (n: number, of: number) => `Showing the first ${n} of ${of} points.`,
  notIn: "not in yet",
  others: "Others",
  partsAria: (parts: string) => `Parts of the whole: ${parts}`,
  target: "target",
};
