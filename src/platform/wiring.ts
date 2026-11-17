// Wiring: reads the shape of a connected catalog and decides which prebuilt surfaces light up for each object.
// Pure and schema-only (no rows), so it runs right after introspection and again whenever an admin edits the catalog.
import type { CatalogColumn, CatalogObject } from "./contract.ts";
import { words } from "../config/data.ts";

export type Role =
  | "key" | "ref" | "title" | "status" | "category" | "start" | "end" | "date" | "stamp"
  | "money" | "quantity" | "email" | "phone" | "address" | "lat" | "lng" | "text" | "flag" | "other";

export type ViewKind = "table" | "detail" | "board" | "calendar" | "trend" | "breakdown" | "map" | "directory" | "timeline";

/** A surface that lit up, with the columns it binds to. */
export type View = { kind: ViewKind; binds: Record<string, string> };

export type ObjectWiring = {
  connectionId: string; object: string; label: string;
  roles: Record<string, Role>;
  views: View[];
  /** Objects this one points at and objects that point at it: declared foreign keys, or a column named after another object's key (works across systems). */
  links: { connectionId: string; object: string; via: string; dir: "out" | "in"; declared: boolean }[];
};

/** Objects joined by foreign keys form a room: one end-to-end area of the tenant's work, later one agent. */
export type Room = { id: string; label: string; anchor: string; /** "connectionId/object" keys. */ objects: string[] };

const R = {
  title: /^(name|nama|title|judul|subject|subjek|full_name|nama_lengkap|display_name|label)$|_(name|nama|title)$/i,
  status: /(^|_)(status|state|stage|phase)$/i,
  category: /(^|_)(type|category|kind|segment|channel|priority|level|grade|class|brand|branch|warehouse|city|region|department|unit)$/i,
  start: /^(start|from|begin|check_in)(_(date|at|time))?$|_(start|from)$|^start_/i,
  end: /^(end|until|to|finish|check_out)(_(date|at|time))?$|_(end|until)$|^end_/i,
  stamp: /^(created|updated|modified|deleted|inserted|decided|approved|last_\w+)(_(at|on|date|time))?$|_(at)$/i,
  money: /(^|_)(amount|price|total|cost|fee|salary|paid|balance|limit|value|revenue|usd)($|_)/i,
  quantity: /(^|_)(qty|quantity|count|days|hours|stock|weight|volume|score|rating|units?)$/i,
  email: /(^|_)e_?mail$/i,
  phone: /(^|_)(phone|mobile|whatsapp)$/i,
  address: /(^|_)(address|location)$/i,
  lat: /^(lat|latitude)$/i,
  lng: /^(lng|lon|long|longitude)$/i,
  text: /(^|_)(note|notes|description|reason|remark|comment|message|body|content)$/i,
  key: /(^|_)(id|no|code|ref|number)$/i,
};

export function roleOf(c: CatalogColumn): Role {
  const n = words(c.name);
  if (c.pk) return "key";
  if (c.fk) return "ref";
  if (c.type === "bool") return "flag";
  if (R.lat.test(n) && c.type === "number") return "lat";
  if (R.lng.test(n) && c.type === "number") return "lng";
  if (c.type === "date" || /(_date|_at|^date)$/i.test(n)) {
    if (R.start.test(n)) return "start";
    if (R.end.test(n)) return "end";
    if (R.stamp.test(n)) return "stamp";
    return "date";
  }
  if (R.status.test(n)) return "status";
  if (R.email.test(n)) return "email";
  if (R.phone.test(n)) return "phone";
  if (c.type === "number" && (R.money.test(n) || c.minorUnits || c.unitHint)) return "money";
  if (c.type === "number" && R.quantity.test(n)) return "quantity";
  if (R.key.test(n)) return "key";
  if (R.title.test(n)) return "title";
  if (R.address.test(n)) return "address";
  if (R.category.test(n)) return "category";
  if (R.text.test(n)) return "text";
  return "other";
}

const first = (roles: Record<string, Role>, ...want: Role[]) => {
  for (const w of want) {
    const hit = Object.keys(roles).find((c) => roles[c] === w);
    if (hit) return hit;
  }
  return undefined;
};

