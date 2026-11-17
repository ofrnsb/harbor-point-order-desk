"use client";
// Workspace pieces specific to Simpul: the act-as switcher, the user menu, the agent list, the work queue home and the
// data scope panel. Data comes from /api/me and /api/workspace; decisions go to /api/work/[id].
import { CAP, INPUT_MAX } from "@/config/ui";
import { API, PAGES } from "@/config/routes";
import { WS } from "@/copy/ui-workspace";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useState } from "react";
import type { MeResponse, ScopeSummary, WorkItemView, WorkspaceResponse } from "@/platform/api-types";
import type { Metric } from "@/lib/types";
import { IAlert, IArrowUpRight, ICheck, IChevron, IClose, IRefresh, IShield } from "../icons";
import { D, EASE, STEP, stagger } from "../motion";
import { agoId, api, KIND_SHORT, num, PLATFORM_ROLE_LABEL, ROLE_LABEL, SENS_LABEL, STATE_LABEL, STATE_TONE } from "./client";
import { moneyCompact, moneyText } from "@/lib/values";
import { Badge, badges, Empty, Grow, Label, List, Meter, Notice, Row, Stack, Text, Title } from "@/components/ui";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuCard, MenuItem, MenuTitle, MenuTrigger } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ui } from "@/domain/ui";

// ---------- Act as ----------
export const UnitSwitcher = memo(function UnitSwitcher({ me, unitId, onPick, disabled }: {
  me: MeResponse | null; unitId: string | null; onPick: (id: string) => void; disabled?: boolean;
}) {
  const current = me?.memberships.find((m) => m.id === unitId) ?? null;
  if (!me) return <Skeleton height={44} width={220} />;
  if (!me.memberships.length) return <Text size="s" tone="warn">{WS.noTeam}</Text>;
  const label = <span className="sp-ui-grow"><Stack gap="none"><Text strong truncate>{current?.name ?? WS.pickTeam}</Text>{current && <Label truncate>{ROLE_LABEL[current.role]}</Label>}</Stack></span>;
  // One team: nothing to switch to, so it is a label, not a menu.
  if (me.memberships.length === 1) return <div className="sp-ui-menu-trigger" data-static title={current?.path}>{label}</div>;
  return (
    <Menu role="listbox" label={WS.actingAs} grow trigger={({ open, toggle }) => (
      <MenuTrigger open={open} onClick={toggle} disabled={disabled} popup="listbox" title={disabled ? WS.waitBeforeSwitch : current?.path}>
        {label}
        <IChevron size={14} />
      </MenuTrigger>
    )}>
      {(close) => (
        <>
          <MenuTitle>{WS.actingAs}</MenuTitle>
          {me.memberships.map((m) => (
            <MenuItem key={m.id} role="option" selected={m.id === unitId} title={m.name} sub={`${ROLE_LABEL[m.role]} · ${m.path}`}
              onClick={() => { close(); if (m.id !== unitId) onPick(m.id); }} />
          ))}
        </>
      )}
    </Menu>
  );
});

// ---------- User ----------
export const UserMenu = memo(function UserMenu({ me }: { me: MeResponse | null }) {
  const [leaving, setLeaving] = useState(false);
  if (!me) return <Skeleton height={32} width={32} />;
  const logout = async () => {
    setLeaving(true);
    try { await fetch(API.auth.logout, { method: "POST" }); } finally { window.location.assign(PAGES.signIn); }
  };
  return (
    <Menu trigger={({ open, toggle }) => (
      <MenuTrigger open={open} onClick={toggle} quiet title={me.user.name}>
        <Avatar name={me.user.name} max={CAP.initials} />
      </MenuTrigger>
    )}>
      {() => (
        <>
          <MenuCard>
            <Text strong>{me.user.name}</Text>
            <Label>{me.user.title}</Label>
            <Label><span translate="no">{me.user.email}</span></Label>
            <Label>{me.tenant.name}</Label>
          </MenuCard>
          {me.user.platformRoles.length > 0 && (
            <MenuItem href={PAGES.admin.overview} icon={<IShield size={15} />} title={WS.adminConsole} sub={me.user.platformRoles.map((r) => PLATFORM_ROLE_LABEL[r]).join(", ")} />
          )}
          <MenuItem icon={<IArrowUpRight size={15} />} title={leaving ? WS.leaving : WS.leave} onClick={logout} disabled={leaving} />
        </>
      )}
    </Menu>
  );
});


