"use client";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ui } from "@/domain/ui";
import { applyWorkspace, LOCALE, SECOND_MS, TIME_ZONE } from "@/config/locale";
import { isLimit, resetAt } from "@/lib/limits";
import { DELAY_MS, FLASH_SPANS, FOLLOW, MEDIA, STORE, THOUGHT_MAX_PX } from "@/config/ui";
import { API } from "@/config/routes";
import { CHAT } from "@/copy/ui-chat";
import type { Block, ChatSummary, Item, Message, Source, StreamEvent, TraceStep } from "@/lib/types";
import { ActivityBubbles, type Step } from "./ActivityBubbles";
import { BlockView, selectionKey, type Selection } from "./blocks/Blocks";
import { Composer, MODEL_INFO, type ModelId } from "./Composer";
import { ContextPanel, type PanelData } from "./ContextPanel";
import { HistoryRail } from "./HistoryRail";
import { parseProse } from "./prose";
import { nextTyped, REVEAL_PAUSE_MS, visibleText } from "./typing";
import { uiLayout, type LayoutMode } from "./ui-options";
import {
  IActivity,
  IAlert,
  IArrowDown,
  IArrowUpRight,
  IChevron,
  IGlobe,
  IChat,
  ICheck,
  ICopy,
  IMenu,
  IPanel,
  IPencil,
  IPlus,
  IRefresh,
  Mark,
} from "./icons";
import { D, DISCLOSE, EASE, EASE_SOFT, FADE, MOTION_VARS, STEP, stagger } from "./motion";
import type { MeResponse, WorkspaceResponse } from "@/platform/api-types";
import type { Pin, Project, AccessTrail as Trail } from "@/platform/contract";
import { Canvas, CanvasChip, onCanvas, titleOf, viewLabel, type CanvasEntry } from "./sp/Canvas";
import { api, redirectIfSetupNeeded, store } from "./sp/client";
import { UnitSwitcher, UserMenu } from "./sp/Workspace";
import { InboxHome } from "./inbox/InboxHome";
import { InboxPanel } from "./inbox/InboxPanel";
import { openEmail } from "./inbox/store";
import { Badge, Button, Callout, Grow, Label, Row, Stack, Text, Title } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { State } from "@/components/ui/state";
import { ProjectList, ProjectSheet, type ProjectsData } from "./sp/Projects";


type Live = {
  chatId: string | null;
  text: string;
  /** What the agent is reasoning about right now; shown until the answer starts. */
  thought: string;
  steps: Step[];
  blocks: Block[];
  error: string | null;
  streaming: boolean;
  trail: Trail;
};

const EMPTY_TRAIL: Trail = { touches: [], model: null };

const local = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  },
};

