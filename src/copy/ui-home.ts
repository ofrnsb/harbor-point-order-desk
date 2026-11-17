// The home sections: heads, carousel, skeleton and error states.
export const HOME = {
  upNext: "Up next",
  viewAll: (n: number) => `View all ${n}`,
  couldNotLoad: (title: string) => `Could not load ${title.toLowerCase()}.`,
  retry: "Retry",
  loading: (title: string) => `Loading ${title.toLowerCase()}`,
  carousel: "carousel",
  position: (i: number, n: number) => `${i} of ${n}`,
  previous: "Previous",
  next: "Next",
  details: "Details",
  more: (n: number) => `${n} more`,
  loadingFigures: "Loading key figures",
  suggestions: "Suggestions",
  capabilityGuard: "Capability",
  previewTitle: "Home sections",
} as const;
