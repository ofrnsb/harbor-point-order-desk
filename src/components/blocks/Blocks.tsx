"use client";
import { INPUT_MAX } from "@/config/ui";
import { API } from "@/config/routes";
import { BLOCKS } from "@/copy/ui-blocks";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { blocks as overrides } from "@/domain/blocks";
import type { Action, Block, FormField, Item, Step, Tone } from "@/lib/types";
import { money, when } from "../format";
import { ICheck, IClose } from "../icons";
import { D, EASE, FADE, REVEAL, REVEAL_STILL } from "../motion";
import { BoardBlock, CalendarBlock, ChartBlock, TableBlock } from "./Lego";
import { VIEWS } from "../lego/views";
import { Stamp } from "../sp/Stamp";
import { BataView } from "../bata/Bata";
import { Badge as UiBadge, Button, Callout, Empty, Field, Figure, Grid, Grow, Label, List, Row, Section, Segmented, Stack, Text, TextInput } from "@/components/ui";
import { Facts } from "@/components/ui/facts";
import { Fieldset } from "@/components/ui/fieldset";
import { SparkBars } from "@/components/ui/spark";
import { Timeline as Steps } from "@/components/ui/timeline";
import { AutoHeight } from "./AutoHeight";

export type Selection =
  | { type: "item"; item: Item }
  | { type: "timeline"; title: string; subject: Item; steps: Step[] };

export const selectionKey = (s: Selection | null) =>
  !s ? "" : s.type === "item" ? `i:${s.item.id}` : `t:${s.subject.id}`;

type Ctx = {
  onSelect: (s: Selection) => void;
  onAsk: (text: string) => void;
  onActionDone?: () => void;
  selected: string;
  latest: boolean;
};
export type BlockCtx = Ctx;

/** A product's own versions of answer blocks, set in src/domain/blocks.tsx. Anything left out uses the shell's version. */
export type BlockOverrides = {
  /** The proof after a confirmed action, as the sector's own artifact: a bank slip, a boarding pass, a return label. */
  receipt?: (action: Action) => React.ReactNode;
  /** Replaces a whole block type; return null to fall back to the shell's version for that block. */
  render?: { [K in Block["type"]]?: (b: Extract<Block, { type: K }>, ctx: Ctx) => React.ReactNode | null };
};

/** A status as a badge; the same badge every screen uses. */
export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <UiBadge tone={tone}>{children}</UiBadge>;
}