// ---------- Work queue home ----------
type QueueRowProps = { w: WorkItemView; mode: "approve" | "mine" | "recent"; onAsk: (t: string) => void; onDecide?: (w: WorkItemView, d: "approve" | "reject", note?: string) => void; busy?: boolean };

function QueueRow({ w, mode, onAsk, onDecide, busy }: QueueRowProps) {
  const still = useReducedMotion();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  return (
    <motion.li
      layout="position"
      className="sp-q-row"
      data-mode={mode}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={still ? { opacity: 0, transition: { duration: D.d1 } } : { opacity: 0, height: 0, paddingBlock: 0, transition: { duration: D.d2, ease: EASE } }}
      style={{ overflow: "hidden" }}
      transition={{ duration: D.d2, ease: EASE }}
    >
      <button type="button" className="sp-q-main" onClick={() => onAsk(WS.queue.summarizeAsk(w.ref, w.title))} title={WS.queue.askTitle}>
        <span className="sp-q-title" dir="auto">{w.title}</span>
        <span className="sp-q-meta">
          <span translate="no" className="sp-mono">{w.ref}</span>
          <span>{mode === "approve" ? `${w.requestedByName} · ${w.unitName}` : w.templateName}</span>
          <span translate="no" className="sp-mono">{w.system}</span>
          <span>{agoId(w.updatedAt)}</span>
        </span>
      </button>
      <span className="sp-q-amount ap-num">{w.amount != null ? moneyText(w.amount) : ""}</span>
      {mode === "approve" && onDecide ? (
        rejecting ? (
          <span className="sp-q-reject">
            <input
              className="sp-input"
              dir="auto"
              autoFocus
              placeholder={WS.queue.reasonPlaceholder}
              aria-label={WS.queue.reasonAria(w.ref)}
              value={note}
              maxLength={INPUT_MAX.reason}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setRejecting(false); if (e.key === "Enter" && note.trim()) onDecide(w, "reject", note.trim()); }}
            />
            <button type="button" className="sp-btn" data-tone="danger" disabled={!note.trim() || busy} onClick={() => onDecide(w, "reject", note.trim())}>{WS.queue.reject}</button>
            <button type="button" className="sp-btn" data-tone="quiet" onClick={() => setRejecting(false)}>{WS.queue.cancel}</button>
          </span>
        ) : (
          <span className="sp-q-actions">
            <button type="button" className="sp-btn" data-tone="primary" disabled={busy} onClick={() => onDecide(w, "approve")}>
              <ICheck size={15} /> {WS.queue.approve}
            </button>
            <button type="button" className="sp-btn" data-tone="quiet" disabled={busy} onClick={() => setRejecting(true)}>
              <IClose size={14} /> {WS.queue.reject}
            </button>
          </span>
        )
      ) : (
        <span className="sp-chip" data-tone={STATE_TONE[w.state]}>{STATE_LABEL[w.state]}</span>
      )}
    </motion.li>
  );
}

