"use client";
// The unit profile editor. Every field can inherit from the parent (null); lists narrow the parent and never widen it.
// The server checks narrowing on save and returns the problems, which are shown above the save button.
import { INPUT_MAX } from "@/config/ui";
import { API } from "@/config/routes";
import { PROFILE } from "@/copy/ui-admin";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActionsResponse, CatalogResponse, ConnectionsResponse, RoutesResponse, UnitNode } from "@/platform/api-types";
import type { Attr, CatalogObject, ColumnMode, DataGrant, ObjectGrant, RowFilter, Sensitivity, UnitProfile } from "@/platform/contract";
import { COLUMN_MODES, SENSITIVITIES } from "@/platform/contract";
import { IChevronRight, IPlus, IShield, ITrash } from "../../icons";
import { D, EASE, FADE, REVEAL, REVEAL_STILL } from "../../motion";
import { api, MODE_LABEL, SENS_LABEL } from "../client";
import {
  Field, MultiPick, Notice, NumberInput, Reveal, RevealRow, SaveBar, Segmented, Select, Sheet, Switch, TextArea, TextInput, useApi, useMutation, useRowKeys,
} from "./kit";

type TabProps = { p: UnitProfile; setP: (fn: (p: UnitProfile | null) => UnitProfile | null) => void };
/** Every tab view takes the same props, so the editor renders whichever is open without knowing which it is. */
type TabViewProps = TabProps & { isRoot: boolean; name: string; setName: (v: string) => void };

const TABS = [
  { value: "profile", label: PROFILE.tabs.profile, View: ContextTab },
  { value: "data", label: PROFILE.tabs.data, View: DataTab },
  { value: "limits", label: PROFILE.tabs.limits, View: LimitsTab },
] as const satisfies readonly { value: string; label: string; View: (props: TabViewProps) => ReactNode }[];
export type ProfileTab = (typeof TABS)[number]["value"];
const TAB_OPTIONS = TABS.map(({ value, label }) => ({ value, label }));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const attrText = (v: Attr) => (Array.isArray(v) ? v.join(", ") : v);
const parseAttr = (s: string): Attr => (s.includes(",") ? s.split(",").map((x) => x.trim()).filter(Boolean) : s.trim());

export function ProfileEditor({ unit, initialTab = "profile", onClose, onSaved }: { unit: UnitNode | null; initialTab?: ProfileTab; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [p, setP] = useState<UnitProfile | null>(null);
  const [name, setName] = useState("");
  const m = useMutation();

  useEffect(() => {
    if (!unit) return;
    setP(clone(unit.profile));
    setName(unit.name);
    setTab(initialTab);
    m.setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, initialTab]);

  const { View } = TABS.find((t) => t.value === tab) ?? TABS[0];
  const save = async () => {
    if (!unit || !p) return;
    const ok = await m.run(() => api(API.admin.units, { method: "PATCH", json: { id: unit.id, name: name.trim(), profile: p } }));
    if (ok) { onSaved(); onClose(); }
  };

  return (
    <Sheet open={!!unit} title={unit ? unit.name : ""} sub={unit ? PROFILE.sub(unit.levelName, unit.code, !unit.parentId) : undefined} onClose={onClose}
      footer={<SaveBar busy={m.busy} error={m.error} onSave={save} onCancel={onClose} />}>
      {unit && p && (
        <>
          <Segmented value={tab} options={TAB_OPTIONS} onChange={setTab} label={PROFILE.tabsLabel} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} className="sp-form" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8, transition: { duration: D.d1, ease: EASE } }} transition={{ duration: D.d2, ease: EASE }}>
              <View p={p} setP={setP} isRoot={!unit.parentId} name={name} setName={setName} />
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </Sheet>
  );
}