/** Approve or reject a work item in place. Rejecting asks for a reason; the server checks the user may decide. */
export function Decide({ d, onDone }: { d: NonNullable<Item["decide"]>; onDone: (decision: "approve" | "reject") => void }) {
  const [mode, setMode] = useState<"idle" | "rejecting" | "busy">("idle");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{ decision: "approve" | "reject"; state: string; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reveal = useReducedMotion() ? REVEAL_STILL : REVEAL;
  const decide = async (decision: "approve" | "reject") => {
    setMode("busy");
    setError(null);
    try {
      const r = await fetch(API.work(d.workId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, ...(decision === "reject" ? { note: note.trim() } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setDone({ decision, state: String(j.item?.state ?? (decision === "reject" ? "rejected" : "executed")), ...(j.item?.error ? { error: String(j.item.error) } : {}) });
      onDone(decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : BLOCKS.decide.failed);
      setMode(decision === "reject" ? "rejecting" : "idle");
    }
  };
  // The decision stays visible where it was made: what happened to the request, not just buttons that vanish.
  if (done) {
    const st = done.state === "executed" ? "done" : done.state === "rejected" ? "cancelled" : "failed";
    const label = done.state === "executed" ? BLOCKS.decide.approvedRan : done.state === "rejected" ? BLOCKS.decide.rejected : BLOCKS.decide.approvedFailed;
    // Internal work ids (wi_...) never reach the screen; a business reference or the error does.
    return <span role="status"><Stamp state={st} label={label} meta={done.error ?? (d.ref.startsWith("wi_") ? undefined : d.ref)} /></span>;
  }
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Stack gap="s">
        <Row gap="s">
          {mode === "rejecting" ? (
            <>
              <Grow>
                <input className="sp-input" dir="auto" autoFocus placeholder={BLOCKS.decide.reasonPlaceholder} aria-label={BLOCKS.decide.reasonAria(d.ref)} value={note} maxLength={INPUT_MAX.reason}
                  onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setMode("idle"); if (e.key === "Enter" && note.trim()) decide("reject"); }} />
              </Grow>
              <Button tone="danger" disabled={!note.trim()} onClick={() => decide("reject")}>{BLOCKS.decide.reject}</Button>
              <Button onClick={() => setMode("idle")}>{BLOCKS.decide.cancel}</Button>
            </>
          ) : (
            <>
              <Button tone="primary" icon={<ICheck size={14} />} disabled={mode === "busy"} onClick={() => decide("approve")}>{BLOCKS.decide.approve}</Button>
              <Button icon={<IClose size={14} />} disabled={mode === "busy"} onClick={() => setMode("rejecting")}>{BLOCKS.decide.reject}</Button>
            </>
          )}
        </Row>
        <AnimatePresence initial={false}>
          {error && <motion.span key="err" role="alert" {...reveal}><Text size="s" tone="bad">{error}</Text></motion.span>}
        </AnimatePresence>
      </Stack>
    </span>
  );
}

export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <Steps steps={steps.map((s, i) => ({
      key: `${i}-${s.label}`, state: s.state, title: s.label,
      meta: [s.owner, s.state === "pending" ? BLOCKS.upcoming : when(s.at), s.note].filter(Boolean).join(" · "),
    }))} />
  );
}

export function Bars({ series }: { series: number[] }) {
  return <SparkBars values={series} />;
}

