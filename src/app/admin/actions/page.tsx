"use client";
import { useState } from "react";
import { AnimatePresence } from "motion/react";
import type { ActionsResponse, CatalogResponse, ConnectionsResponse } from "@/platform/api-types";
import type { ActionField, ActionTemplate } from "@/platform/contract";
import { IPlus, ITrash } from "@/components/icons";
import { api } from "@/components/sp/client";
import { Badge, Button, Divider, Field, Grid, Grow, Label, ListState, Notice, Reveal, Row, SaveBar, Segmented, Select, Sheet, Stack, Switch, Table, Text, TextArea, TextInput, Title, useApi, useMutation, type Col } from "@/components/ui";
import { RevealRow, useRowKeys } from "@/components/sp/admin/kit";
import { ACTIONS as C, ADMIN_COMMON } from "@/copy/app-admin";
import { ACTION_DESCRIPTION_ROWS, ACTION_FIELD_MAX, ACTION_PREFIX_MIN } from "@/config/app";
import { API } from "@/config/routes";

type Draft = Omit<ActionTemplate, "tenantId" | "id"> & { id?: string };
const BLANK: Draft = { name: "", description: "", connectionId: "", object: "", op: "insert", fields: [], risk: "low", owner: "", receiptPrefix: "" };
const KIND_OPTS = (["text", "number", "date", "choice"] as const).map((value) => ({ value, label: C.kinds[value] }));