function ContextTab({ p, setP, name, setName }: TabViewProps) {
  const up = (fn: (d: UnitProfile) => void) => setP((x) => { if (!x) return x; const d = clone(x); fn(d); return d; });
  const attrs = Object.entries(p.attributes);
  const termKeys = useRowKeys(p.glossary.length);
  const attrKeys = useRowKeys(attrs.length);
  return (
    <>
      <Field label={PROFILE.unitName}><TextInput value={name} onChange={setName} maxLength={INPUT_MAX.unitName} /></Field>
      <Field label={PROFILE.description} hint={PROFILE.descriptionHint} wide>
        <TextArea value={p.description} onChange={(v) => up((d) => { d.description = v; })} rows={4} />
      </Field>

      <section className="sp-form-block">
        <h3>{PROFILE.glossary} <span className="sp-count ap-num">{p.glossary.length}</span></h3>
        <Reveal>{p.glossary.length === 0 && <p className="sp-empty-line">{PROFILE.glossaryEmpty}</p>}</Reveal>
        <AnimatePresence initial={false}>
          {p.glossary.map((g, i) => (
            <RevealRow key={termKeys.keys[i]}>
              <div className="sp-form-row" data-cols="3">
                <TextInput value={g.term} placeholder={PROFILE.term} onChange={(v) => up((d) => { d.glossary[i].term = v; })} />
                <TextInput value={g.meaning} placeholder={PROFILE.meaning} onChange={(v) => up((d) => { d.glossary[i].meaning = v; })} />
                <button type="button" className="sp-btn" data-tone="quiet" aria-label={PROFILE.removeTerm(g.term)} onClick={() => { termKeys.removeAt(i); up((d) => { d.glossary.splice(i, 1); }); }}><ITrash size={14} /> {PROFILE.remove}</button>
              </div>
            </RevealRow>
          ))}
        </AnimatePresence>
        <button type="button" className="sp-btn" onClick={() => up((d) => { d.glossary.push({ term: "", meaning: "" }); })}><IPlus size={14} /> {PROFILE.addTerm}</button>
      </section>

      <section className="sp-form-block">
        <h3>{PROFILE.rules} <span className="sp-count ap-num">{p.rules.length}</span></h3>
        <p className="sp-field-hint">{PROFILE.rulesHint}</p>
        <AnimatePresence initial={false}>
          {p.rules.map((r, i) => (
            <RevealRow key={r.id}>
              <div className="sp-form-row" data-cols="rule">
                <TextArea value={r.text} rows={2} onChange={(v) => up((d) => { d.rules[i].text = v; })} />
                <Switch checked={r.locked} label={PROFILE.required} onChange={(v) => up((d) => { d.rules[i].locked = v; })} />
                <button type="button" className="sp-btn" data-tone="quiet" aria-label={PROFILE.removeRule} onClick={() => up((d) => { d.rules.splice(i, 1); })}><ITrash size={14} /> {PROFILE.remove}</button>
              </div>
            </RevealRow>
          ))}
        </AnimatePresence>
        <button type="button" className="sp-btn" onClick={() => up((d) => { d.rules.push({ id: `r_${Date.now().toString(36)}`, text: "", locked: false }); })}><IPlus size={14} /> {PROFILE.addRule}</button>
      </section>

      <section className="sp-form-block">
        <h3>{PROFILE.attributes}</h3>
        <p className="sp-field-hint">{PROFILE.attributesHint}</p>
        <AnimatePresence initial={false}>
          {attrs.map(([k, v], i) => (
            <RevealRow key={attrKeys.keys[i]}>
              <div className="sp-form-row" data-cols="3">
                <TextInput value={k} mono placeholder={PROFILE.key} onChange={(nk) => up((d) => { const val = d.attributes[k]; delete d.attributes[k]; d.attributes[nk] = val; })} />
                <TextInput value={attrText(v)} mono placeholder={PROFILE.value} onChange={(nv) => up((d) => { d.attributes[k] = parseAttr(nv); })} />
                <button type="button" className="sp-btn" data-tone="quiet" aria-label={PROFILE.removeAttr(k)} onClick={() => { attrKeys.removeAt(i); up((d) => { delete d.attributes[k]; }); }}><ITrash size={14} /> {PROFILE.remove}</button>
              </div>
            </RevealRow>
          ))}
        </AnimatePresence>
        <button type="button" className="sp-btn" onClick={() => up((d) => { let k: string = PROFILE.newAttr; let n = 1; while (k in d.attributes) k = `${PROFILE.newAttr}${++n}`; d.attributes[k] = ""; })}><IPlus size={14} /> {PROFILE.addAttr}</button>
      </section>
    </>
  );
}