const ACTION_STATUS = BLOCKS.action.status;
function Confirm({ initial, ctx }: { initial: Action; ctx: Ctx }) {
  const [a, setA] = useState(initial);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const decide = async (decision: "confirm" | "cancel") => {
    setBusy(decision);
    setErr(null);
    try {
      const r = await fetch(API.action(a.id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const j = await r.json();
      if (j.action) setA(j.action);
      if (!r.ok) setErr(j.error ?? `HTTP ${r.status}`);
      else ctx.onActionDone?.();
    } catch {
      setErr(BLOCKS.action.unreachable);
    } finally {
      setBusy(null);
    }
  };

  const pending = a.status === "pending";
  const isReceipt = a.status === "confirmed" && !!a.receipt?.length;
  const rows = isReceipt ? a.receipt! : a.summary;

  const note = pending
    ? BLOCKS.action.review
    : a.awaitingApproval
      ? BLOCKS.action.sentAt(when(a.decidedAt))
      : a.status === "confirmed"
        ? BLOCKS.action.doneAt(when(a.decidedAt))
        : a.status === "cancelled"
          ? BLOCKS.action.cancelledNote
          : BLOCKS.action.failedNote;
  const stamp = (
    <Stamp
      key={`${a.status}:${!!a.awaitingApproval}`}
      state={a.awaitingApproval ? "waiting" : a.status === "confirmed" ? "done" : a.status === "failed" ? "failed" : a.status === "cancelled" ? "cancelled" : "waiting"}
      label={a.awaitingApproval ? BLOCKS.action.awaitingApproval : a.status === "confirmed" ? BLOCKS.action.ran : ACTION_STATUS[a.status] ?? a.status}
      meta={a.status === "confirmed" ? a.receipt?.[0]?.value : undefined}
    />
  );
  const fade = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, scale: 0.98, transition: { duration: D.d1, ease: EASE } }, transition: { duration: D.d2, ease: EASE } };

  return (
    <Section title={a.title} note={note} actions={stamp} focus={pending}>
      <AutoHeight>
        <Stack gap="m">
          {isReceipt && overrides.receipt ? overrides.receipt(a) : rows.length > 0 && (
            <Stack gap="s">
              {isReceipt && <Label>{BLOCKS.action.receipt}</Label>}
              <Facts key={isReceipt ? "receipt" : "summary"} rows={rows} label={isReceipt ? BLOCKS.action.receipt : a.title} />
            </Stack>
          )}
          <AnimatePresence initial={false} mode="popLayout">
            {pending && a.consequence && <motion.div key="consequence" layout="position" {...fade}><Text size="s" tone="muted">{a.consequence}</Text></motion.div>}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {(a.error || err) && <motion.div key="err" layout="position" {...FADE}><Callout tone="bad">{a.error ?? err}</Callout></motion.div>}
          </AnimatePresence>
          <AnimatePresence initial={false} mode="popLayout">
            {pending && (
              <motion.div key="foot" layout="position" {...fade}>
                <Row gap="s">
                  <Button tone={a.danger ? "danger" : "primary"} data-commit={a.danger || undefined} disabled={!!busy} onClick={() => decide("confirm")} data-guard="clickable" data-guard-label={BLOCKS.action.confirmGuard}>
                    {busy === "confirm" ? <><span className="ap-spinner" aria-hidden />{BLOCKS.action.busy}</> : BLOCKS.action.confirm}
                  </Button>
                  <Button disabled={!!busy} onClick={() => ctx.onAsk(BLOCKS.action.changeAsk(a.title))}>{BLOCKS.action.change}</Button>
                  <Button tone="ghost" disabled={!!busy} onClick={() => decide("cancel")}>{BLOCKS.action.cancel}</Button>
                </Row>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {a.status === "failed" && <motion.div key="failed" layout="position" {...FADE}><Button onClick={() => ctx.onAsk(BLOCKS.action.failedAsk(a.error))}>{BLOCKS.action.nextStep}</Button></motion.div>}
          </AnimatePresence>
        </Stack>
      </AutoHeight>
    </Section>
  );
}

function Form({ b, ctx }: { b: Extract<Block, { type: "form" }>; ctx: Ctx }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(b.fields.map((f) => [f.name, f.value ?? ""])));
  const [sent, setSent] = useState(false);
  const missing = b.fields.filter((f) => f.required && !values[f.name]?.trim());
  const set = (f: FormField, v: string) => setValues((s) => ({ ...s, [f.name]: v }));
  const disabled = sent || !ctx.latest;
  const submit = () => {
    if (missing.length || disabled) return;
    setSent(true);
    ctx.onAsk(b.fields.map((f) => `${f.label}: ${values[f.name] || "(none)"}`).join("\n"));
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); submit(); } }}>
      <Section title={b.title}>
        {/* A sent form, or one from an earlier turn, is read-only: the fieldset disables every control in it. */}
        <Fieldset disabled={disabled}>
          <Stack gap="m">
            {b.fields.map((f) => (
              <Field key={f.name} label={f.required ? f.label : `${f.label} · ${BLOCKS.form.optional}`}>
                {f.kind === "choice"
                  ? <Segmented value={values[f.name]} options={f.options!.map((o) => ({ value: o, label: o }))} onChange={(v) => set(f, v)} label={f.label} />
                  : <TextInput type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"} value={values[f.name]} onChange={(v) => set(f, v)} />}
              </Field>
            ))}
          </Stack>
        </Fieldset>
        <Row gap="m">
          <Button tone="primary" disabled={disabled || missing.length > 0} onClick={submit}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={sent ? "sent" : "submit"} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0, transition: { duration: D.d2, ease: EASE } }} exit={{ opacity: 0, y: -3, transition: { duration: D.d1, ease: EASE } }}>
                {sent ? BLOCKS.form.sent : b.submitLabel}
              </motion.span>
            </AnimatePresence>
          </Button>
          <AnimatePresence initial={false}>
            {missing.length > 0 && !sent && <motion.span key="required" {...FADE}><Label>{BLOCKS.form.required(missing.length)}</Label></motion.span>}
          </AnimatePresence>
        </Row>
      </Section>
    </form>
  );
}

