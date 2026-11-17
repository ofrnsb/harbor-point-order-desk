// The fallback that keeps an agent from ever dead-ending: anything the business handles that no dedicated tool performs
// becomes a service request, confirmed by the customer, routed to the desk that owns it, with a reference and a due date.
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ActionHandler } from "./actions.ts";
import { DATA_DIR } from "./data-dir.ts";
import { defineTool, type DomainTool, type ToolCtx } from "./domain.ts";
import { LEN, REQUEST_DAYS_DEFAULT } from "../config/data.ts";
import { TOOL_DESC } from "../copy/agent.ts";
import { ERR, LABEL } from "../copy/server.ts";
import { LOCALE } from "../config/locale.ts";

/** A desk that takes service requests: who it is, what it handles, how many working days it has to answer. */
export type RequestDesk = { name: string; handles: string; workingDays: number };
const FILE = path.join(DATA_DIR, "domain", "requests.json");
let queue: Promise<unknown> = Promise.resolve();
const locked = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};

/** The date `days` working days (Monday to Friday) after `from`. */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from);
  for (let left = days; left > 0; ) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}

/** The `open_request` tool and its `service_request` executor for a domain\x27s desks. */
/**
 * The service-request fallback. Desks are looked up per turn (`desksFor`), so each company routes to its own divisions;
 * the agent sees them in its context. The desk's answer time travels with the request, so filing never looks it up again.
 */
export function serviceRequests(desksFor: (ctx: ToolCtx) => RequestDesk[], locale = LOCALE): { tool: DomainTool; action: ActionHandler } {
  const tool = defineTool({
    name: "open_request",
    category: "work",
    description: TOOL_DESC.openServiceRequestAnything,
    shape: { desk: z.string().min(2).max(LEN.label), kind: z.string().min(3).max(LEN.label), details: z.string().min(3).max(LEN.detail) },
    label: (i) => ({ running: LABEL.menyiapkanPermintaan(String(i.desk)), done: LABEL.permintaanDisiapkan(String(i.desk)) }),
    run: async ({ desk, kind, details }, ctx) => {
      const desks = desksFor(ctx);
      const d = desks.find((x) => x.name.toLowerCase() === String(desk).trim().toLowerCase());
      if (!d) return ERR.unknownDesk(desk, desks.map((x) => x.name).join(", ") || "(no desks yet)");
      const a = await ctx.propose({
        type: "service_request",
        payload: { desk: d.name, kind, details, workingDays: d.workingDays },
        title: kind,
        summary: [
          { label: LABEL.permintaan, value: kind },
          { label: LABEL.handledBy, value: d.name },
          { label: LABEL.rincian, value: details },
          { label: LABEL.responseWithin, value: LABEL.workingDays(d.workingDays) },
        ],
        consequence: ERR.requestReceivedRespondWithin(d.name, d.workingDays),
        danger: false,
      });
      return ERR.actionAwaitingConfirm(a.id);
    },
  });
  const action: ActionHandler = (a) =>
    locked(async () => {
      const { desk, kind, details, workingDays } = a.payload as { desk: string; kind: string; details: string; workingDays?: number };
      const now = new Date();
      const ref = `REQ-${now.toISOString().slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
      const due = addWorkingDays(now, Math.max(1, Number(workingDays) || REQUEST_DAYS_DEFAULT));
      let all: unknown[] = [];
      try {
        all = JSON.parse(await fs.readFile(FILE, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      all.push({ ref, desk, kind, details, openedAt: now.toISOString(), dueAt: due.toISOString(), status: "open" });
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(all, null, 2));
      return [
        { label: LABEL.referensi, value: ref },
        { label: LABEL.handledBy, value: desk },
        { label: LABEL.dijawabPalingLambat, value: due.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }) },
      ];
    });
  return { tool, action };
}
