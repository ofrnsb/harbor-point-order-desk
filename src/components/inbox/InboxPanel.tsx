"use client";
// The queue beside a conversation: how many emails wait and the next few, so the reviewer can jump back to one.
import { OPEN_STATES } from "@/config/orders";
import { INBOX as T, KIND_LABEL } from "@/copy/orders";
import { Badge, Button, Text } from "../ui";
import { Skeleton } from "../ui/skeleton";
import { useInbox } from "./store";
import "./inbox.css";

const SHOWN = 8;

export function InboxPanel({ onOpen }: { onOpen: (id: string | null) => void }) {
  const { data, error } = useInbox();
  if (!data) return error ? <Text tone="bad">{T.loadFailed}</Text> : <Skeleton rows={4} height={48} label={T.panelTitle} />;
  const waiting = data.items.filter((t) => OPEN_STATES.includes(t.state));
  return (
    <div className="hp-panel">
      <Text strong>{T.headline(waiting.length, data.items.filter((t) => t.state === "queued").length)}</Text>
      <ul className="hp-panel-list">
        {waiting.slice(0, SHOWN).map((t) => (
          <li key={t.id}>
            <button type="button" className="hp-panel-row" onClick={() => onOpen(t.id)}>
              <span className="hp-mono">{t.id}</span>
              <span dir="auto">{t.checked[0]?.customerName ?? t.fromName}</span>
              <span />
              <span>{t.kind && <Badge>{KIND_LABEL[t.kind]}</Badge>}</span>
            </button>
          </li>
        ))}
      </ul>
      {waiting.length > SHOWN && <span className="hp-muted">{T.panelMore(waiting.length - SHOWN)}</span>}
      <Button tone="secondary" onClick={() => onOpen(null)}>{T.panelOpen}</Button>
    </div>
  );
}