/** Reveals text at a readable, steady pace however fast it arrives. Returns the visible text and whether it is still typing. */
function useTyped(text: string, on: boolean): [string, boolean] {
  const reduce = useReducedMotion();
  const animate = on && !reduce;
  const target = text.length;
  // The fractional count lives in a ref; the turn re-renders only when a whole new character shows.
  const exact = useRef(animate ? 0 : target);
  const [n, setN] = useState(() => (animate ? 0 : target));
  const typing = animate && n < target;

  useEffect(() => {
    if (n > target) { exact.current = target; setN(target); }
  }, [n, target]);

  useEffect(() => {
    if (!typing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      exact.current = nextTyped(exact.current, target, dt);
      const whole = Math.floor(exact.current);
      setN((prev) => (prev === whole ? prev : whole));
      if (exact.current < target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [typing, target]);

  return animate ? [visibleText(text, Math.min(n, target)), typing] : [text, false];
}

/** A complete [label](https://...) link or a bare https address; anything else stays text. */
const LINK = /(\[[^\]\n]{1,200}\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)\]>"']+)/g;
const linked = (s: string, k: string) =>
  s.split(LINK).map((part, i) => {
    const md = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    const href = md ? md[2] : /^https?:\/\//.test(part) ? part.replace(/[.,;:]+$/, "") : null;
    if (!href) return <Fragment key={`${k}-${i}`}>{part}</Fragment>;
    const label = md ? md[1] : href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    return <a key={`${k}-${i}`} className="ap-link" href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
  });

/** Paragraphs, "- " lists, **bold** and links; everything else is plain text (React escapes it). */
function Prose({ text, caret }: { text: string; caret?: "typing" | "waiting" | false }) {
  const inline = (s: string) =>
    s
      .split(/(\*\*[^*]+\*\*)/g)
      .map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{linked(p.slice(2, -2), `b${i}`)}</strong> : <Fragment key={i}>{linked(p, `t${i}`)}</Fragment>,
      );
  // The caret sits at the end of the last line, where the next character will appear.
  // Solid while characters land, blinking only while it waits for more.
  const tail = caret ? <span className="ap-caret-mark" data-typing={caret === "typing" || undefined} aria-hidden /> : null;
  const blocks = parseProse(text);
  if (!blocks.length) return tail ? <p>{tail}</p> : null;
  return (
    <>
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        if (b.kind === "p") {
          return (
            <p key={i}>
              {inline(b.text)}
              {last && tail}
            </p>
          );
        }
        const List = b.kind;
        return (
          <List key={i}>
            {b.items.map((item, j) => (
              <li key={j}>
                {inline(item)}
                {last && j === b.items.length - 1 && tail}
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}

/** Follow-ups come from the blocks' own next actions, so they always fit the answer. */
function followUps(blocks: Block[]): { label: string; message: string }[] {
  if (blocks.some((b) => b.type === "confirm" || b.type === "form" || b.type === "choices")) return [];
  const out: { label: string; message: string }[] = [];
  for (const b of blocks) {
    if (b.type === "list" || b.type === "compare") {
      // Every list card and row already carries its own action; only comparisons lift item actions into follow-ups.
      if (b.type === "list") continue;
      const rank = (it: Item) => (it.status?.tone === "bad" ? 0 : it.status?.tone === "warn" ? 1 : 2);
      for (const it of [...b.items].sort((x, y) => rank(x) - rank(y)).slice(0, 2)) {
        if (it.action) out.push({ label: `${it.action.label}: ${it.title}`, message: it.action.message });
      }
    }
    if (b.type === "timeline" && b.subject.action) {
      out.push({ label: b.subject.action.label, message: b.subject.action.message });
    }
  }
  return [...new Map(out.map((o) => [o.message, o])).values()].slice(0, 3);
}

function Trace({ steps, onClose }: { steps: TraceStep[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", close));
    document.addEventListener("keydown", esc, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);

  const totalSec = (steps.reduce((acc, s) => acc + s.ms, 0) / SECOND_MS).toFixed(1);

  return (
    <motion.div
      ref={ref}
      className="ap-trace"
      role="dialog"
      aria-label={CHAT.trace.aria}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4, transition: { duration: D.d1, ease: EASE } }}
      transition={{ duration: D.d2, ease: EASE }}
    >
      <Stack gap="s">
        <Row align="between" wrap={false}>
          <Title level={3}>{CHAT.trace.title}</Title>
          {steps.length > 0 && <Label>{CHAT.trace.steps(steps.length)} · {totalSec}s</Label>}
        </Row>
        {steps.length === 0 ? (
          <Text size="s" tone="muted">{CHAT.trace.none}</Text>
        ) : (
          steps.map((s) => (
            <Stack key={s.id} gap="none">
              <Row gap="s" wrap={false}>
                <Text tone={s.status === "done" ? "good" : "bad"}>{s.status === "done" ? <ICheck size={15} /> : <IAlert size={15} />}</Text>
                <Grow><Text strong truncate>{s.label}</Text></Grow>
                <Label>{(s.ms / SECOND_MS).toFixed(1)}s</Label>
              </Row>
              {s.detail && <Text size="s" tone="muted">{s.detail}</Text>}
            </Stack>
          ))
        )}
      </Stack>
    </motion.div>
  );
}

type TurnProps = {
  text: string;
  /** When the entry was written; a live turn without one shows the time it started. */
  at?: string;
  /** Type the text out; true for the live turn and the turn that just finished streaming. */
  typed: boolean;
  blocks: Block[];
  trace: TraceStep[];
  /** Official pages the answer rests on, as links under it. */
  sources?: Source[];
  error: string | null;
  streaming: boolean;
  steps: Step[];
  /** The live turn's reasoning so far. */
  thought?: string;
  isLast: boolean;
  selected: string;
  onSelect: (s: Selection) => void;
  onAsk: (t: string) => void;
  onActionDone: () => void;
  onRetryLast: () => void;
  agentName: string;
  /** Saved message id; blocks of a saved turn can live on the canvas. */
  msgId?: string;
  /** The canvas is docked and open: canvas blocks show as chips here. */
  canvas: boolean;
  focusedKey: string | null;
  onFocusBlock: (key: string) => void;
  /** Called once the turn's text has finished typing and its components may appear. */
  onRevealed?: (msgId: string) => void;
};

const NO_STEPS: Step[] = [];
/** The agent's reasoning, typed out at the same pace as an answer. It only grows, one paragraph per thought; past
 *  a few lines the older ones glide up and out, and the whole block closes in one motion when the answer begins. */
function Thought({ text }: { text: string }) {
  const [shown, typing] = useTyped(text.replace(/\n{3,}/g, "\n\n").trim(), true);
  const inner = useRef<HTMLParagraphElement>(null);
  const [over, setOver] = useState(0);
  useLayoutEffect(() => {
    const h = inner.current?.offsetHeight ?? 0;
    setOver(Math.max(0, h - THOUGHT_MAX_PX));
  }, [shown]);
  return (
    <motion.div
      className="sp-thought"
      data-over={over > 0 || undefined}
      style={{ maxHeight: THOUGHT_MAX_PX }}
      aria-hidden
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: D.d3, ease: EASE }}
    >
      <p ref={inner} style={{ transform: `translateY(${-over}px)` }}>
        {shown}
        <span className="ap-caret-mark" data-typing={typing || undefined} />
      </p>
    </motion.div>
  );
}
/** Ledger time: "09.41" in the user's locale, the column every entry is read by. */
const hhmm = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }) : "";
};

/**
 * The official pages an answer rests on: one line under the answer; clicked, a floating list over the content below,
 * so nothing in the conversation moves. It opens upward when the composer would cover it, and scrolls past three rows.
 */
function Sources({ sources, delay }: { sources: Source[]; delay: number }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const id = useId();
  const box = useRef<HTMLElement>(null);
  const head = useRef<HTMLButtonElement>(null);
  const hosts = [...new Set(sources.map((s) => s.host))].join(", ");
  const rows = Math.min(sources.length, 3);

  const toggle = () => {
    if (!open && head.current) {
      // Room below the header down to the composer (or the window): too little, and the list opens upward.
      const r = head.current.getBoundingClientRect();
      const floor = document.querySelector(".ap-composer")?.getBoundingClientRect().top ?? window.innerHeight;
      setUp(floor - r.bottom < rows * 44 + 24 && r.top > floor - r.bottom);
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); head.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);

  return (
    <motion.section ref={box} className="ap-sources" data-open={open} aria-label={CHAT.sourcesAria} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d2, ease: EASE, delay }}>
      <button ref={head} type="button" className="ap-sources-head" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <IGlobe size={14} />
        <span className="ap-sources-name">{CHAT.sources}</span>
        <span className="ap-sources-count ap-num">{sources.length}</span>
        <span className="ap-sources-hosts">{hosts}</span>
        <IChevron size={14} className="ap-sources-chev" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div key="panel" id={id} className="ap-sources-panel" data-up={up || undefined}
            initial={{ opacity: 0, y: up ? 6 : -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: DISCLOSE.pop, ease: EASE_SOFT } }}
            exit={{ opacity: 0, y: up ? 4 : -4, scale: 0.99, transition: { duration: DISCLOSE.popOut, ease: EASE_SOFT } }}>
            <motion.ol className="ap-sources-list" data-scroll={sources.length > 3 || undefined} tabIndex={sources.length > 3 ? 0 : undefined} aria-label={CHAT.sourcesAria}
              initial="hidden" animate="shown" variants={{ shown: { transition: { delayChildren: DISCLOSE.rowsAfter, staggerChildren: DISCLOSE.row } } }}>
              {sources.map((s, i) => (
                <motion.li key={s.url} variants={{ hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: DISCLOSE.rowFade, ease: EASE_SOFT } } }}>
                  <a className="ap-source" href={s.url} target="_blank" rel="noopener noreferrer" title={s.url} aria-label={CHAT.openSource(s.title, s.host)}>
                    <span className="ap-source-n ap-num" aria-hidden>{i + 1}</span>
                    <span className="ap-source-title" dir="auto">{s.title}</span>
                    <span className="ap-source-host">{s.host}</span>
                    <IArrowUpRight size={14} className="ap-source-go" />
                  </a>
                </motion.li>
              ))}
            </motion.ol>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