function DataTab({ p, setP, isRoot }: TabViewProps) {
  const conns = useApi<ConnectionsResponse>(API.admin.connections);
  const up = (fn: (d: UnitProfile) => void) => setP((x) => { if (!x) return x; const d = clone(x); fn(d); return d; });
  const inherit = p.grants === null;
  return (
    <>
      <Field label={PROFILE.clearance} hint={PROFILE.clearanceHint}>
        <Select<Sensitivity | "inherit">
          value={p.clearance ?? "inherit"}
          options={[...(isRoot ? [] : [{ value: "inherit" as const, label: PROFILE.inherit }]), ...SENSITIVITIES.map((s) => ({ value: s, label: PROFILE.upTo(SENS_LABEL[s]) }))]}
          onChange={(v) => up((d) => { d.clearance = v === "inherit" ? null : v; })}
        />
      </Field>
      <Field label={PROFILE.dataAccess} hint={isRoot ? PROFILE.rootHint : PROFILE.narrowHint}>
        <Segmented value={inherit ? "inherit" : "narrow"} label={PROFILE.dataMode}
          options={[{ value: "inherit", label: isRoot ? PROFILE.allConnections : PROFILE.inherit }, { value: "narrow", label: isRoot ? PROFILE.pickConnections : PROFILE.narrow }]}
          onChange={(v) => up((d) => { d.grants = v === "inherit" ? null : (d.grants ?? []); })} />
      </Field>
      <Reveal id="grants">{!inherit && (
        conns.error ? (
          <Notice tone="bad" onRetry={conns.reload}>{conns.error}</Notice>
        ) : !conns.data ? (
          <div className="sp-q-skel" aria-hidden>{[0, 1].map((i) => <span key={i} className="sp-skel" />)}</div>
        ) : conns.data.connections.length === 0 ? (
          <p className="sp-empty-line">{PROFILE.noConnections}</p>
        ) : (
          <div className="sp-grants">
            {conns.data.connections.map((c) => {
              const gi = (p.grants ?? []).findIndex((g) => g.connectionId === c.id);
              const g = gi >= 0 ? p.grants![gi] : null;
              return (
                <GrantBlock key={c.id} code={c.code} name={c.name} connectionId={c.id} grant={g}
                  onChange={(next) => up((d) => {
                    const list = d.grants ?? [];
                    const i = list.findIndex((x) => x.connectionId === c.id);
                    if (next === null) { if (i >= 0) list.splice(i, 1); }
                    else if (i >= 0) list[i] = next; else list.push(next);
                    d.grants = list;
                  })} />
              );
            })}
          </div>
        )
      )}</Reveal>
    </>
  );
}

