"use client";
import { Indent } from "@/components/ui/indent";
import { useMemo, useState } from "react";
import type { UnitNode, UnitsResponse } from "@/platform/api-types";
import { IPlus, ITrash } from "@/components/icons";
import { api, num, SENS_LABEL } from "@/components/sp/client";
import { moneyCompact } from "@/lib/values";
import { Badge, Button, Field, Filter, Label, ListState, Notice, Reveal, Row, SaveBar, SENS_TONE, Sheet, Stack, Table, Text, TextInput, Title, useApi, useMutation, type Col } from "@/components/ui";
import { ProfileEditor } from "@/components/sp/admin/ProfileEditor";
import { ADMIN_COMMON, ORG } from "@/copy/app-admin";
import { FIELD_MAX } from "@/config/app";
import { API } from "@/config/routes";

export default function Organisation() {
  const { data, error, loading, reload } = useApi<UnitsResponse>(API.admin.units);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<UnitNode | null>(null);
  const [adding, setAdding] = useState<UnitNode | null>(null);
  const [form, setForm] = useState({ name: "", code: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const add = useMutation();
  const del = useMutation();

  const units = data?.units ?? [];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? units.filter((u) => `${u.name} ${u.code}`.toLowerCase().includes(t)) : units;
  }, [units, q]);

  const create = async () => {
    if (!adding) return;
    const ok = await add.run(() => api(API.admin.units, { method: "POST", json: { parentId: adding.id, name: form.name.trim(), code: form.code.trim().toUpperCase() } }));
    if (ok) { setAdding(null); setNotice(ORG.created(form.name, adding.name)); reload(); }
  };
  const remove = async (u: UnitNode) => {
    if (!window.confirm(ORG.confirmDelete(u.name))) return;
    const ok = await del.run(() => api(API.admin.unit(u.id), { method: "DELETE" }));
    if (ok) { setNotice(ORG.deleted(u.name)); reload(); }
  };

  const cols: Col<UnitNode>[] = [
    { key: "unit", header: ORG.th.unit, kind: "wide", text: (u) => `${u.name} · ${u.code}`, cell: (u) => (
      <Indent depth={q ? 0 : u.depth}><Stack gap="none"><Text strong truncate>{u.name}</Text><Label truncate>{u.code}</Label></Stack></Indent>
    ) },
    { key: "level", header: ORG.th.level, kind: "text", cell: (u) => u.levelName },
    { key: "members", header: ORG.th.members, kind: "num", cell: (u) => num(u.members) },
    { key: "data", header: ORG.th.data, kind: "status", cell: (u) => (u.profile.grants === null ? ADMIN_COMMON.inherit : <Badge>{ORG.connections(u.profile.grants.length)}</Badge>) },
    { key: "clearance", header: ORG.th.clearance, kind: "badge", cell: (u) => (u.profile.clearance ? <Badge tone={SENS_TONE[u.profile.clearance]}>{SENS_LABEL[u.profile.clearance]}</Badge> : ADMIN_COMMON.inherit) },
    { key: "budget", header: ORG.th.budget, kind: "num", cell: (u) => (u.profile.budgetMonthly == null ? ADMIN_COMMON.inherit : moneyCompact(u.profile.budgetMonthly)) },
    { key: "actions", header: <span className="ap-sr">{ADMIN_COMMON.actionsSr}</span>, kind: "actions", cell: (u) => (
      <>
        <Button tone="ghost" icon={<IPlus size={14} />} onClick={() => { setAdding(u); setForm({ name: "", code: "" }); add.setError(null); }}>{ORG.subUnit}</Button>
        {u.parentId && <Button tone="ghost" icon={<ITrash size={14} />} aria-label={ADMIN_COMMON.deleteNamed(u.name)} onClick={() => remove(u)} />}
      </>
    ) },
  ];
  return (
    <>
      <Stack gap="l">
        <Stack gap="s"><Title level={1}>{ORG.title}</Title><Text tone="muted">{ORG.sub}</Text></Stack>
        <Row gap="s"><Filter value={q} onChange={setQ} placeholder={ORG.filter} label={ORG.filterLabel} /></Row>
        <Reveal>{notice && <Notice tone="good" onClose={() => setNotice(null)}>{notice}</Notice>}</Reveal>
        <Reveal>{del.error && <Notice tone="bad" onClose={() => del.setError(null)}>{del.error}</Notice>}</Reveal>
        <ListState loading={loading} error={error} onRetry={reload} empty={shown.length === 0} emptyText={ORG.empty} filtered={!!q} filterText={ORG.noMatch(q)} onClearFilter={() => setQ("")}>
          <Table rows={shown} cols={cols} rowKey={(u) => u.id} label={ORG.title} onRow={(u) => setEditing(u)} />
        </ListState>
      </Stack>

      <ProfileEditor unit={editing} onClose={() => setEditing(null)} onSaved={() => { setNotice(ORG.saved); reload(); }} />

      <Sheet open={!!adding} title={ORG.newTitle} sub={adding ? ORG.under(adding.name) : undefined} onClose={() => setAdding(null)}
        footer={<SaveBar busy={add.busy} error={add.error} onSave={create} onCancel={() => setAdding(null)} label={ORG.create} />}>
        <Stack gap="m">
          <Field label={ORG.name}><TextInput value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder={ORG.namePh} maxLength={FIELD_MAX.name} /></Field>
          <Field label={ORG.code} hint={ORG.codeHint}><TextInput mono value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} placeholder={ORG.codePh} maxLength={FIELD_MAX.unitCode} /></Field>
          <Label>{ORG.inheritNote}</Label>
        </Stack>
      </Sheet>
    </>
  );
}