const AgentTurn = memo(function AgentTurn(p: TurnProps) {
  const reduce = useReducedMotion();
  const [traceOpen, setTraceOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shown, typing] = useTyped(p.text, p.typed);
  const [startedAt] = useState(() => new Date().toISOString());
  const at = p.at ?? startedAt;
  const busy = p.streaming || typing;
  // Before the answer starts, the agent's own reasoning fills the wait.
  const thinking = p.streaming && !p.text && !!p.thought?.trim();
  // A short beat after the last character, then the components; a saved turn opened later shows them at once.
  const [revealed, setRevealed] = useState(!busy);
  const [settled, setSettled] = useState(!busy);
  useEffect(() => {
    if (busy) {
      setRevealed(false);
      return;
    }
    const t = setTimeout(() => setRevealed(true), REVEAL_PAUSE_MS);
    return () => clearTimeout(t);
  }, [busy]);
  const { onRevealed, msgId, typed } = p;
  useEffect(() => {
    if (revealed && typed && msgId) onRevealed?.(msgId);
  }, [revealed, typed, msgId, onRevealed]);
  const afterBlocks = p.blocks.length ? stagger(p.blocks.length, STEP.card) + D.d2 : 0;
  const ctx = useMemo(
    () => ({
      onSelect: p.onSelect,
      onAsk: p.onAsk,
      onActionDone: p.onActionDone,
      selected: p.selected,
      latest: p.isLast,
    }),
    [p.onSelect, p.onAsk, p.onActionDone, p.selected, p.isLast],
  );
  const suggestions = useMemo(() => (p.isLast && revealed ? followUps(p.blocks) : []), [p.isLast, revealed, p.blocks]);

  return (
    <motion.div
      className="ap-agent"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: D.d2, ease: EASE }}
    >
      <div className="ap-agent-label">
        <span className="ap-agent-mark"><Mark size={15} busy={busy} /></span>
        <span className="ap-agent-name">{p.agentName}</span>
        <time className="ap-agent-time ap-num" dateTime={at}>{hhmm(at)}</time>
        <ActivityBubbles steps={p.streaming ? p.steps : NO_STEPS} />
      </div>
      {(p.text || p.streaming) && (
        <div className="ap-answer" dir="auto">
          <AnimatePresence initial={false}>{thinking && <Thought key="thought" text={p.thought!} />}</AnimatePresence>
          {!thinking && <Prose text={shown} caret={typing ? "typing" : busy ? "waiting" : false} />}
        </div>
      )}
      <AnimatePresence initial={false}>
        {revealed && p.blocks.length > 0 && (
          <motion.div
            key="blocks"
            className="ap-reveal"
            style={{ overflow: settled ? "visible" : "hidden" }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            transition={{ height: { duration: D.d4, ease: EASE }, opacity: { duration: D.d2, ease: EASE } }}
            onAnimationComplete={() => setSettled(true)}
          >
            {p.blocks.map((b, i) => {
              const key = p.msgId ? canvasKey(p.msgId, i) : null;
              return (
                <motion.div
                  key={`${b.type}${i}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: D.d3, ease: EASE, delay: stagger(i, STEP.card) }}
                >
                  {p.canvas && key && onCanvas(b) ? (
                    <CanvasChip b={b} focused={p.focusedKey === key} onFocus={() => p.onFocusBlock(key)} />
                  ) : (
                    <BlockView b={b} ctx={ctx} />
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
      {p.error && (
        <div role="alert">
          <Callout tone="bad">
            <Row gap="s" wrap={false}>
              <Grow><Text size="s">{shownError(p.error, at)}</Text></Grow>
              {p.isLast && revealed && <Button onClick={p.onRetryLast}>{CHAT.retry}</Button>}
            </Row>
          </Callout>
        </div>
      )}
      {revealed && p.sources?.length ? <Sources sources={p.sources} delay={afterBlocks} /> : null}
      {revealed && (
        <motion.div className="ap-actions-wrap" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: D.d2, ease: EASE, delay: afterBlocks, layout: { duration: D.d3, ease: EASE } }}>
          <div className="ap-actions" data-pinned={traceOpen}>
            <Row gap="none">
              {p.text && (
                <Button tone="ghost" icon={copied ? <ICheck size={14} /> : <ICopy size={14} />} onClick={() => {
                  navigator.clipboard?.writeText(p.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), DELAY_MS.copiedFlash); }).catch(() => {});
                }}>{copied ? CHAT.copied : CHAT.copy}</Button>
              )}
              <AnimatePresence initial={false}>
                {p.isLast && !p.error && <motion.span key="again" {...FADE}><Button tone="ghost" icon={<IRefresh size={13} />} onClick={p.onRetryLast}>{CHAT.again}</Button></motion.span>}
              </AnimatePresence>
              <Button tone="ghost" icon={<IActivity size={14} />} aria-expanded={traceOpen} onClick={() => setTraceOpen((o) => !o)}>
                {CHAT.activity}{p.trace.length > 0 && <Badge>{p.trace.length}</Badge>}
              </Button>
            </Row>
          </div>
        </motion.div>
      )}
      <AnimatePresence>{traceOpen && <Trace steps={p.trace} onClose={() => setTraceOpen(false)} />}</AnimatePresence>
      <AnimatePresence initial={false}>
      {suggestions.length > 0 && (
        <motion.div
          key="follow"
          className="ap-follow"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0, transition: { duration: D.d1 } } : { opacity: 0, height: 0, marginTop: 0, transition: { duration: D.d2, ease: EASE } }}
          transition={{ duration: D.d3, ease: EASE, delay: afterBlocks + STEP.card }}
        >
          <Row gap="s">
            {suggestions.map((f) => (
              <Button key={f.message} title={f.message} icon={<IArrowUpRight size={13} />} onClick={() => p.onAsk(f.message)}>{f.label}</Button>
            ))}
          </Row>
        </motion.div>
      )}
      </AnimatePresence>
    </motion.div>
  );
});

function ChatLoading() {
  return (
    <div className="ap-chat-skels">
      <Stack gap="l">
        <Skeleton rows={1} height={44} width="40%" />
        <Skeleton rows={2} height={14} label={CHAT.loadingAria} />
        <Skeleton rows={1} height={160} />
      </Stack>
    </div>
  );
}

const VALID_LAYOUTS = new Set<LayoutMode>(["horizon", "workbench", "editorial"]);

/** A count badge that fades and scales in and out instead of popping, and keeps its last number while it leaves. */
/** A usage-limit error, also one saved in an older chat, reads in the product's words with the time it lifts. */
function shownError(error: string, at: string): string {
  if (!isLimit(error)) return error;
  const until = resetAt(error, Date.parse(at) || Date.now());
  return until > Date.now() ? CHAT.atCapacity(new Date(until).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE })) : CHAT.capacityBack;
}

const canvasKey = (msgId: string, i: number) => `${msgId}:${i}`;

/** The right-hand column (canvas or context panel). Its width glides open and closed so the conversation beside it
 *  resizes smoothly instead of snapping; the content keeps its own width and slides in from the edge. */
function Dock({ children }: { children: React.ReactNode }) {
  // Width is not covered by MotionConfig's reduced motion, so it is switched off here.
  const reduce = useReducedMotion();
  return (
    <motion.div className="sp-dock" initial={{ width: 0, opacity: reduce ? 0 : 1 }} animate={{ width: "auto", opacity: 1 }} exit={{ width: 0, opacity: reduce ? 0 : 1 }}
      transition={{ duration: reduce ? 0 : D.d4, ease: EASE, opacity: { duration: D.d1 } }}>
      {children}
    </motion.div>
  );
}

export function App() {
  const configuredLayout = uiLayout;
  const configuredHome = Boolean((ui.panelTitle as string).trim());
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(configuredLayout);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>(CHAT.newTitle);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<ModelId>("sonnet");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panelData, setPanelData] = useState<PanelData | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(configuredHome && configuredLayout === "workbench");
  const [railOpen, setRailOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  // The new chat's highlight plays once; cleared so a remounted row (popover, search, regroup) does not replay it.
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), D.d4 * FLASH_SPANS * SECOND_MS);
    return () => clearTimeout(t);
  }, [flashId]);
  const [typedId, setTypedId] = useState<string | null>(null);
  const [liveKey, setLiveKey] = useState("live-0");
  const [turnKeys, setTurnKeys] = useState<Record<string, string>>({});
  const liveSeq = useRef(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [ws, setWs] = useState<WorkspaceResponse | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);
  const [railHidden, setRailHidden] = useState(false);
  // Saved layout is restored without animating; only the person's own toggles glide.
  const [settled, setSettled] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(true);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectsData | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectSheet, setProjectSheet] = useState<{ editing: Project | null } | null>(null);
  const projectRef = useRef<string | null>(null);
  projectRef.current = projectId;
  const unitRef = useRef<string | null>(null);
  unitRef.current = unitId;

  const activeRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const draftRef = useRef("");
  const modelRef = useRef<ModelId>("sonnet");
  const messagesRef = useRef<Message[]>([]);
  const narrowRef = useRef(false);
  const layoutRef = useRef<LayoutMode>(configuredLayout);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const atBottomRef = useRef(true);
  const conversingRef = useRef(false);

  activeRef.current = activeId;
  streamingRef.current = !!live?.streaming;
  draftRef.current = draft;
  modelRef.current = model;
  messagesRef.current = messages;
  narrowRef.current = narrow;
  layoutRef.current = layoutMode;

  const loadProjects = useCallback(async () => {
    const u = unitRef.current;
    if (!u) return;
    setProjectsError(null);
    try {
      const d = await api<ProjectsData>(API.projectsOf(u));
      if (unitRef.current !== u) return;
      setProjects(d);
      const saved = store.get(`sp:project:${u}`);
      setProjectId((cur) => {
        const want = cur ?? saved;
        return want && d.projects.some((p) => p.id === want) ? want : null;
      });
    } catch (e) {
      if (unitRef.current === u) setProjectsError(e instanceof Error ? e.message : CHAT.error.load);
    }
  }, []);

  const [pins, setPins] = useState<Pin[] | null>(null);
  useEffect(() => {
    if (!unitId) return;
    let live = true;
    const q = `unitId=${encodeURIComponent(unitId)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`;
    api<{ pins: Pin[] }>(API.pins(q)).then((d) => { if (live) setPins(d.pins); }).catch(() => { if (live) setPins([]); });
    return () => { live = false; };
  }, [unitId, projectId]);
  /** Returns the reason it failed, for the canvas to say next to the button. */
  const pinView = useCallback(async (e: CanvasEntry): Promise<string | null> => {
    const u = unitRef.current;
    if (!u || !e.ask) return CHAT.pinSourceMissing;
    try {
      const saved = await api<Pin>(API.pinsOf(u), { method: "POST", json: { projectId: projectRef.current, title: titleOf(e.block).replace(/\s*\((per|s\.d\.|hingga|sampai)\b[^)]*\)\s*$/i, ""), ask: e.ask, view: viewLabel(e.block) } });
      setPins((cur) => [saved, ...(cur ?? []).filter((x) => x.id !== saved.id)]);
      return null;
    } catch (err) { return err instanceof Error ? err.message : CHAT.error.pin; }
  }, []);

  const loadChats = useCallback(async () => {
    setChatsError(null);
    try {
      const r = await fetch(API.chats);
      if (!r.ok) throw new Error(CHAT.error.http(r.status));
      setChats(await r.json());
    } catch (e) {
      setChatsError(e instanceof Error ? e.message : CHAT.error.history);
    }
  }, []);

  const loadPanelData = useCallback(async (u: string) => {
    setPanelError(null);
    try {
      const p = await api<PanelData>(API.panelOf(u));
      if (unitRef.current === u) setPanelData(p);
    } catch (e) {
      if (unitRef.current === u) setPanelError(e instanceof Error ? e.message : CHAT.error.load);
    }
  }, []);

  const loadPanel = useCallback(async () => {
    const u = unitRef.current;
    if (!u) return;
    void loadPanelData(u);
    setPanelBusy(true);
    setWsError(null);
    try {
      const w = await api<WorkspaceResponse>(API.workspace(u));
      if (unitRef.current !== u) return;
      setWs(w);
    } catch (e) {
      if (unitRef.current === u) setWsError(e instanceof Error ? e.message : CHAT.error.load);
    } finally {
      setPanelBusy(false);
    }
  }, [loadPanelData]);

  const loadMe = useCallback(async () => {
    setMeError(null);
    if (await redirectIfSetupNeeded()) return;
    try {
      const m = await api<MeResponse>(API.me);
      applyWorkspace(m.tenant);
      setMe(m);
      const saved = store.get(`sp:unit:${m.user.id}`);
      setUnitId(m.memberships.find((x) => x.id === saved)?.id ?? m.memberships[0]?.id ?? null);
    } catch (e) {
      setMeError(e instanceof Error ? e.message : CHAT.error.session);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (!unitId) return;
    // The previous team's workspace and projects stay up until the new ones arrive, so nothing drops to a skeleton.
    loadPanel();
    if (ui.projects) loadProjects();
  }, [unitId, loadPanel, loadProjects]);

  // Before the first client paint, so the saved and measured layout (mobile, narrow, rail, canvas) is the first one seen.
  useLayoutEffect(() => {
    let activeLayout: LayoutMode = configuredLayout;
    const qp = new URLSearchParams(window.location.search).get("layout") as LayoutMode | null;
    if (qp && VALID_LAYOUTS.has(qp)) {
      activeLayout = qp;
      setLayoutMode(qp);
      layoutRef.current = qp;
    }

    loadChats();
    if (configuredHome) loadPanel();
    const m = local.get(STORE.model);
    if (m && m in MODEL_INFO) setModel(m as ModelId);
    if (local.get(STORE.rail) === "hidden") setRailHidden(true);
    if (local.get(STORE.canvas) === "closed") setCanvasOpen(false);
    prefsLoaded.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));

    const mqNarrow = window.matchMedia(MEDIA.narrow);
    const mqMobile = window.matchMedia(MEDIA.mobile);
    const apply = () => {
      setNarrow(mqNarrow.matches);
      setMobile(mqMobile.matches);
      if (mqNarrow.matches || !configuredHome) {
        setPanelOpen(false);
      } else if (activeLayout === "workbench") {
        setPanelOpen(local.get(STORE.panel) !== "closed");
      } else {
        setPanelOpen(local.get(STORE.panel) === "open");
      }
    };
    apply();
    mqNarrow.addEventListener("change", apply);
    mqMobile.addEventListener("change", apply);
    setDraft(local.get(STORE.draft(null)) ?? "");

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (layoutRef.current === "editorial" && !mqMobile.matches) {
          searchRef.current?.focus();
        } else {
          setRailOpen(true);
          requestAnimationFrame(() => searchRef.current?.focus());
        }
      } else if (e.key === "Escape") {
        if (streamingRef.current) {
          abortRef.current?.abort();
        } else {
          setRailOpen(false);
          if (narrowRef.current) setPanelOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      mqNarrow.removeEventListener("change", apply);
      mqMobile.removeEventListener("change", apply);
    };
  }, [configuredHome, configuredLayout, loadChats, loadPanel]);

  useEffect(() => {
    local.set(STORE.draft(activeId), draft);
  }, [draft, activeId]);

  useEffect(() => {
    const el = scrollRef.current;
    const log = logRef.current;
    if (!el || !log) return;
    const still = window.matchMedia(MEDIA.reducedMotion);
    // One eased follow toward the bottom while the user is there, so growing content glides instead of jumping.
    // Any wheel, touch or key input hands the scroll back to the user at once.
    let raf = 0;
    let following = false;
    let last = 0;
    const gapOf = () => el.scrollHeight - el.clientHeight - el.scrollTop;
    // "Near the bottom" drives the jump button; following needs the person to be truly at the bottom, so a small
    // scroll up is respected and growing content never pulls them back down.
    const measure = () => {
      const gap = gapOf();
      atBottomRef.current = gap <= FOLLOW.snapPx;
      setAtBottom(gap < FOLLOW.nearPx);
      setScrolled(el.scrollTop > FOLLOW.scrolledPx);
    };
    const step = (now: number) => {
      const gap = gapOf();
      if (gap <= 1) {
        following = false;
        measure();
        return;
      }
      // Frame-rate independent ease: the same glide at 30, 60 or 120 frames a second.
      const dt = Math.min(now - last, FOLLOW.maxFrameMs);
      last = now;
      el.scrollTop += Math.max(1, gap * (1 - Math.exp(-dt / FOLLOW.tauMs)));
      setScrolled(el.scrollTop > FOLLOW.scrolledPx);
      raf = requestAnimationFrame(step);
    };
    const stop = () => {
      if (!following) return;
      cancelAnimationFrame(raf);
      following = false;
    };
    // Any wheel, touch, key or scrollbar drag hands the scroll back to the person at once.
    const take = () => {
      stop();
      atBottomRef.current = gapOf() <= FOLLOW.snapPx;
    };
    const onScroll = () => {
      if (!following) measure();
    };
    const ro = new ResizeObserver(() => {
      // The start screen reads from the top: only a conversation follows its newest line.
      if (!atBottomRef.current || !conversingRef.current) return;
      if (still.matches) {
        el.scrollTop = el.scrollHeight;
        return;
      }
      if (!following) {
        following = true;
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    });
    ro.observe(log);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", take, { passive: true });
    el.addEventListener("touchstart", take, { passive: true });
    el.addEventListener("pointerdown", take, { passive: true });
    el.addEventListener("keydown", take);
    return () => {
      stop();
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", take);
      el.removeEventListener("touchstart", take);
      el.removeEventListener("pointerdown", take);
      el.removeEventListener("keydown", take);
    };
  }, []);

  const openChat = useCallback(async (id: string) => {
    setRailOpen(false);
    if (id === activeRef.current) return;
    setActiveId(id);
    activeRef.current = id;
    setSelection(null);
    setLoadingChat(true);
    // The open chat fades out first; the skeleton only takes its place if the next one is slow to arrive.
    setSwitching(true);
    const clear = setTimeout(() => {
      if (activeRef.current !== id) return;
      setMessages([]);
      setSwitching(false);
    }, D.d1 * SECOND_MS);
    setDraft(local.get(STORE.draft(id)) ?? "");
    try {
      const r = await fetch(API.chatById(id));
      if (!r.ok) throw new Error(r.status === 404 ? CHAT.error.chatGone : CHAT.error.http(r.status));
      const c = await r.json();
      if (activeRef.current !== id) return;
      clearTimeout(clear);
      setMessages(c.messages);
      setSwitching(false);
      setTitle(c.title);
      setProjectId(typeof c.projectId === "string" ? c.projectId : null);
      setFocusedKey(local.get(STORE.focus(id)));
      atBottomRef.current = true;
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    } catch (e) {
      clearTimeout(clear);
      setSwitching(false);
      setMessages([
        {
          id: "load-error",
          role: "agent",
          text: "",
          blocks: [],
          trace: [],
          error: e instanceof Error ? e.message : CHAT.error.chatOpen,
          at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoadingChat(false);
    }
  }, []);

  const newChat = useCallback(() => {
    setFocusedKey(null);
    setActiveId(null);
    activeRef.current = null;
    setMessages([]);
    setSwitching(false);
    setTitle(CHAT.newTitle);
    setSelection(null);
    setRailOpen(false);
    setDraft(local.get(STORE.draft(null)) ?? "");
    setTimeout(() => inputRef.current?.focus(), DELAY_MS.focusAfterNew);
  }, []);

  // The open conversation lives in the URL (?c=), so a link reopens it and Back and Forward move between chats.
  const pendingChat = useRef<string | null>(null);
  useEffect(() => {
    const read = () => {
      const c = new URLSearchParams(window.location.search).get("c");
      return c && /^[A-Za-z0-9_-]{1,64}$/.test(c) ? c : null;
    };
    const first = read();
    if (first) {
      pendingChat.current = first;
      openChat(first);
    }
    const onPop = () => {
      const c = read();
      if (c) openChat(c);
      else newChat();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openChat, newChat]);

  useEffect(() => {
    if (pendingChat.current) {
      if (activeId !== pendingChat.current) return;
      pendingChat.current = null;
    }
    const url = new URL(window.location.href);
    if (activeId) url.searchParams.set("c", activeId);
    else url.searchParams.delete("c");
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
  }, [activeId]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || streamingRef.current) return;
      const chatId = activeRef.current;
      const chosenModel = modelRef.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      streamingRef.current = true;
      setRailOpen(false);
      setDraft("");
      local.del(STORE.draft(chatId));
      setMessages((m) => [
        ...m.filter((x) => x.id !== "load-error"),
        { id: `local-${Date.now()}`, role: "user", text, at: new Date().toISOString() },
      ]);
      setLive({ chatId, text: "", thought: "", steps: [], blocks: [], error: null, streaming: true, trail: EMPTY_TRAIL });
      setTypedId(null);
      const turnKey = `live-${++liveSeq.current}`;
      setLiveKey(turnKey);
      atBottomRef.current = true;
      let id = chatId;
      try {
        const res = await fetch(API.chat, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chatId: chatId ?? undefined,
            text,
            model: chosenModel,
            ...(chatId ? {} : { unitId: unitRef.current ?? undefined, ...(projectRef.current ? { projectId: projectRef.current } : {}) }),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? CHAT.error.request(res.status));
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const apply = (e: StreamEvent) => {
          if (e.t === "chat") {
            id = e.id;
            if (!chatId) {
              setActiveId(e.id);
              activeRef.current = e.id;
              setTitle(e.title);
              setFlashId(e.id);
              setChats((cs) => [
                {
                  id: e.id,
                  title: e.title,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  unitId: unitRef.current ?? undefined,
                  ...(projectRef.current ? { projectId: projectRef.current } : {}),
                },
                ...(cs ?? []).filter((c) => c.id !== e.id),
              ]);
            }
            setLive((l) => l && { ...l, chatId: e.id });
          } else if (e.t === "text") setLive((l) => l && { ...l, text: l.text + e.d });
          // Working notes are one stream that only grows: a new thought continues it, and narration the agent drops
          // before a step joins it instead of vanishing.
          else if (e.t === "reset") setLive((l) => l && { ...l, text: "", thought: [l.thought, l.text.trim()].filter(Boolean).join("\n\n") });
          else if (e.t === "think") setLive((l) => l && { ...l, thought: l.thought + (e.fresh && l.thought ? "\n\n" : "") + e.d });
          else if (e.t === "step") {
            setLive((l) => {
              if (!l) return l;
              const s: Step = {
                id: e.id,
                kind: e.kind,
                label: e.label,
                doneLabel: e.doneLabel,
                status: e.status,
                detail: e.detail,
              };
              return {
                ...l,
                steps: l.steps.some((x) => x.id === e.id) ? l.steps.map((x) => (x.id === e.id ? s : x)) : [...l.steps, s],
              };
            });
          } else if (e.t === "block") setLive((l) => l && { ...l, blocks: [...l.blocks, e.block] });
          else if (e.t === "touch")
            setLive((l) => l && { ...l, trail: { ...l.trail, touches: [...l.trail.touches.filter((t) => t.id !== e.touch.id), e.touch] } });
          else if (e.t === "model") setLive((l) => l && { ...l, trail: { ...l.trail, model: e.model } });
          else if (e.t === "error") setLive((l) => l && { ...l, error: e.message });
          else if (e.t === "done") {
            if (activeRef.current === id) {
              setMessages((m) => [...m, e.message]);
              setTypedId(e.message.id);
              setTurnKeys((k) => ({ ...k, [e.message.id]: turnKey }));
            }
            setLive(null);
            if (configuredHome) loadPanel();
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) {
              try {
                apply(JSON.parse(line));
              } catch {
                /* skip a malformed line */
              }
            }
          }
        }
        setLive((l) => (l ? { ...l, streaming: false, error: l.error ?? CHAT.error.cut } : l));
      } catch (e) {
        const aborted = ctrl.signal.aborted;
        setLive(
          (l) =>
            l && {
              ...l,
              streaming: false,
              // The browser's own words for a dropped connection ("Load failed", "Failed to fetch") mean nothing to a user.
              error: aborted ? CHAT.error.stopped : e instanceof TypeError ? CHAT.error.network : e instanceof Error ? e.message : CHAT.error.generic,
            },
        );
        if (!aborted && !id) setDraft(text);
        if (aborted && id) {
          // Swap the stopped live turn for the saved one in place: no empty flash, no skeleton, no reload.
          const chatId = id;
          setTimeout(async () => {
            const c = activeRef.current === chatId ? await fetch(API.chatById(chatId)).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
            if (activeRef.current !== chatId) return setLive(null);
            if (c?.messages?.at(-1)?.role === "agent") {
              setMessages(c.messages);
              setLive(null);
            }
          }, DELAY_MS.reopenAfterStream);
        }
      } finally {
        abortRef.current = null;
        streamingRef.current = false;
        loadChats();
      }
    },
    [configuredHome, loadChats, loadPanel, openChat],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const focusBlock = useCallback((key: string) => {
    setFocusedKey(key);
    setCanvasOpen(true);
  }, []);
  // A fresh answer brings its first canvas block into view once its text has finished typing.
  const onTurnRevealed = useCallback((msgId: string) => {
    setRevealedId(msgId);
    const m = messagesRef.current.find((x) => x.id === msgId);
    const blocks = m && m.role === "agent" ? m.blocks : [];
    const i = blocks.findIndex(onCanvas);
    if (i >= 0) {
      setFocusedKey(canvasKey(msgId, i));
      setCanvasOpen(true);
    }
  }, []);
  const toggleRail = useCallback(() => setRailHidden((h) => !h), []);
  const toggleCanvas = useCallback(() => setCanvasOpen((o) => !o), []);
  // The canvas tab a chat had open comes back with the chat.
  useEffect(() => {
    if (activeId && focusedKey) local.set(STORE.focus(activeId), focusedKey);
  }, [activeId, focusedKey]);
  // Layout choices persist per browser; written after they change, never from inside a state updater.
  const prefsLoaded = useRef(false);
  useEffect(() => {
    if (prefsLoaded.current) local.set(STORE.rail, railHidden ? "hidden" : "shown");
  }, [railHidden]);
  useEffect(() => {
    if (prefsLoaded.current) local.set(STORE.canvas, canvasOpen ? "open" : "closed");
  }, [canvasOpen]);
  const pickProject = useCallback(
    (id: string | null) => {
      if (streamingRef.current) return;
      setProjectId(id);
      const u = unitRef.current;
      if (u) {
        if (id) store.set(`sp:project:${u}`, id);
        else store.set(`sp:project:${u}`, "");
      }
      newChat();
    },
    [newChat],
  );
  const pickUnit = useCallback(
    (id: string) => {
      if (streamingRef.current) return;
      setUnitId(id);
      if (me) store.set(`sp:unit:${me.user.id}`, id);
      setProjectId(null);
      newChat();
    },
    [me, newChat],
  );
  const retryLast = useCallback(() => {
    setLive(null);
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === "user");
    if (lastUser) send(lastUser.text);
  }, [send]);
  const onSelect = useCallback((s: Selection) => {
    setSelection(s);
    setPanelOpen(true);
  }, []);
  const onActionDone = useCallback(() => {
    if (configuredHome) loadPanel();
  }, [configuredHome, loadPanel]);

  // The new title shows at once; a refused rename puts the old one back.
  const rename = useCallback(async (id: string, t: string) => {
    let before: string | null = null;
    setChats((cs) => cs?.map((c) => (c.id === id ? ((before = c.title), { ...c, title: t }) : c)) ?? cs);
    const active = id === activeRef.current;
    if (active) setTitle(t);
    const ok = await fetch(API.chatById(id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: t }),
    }).then((r) => r.ok, () => false);
    if (ok || before === null) return;
    const old: string = before;
    setChats((cs) => cs?.map((c) => (c.id === id && c.title === t ? { ...c, title: old } : c)) ?? cs);
    if (active && activeRef.current === id) setTitle(old);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const r = await fetch(API.chatById(id), { method: "DELETE" });
      if (r.ok) {
        setChats((cs) => cs?.filter((c) => c.id !== id) ?? cs);
        if (id === activeRef.current) newChat();
      }
    },
    [newChat],
  );

  const sendDraft = useCallback(() => send(draftRef.current), [send]);

  const reusePrompt = useCallback((t: string) => {
    setDraft(t);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  const pickModel = useCallback((m: ModelId) => {
    setModel(m);
    local.set(STORE.model, m);
  }, []);
  const clearSelection = useCallback(() => setSelection(null), []);
  const closeRail = useCallback(() => setRailOpen(false), []);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    if (!configuredHome) setSelection(null);
    if (!narrowRef.current && configuredHome) local.set(STORE.panel, "closed");
  }, [configuredHome]);
  const askFromPanel = useCallback(
    (t: string) => {
      if (narrowRef.current) setPanelOpen(false);
      send(t);
    },
    [send],
  );
  const toggleHistory = useCallback(() => {
    setRailOpen((o) => {
      const next = !o;
      if (next) requestAnimationFrame(() => searchRef.current?.focus());
      return next;
    });
  }, []);

  const streaming = !!live?.streaming;
  const showLive = !!live && live.chatId === activeId;
  const selected = selectionKey(selection);
  const lastAgentIdx = messages.map((m) => m.role).lastIndexOf("agent");
  const empty = messages.length === 0 && !showLive && !loadingChat;
  conversingRef.current = !empty;
  const hasPanel = configuredHome || selection !== null;
  const showPanel = panelOpen && hasPanel;
  const dockedRail = !mobile && !railHidden;
  // On a wide screen the agent's large output always belongs to the canvas; the chat links to it with chips.
  const canvasMode = !narrow;
  // Canvas blocks of every saved turn, oldest first; a turn still typing keeps its blocks back until it is revealed.
  const canvasEntries = useMemo<CanvasEntry[]>(() => {
    const lastId = [...messages].reverse().find((m) => m.role === "agent")?.id;
    let ask = "";
    const fromChat = messages.flatMap((m) => {
      if (m.role === "user") { ask = m.text; return []; }
      if (m.id === typedId && revealedId !== typedId) return [];
      return m.blocks.flatMap((b, i) => (onCanvas(b) ? [{ key: canvasKey(m.id, i), block: b, latest: m.id === lastId, ask }] : []));
    });
    const latestOf = new Map(fromChat.map((e, i) => [e.key, i]));
    const once = fromChat.filter((e, i) => latestOf.get(e.key) === i);
    return once;
  }, [messages, typedId, revealedId]);
  // The canvas opens only when there is something on it: a finished answer's view. Until then the
  // conversation keeps the full width.
  const canvasDocked = canvasMode && canvasOpen && canvasEntries.length > 0;
  const canvasCtx = useMemo(() => ({ onSelect, onAsk: send, onActionDone, selected }), [onSelect, send, onActionDone, selected]);
  const unitChats = chats?.filter((c) => c.unitId === unitId && (c.projectId ?? null) === projectId) ?? null;
  const agentName = ui.agent;
  const homeError =
    meError ?? wsError ?? (me && me.memberships.length === 0 ? CHAT.noTeam : null);
  const retryHome = meError ? loadMe : loadPanel;
  const pinnedAsks = useMemo(() => new Set((pins ?? []).map((p) => p.ask)), [pins]);
  // With the sidebar docked, who you are and which team you act for live at its top; the chat bar keeps only its own controls.
  const identity = dockedRail ? (
    <div className="sp-rail-identity">
      <UnitSwitcher me={me} unitId={unitId} onPick={pickUnit} disabled={streaming} />
      <UserMenu me={me} />
    </div>
  ) : null;
  const projectList = (
    <ProjectList
      data={projects}
      error={projectsError}
      activeId={projectId}
      onPick={pickProject}
      onNew={() => setProjectSheet({ editing: null })}
      onEdit={(p) => setProjectSheet({ editing: p })}
      onRetry={loadProjects}
    />
  );
  const railTop = (
    <>
      {identity}
      {ui.projects && projectList}
    </>
  );
  const showScrim = (mobile && (railOpen || showPanel)) || (!mobile && narrow && showPanel);
  const chatCount = unitChats?.length ?? 0;
  const composer = (
    <Composer
      ref={inputRef}
      placeholder={ui.placeholder}
      value={draft}
      onChange={setDraft}
      onSend={sendDraft}
      onStop={stop}
      streaming={streaming}
      model={model}
      onModel={pickModel}
      routeLabel={ws?.scope.models[0]?.label}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className="ap-shell"
        style={MOTION_VARS}
        data-layout={layoutMode}
        data-panel={showPanel}
        data-canvas={canvasDocked}
        data-docked-rail={dockedRail}
        data-rail={mobile ? undefined : railHidden ? "folded" : "open"}
        data-settled={settled || undefined}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: D.d4, ease: EASE }}
      >
        <AnimatePresence>
          {showScrim && (
            <motion.div
              className="ap-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: D.d2, ease: EASE } }}
              transition={{ duration: D.d3, ease: EASE }}
              onClick={() => {
                setRailOpen(false);
                if (narrow) setPanelOpen(false);
              }}
            />
          )}
        </AnimatePresence>

        {!mobile && (
          <HistoryRail
            ref={searchRef}
            variant="rail"
            hidden={railHidden}
            top={railTop}
            chats={unitChats}
            error={chatsError}
            activeId={activeId}
            flashId={flashId}
            busy={streaming}
            onNew={newChat}
            onOpen={openChat}
            onRename={rename}
            onDelete={remove}
            onRetry={loadChats}
          />
        )}

        <AnimatePresence>
          {!dockedRail && mobile && railOpen && (
            <HistoryRail
              ref={searchRef}
              variant="drawer"
              top={railTop}
              chats={unitChats}
              error={chatsError}
              activeId={activeId}
              flashId={flashId}
              busy={streaming}
              onNew={newChat}
              onOpen={openChat}
              onRename={rename}
              onDelete={remove}
              onRetry={loadChats}
              onClose={closeRail}
            />
          )}
        </AnimatePresence>

        <main className="ap-main">
          <header className="ap-top" data-scrolled={scrolled}>
            <div className="ap-top-start">
              {!mobile && (
                <Button tone="ghost" icon={<IMenu size={18} />} aria-label={railHidden ? CHAT.showSidebar : CHAT.hideSidebar} aria-pressed={!railHidden} onClick={toggleRail} title={railHidden ? CHAT.showSidebar : CHAT.hideSidebar} />
              )}
              {mobile && (
                <button
                  type="button"
                  className="ap-brand-btn"
                  data-clickable={Boolean(activeId)}
                  onClick={() => activeId && newChat()}
                  title={activeId ? CHAT.startNew : undefined}
                >
                  <span className="ap-brand-mark">
                    <Mark size={18} />
                  </span>
                  <span className="ap-brand-name">{ui.product}</span>
                  {ui.tagline && <small className="ap-brand-tag">{ui.tagline}</small>}
                </button>
              )}

              {activeId && (
                <>
                  {mobile && (
                    <span className="ap-crumb-sep" aria-hidden>
                      /
                    </span>
                  )}
                  {editingTitle ? (
                    <motion.input
                      key="title-input"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { duration: D.d2, ease: EASE } }}
                      className="ap-title-input"
                      dir="auto"
                      autoFocus
                      defaultValue={title}
                      maxLength={80}
                      aria-label={CHAT.titleAria}
                      onBlur={(e) => {
                        setEditingTitle(false);
                        const v = e.target.value.trim();
                        if (v && v !== title) rename(activeId, v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditingTitle(false);
                      }}
                    />
                  ) : (
                    <motion.button
                      key="title"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { duration: D.d2, ease: EASE } }}
                      type="button"
                      className="ap-title"
                      data-editable="true"
                      onClick={() => setEditingTitle(true)}
                      title={CHAT.rename}
                    >
                      <span className="ap-title-text">{title}</span>
                      <IPencil size={12} className="ap-title-ico" />
                    </motion.button>
                  )}
                </>
              )}
            </div>

            <div className="ap-top-end">
              {mobile && <UnitSwitcher me={me} unitId={unitId} onPick={pickUnit} disabled={streaming} />}
              {mobile && (
                <div className="ap-history-anchor">
                  <Button ref={historyBtnRef} tone="ghost" collapse icon={<IChat size={15} />} count={chatCount} aria-label={CHAT.historyAria} aria-expanded={railOpen} onClick={toggleHistory}
                    data-guard="clickable" data-guard-label={CHAT.history}>{CHAT.history}</Button>

                  <AnimatePresence>
                    {!mobile && railOpen && (
                      <HistoryRail
                        ref={searchRef}
                        variant="popover"
                        triggerRef={historyBtnRef}
                        chats={unitChats}
                        error={chatsError}
                        activeId={activeId}
                        flashId={flashId}
                        busy={streaming}
                        onNew={newChat}
                        onOpen={openChat}
                        onRename={rename}
                        onDelete={remove}
                        onRetry={loadChats}
                        onClose={closeRail}
                      />
                    )}
                  </AnimatePresence>
                </div>
              )}

              {mobile && (
                <Button tone="ghost" collapse icon={<IPlus size={14} />} aria-label={CHAT.newChat} onClick={newChat} data-guard="clickable" data-guard-label={CHAT.newChat}>{CHAT.newShort}</Button>
              )}

              <AnimatePresence initial={false}>
                {!narrow && !empty && canvasMode && canvasEntries.length > 0 && (
                  <motion.span key="canvas-pill" {...FADE}>
                    <Button tone="ghost" collapse icon={<IPanel size={15} />} count={canvasEntries.length} aria-pressed={canvasOpen} onClick={toggleCanvas} title={canvasOpen ? CHAT.hideCanvas : CHAT.showCanvas}>{CHAT.canvas}</Button>
                  </motion.span>
                )}
              </AnimatePresence>
              {mobile && <UserMenu me={me} />}
            </div>
          </header>

          <div className="ap-scroll" ref={scrollRef}>
            <div className="ap-log" data-empty={empty} data-switching={switching || undefined} ref={logRef} role="log" aria-live="polite" aria-busy={streaming}>
              <AnimatePresence mode="popLayout" initial={false}>
                {empty && (homeError ? (
                  <motion.div key="home-error" {...FADE}>
                    <State tone="bad" icon={<IAlert size={18} />} title={homeError} action={{ label: CHAT.retry, onClick: retryHome }} />
                  </motion.div>
                ) : (
                  <motion.div key={`start:${unitId ?? ""}`} className="sp-start-frame" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: D.d3, ease: EASE } }} exit={{ opacity: 0, y: -6, transition: { duration: D.d1, ease: EASE } }}>
                    <InboxHome onAsk={reusePrompt} />
                  </motion.div>
                ))}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {loadingChat && <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: D.d2 } }} exit={{ opacity: 0, transition: { duration: D.d1, ease: EASE } }}><ChatLoading /></motion.div>}
              </AnimatePresence>
              {/* One keyed list, so the live turn keeps its instance (and its typing) when it becomes a saved message. */}
              {[
                ...messages.map((m, i) =>
                  m.role === "user" ? (
                    <motion.div
                      key={m.id}
                      className="ap-user-row"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: D.d2, ease: EASE }}
                    >
                      <button
                        type="button"
                        className="ap-user-edit"
                        title={CHAT.editInComposer}
                        aria-label={CHAT.editPromptAria}
                        onClick={() => reusePrompt(m.text)}
                      >
                        <IPencil size={12} />
                      </button>
                      <div className="ap-user-stack">
                        {m.text && (
                          <div className="ap-user" dir="auto">
                            {m.text}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ) : (
                    <AgentTurn
                      key={turnKeys[m.id] ?? m.id}
                      text={m.text}
                      typed={m.id === typedId}
                      blocks={m.blocks}
                      trace={m.trace}
                      sources={m.sources}
                      error={m.error}
                      streaming={false}
                      steps={NO_STEPS}
                      isLast={i === lastAgentIdx && !showLive}
                      selected={selected}
                      onSelect={onSelect}
                      onAsk={send}
                      onActionDone={onActionDone}
                      onRetryLast={retryLast}
                      agentName={agentName}
                      at={m.at}
                      msgId={m.id}
                      canvas={canvasMode}
                      focusedKey={focusedKey}
                      onFocusBlock={focusBlock}
                      onRevealed={onTurnRevealed}
                    />
                  ),
                ),
                showLive && live ? (
                  <AgentTurn
                    key={liveKey}
                    text={live.text}
                    typed
                    blocks={live.blocks}
                    trace={[]}
                    error={live.error}
                    streaming={live.streaming}
                    steps={live.steps}
                    thought={live.thought}
                    isLast
                    selected={selected}
                    onSelect={onSelect}
                    onAsk={send}
                    onActionDone={onActionDone}
                    onRetryLast={retryLast}
                    agentName={agentName}
                    canvas={canvasMode}
                    focusedKey={focusedKey}
                    onFocusBlock={focusBlock}
                  />
                ) : null,
              ]}
              <div className="ap-pad-bottom" />
            </div>
          </div>

          <AnimatePresence>
            {!atBottom && !empty && (
              <motion.button
                type="button"
                className="ap-jump"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8, transition: { duration: D.d1, ease: EASE } }}
                transition={{ duration: D.d2, ease: EASE }}
                whileHover={{ y: -1.5, transition: { duration: D.d2, ease: EASE } }}
                whileTap={{ scale: 0.96, transition: { duration: D.d1, ease: EASE } }}
                onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}
              >
                <IArrowDown size={13} />
                {CHAT.toLatest}
              </motion.button>
            )}
          </AnimatePresence>

          <div className="ap-composer-wrap">{composer}</div>
        </main>

        <div className="sp-dock-col">
        <AnimatePresence initial={false}>
          {!showPanel && canvasDocked && (
            <Dock key="canvas">
              <Canvas entries={canvasEntries} focused={focusedKey} onFocus={focusBlock} onClose={toggleCanvas} ctx={canvasCtx} pinned={pinnedAsks} onPin={pinView} />
            </Dock>
          )}
          {showPanel && (
            <Dock key="panel">
            <ContextPanel
              data={panelData}
              error={panelError}
              refreshing={panelBusy}
              hasHome={configuredHome}
              selection={selection}
              mobile={mobile}
              onSelect={onSelect}
              onClear={clearSelection}
              onClose={closePanel}
              onRefresh={loadPanel}
              onAsk={askFromPanel}
              home={<InboxPanel onOpen={(id) => { openEmail(id); newChat(); }} />}
            />
            </Dock>
          )}
        </AnimatePresence>
        </div>
        {projects && unitId && (
          <ProjectSheet
            open={projectSheet !== null}
            unitId={unitId}
            data={projects}
            editing={projectSheet?.editing ?? null}
            onClose={() => setProjectSheet(null)}
            onSaved={(p) => {
              const created = !projectSheet?.editing;
              setProjectSheet(null);
              setProjects((d) => d && { ...d, projects: [p, ...d.projects.filter((x) => x.id !== p.id)] });
              // Editing keeps the open conversation; its next turn already runs on the updated sources.
              if (created) pickProject(p.id);
            }}
            onDeleted={(id) => {
              setProjectSheet(null);
              setProjects((d) => d && { ...d, projects: d.projects.filter((x) => x.id !== id) });
              setChats((cs) => cs?.filter((c) => c.projectId !== id) ?? cs);
              pickProject(null);
            }}
          />
        )}
      </motion.div>
    </MotionConfig>
  );
}
