"use client";
import { DAY_MS, WEEK_DAYS } from "@/config/locale";
import { STORE } from "@/config/ui";
import { CHAT } from "@/copy/ui-chat";
import { RAIL } from "@/copy/ui-rail";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { forwardRef, memo, useEffect, useMemo, useRef, useState } from "react";
import { ui } from "@/domain/ui";
import type { ChatSummary } from "@/lib/types";
import { ago } from "./format";
import { IAlert, IChat, IClose, IKeep, IPencil, IPlus, ISearch, ITrash, Mark } from "./icons";
import { D, EASE, stagger } from "./motion";
import { Badge, Button, Grow, Row, Title } from "@/components/ui";
import { NavAction, NavBrand, NavGroup, NavPad, NavRow, NavRowConfirm, NavRowInput, NavRowTime, NavRowTitle, NavRowTool, NavRowTools, NavScroll, NavSection } from "@/components/ui/nav";
import { SearchField } from "@/components/ui/search";
import { Skeleton } from "@/components/ui/skeleton";
import { State } from "@/components/ui/state";

export type RailVariant = "popover" | "drawer" | "rail";

/** A history row that can take focus, for arrow-key moves between rows. */
const ROW = ".sp-ui-nav-row[role='button']";
const RENAME_MAX = 80;

type Props = {
  chats: ChatSummary[] | null;
  error: string | null;
  activeId: string | null;
  flashId: string | null;
  busy: boolean;
  variant?: RailVariant;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRetry: () => void;
  onClose?: () => void;
  /** Rendered between the brand and the history (Simpul: the agent list). Replaces the New conversation button. */
  top?: React.ReactNode;
  /** Docked rail only: folded away. It stays mounted so it can slide closed and open instead of popping. */
  hidden?: boolean;
};

const PIN_KEY = STORE.pinned;

function readPins(): string[] {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writePins(ids: string[]) {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(ids));
  } catch {
    /* private mode */
  }
}

function groupOf(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "Today";
  if (t >= start - DAY_MS) return "Yesterday";
  if (t >= start - WEEK_DAYS * DAY_MS) return "Previous 7 days";
  return "Older";
}

const ORDER = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Older"];
const GROUP_LABEL = RAIL.groups;

