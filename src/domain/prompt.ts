// The platform briefing every agent gets, then the company, unit and process context of this turn.
import type { Agent, Effective } from "../platform/contract.ts";
import { list } from "../platform/store.ts";
import { desksOf } from "./desks.ts";
import { CONTEXT as T, PROMPT } from "../copy/domain.ts";
import { moneyText } from "../lib/values.ts";

export { PROMPT };


export function contextPrompt(eff: Effective, agent: Agent): string {
  const conns = list("connection", eff.tenant.id);
  const catalog = list("catalog", eff.tenant.id);
  const actions = list("action", eff.tenant.id).filter((a) => eff.actions.includes(a.id));
  const systems = conns.filter((c) => eff.data[c.id]).map((c) => {
    const objs = Object.entries(eff.data[c.id]).map(([name, o]) => {
      const obj = catalog.find((x) => x.connectionId === c.id && x.name === name);
      const filt = o.rowFilters.map((r) => T.filterLine(r.column, Array.isArray(r.value) ? r.value.join(T.filterValueSep) : String(r.value))).join(T.filterSep);
      return T.object(name, obj?.label ?? name, filt);
    });
    return T.system(c.code, c.name, c.kind, objs.join(T.objectSep));
  });
  const out = conns.filter((c) => !eff.data[c.id]).map((c) => T.outSystem(c.code, c.name));
  return [
    T.company(eff.tenant.name, eff.tenant.legalName, eff.tenant.industry, eff.tenant.currency, eff.tenant.timezone),
    T.agent(agent.name, agent.process, agent.owners.join(T.ownerSep)),
    agent.instructions,
    `${T.actingFor(eff.user.name, eff.user.title, eff.role, eff.path.slice(1).map((u) => u.name).join(T.pathSep) || eff.unit.name)} ${eff.can.propose ? T.mayPropose : T.readOnly} ${eff.can.approve ? T.approver : ""}`,
    eff.context.length ? T.context(eff.context.map((c) => T.contextLine(c.unit, c.description)).join(T.lineSep)) : "",
    eff.rules.length ? T.rules(eff.rules.map((r) => T.ruleLine(r.locked, r.text, r.unit)).join(T.lineSep)) : "",
    eff.glossary.length ? T.glossary(eff.glossary.map((g) => T.glossaryTerm(g.term, g.meaning)).join(T.glossarySep)) : "",
    T.systems(systems.join(T.lineSep), out),
    actions.length
      ? T.actions(moneyText(eff.approvalOver), actions.map((a) => T.actionLine(a.id, a.name, a.description, T.actionTarget(conns.find((c) => c.id === a.connectionId)?.code ?? a.connectionId, a.object), a.op, a.keyColumn, a.fields.filter((f) => f.fixed === undefined).map((f) => T.actionField(f.column, f.required, f.kind, f.options)).join(T.fieldSep), a.risk, a.owner)).join(T.lineSep))
      : T.noActions,
    (() => { const desks = desksOf(eff.tenant.id); return desks.length ? T.desks(desks.map((d) => T.desk(d.name, d.handles, d.workingDays)).join(T.deskSep)) : ""; })(),
].filter(Boolean).join(T.sectionSep);
}