export default function Actions() {
  const { data, error, loading, reload } = useApi<ActionsResponse>(API.admin.actions);
  const conns = useApi<ConnectionsResponse>(API.admin.connections);
  const [draft, setDraft] = useState<Draft | null>(null);
  const fieldKeys = useRowKeys(draft?.fields.length ?? 0);
  const [notice, setNotice] = useState<string | null>(null);
  const cat = useApi<CatalogResponse>(draft?.connectionId ? API.admin.catalog(draft.connectionId) : null);
  const save = useMutation();
  const del = useMutation();
  const obj = cat.data?.objects.find((o) => o.name === draft?.object) ?? null;
  const colOpts = (obj?.columns ?? []).map((c) => ({ value: c.name, label: c.label || c.name, hint: c.name }));
  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setField = (i: number, p: Partial<ActionField> | null) => setDraft((d) => {
    if (!d) return d;
    const fields = [...d.fields];
    if (p === null) fields.splice(i, 1); else fields[i] = { ...fields[i], ...p };
    return { ...d, fields };
  });
  const connName = (id: string) => conns.data?.connections.find((c) => c.id === id)?.code ?? id;

  const submit = async () => {
    if (!draft) return;
    const body = { ...draft, keyColumn: draft.op === "update" ? draft.keyColumn : undefined, amountField: draft.amountField || undefined };
    const ok = await save.run(() => api(API.admin.actions, { method: draft.id ? "PATCH" : "POST", json: body }));
    if (ok) { setNotice(C.saved(draft.name)); setDraft(null); reload(); }
  };
  const remove = async (a: ActionTemplate) => {
    if (!window.confirm(C.confirmDelete(a.name))) return;
    const ok = await del.run(() => api(API.admin.action(a.id), { method: "DELETE" }));
    if (ok) { setNotice(C.deleted(a.name)); reload(); }
  };

  const edit = (a: ActionTemplate) => { save.setError(null); setDraft({ ...a }); };
  const cols: Col<ActionTemplate>[] = [
    { key: "action", header: C.th.action, kind: "wide", cell: (a) => <Stack gap="none"><Text strong truncate>{a.name}</Text>{a.description && <Label truncate>{a.description}</Label>}</Stack>, text: (a) => `${a.name}\n${a.description}` },
    { key: "target", header: C.th.target, kind: "title", cell: (a) => <Text mono truncate>{C.target(connName(a.connectionId), a.object)}</Text>, text: (a) => C.target(connName(a.connectionId), a.object) },
    { key: "op", header: C.th.op, kind: "text", cell: (a) => (a.op === "insert" ? C.insert : C.updateOne(a.keyColumn)) },
    { key: "risk", header: C.th.risk, kind: "code", cell: (a) => (a.risk === "high" ? <Badge tone="warn">{C.high}</Badge> : <Badge>{C.low}</Badge>) },
    { key: "owner", header: C.th.owner, kind: "text", cell: (a) => a.owner, text: (a) => a.owner },
    { key: "ref", header: C.th.ref, kind: "code", cell: (a) => a.receiptPrefix },
    { key: "actions", header: <span className="ap-sr">{ADMIN_COMMON.deleteSr}</span>, kind: "icon", cell: (a) => <Button tone="ghost" icon={<ITrash size={14} />} aria-label={ADMIN_COMMON.deleteNamed(a.name)} onClick={() => remove(a)} /> },
  ];
  return (
    <>
      <Stack gap="l">
        <Row align="between" wrap={false}>
          <Stack gap="s"><Title level={1}>{C.title}</Title><Text tone="muted">{C.sub}</Text></Stack>
          <Button tone="primary" icon={<IPlus size={14} />} onClick={() => { save.setError(null); setDraft({ ...BLANK }); }}>{C.add}</Button>
        </Row>
        <Reveal>{notice && <Notice tone="good" onClose={() => setNotice(null)}>{notice}</Notice>}</Reveal>
        <Reveal>{del.error && <Notice tone="bad" onClose={() => del.setError(null)}>{del.error}</Notice>}</Reveal>
        <ListState loading={loading} error={error} onRetry={reload} empty={!data?.actions.length} emptyText={C.empty}>
          <Table rows={data?.actions ?? []} cols={cols} rowKey={(a) => a.id} label={C.title} onRow={edit} />
        </ListState>
      </Stack>

      <Sheet open={!!draft} title={draft?.id ? draft.name : C.newTitle} sub={C.sheetSub} onClose={() => setDraft(null)}
        footer={<SaveBar busy={save.busy} error={save.error} onSave={submit} onCancel={() => setDraft(null)} />}>
        {draft && (
          <Stack gap="m">
            <Field label={C.name}><TextInput value={draft.name} onChange={(v) => set({ name: v })} placeholder={C.namePh} maxLength={ACTION_FIELD_MAX.name} /></Field>
            <Field label={C.description} hint={C.descriptionHint}><TextArea value={draft.description} onChange={(v) => set({ description: v })} rows={ACTION_DESCRIPTION_ROWS} /></Field>
            <Grid cols={2}>
              <Field label={C.connection}>
                <Select value={draft.connectionId || null} label={C.connection} options={(conns.data?.connections ?? []).map((c) => ({ value: c.id, label: C.connectionOption(c.code, c.name), hint: c.hasWrite ? C.hasWrite : C.noWrite }))} onChange={(v) => set({ connectionId: v, object: "", fields: [] })} />
                {conns.error && <Label>{conns.error}</Label>}
              </Field>
              <Field label={C.object}>
                <Select value={draft.object || null} label={C.object} placeholder={draft.connectionId ? C.pickObject : C.pickConnectionFirst} options={(cat.data?.objects ?? []).map((o) => ({ value: o.name, label: o.label || o.name, hint: o.name }))} onChange={(v) => set({ object: v, fields: [] })} />
                <Reveal>{cat.error && <Label>{cat.error}</Label>}</Reveal>
              </Field>
            </Grid>
            <Grid cols={2}>
              <Field label={C.op}><Segmented value={draft.op} label={C.op} options={[{ value: "insert", label: C.insert }, { value: "update", label: C.updateOneShort }]} onChange={(v) => set({ op: v, object: "", fields: [] })} /></Field>
              <Reveal>{draft.op === "update" && <Field label={C.keyColumn}><Select value={draft.keyColumn ?? null} label={C.keyColumn} options={colOpts} onChange={(v) => set({ keyColumn: v })} /></Field>}</Reveal>
            </Grid>

            <Stack gap="s"><Divider />
              <Row gap="s" wrap={false}><Title level={3}>{C.fields}</Title><Badge>{draft.fields.length}</Badge></Row>
              <Label>{C.fieldsHint}{C.placeholders.join(C.placeholderSep)}{C.placeholderEnd}</Label>
              <AnimatePresence initial={false}>
              {draft.fields.map((f, i) => (
                <RevealRow key={fieldKeys.keys[i]}>
                <Stack gap="s">
                  {i > 0 && <Divider />}
                  <Row gap="s" wrap={false}>
                    <Grow><Select value={f.column || null} label={C.column} placeholder={C.column} options={colOpts} onChange={(v) => setField(i, { column: v, label: f.label || (obj?.columns.find((c) => c.name === v)?.label ?? v) })} /></Grow>
                    <Grow><TextInput value={f.label} placeholder={C.label} onChange={(v) => setField(i, { label: v })} /></Grow>
                    <Button tone="ghost" icon={<ITrash size={14} />} aria-label={C.deleteField} onClick={() => { fieldKeys.removeAt(i); setField(i, null); }}>{C.delete}</Button>
                  </Row>
                  <Row gap="s" wrap={false}>
                    <Segmented value={f.kind} label={C.fieldKind} options={KIND_OPTS} onChange={(v) => setField(i, { kind: v })} />
                    <Switch checked={f.required} label={C.required} onChange={(v) => setField(i, { required: v })} />
                    <Grow><TextInput mono value={f.fixed === undefined ? "" : String(f.fixed)} placeholder={C.fixed} onChange={(v) => setField(i, { fixed: v === "" ? undefined : v })} /></Grow>
                  </Row>
                  <Reveal>{f.kind === "choice" && <TextInput value={(f.options ?? []).join(C.choicesJoin)} placeholder={C.choices} onChange={(v) => setField(i, { options: v.split(C.choicesSplit).map((s) => s.trim()).filter(Boolean) })} />}</Reveal>
                </Stack>
                </RevealRow>
              ))}
              </AnimatePresence>
              <Button icon={<IPlus size={14} />} tone="secondary" disabled={!obj} onClick={() => setDraft((d) => d && { ...d, fields: [...d.fields, { column: "", label: "", kind: "text", required: true }] })}>{C.addField}</Button>
            </Stack>

            <Grid cols={2}>
              <Field label={C.amountField} hint={C.amountFieldHint}>
                <Select value={draft.amountField ?? null} label={C.amountFieldLabel} placeholder={C.noAmount} options={draft.fields.filter((f) => f.kind === "number" && f.column).map((f) => ({ value: f.column, label: f.label || f.column }))} onChange={(v) => set({ amountField: v })} />
              </Field>
              <Field label={C.risk}><Segmented value={draft.risk} label={C.risk} options={[{ value: "low", label: C.low }, { value: "high", label: C.high }]} onChange={(v) => set({ risk: v })} /></Field>
            </Grid>
            <Grid cols={2}>
              <Field label={C.owner} hint={C.ownerHint}><TextInput value={draft.owner} onChange={(v) => set({ owner: v })} placeholder={C.ownerPh} /></Field>
              <Field label={C.prefix} hint={C.prefixHint(ACTION_PREFIX_MIN, ACTION_FIELD_MAX.prefix)}><TextInput mono value={draft.receiptPrefix} onChange={(v) => set({ receiptPrefix: v.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder={C.prefixPh} maxLength={ACTION_FIELD_MAX.prefix} /></Field>
            </Grid>
          </Stack>
        )}
      </Sheet>
    </>
  );
}