export const HistoryRail = memo(
  forwardRef<HTMLInputElement, Props>(function HistoryRail(p, searchRef) {
    const variant = p.variant ?? "popover";
    const [q, setQ] = useState("");
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [confirming, setConfirming] = useState<string | null>(null);
    const [pinned, setPinned] = useState<string[]>([]);
    const [shortcut, setShortcut] = useState<string>(CHAT.shortcutMac);
    const listRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLElement>(null);

    useEffect(() => {
      setPinned(readPins());
      if (typeof navigator !== "undefined" && !/(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent)) {
        setShortcut(CHAT.shortcutOther);
      }
    }, []);

    useEffect(() => {
      if (variant !== "popover" || !p.onClose) return;
      const onDown = (e: MouseEvent) => {
        const target = e.target as Node;
        if (rootRef.current?.contains(target)) return;
        if (p.triggerRef?.current?.contains(target)) return;
        p.onClose?.();
      };
      const t = setTimeout(() => document.addEventListener("mousedown", onDown));
      return () => {
        clearTimeout(t);
        document.removeEventListener("mousedown", onDown);
      };
    }, [variant, p.onClose, p.triggerRef]);

    const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

    const togglePin = (id: string) => {
      setPinned((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
        writePins(next);
        return next;
      });
    };

    const groups = useMemo(() => {
      const term = q.trim().toLowerCase();
      const rows = (p.chats ?? []).filter((c) => c.title.toLowerCase().includes(term));
      const by = new Map<string, ChatSummary[]>();
      for (const c of rows) {
        const g = pinnedSet.has(c.id) ? "Pinned" : groupOf(c.updatedAt);
        by.set(g, [...(by.get(g) ?? []), c]);
      }
      return ORDER.filter((g) => by.has(g)).map((g) => ({ g, rows: by.get(g)! }));
    }, [p.chats, q, pinnedSet]);

    const commitRename = async (id: string) => {
      const t = draft.trim();
      setEditing(null);
      if (t) await p.onRename(id, t);
    };

    const focusSearch = () => {
      if (searchRef && typeof searchRef !== "function") searchRef.current?.focus();
    };

    const moveRowFocus = (current: HTMLElement, dir: 1 | -1) => {
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>(ROW) ?? []);
      const idx = rows.indexOf(current);
      if (idx < 0) return;
      const next = rows[idx + dir];
      next?.focus();
    };

    const totalCount = p.chats?.length ?? 0;
    let firstRow = true;

    const body = (
      <>
        {variant === "popover" ? (
          <NavPad>
            <Row gap="s" wrap={false}>
              <Grow><Row gap="s" wrap={false}><Title level={3}>{RAIL.conversations}</Title>{totalCount > 0 && <Badge>{totalCount}</Badge>}</Row></Grow>
              <Button tone="ghost" icon={<IPlus size={13} />} onClick={p.onNew}>{RAIL.newShort}</Button>
              {p.onClose && <Button tone="ghost" icon={<IClose size={14} />} aria-label={RAIL.close} onClick={p.onClose} />}
            </Row>
          </NavPad>
        ) : (
          <>
            <NavBrand mark={<Mark size={18} />} name={ui.product} sub={ui.tagline}
              end={p.onClose && variant === "drawer" ? <Button tone="ghost" icon={<IClose size={16} />} aria-label={RAIL.close} onClick={p.onClose} /> : undefined} />
            {p.top}
            {/* Always offered: with projects and boards above it, a fresh conversation was otherwise only reachable by picking "No project". */}
            <NavPad><NavAction icon={<IPlus size={15} />} onClick={p.onNew} disabled={p.busy}>{RAIL.newChat}</NavAction></NavPad>
            {p.top && <NavSection title={RAIL.title}>{null}</NavSection>}
          </>
        )}

        <NavPad>
          <SearchField
            ref={searchRef}
            value={q}
            onChange={setQ}
            placeholder={RAIL.search}
            label={RAIL.search}
            clearLabel={RAIL.clearSearch}
            shortcut={shortcut}
            onClear={focusSearch}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (q) {
                  e.stopPropagation();
                  setQ("");
                } else if (variant !== "rail" && p.onClose) {
                  e.stopPropagation();
                  p.onClose();
                } else {
                  (e.target as HTMLInputElement).blur();
                }
              } else if (e.key === "ArrowDown") {
                const first = listRef.current?.querySelector<HTMLElement>(ROW);
                if (first) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          />
        </NavPad>

        <NavScroll ref={listRef}>
          {p.error ? (
            <State tone="bad" icon={<IAlert size={18} />} title={RAIL.loadFailed} body={p.error} action={{ label: RAIL.retry, onClick: p.onRetry }} />
          ) : p.chats === null ? (
            <Skeleton rows={4} height={38} label={RAIL.loading} />
          ) : p.chats.length === 0 ? (
            <State icon={<IChat size={18} />} title={RAIL.emptyTitle} body={RAIL.emptyBody} />
          ) : groups.length === 0 ? (
            <State icon={<ISearch size={18} />} title={<>{RAIL.noMatch} &ldquo;{q.trim()}&rdquo;</>} body={RAIL.noMatchHint}
              action={{ label: RAIL.clearSearchLong, onClick: () => { setQ(""); focusSearch(); } }} />
          ) : (
            // One flat list of headers and rows, so a pinned or renamed chat glides to its new group instead of
            // leaving one list and popping into another; headers fade in and out as groups appear and empty.
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: D.d2, ease: EASE } }}>
            <LayoutGroup id={`rail-${variant}`}>
              <AnimatePresence initial={false} mode="popLayout">
                {groups.flatMap(({ g, rows }) => [
                  <NavGroup
                    key={`group:${g}`}
                    layout="position"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: D.d1, ease: EASE } }}
                    transition={{ duration: D.d2, ease: EASE, layout: { duration: D.d3, ease: EASE } }}
                  >
                    {GROUP_LABEL[g] ?? g}
                  </NavGroup>,
                  ...rows.map((c, i) => {
                    const guard = firstRow ? { "data-guard": "visible", "data-guard-label": RAIL.rowsGuard } : {};
                    firstRow = false;
                    const active = c.id === p.activeId;
                    const isPinned = pinnedSet.has(c.id);
                    const interactive = editing !== c.id && confirming !== c.id;
                    return (
                      <NavRow
                        key={c.id}
                        glide={`rail-hl-${variant}`}
                        layout="position"
                        active={active}
                        pinned={isPinned}
                        flash={c.id === p.flashId}
                        {...guard}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, transition: { duration: D.d1, ease: EASE } }}
                        transition={{ duration: D.d3, delay: stagger(i), ease: EASE, layout: { duration: D.d3, ease: EASE } }}
                        whileHover={interactive ? { x: 1.5, transition: { duration: D.d2, ease: EASE } } : undefined}
                        whileTap={interactive ? { scale: 0.985, transition: { duration: D.d1, ease: EASE } } : undefined}
                        onClick={() => interactive && p.onOpen(c.id)}
                        role="button"
                        tabIndex={0}
                        aria-current={active ? "page" : undefined}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget || !interactive) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            p.onOpen(c.id);
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            moveRowFocus(e.currentTarget, 1);
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            moveRowFocus(e.currentTarget, -1);
                          }
                        }}
                      >
                        {editing === c.id ? (
                          <NavRowInput value={draft} onChange={setDraft} onDone={() => commitRename(c.id)} onCancel={() => setEditing(null)} label={RAIL.renameAria} maxLength={RENAME_MAX} />
                        ) : confirming === c.id ? (
                          <NavRowConfirm question={RAIL.confirmDelete} yes={RAIL.delete} no={RAIL.cancel}
                            onYes={async () => {
                              setConfirming(null);
                              if (isPinned) togglePin(c.id);
                              await p.onDelete(c.id);
                            }}
                            onNo={() => setConfirming(null)} />
                        ) : (
                          <>
                            <NavRowTitle title={c.title}>{c.title}</NavRowTitle>
                            <NavRowTime>{ago(c.updatedAt)}</NavRowTime>
                            <NavRowTools>
                              <NavRowTool icon={<IKeep size={13} />} on={isPinned} title={isPinned ? RAIL.unpin : RAIL.pinTop} label={isPinned ? RAIL.unpinOf(c.title) : RAIL.pinOf(c.title)} onClick={() => togglePin(c.id)} />
                              <NavRowTool icon={<IPencil size={13} />} title={RAIL.rename} label={RAIL.renameOf(c.title)} onClick={() => { setDraft(c.title); setEditing(c.id); }} />
                              <NavRowTool icon={<ITrash size={13} />} title={RAIL.delete} label={RAIL.deleteOf(c.title)} onClick={() => setConfirming(c.id)} />
                            </NavRowTools>
                          </>
                        )}
                      </NavRow>
                    );
                  }),
                ])}
              </AnimatePresence>
            </LayoutGroup>
            </motion.div>
          )}
        </NavScroll>
      </>
    );

    if (variant === "rail") {
      return (
        <div className="ap-rail-frame" data-hidden={p.hidden || undefined} inert={p.hidden || undefined} aria-hidden={p.hidden || undefined}>
          <nav ref={rootRef} className="ap-rail ap-rail-dock" aria-label={RAIL.aria}>
            {body}
          </nav>
        </div>
      );
    }

    if (variant === "drawer") {
      return (
        <motion.aside
          ref={rootRef}
          className="ap-rail ap-rail-drawer"
          role="dialog"
          aria-label={RAIL.aria}
          initial={{ x: "-100%", opacity: 0.9 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "-100%", opacity: 0.9, transition: { duration: D.d2, ease: EASE } }}
          transition={{ duration: D.d3, ease: EASE }}
        >
          {body}
        </motion.aside>
      );
    }

    return (
      <motion.div
        ref={rootRef as React.RefObject<HTMLDivElement>}
        className="ap-rail ap-rail-pop"
        role="dialog"
        aria-label={RAIL.aria}
        initial={{ opacity: 0, y: -8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.985, transition: { duration: D.d1, ease: EASE } }}
        transition={{ duration: D.d2, ease: EASE }}
      >
        {body}
      </motion.div>
    );
  }),
);