function QueueGroup({ title, items, mode, onAsk, onDecide, busyId }: { title: string; items: WorkItemView[]; mode: QueueRowProps["mode"]; onAsk: (t: string) => void; onDecide?: QueueRowProps["onDecide"]; busyId?: string | null }) {
  // The group stays mounted while its last row leaves, then fades out itself.
  return (
    <AnimatePresence initial={false}>
      {items.length > 0 && (
        <motion.section key="group" className="sp-q-group" data-mode={mode} exit={{ opacity: 0, transition: { duration: D.d2, ease: EASE } }}>
          <h3 className="sp-q-h">{title} <span className="sp-count ap-num">{items.length}</span></h3>
          <ul className="sp-q-list">
            <AnimatePresence initial={false}>
              {items.map((w) => <QueueRow key={w.id} w={w} mode={mode} onAsk={onAsk} onDecide={onDecide} busy={busyId === w.id} />)}
            </AnimatePresence>
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function Spark({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const min = Math.min(...series), max = Math.max(...series);
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${max === min ? 50 : 92 - ((v - min) / (max - min)) * 84}`).join(" ");
  return <svg className="sp-spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden><polyline points={pts} /></svg>;
}

function Figures({ metrics }: { metrics: Metric[] }) {
  if (!metrics.length) return null;
  return (
    <section className="sp-figs" aria-label={WS.figures}>
      {metrics.slice(0, CAP.wsMetrics).map((m, i) => (
        <motion.div key={`${m.label}-${i}`} className="sp-fig" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d3, ease: EASE, delay: stagger(i, STEP.card) }}>
          <span className="sp-fig-label">{m.label}</span>
          <strong className="sp-fig-value ap-num" data-tone={m.tone ?? "neutral"}>{m.value}</strong>
          {m.delta && <span className="sp-fig-delta ap-num">{m.delta}</span>}
          {m.series && <Spark series={m.series} />}
        </motion.div>
      ))}
    </section>
  );
}

export const WorkQueueHome = memo(function WorkQueueHome({ me, ws, error, onRetry, onAsk, onChanged }: {
  me: MeResponse | null; ws: WorkspaceResponse | null; error: string | null;
  onRetry: () => void; onAsk: (t: string) => void; onChanged: () => void;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => { setHidden(new Set()); }, [ws]);

  const awaiting = useMemo(() => (ws?.queue.awaitingMe ?? []).filter((w) => !hidden.has(w.id)), [ws, hidden]);
  const decide = async (w: WorkItemView, decision: "approve" | "reject", note?: string) => {
    setBusyId(w.id);
    setFail(null);
    setHidden((h) => new Set(h).add(w.id));
    try {
      await api(API.work(w.id), { method: "POST", json: { decision, note } });
      setAnnounce(WS.queue.decided(w.ref, decision === "approve"));
      onChanged();
    } catch (e) {
      setHidden((h) => { const n = new Set(h); n.delete(w.id); return n; });
      setFail(WS.queue.failedOf(w.ref, e instanceof Error ? e.message : WS.queue.saveFailed));
    } finally {
      setBusyId(null);
    }
  };

  const first = me?.user.name.split(" ")[0] ?? "";
  const starters = ui.capabilities;
  const total = awaiting.length + (ws?.queue.mine.length ?? 0);

  return (
    <motion.div className="sp-home" exit={{ opacity: 0, transition: { duration: D.d2, ease: EASE } }}>
      <motion.header className="sp-home-head" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d3, ease: EASE }}>
        <h2 dir="auto">{ws ? WS.queue.titleOf(first, ws.unit.name) : WS.queue.title}</h2>
        {ws && (
          <p className="sp-home-sub" role="status" aria-atomic="true">
            {awaiting.length > 0
              ? WS.queue.awaiting(awaiting.length)
              : total > 0 ? WS.queue.mineRunning(ws.queue.mine.length) : WS.queue.nothing}
            {announce && <span className="ap-sr">. {announce}</span>}
          </p>
        )}
      </motion.header>

      {error ? (
        <div className="sp-state" data-tone="bad" role="alert">
          <IAlert size={16} />
          <span>{WS.queue.loadFailed} {error}</span>
          <button type="button" className="sp-link" onClick={onRetry}><IRefresh size={13} /> {WS.retry}</button>
        </div>
      ) : !ws ? (
        <div className="sp-q-skel" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className="sp-skel" />)}</div>
      ) : (
        <>
          {fail && (
            <div className="sp-state" data-tone="bad" role="alert">
              <IAlert size={16} /><span>{fail}</span>
              <button type="button" className="sp-link" onClick={() => setFail(null)}>{WS.queue.close}</button>
            </div>
          )}
          {total === 0 && ws.queue.recent.length === 0 ? (
            <div className="sp-q-empty">
              <ICheck size={18} />
              <span>{WS.queue.clear}</span>
            </div>
          ) : (
            <div className="sp-queue">
              <QueueGroup title={WS.queue.awaitingMe} items={awaiting} mode="approve" onAsk={onAsk} onDecide={decide} busyId={busyId} />
              <QueueGroup title={WS.queue.mine} items={ws.queue.mine} mode="mine" onAsk={onAsk} />
              <QueueGroup title={WS.queue.recent} items={ws.queue.recent.slice(0, CAP.recentDone)} mode="recent" onAsk={onAsk} />
            </div>
          )}
          <Figures metrics={ws.metrics} />
        </>
      )}

      {starters.length > 0 && (
        <section className="sp-starters" aria-label={WS.startWith(ui.agent)}>
          <h3 className="sp-q-h">{WS.startWith(ui.agent)}</h3>
          <div className="sp-starter-grid">
            {starters.slice(0, CAP.starters).map((s, i) => (
              <motion.button
                key={`${s.title}-${i}`}
                type="button"
                className="sp-starter"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: D.d3, ease: EASE, delay: D.d1 + stagger(i, STEP.card) }}
                whileHover={{ y: -2, transition: { duration: D.d2, ease: EASE } }}
                whileTap={{ scale: 0.98, transition: { duration: D.d1, ease: EASE } }}
                onClick={() => onAsk(s.send)}
              >
                <strong dir="auto">{s.title}</strong>
                <span dir="auto">{s.send}</span>
              </motion.button>
            ))}
          </div>
        </section>
      )}
    </motion.div>
  );
});

// ---------- Data scope panel ----------
const NOTE_TONE = { scope: "info", mask: "warn" } as const;
export const ScopePanel = memo(function ScopePanel({ scope, error, onRetry }: { scope: ScopeSummary | null; error: string | null; onRetry: () => void }) {
  if (error) return <Notice tone="bad" onRetry={onRetry}>{WS.scope.failed}</Notice>;
  if (!scope) return <Skeleton rows={3} />;
  // A different team's scope crossfades in place of the last one rather than flashing back to a skeleton.
  const scopeKey = scope.systems.map((x) => x.connectionId).join(",") + `|${scope.clearance}|${scope.approvalOver}`;
  const pct = scope.budget.limit > 0 ? Math.min(100, (scope.budget.used / scope.budget.limit) * 100) : 0;
  const rules = [...scope.rules.filter((r) => r.locked), ...scope.rules.filter((r) => !r.locked)];
  const statusTone = (st: string) => (st === "ok" ? "good" : st === "error" ? "bad" : "neutral");
  return (
    <motion.div key={scopeKey} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: D.d2, ease: EASE } }}>
      <Stack gap="l">
        <Stack gap="s">
          <Title level={3}>{WS.scope.systems}</Title>
          {scope.systems.length === 0 && scope.outOfScope.length === 0 && <Empty>{WS.scope.noSystems}</Empty>}
          {scope.systems.map((sys) => (
            <Stack key={sys.connectionId} gap="s">
              <Row gap="s" wrap={false}>
                <Text strong mono>{sys.code}</Text>
                <Grow><Text truncate>{sys.name}</Text></Grow>
                <Badge>{KIND_SHORT[sys.kind]}</Badge>
                <Badge tone={statusTone(sys.status)}>{sys.status === "ok" ? WS.scope.status.ok : sys.status === "error" ? WS.scope.status.error : WS.scope.status.untested}</Badge>
              </Row>
              <List items={sys.objects} rowKey={(o) => o.name} size="s" render={(o) => {
                const notes = [
                  ...o.rowFilters.map((f) => ({ k: "scope" as const, v: f })),
                  ...o.masked.map((c) => ({ k: "mask" as const, v: `masking ${c}` })),
                  ...o.hashed.map((c) => ({ k: "mask" as const, v: `hash ${c}` })),
                  ...o.aggregated.map((c) => ({ k: "mask" as const, v: `agregat ${c}` })),
                ];
                return (
                  <Row gap="s" wrap={false}>
                    <Stack gap="none">
                      <Text truncate title={o.name}>{o.label || o.name}</Text>
                      <Label truncate>{o.columns} {WS.scope.columns}{o.denied ? WS.scope.closedCols(o.denied) : ""}</Label>
                    </Stack>
                    {notes.length > 0 && badges(notes.map((n) => n.v), { tone: NOTE_TONE[notes[0].k] })}
                  </Row>
                );
              }} />
            </Stack>
          ))}
          {scope.outOfScope.map((sys) => (
            <Row key={sys.code} gap="s" wrap={false}>
              <Text strong mono tone="muted">{sys.code}</Text>
              <Grow><Text truncate tone="muted">{sys.name}</Text></Grow>
              <Badge>{KIND_SHORT[sys.kind]}</Badge>
              <Badge tone="bad">{WS.scope.outOfScope}</Badge>
            </Row>
          ))}
        </Stack>

        <Stack gap="s">
          <Title level={3}>{WS.scope.limits}</Title>
          <List items={[[WS.scope.clearance, `${WS.scope.upTo} ${SENS_LABEL[scope.clearance]}`], [WS.scope.approvalOver, moneyText(scope.approvalOver)]] as [string, string][]} rowKey={([k]) => k} size="s"
            render={([k, v]) => <Row align="between" wrap={false}><Label>{k}</Label><Text>{v}</Text></Row>} />
          <Row gap="s" wrap={false}>
            <Label>{WS.scope.budget}</Label>
            <Grow><Meter value={scope.budget.used} max={scope.budget.limit} tone={pct >= 90 ? "bad" : pct >= 70 ? "warn" : "good"} label={WS.scope.budget} /></Grow>
            <Text size="s">{moneyCompact(scope.budget.used)} / {moneyCompact(scope.budget.limit)}</Text>
          </Row>
          {scope.models.length > 0 && (
            <List items={scope.models} rowKey={(m) => m.id} size="s"
              render={(m) => <Row align="between" wrap={false}><Text truncate>{m.label}</Text><Badge tone={m.external ? "warn" : "good"}>{m.external ? WS.scope.external : WS.scope.local}</Badge></Row>} />
          )}
        </Stack>

        {scope.actions.length > 0 && (
          <Stack gap="s">
            <Row gap="s" wrap={false}><Title level={3}>{WS.scope.actions}</Title><Badge>{scope.actions.length}</Badge></Row>
            <List items={scope.actions} rowKey={(x) => x.id} size="s"
              render={(x) => <Stack gap="none"><Text truncate>{x.name}</Text><Label truncate>{x.owner}</Label></Stack>} />
          </Stack>
        )}

        {rules.length > 0 && (
          <Stack gap="s">
            <Title level={3}>{WS.scope.rules}</Title>
            <List items={rules} rowKey={(r, i) => `${r.unit}-${i}`} size="m" tall
              render={(r) => (
                <Row gap="s" wrap={false}>
                  {r.locked && <IShield size={14} />}
                  <Stack gap="none"><Text truncate title={r.text}>{r.text}</Text><Label truncate>{r.locked ? WS.scope.lockedRule(r.unit) : r.unit}</Label></Stack>
                </Row>
              )} />
          </Stack>
        )}
        <Label>{num(scope.systems.reduce((n, sys) => n + sys.objects.length, 0))} {WS.scope.objectsOpen}</Label>
      </Stack>
    </motion.div>
  );
});
