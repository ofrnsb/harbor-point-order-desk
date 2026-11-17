type P = { size?: number; className?: string };
const s = (size = 16, className?: string) => ({
  width: size,
  height: size,
  className,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IPlus = ({ size, className }: P) => <svg {...s(size, className)}><path d="M12 5v14M5 12h14" /></svg>;
export const ISearch = ({ size, className }: P) => <svg {...s(size, className)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>;
export const IGlobe = ({ size, className }: P) => <svg {...s(size, className)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" /></svg>;
export const IStop = ({ size, className }: P) => <svg {...s(size, className)}><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" /></svg>;
export const IArrowUp = ({ size, className }: P) => <svg {...s(size, className)}><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
export const IArrowDown = ({ size, className }: P) => <svg {...s(size, className)}><path d="M12 5v14M6 13l6 6 6-6" /></svg>;
export const IArrowLeft = ({ size, className }: P) => <svg {...s(size, className)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
export const IArrowRight = ({ size, className }: P) => <svg {...s(size, className)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const IArrowUpRight = ({ size, className }: P) => <svg {...s(size, className)}><path d="M7 17 17 7M8 7h9v9" /></svg>;
export const IChevron = ({ size, className }: P) => <svg {...s(size, className)}><path d="m7 10 5 5 5-5" /></svg>;
export const IChevronRight = ({ size, className }: P) => <svg {...s(size, className)}><path d="m9 6 6 6-6 6" /></svg>;
export const IChevronLeft = ({ size, className }: P) => <svg {...s(size, className)}><path d="m15 6-6 6 6 6" /></svg>;
export const ICheck = ({ size, className }: P) => <svg {...s(size, className)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
export const IInfo = ({ size, className }: P) => <svg {...s(size, className)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6h.01" /></svg>;
export const IAlert = ({ size, className }: P) => <svg {...s(size, className)}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>;
export const IPencil = ({ size, className }: P) => <svg {...s(size, className)}><path d="M14.5 5.5 18.5 9.5M4 20l1-4.5L16 4.5a2 2 0 0 1 3 3L8 18.5 4 20Z" /></svg>;
export const ITrash = ({ size, className }: P) => <svg {...s(size, className)}><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></svg>;
export const ICopy = ({ size, className }: P) => <svg {...s(size, className)}><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 5v8A1.5 1.5 0 0 0 6 14.5h.5" /></svg>;
export const IDownload = ({ size, className }: P) => <svg {...s(size, className)}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg>;
export const IPrint = ({ size, className }: P) => <svg {...s(size, className)}><path d="M7 8.5V4.5h10v4" /><rect x="3.5" y="8.5" width="17" height="8" rx="2" /><path d="M7 14.5h10v5H7z" /></svg>;
export const IActivity = ({ size, className }: P) => <svg {...s(size, className)}><path d="M3 12h4l2.5-6 5 12L17 12h4" /></svg>;
export const IPanel = ({ size, className }: P) => <svg {...s(size, className)}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M14.5 4.5v15" /></svg>;
export const IMenu = ({ size, className }: P) => <svg {...s(size, className)}><path d="M4 7h16M4 12h16M4 17h10" /></svg>;
export const IClose = ({ size, className }: P) => <svg {...s(size, className)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const IRefresh = ({ size, className }: P) => <svg {...s(size, className)}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" /></svg>;
export const ISpark = ({ size, className }: P) => <svg {...s(size, className)}><path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14 3.5 12l6.7-2L12 3.5Z" /></svg>;
export const IChat = ({ size, className }: P) => <svg {...s(size, className)}><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H10l-4.5 3.5V16A2.5 2.5 0 0 1 5 13.5v-7Z" /></svg>;

export const IBox = ({ size, className }: P) => <svg {...s(size, className)}><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></svg>;
export const IReturn = ({ size, className }: P) => <svg {...s(size, className)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>;
export const IColumns = ({ size, className }: P) => <svg {...s(size, className)}><rect x="3.5" y="4.5" width="7" height="15" rx="2" /><rect x="13.5" y="4.5" width="7" height="15" rx="2" /></svg>;
export const IChart = ({ size, className }: P) => <svg {...s(size, className)}><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></svg>;

export const ICalendar = ({ size, className }: P) => <svg {...s(size, className)}><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
export const IUsers = ({ size, className }: P) => <svg {...s(size, className)}><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></svg>;
export const IStar = ({ size, className }: P) => <svg {...s(size, className)}><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" /></svg>;
export const IShield = ({ size, className }: P) => <svg {...s(size, className)}><path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6L12 3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>;
export const IDoc = ({ size, className }: P) => <svg {...s(size, className)}><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5l-5-5Z" /><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" /></svg>;
export const IPin = ({ size, className }: P) => <svg {...s(size, className)}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
export const IKeep = ({ size, className }: P) => <svg {...s(size, className)}><path d="m15 4.5 4.5 4.5-3.2 3.2.7 4.3-4.8-4.8-4.7 4.8.7-4.3-3.2-3.2L9.5 8l2.3-4.5 3.2 1Z" /><path d="M9.5 14.5 4.5 19.5" /></svg>;
export const IWallet = ({ size, className }: P) => <svg {...s(size, className)}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="7.5" width="16.5" height="12" rx="2.5" /><path d="M16 13.5h1.5" /></svg>;

export { Mark } from "@/domain/Mark";
