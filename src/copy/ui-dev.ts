// Developer pages and the dev guards: home preview, block stress page, visibility and motion reports.
export const DEV = {
  preview: {
    title: "Home sections",
    introA: "Live data from this product. Order them in ",
    introCode: "ui.home",
    introB: ", or open ",
    introLink: "/?home=spotlight,suggestions",
    introC: " to try an arrangement.",
    noData: (needs: string) => `No data yet: this section needs ${needs}.`,
    needs: {
      spotlight: "panel() items",
      records: "panel() items",
      board: "panel() items with a status",
      agenda: "panel() items with an `at` time from today on",
      metrics: "panel() metrics",
      suggestions: "capabilities in ui.ts",
      "suggestion-cards": "capabilities in ui.ts",
    },
  },
  stress: {
    title: "Answer blocks under stress",
    intro: "Each scenario at 360px and at the conversation width. Anything clipped, overlapping or unreadable here is a bug in the block.",
  },
  bricks: {
    title: "Bricks, one by one",
    intro: (bricks: number, cases: number) => `${bricks} bricks the agent builds every answer from, ${cases} variants, each on its own at 360px and at the conversation width. Built through the same schema and resolver as the agent's own calls.`,
    index: "Bricks",
    phone: "360px",
    column: "Conversation width",
  },
  guard: {
    hidden: (visibility: string, display: string, opacity: number) => `hidden (visibility:${visibility} display:${display} opacity:${opacity})`,
    zero: "zero size",
    covered: (tag: string, cls: string) => `covered by ${tag}.${cls}`,
    rejection: (reason: string) => `unhandled rejection: ${reason}`,
    overflow: (px: number, parent: string) => `runs ${px}px past its ${parent}`,
    spill: (px: number) => `its words run ${px}px past its own box`,
    overlap: (part: number, px: number) => `part ${part + 1} paints ${px}px over the part before it`,
    misaligned: (layouts: number) => `rows' trailing values sit at ${layouts} different places`,
  },
} as const;