function Choices({ b, ctx }: { b: Extract<Block, { type: "choices" }>; ctx: Ctx }) {
  const [picked, setPicked] = useState<string | null>(null);
  const off = !!picked || !ctx.latest;
  return (
    <Section title={b.question} label={b.question}>
      <div role="group" aria-label={b.question}>
        <Row gap="s">
          {b.options.map((o, i) => (
            <Button key={`${i}-${o}`} tone={picked === o ? "primary" : "secondary"} aria-pressed={picked === o} disabled={off} onClick={() => { setPicked(o); ctx.onAsk(o); }}>{o}</Button>
          ))}
        </Row>
      </div>
    </Section>
  );
}

export function BlockView({ b, ctx }: { b: Block; ctx: Ctx }) {
  const custom = overrides.render?.[b.type] as ((b: Block, ctx: Ctx) => React.ReactNode | null) | undefined;
  const own = custom?.(b, ctx);
  if (own !== undefined && own !== null) return own;
  switch (b.type) {
    case "list": case "compare": return <StoredItems title={b.title} items={b.items} note={"note" in b ? b.note : undefined} />;
    case "timeline": return <StoredSteps title={b.title} steps={b.steps} />;
    case "metrics":
      return (
        <Section title={b.title} note={b.note}>
          {b.metrics.length ? <Grid cols={Math.min(4, b.metrics.length)}>{b.metrics.map((m, i) => <Figure key={`${i}-${m.label}`} label={m.label} value={m.value} sub={m.delta} tone={m.tone} />)}</Grid> : <Empty>{BLOCKS.noDataTitle}</Empty>}
        </Section>
      );
    case "confirm":
      return <Confirm initial={b.action} ctx={ctx} />;
    case "form":
      return <Form b={b} ctx={ctx} />;
    case "choices":
      return <Choices b={b} ctx={ctx} />;
    case "table":
      return <TableBlock b={b} ctx={ctx} />;
    case "board":
      return <BoardBlock b={b} ctx={ctx} />;
    case "calendar":
      return <CalendarBlock b={b} ctx={ctx} />;
    case "chart":
      return <ChartBlock b={b} />;
    case "lego": {
      const View = VIEWS[b.component];
      if (!View) return <p className="sp-lego-empty">{BLOCKS.missingView(b.label)}</p>;
      return <View data={b.data} title={b.title} ctx={ctx} pageSize={b.pageSize} />;
    }
    case "layout":
      return <Stack gap="l">{b.children.map((c, i) => <BlockView key={`${c.type}-${i}`} b={c} ctx={ctx} />)}</Stack>;
    case "bata":
      return <BataView b={b} ctx={ctx} />;
  }
}

// Answers stored before every answer was composed from bricks keep showing, through the same primitives.
function StoredItems({ title, items, note }: { title: string; items: Item[]; note?: string }) {
  return (
    <Section title={title} note={note}>
      <List items={items} rowKey={(it) => it.id} size="m" empty={BLOCKS.noDataTitle} render={(it) => (
        <Row gap="s" wrap={false}>
          <Grow><Stack gap="none"><Text strong truncate>{it.title}</Text>{it.subtitle && <Label truncate>{it.subtitle}</Label>}</Stack></Grow>
          {it.price && <Text>{money(it.price)}</Text>}
          {it.status && <UiBadge tone={it.status.tone}>{it.status.label}</UiBadge>}
        </Row>
      )} />
    </Section>
  );
}

function StoredSteps({ title, steps }: { title: string; steps: Step[] }) {
  return (
    <Section title={title}>
      <List items={steps} rowKey={(st, i) => `${i}-${st.label}`} size="m" render={(st) => (
        <Row gap="s" wrap={false}>
          <Grow><Stack gap="none"><Text truncate>{st.label}</Text>{st.owner && <Label truncate>{st.owner}</Label>}</Stack></Grow>
          {st.at && <Label>{when(st.at)}</Label>}
        </Row>
      )} />
    </Section>
  );
}
