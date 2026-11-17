"use client";
import { useState } from "react";
import type { ConnectionInput, ConnectionRow, ConnectionsResponse } from "@/platform/api-types";
import { IPlus, IRefresh } from "@/components/icons";
import { agoId, api, num } from "@/components/sp/client";
import { useAdminMe } from "@/components/sp/admin/AdminShell";
import { Badge, Button, Divider, Field, Grid, Label, List, ListState, Notice, Reveal, Row, SaveBar, Sheet, Stack, Switch, Table, Text, TextInput, Title, useApi, useMutation, type Col } from "@/components/ui";
import { ADMIN_COMMON, CONNECTIONS as C } from "@/copy/app-admin";
import { FIELD_MAX } from "@/config/app";
import { API } from "@/config/routes";

type Form = { code: string; name: string; file: string; withWrite: boolean };
const EMPTY: Form = { code: "", name: "", file: "", withWrite: false };

const toInput = (f: Form): ConnectionInput => ({
  code: f.code.trim().toUpperCase(), name: f.name.trim(), kind: "sqlite", config: { file: f.file.trim() }, read: {}, write: f.withWrite ? {} : null,
});

export default function Connections() {
  const { data, error, loading, reload, setData } = useApi<ConnectionsResponse>(API.admin.connections);
  const [form, setForm] = useState<Form | null>(null);
  const [rowBusy, setRowBusy] = useState<Record<string, "test" | "introspect">>({});
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const save = useMutation();
  const canWrite = !!useAdminMe()?.user.platformRoles.includes("security_admin");
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const test = async (c: ConnectionRow) => {
    setRowBusy((b) => ({ ...b, [c.id]: "test" }));
    try {
      const r = await api<{ connection: ConnectionRow }>(API.admin.connectionTest(c.id), { method: "POST" });
      setData((d) => d && { connections: d.connections.map((x) => (x.id === c.id ? { ...x, ...r.connection, objects: x.objects } : x)) });
      setNotice({ tone: r.connection.status === "ok" ? "good" : "bad", text: C.codeNote(c.code, r.connection.statusNote) });
    } catch (e) { setNotice({ tone: "bad", text: C.codeNote(c.code, e instanceof Error ? e.message : C.testFailed) }); }
    finally { setRowBusy(({ [c.id]: _, ...rest }) => rest); }
  };
  const introspect = async (c: ConnectionRow) => {
    setRowBusy((b) => ({ ...b, [c.id]: "introspect" }));
    try {
      const r = await api<{ objects: unknown[] }>(API.admin.connectionIntrospect(c.id), { method: "POST" });
      setNotice({ tone: "good", text: C.objectsRead(c.code, num(r.objects.length)) });
      reload();
    } catch (e) { setNotice({ tone: "bad", text: C.codeNote(c.code, e instanceof Error ? e.message : C.introspectFailed) }); }
    finally { setRowBusy(({ [c.id]: _, ...rest }) => rest); }
  };
  const submit = async () => {
    if (!form) return;
    const ok = await save.run(() => api(API.admin.connections, { method: "POST", json: toInput(form) }));
    if (ok) { setNotice({ tone: "good", text: C.saved(form.code) }); setForm(null); reload(); }
  };

  const conns = data?.connections ?? [];
  const cols: Col<ConnectionRow>[] = [
    { key: "system", header: C.th.system, kind: "title", cell: (c) => <Stack gap="none"><Text strong mono truncate>{c.code}</Text><Label truncate>{c.name}</Label></Stack>, text: (c) => `${c.code} · ${c.name}` },
    { key: "status", header: C.th.status, kind: "status", cell: (c) => <Badge tone={c.status === "ok" ? "good" : c.status === "error" ? "bad" : "neutral"} title={c.statusNote}>{c.status === "ok" ? C.ok : c.status === "error" ? C.failed : C.untested}</Badge> },
    { key: "objects", header: C.th.objects, kind: "num", cell: (c) => num(c.objects) },
    { key: "write", header: C.th.write, kind: "badge", cell: (c) => (c.hasWrite ? <Badge tone="info">{C.hasWrite}</Badge> : <Badge>{C.readOnlyChip}</Badge>) },
    { key: "introspected", header: C.th.introspect, kind: "date", cell: (c) => (c.introspectedAt ? agoId(c.introspectedAt) : C.never) },
    ...(canWrite ? [{ key: "actions", header: <span className="ap-sr">{ADMIN_COMMON.actionsSr}</span>, kind: "actions" as const, cell: (c: ConnectionRow) => (
      <>
        <Button tone="ghost" disabled={!!rowBusy[c.id]} onClick={() => test(c)}>{rowBusy[c.id] === "test" ? C.testing : C.test}</Button>
        <Button tone="ghost" icon={<IRefresh size={13} />} disabled={!!rowBusy[c.id]} onClick={() => introspect(c)}>{rowBusy[c.id] === "introspect" ? C.introspecting : C.introspect}</Button>
      </>
    ) }] : []),
  ];
  return (
    <>
      <Stack gap="l">
        <Row align="between" wrap={false}>
          <Stack gap="s"><Title level={1}>{C.title}</Title><Text tone="muted">{canWrite ? C.sub : `${C.sub} ${C.readOnly}`}</Text></Stack>
          {canWrite && <Button tone="primary" icon={<IPlus size={14} />} onClick={() => { save.setError(null); setForm({ ...EMPTY }); }}>{C.add}</Button>}
        </Row>
        <Reveal>{notice && <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice>}</Reveal>
        <ListState loading={loading} error={error} onRetry={reload} empty={conns.length === 0} emptyText={C.empty}>
          <Table rows={conns} cols={cols} rowKey={(c) => c.id} label={C.title} expand={(c) => <List items={[[C.th.status, c.statusNote || C.untested], [C.th.introspect, c.introspectedAt ? agoId(c.introspectedAt) : C.never]]} rowKey={(_, i) => String(i)} size="s" render={([k, v]) => <Row align="between" wrap={false}><Label>{k}</Label><Text>{v}</Text></Row>} />} />
        </ListState>
      </Stack>

      <Sheet open={!!form} title={C.sheetTitle} sub={C.sheetSub} onClose={() => setForm(null)}
        footer={<SaveBar busy={save.busy} error={save.error} onSave={submit} onCancel={() => setForm(null)} label={C.save} />}>
        {form && (
          <Stack gap="m">
            <Grid cols={2}>
              <Field label={C.code} hint={C.codeHint}><TextInput mono value={form.code} onChange={(v) => set({ code: v.toUpperCase() })} maxLength={FIELD_MAX.connectionCode} placeholder={C.codePh} /></Field>
              <Field label={C.name}><TextInput value={form.name} onChange={(v) => set({ name: v })} maxLength={FIELD_MAX.name} placeholder={C.namePh} /></Field>
            </Grid>
            <Field label={C.file} hint={C.fileHint}><TextInput mono value={form.file} onChange={(v) => set({ file: v })} placeholder={C.filePh} /></Field>
            <Divider />
            <Switch checked={form.withWrite} label={C.withWrite} onChange={(v) => set({ withWrite: v })} />
          </Stack>
        )}
      </Sheet>
    </>
  );
}
