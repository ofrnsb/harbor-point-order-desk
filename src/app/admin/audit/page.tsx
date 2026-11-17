"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditResponse, AuditVerifyResponse, UsersResponse } from "@/platform/api-types";
import type { AuditKind } from "@/platform/contract";
import { IArrowDown, IShield } from "@/components/icons";
import { api, dateTime, num, PLATFORM_ROLE_LABEL, ROLE_LABEL } from "@/components/sp/client";
import { Badge, Button, Grow, Label, ListState, Notice, Reveal, Row, Segmented, Select, Stack, Table, Text, Title, useApi, useMutation, type Col, type Tone } from "@/components/ui";
import { Code } from "@/components/ui/code";
import { AUDIT as C } from "@/copy/app-admin";
import { AUDIT_EXPORT_SLACK_MS, AUDIT_HASH_SHOWN, AUDIT_PAGE, AUDIT_PERIOD_DEFAULT, AUDIT_PERIODS } from "@/config/app";
import { DAY_MS } from "@/config/locale";
import { API } from "@/config/routes";

type Ev = AuditResponse["events"][number];
const KIND_LABEL: Record<AuditKind, string> = C.kinds;
const KIND_TONE: Partial<Record<AuditKind, Tone>> = { denied: "bad", fail: "bad", reject: "bad", execute: "good", approve: "good", propose: "info", confirm: "info", admin: "warn", data_change: "warn", schema_change: "warn", triage: "info", release: "good" };

export default function Audit() {
  const [kind, setKind] = useState<AuditKind | "all">("all");
  const [userId, setUserId] = useState<string>("all");
  const [events, setEvents] = useState<Ev[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<AuditVerifyResponse | null>(null);
  const [period, setPeriod] = useState<"all" | (typeof AUDIT_PERIODS)[number]>(AUDIT_PERIOD_DEFAULT);
  // The window is taken when the link is clicked: a time read while rendering differs between server and browser.
  const exportHref = () => {
    if (period === "all") return API.admin.auditExport;
    const from = new Date(Date.now() - Number(period) * DAY_MS).toISOString();
    return API.admin.auditExportRange(from, new Date(Date.now() + AUDIT_EXPORT_SLACK_MS).toISOString());
  };
  const users = useApi<UsersResponse>(API.admin.users);
  const v = useMutation();
  const reqSeq = useRef(0);

  const load = useCallback(async (before: number | null, reset: boolean) => {
    const n = ++reqSeq.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ limit: String(AUDIT_PAGE) });
    if (before) qs.set("before", String(before));
    if (kind !== "all") qs.set("kind", kind);
    if (userId !== "all") qs.set("userId", userId);
    try {
      const r = await api<AuditResponse>(API.admin.audit(qs));
      if (n !== reqSeq.current) return;
      setEvents((e) => (reset ? r.events : [...e, ...r.events]));
      setNext(r.next);
    } catch (e) { if (n === reqSeq.current) setError(e instanceof Error ? e.message : C.loadFailed); }
    finally { if (n === reqSeq.current) setLoading(false); }
  }, [kind, userId]);

  useEffect(() => { setEvents([]); load(null, true); }, [load]);

  const runVerify = async () => { const r = await v.run(() => api<AuditVerifyResponse>(API.admin.auditVerify)); if (r) setVerify(r); };

  const cols: Col<Ev>[] = [
    { key: "seq", header: C.th.seq, kind: "code", cell: (e) => num(e.seq) },
    { key: "at", header: C.th.at, kind: "date", cell: (e) => dateTime(e.at) },
    { key: "actor", header: C.th.actor, kind: "title", cell: (e) => <Stack gap="none"><Text strong truncate>{e.actorName}</Text><Label truncate>{e.actor.role.split("+").map((r) => PLATFORM_ROLE_LABEL[r] ?? ROLE_LABEL[r] ?? r).join(", ")}</Label></Stack> },
    { key: "kind", header: C.th.kind, kind: "badge", cell: (e) => <Badge tone={KIND_TONE[e.kind] ?? "neutral"}>{KIND_LABEL[e.kind] ?? e.kind}</Badge> },
    { key: "target", header: C.th.target, kind: "wide", cell: (e) => e.targetName, text: (e) => `${e.targetName} (${e.target})` },
    { key: "hash", header: C.th.hash, kind: "code", cell: (e) => e.hash.slice(0, AUDIT_HASH_SHOWN), text: (e) => e.hash },
  ];
  return (
    <Stack gap="l">
      <Row align="between" wrap={false}>
        <Stack gap="s"><Title level={1}>{C.title}</Title><Text tone="muted">{C.sub}</Text></Stack>
        <Row gap="s" wrap={false}>
          <a className="sp-ui-btn" data-tone="secondary" href={API.admin.auditExport} onClick={(e) => { e.currentTarget.href = exportHref(); }} download><IArrowDown size={14} /> {C.download}</a>
          <Button icon={<IShield size={14} />} disabled={v.busy} onClick={runVerify}>{v.busy ? C.checking : C.check}</Button>
        </Row>
      </Row>
        <Reveal>{verify && (
          <Notice tone={verify.ok ? "good" : "bad"} onClose={() => setVerify(null)}>
            {verify.ok ? C.intact(num(verify.checked)) : C.broken(verify.brokenAt, num(verify.checked))}
          </Notice>
        )}</Reveal>
        <Reveal>{v.error && <Notice tone="bad" onClose={() => v.setError(null)}>{v.error}</Notice>}</Reveal>
        <Row gap="s">
          <Grow><Row gap="s">
          <Select value={kind} label={C.kind} options={[{ value: "all" as const, label: C.allKinds }, ...(Object.keys(KIND_LABEL) as AuditKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))]} onChange={setKind} />
          <Select value={userId} label={C.actor} options={[{ value: "all", label: C.allActors }, ...(users.data?.users ?? []).map((u) => ({ value: u.id, label: u.name, hint: u.title }))]} onChange={setUserId} />
          </Row></Grow>
          <Segmented value={period} label={C.exportPeriod} options={[...AUDIT_PERIODS.map((value) => ({ value, label: C.days(value) })), { value: "all" as const, label: C.all }]} onChange={setPeriod} />
        </Row>
        <ListState loading={loading && events.length === 0} error={error} onRetry={() => load(null, true)} empty={events.length === 0} emptyText={C.empty} filtered={kind !== "all" || userId !== "all"} filterText={C.noMatch} onClearFilter={() => { setKind("all"); setUserId("all"); }}>
          <Table rows={events} cols={cols} rowKey={(e) => String(e.seq)} label={C.title} view={`${kind}|${userId}|${period}`} tight
            hasMore={next !== null} onMore={() => { if (!loading && next !== null) void load(next, false); }}
            expand={(e) => <Code>{JSON.stringify({ actor: e.actor, detail: e.detail, prevHash: e.prevHash, hash: e.hash }, null, 2)}</Code>} />
        </ListState>
    </Stack>
  );
}