function GrantBlock({ code, name, connectionId, grant, onChange }: { code: string; name: string; connectionId: string; grant: DataGrant | null; onChange: (g: DataGrant | null) => void }) {
  const [open, setOpen] = useState(false);
  const cat = useApi<CatalogResponse>(grant && grant.objects !== "*" && open ? API.admin.catalog(connectionId) : null);
  const picked = grant && grant.objects !== "*" ? grant.objects : [];
  const objects = (cat.data?.objects ?? []).filter((o) => o.exposed);
  const rv = useReducedMotion() ? REVEAL_STILL : REVEAL;
  return (
    <div className="sp-grant" data-on={!!grant}>
      <div className="sp-grant-head">
        <Switch checked={!!grant} label={`${code} · ${name}`} onChange={(v) => onChange(v ? { connectionId, objects: "*" } : null)} />
        {grant && (
          <Segmented value={grant.objects === "*" ? "all" : "pick"} label={PROFILE.objectsOf(code)}
            options={[{ value: "all", label: PROFILE.allObjects }, { value: "pick", label: PROFILE.pickObjects(picked.length) }]}
            onChange={(v) => { onChange({ connectionId, objects: v === "all" ? "*" : [] }); if (v === "pick") setOpen(true); }} />
        )}
        {grant && grant.objects !== "*" && (
          <button type="button" className="sp-btn" data-tone="quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <IChevronRight size={14} className="sp-rot" data-open={open} /> {open ? PROFILE.close : PROFILE.setObjects}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {grant && grant.objects !== "*" && open && (
          <motion.div className="sp-grant-body" style={{ overflow: "hidden" }} initial={rv.initial} animate={{ ...rv.animate, transitionEnd: { overflow: "visible" } }} exit={{ ...rv.exit, overflow: "hidden" }}>
            <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={cat.error ? "error" : !cat.data ? "loading" : "list"} {...FADE}>
            {cat.error ? <Notice tone="bad" onRetry={cat.reload}>{cat.error}</Notice>
              : !cat.data ? <div className="sp-q-skel" aria-hidden><span className="sp-skel" /></div>
              : objects.length === 0 ? <p className="sp-empty-line">{PROFILE.emptyCatalog(code)}</p>
              : objects.map((o) => {
                const og = picked.find((x) => x.object === o.name) ?? null;
                return (
                  <ObjectGrantRow key={o.name} obj={o} grant={og} onChange={(next) => {
                    const list = picked.filter((x) => x.object !== o.name);
                    onChange({ connectionId, objects: next ? [...list, next] : list });
                  }} />
                );
              })}
            </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ObjectGrantRow({ obj, grant, onChange }: { obj: CatalogObject; grant: ObjectGrant | null; onChange: (g: ObjectGrant | null) => void }) {
  const [open, setOpen] = useState(false);
  const cols = useMemo(() => obj.columns.map((c) => ({ value: c.name, label: c.label || c.name })), [obj]);
  const overrides = grant?.columns ?? {};
  const filters = grant?.rowFilters ?? [];
  const filterKeys = useRowKeys(filters.length);
  const setCol = (col: string, mode: ColumnMode | "default") => {
    if (!grant) return;
    const next = { ...overrides };
    if (mode === "default") delete next[col]; else next[col] = mode;
    onChange({ ...grant, columns: next });
  };
  const setFilter = (i: number, f: RowFilter | null) => {
    if (!grant) return;
    const next = [...filters];
    if (f === null) next.splice(i, 1); else next[i] = f;
    onChange({ ...grant, rowFilters: next });
  };
  return (
    <div className="sp-og" data-on={!!grant}>
      <div className="sp-og-head">
        <Switch checked={!!grant} label={obj.label || obj.name} onChange={(v) => onChange(v ? { object: obj.name } : null)} />
        <span className="sp-mono sp-og-name" translate="no">{obj.name}</span>
        {grant && (
          <button type="button" className="sp-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? PROFILE.close : PROFILE.columnsAndFilters(Object.keys(overrides).length + filters.length)}
          </button>
        )}
      </div>
      <Reveal id="og-body">{grant && open && (
        <div className="sp-og-body">
          <table className="sp-table sp-table-tight">
            <thead><tr><th>{PROFILE.column}</th><th>{PROFILE.sensitivity}</th><th>{PROFILE.mode}</th></tr></thead>
            <tbody>
              {obj.columns.map((c) => (
                <tr key={c.name}>
                  <td><span dir="auto">{c.label || c.name}</span> <small className="sp-mono" translate="no">{c.name}</small></td>
                  <td><span className="sp-sens" data-s={c.sensitivity}>{SENS_LABEL[c.sensitivity]}</span></td>
                  <td>
                    <Select<ColumnMode | "default"> value={overrides[c.name] ?? "default"} label={PROFILE.columnMode(c.name)}
                      options={[{ value: "default", label: PROFILE.defaultSensitivity }, ...COLUMN_MODES.map((mm) => ({ value: mm, label: MODE_LABEL[mm] }))]}
                      onChange={(v) => setCol(c.name, v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="sp-og-h">{PROFILE.rowFilters}</h4>
          <p className="sp-field-hint">{PROFILE.rowFiltersHintA}{PROFILE.attrUserBranch}{PROFILE.rowFiltersHintB}{PROFILE.attrUnitRegion}{PROFILE.rowFiltersHintC}</p>
          <AnimatePresence initial={false}>
            {filters.map((f, i) => (
              <RevealRow key={filterKeys.keys[i]}>
                <div className="sp-form-row" data-cols="filter">
                  <Select value={f.column} options={cols} label={PROFILE.filterColumn} onChange={(v) => setFilter(i, { ...f, column: v })} />
                  <Segmented value={f.op} label={PROFILE.operator} options={[{ value: "eq", label: PROFILE.eq }, { value: "in", label: PROFILE.in }]} onChange={(v) => setFilter(i, { ...f, op: v })} />
                  <TextInput mono value={attrText(f.value)} placeholder={PROFILE.attrUserBranch} onChange={(v) => setFilter(i, { ...f, value: f.op === "in" ? parseAttr(v) : v })} />
                  <button type="button" className="sp-btn" data-tone="quiet" aria-label={PROFILE.removeFilter} onClick={() => { filterKeys.removeAt(i); setFilter(i, null); }}><ITrash size={14} /></button>
                </div>
              </RevealRow>
            ))}
          </AnimatePresence>
          <button type="button" className="sp-btn" onClick={() => setFilter(filters.length, { column: obj.columns[0]?.name ?? "", op: "eq", value: "" })}><IPlus size={14} /> {PROFILE.addFilter}</button>
        </div>
      )}</Reveal>
    </div>
  );
}

function LimitsTab({ p, setP, isRoot }: TabViewProps) {
  const actions = useApi<ActionsResponse>(API.admin.actions);
  const routes = useApi<RoutesResponse>(API.admin.routes);
  const up = (fn: (d: UnitProfile) => void) => setP((x) => { if (!x) return x; const d = clone(x); fn(d); return d; });
  const inheritLabel = isRoot ? PROFILE.all : PROFILE.inherit;
  return (
    <>
      <Field label={PROFILE.actions}>
        <Segmented value={p.actions === null ? "inherit" : "pick"} label={PROFILE.actionMode} options={[{ value: "inherit", label: inheritLabel }, { value: "pick", label: PROFILE.pickOne }]}
          onChange={(v) => up((d) => { d.actions = v === "inherit" ? null : (d.actions ?? []); })} />
      </Field>
      <Reveal id="actions">{p.actions !== null && (
        actions.error ? <Notice tone="bad" onRetry={actions.reload}>{actions.error}</Notice>
          : <MultiPick values={p.actions} label={PROFILE.actionsLabel} options={(actions.data?.actions ?? []).map((a) => ({ value: a.id, label: a.name, hint: a.description }))} onChange={(v) => up((d) => { d.actions = v; })} />
      )}</Reveal>
      <Field label={PROFILE.models}>
        <Segmented value={p.models === null ? "inherit" : "pick"} label={PROFILE.modelMode} options={[{ value: "inherit", label: inheritLabel }, { value: "pick", label: PROFILE.pickOne }]}
          onChange={(v) => up((d) => { d.models = v === "inherit" ? null : (d.models ?? []); })} />
      </Field>
      <Reveal id="models">{p.models !== null && (
        routes.error ? <Notice tone="bad" onRetry={routes.reload}>{routes.error}</Notice>
          : <MultiPick values={p.models} label={PROFILE.model} options={(routes.data?.routes ?? []).map((r) => ({ value: r.id, label: r.label, hint: r.external ? PROFILE.external : PROFILE.local }))} onChange={(v) => up((d) => { d.models = v; })} />
      )}</Reveal>
      <div className="sp-form-row" data-cols="2">
        <Field label={PROFILE.budget} hint={p.budgetMonthly === null ? PROFILE.emptyInherits : undefined}>
          <NumberInput value={p.budgetMonthly} placeholder={isRoot ? PROFILE.noLimit : PROFILE.inherit} onChange={(v) => up((d) => { d.budgetMonthly = v; })} />
        </Field>
        <Field label={PROFILE.approvalOver} hint={p.approvalOver === null ? PROFILE.emptyInherits : undefined}>
          <NumberInput value={p.approvalOver} placeholder={isRoot ? PROFILE.noLimit : PROFILE.inherit} onChange={(v) => up((d) => { d.approvalOver = v; })} />
        </Field>
      </div>
      <p className="sp-field-hint"><IShield size={13} /> {PROFILE.ceilingNote}</p>
    </>
  );
}