function viewsFor(obj: CatalogObject, roles: Record<string, Role>): View[] {
  const key = obj.primaryKey[0] ?? first(roles, "key");
  const title = first(roles, "title") ?? key;
  const status = first(roles, "status");
  const category = first(roles, "category");
  const start = first(roles, "start");
  const end = first(roles, "end");
  const when = start ?? first(roles, "date");
  // Restricted or confidential figures (salaries, balances of a person) are never charted on a shared screen.
  const sens = new Map(obj.columns.map((c) => [c.name, c.sensitivity]));
  const charted = Object.fromEntries(Object.entries(roles).filter(([c]) => sens.get(c) === "public" || sens.get(c) === "internal"));
  const measure = first(charted, "money", "quantity");
  const stamps = Object.keys(roles).filter((c) => roles[c] === "stamp");
  const lat = first(roles, "lat");
  const lng = first(roles, "lng");
  const address = first(roles, "address");
  const reach = first(roles, "email", "phone");

  const out: View[] = [{ kind: "table", binds: { ...(title ? { title } : {}), ...(status ? { status } : {}) } }];
  if (key) out.push({ kind: "detail", binds: { key, ...(title ? { title } : {}) } });
  if (status) out.push({ kind: "board", binds: { lane: status, ...(title ? { title } : {}), ...(when ? { date: when } : {}) } });
  if (when) out.push({ kind: "calendar", binds: { start: when, ...(start && end ? { end } : {}), ...(title ? { title } : {}) } });
  if (measure && (when ?? stamps[0])) out.push({ kind: "trend", binds: { measure, date: (when ?? stamps[0])! } });
  if (measure && (category ?? status)) out.push({ kind: "breakdown", binds: { measure, group: (category ?? status)! } });
  if (lat && lng) out.push({ kind: "map", binds: { lat, lng, ...(title ? { title } : {}) } });
  else if (address) out.push({ kind: "map", binds: { address, ...(title ? { title } : {}) } });
  if (first(roles, "title") && reach) out.push({ kind: "directory", binds: { title: first(roles, "title")!, contact: reach } });
  const lifecycle = [...(when ? [when] : []), ...stamps];
  if (lifecycle.length >= 2) out.push({ kind: "timeline", binds: { steps: lifecycle.join(","), ...(status ? { status } : {}) } });
  return out;
}

export function wireObject(obj: CatalogObject, all: CatalogObject[] = [obj]): ObjectWiring {
  const roles = Object.fromEntries(obj.columns.map((c) => [c.name, roleOf(c)])) as Record<string, Role>;
  const others = all.filter((o) => !(o.connectionId === obj.connectionId && o.name === obj.name));
  const pointsAt = (c: CatalogColumn, from: CatalogObject, to: CatalogObject) =>
    c.fk ? c.fk.object === to.name && from.connectionId === to.connectionId : !c.pk && to.primaryKey.length === 1 && to.primaryKey[0] === c.name && R.key.test(c.name);
  const links: ObjectWiring["links"] = [
    ...others.flatMap((o) => obj.columns.filter((c) => pointsAt(c, obj, o)).map((c) => ({ connectionId: o.connectionId, object: o.name, via: c.name, dir: "out" as const, declared: !!c.fk }))),
    ...others.flatMap((o) => o.columns.filter((c) => pointsAt(c, o, obj)).map((c) => ({ connectionId: o.connectionId, object: o.name, via: c.name, dir: "in" as const, declared: !!c.fk }))),
  ];
  return { connectionId: obj.connectionId, object: obj.name, label: obj.label, roles, views: viewsFor(obj, roles), links };
}

/** Wires every exposed object and groups them into rooms by foreign key, anchored on the most referenced object. */
export function wireCatalog(objs: CatalogObject[]): { objects: ObjectWiring[]; rooms: Room[] } {
  const live = objs.filter((o) => o.exposed);
  const objects = live.map((o) => wireObject(o, live));
  const id = (o: { connectionId: string; object?: string; name?: string }) => `${o.connectionId}/${o.object ?? o.name}`;
  const parent = new Map(objects.map((w) => [id(w), id(w)]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (const w of objects) {
    for (const l of w.links) {
      const other = `${l.connectionId}/${l.object}`;
      if (parent.has(other)) parent.set(find(id(w)), find(other));
    }
  }
  const groups = new Map<string, ObjectWiring[]>();
  for (const w of objects) {
    const root = find(id(w));
    groups.set(root, [...(groups.get(root) ?? []), w]);
  }
  const rooms: Room[] = [...groups.values()].map((members) => {
    const inbound = (w: ObjectWiring) => w.links.filter((l) => l.dir === "in").length;
    const anchor = [...members].sort((a, b) => inbound(b) - inbound(a) || a.object.localeCompare(b.object))[0];
    return { id: id(anchor), label: anchor.label, anchor: anchor.object, objects: members.map((m) => id(m)).sort((a, b) => a.split("/")[1].localeCompare(b.split("/")[1])) };
  });
  return { objects, rooms: rooms.sort((a, b) => b.objects.length - a.objects.length || a.label.localeCompare(b.label)) };
}
