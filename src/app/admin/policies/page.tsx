"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { Indent } from "@/components/ui/indent";
import { useEffect, useMemo, useState } from "react";
import type { ConnectionsResponse, UnitNode, UnitsResponse } from "@/platform/api-types";
import type { ColumnMode, Sensitivity, Tenant } from "@/platform/contract";
import { COLUMN_MODES, SENSITIVITIES } from "@/platform/contract";
import { api, MODE_LABEL, SENS_LABEL } from "@/components/sp/client";
import { moneyCompact } from "@/lib/values";
import { useAdminMe } from "@/components/sp/admin/AdminShell";
import { Badge, Button, Field, Filter, Grid, Grow, Label, ListState, Notice, NumberInput, Reveal, Row, Section, Segmented, Select, SENS_TONE, Stack, Table, Text, Title, useApi, useMutation, type Col } from "@/components/ui";
import { ProfileEditor } from "@/components/sp/admin/ProfileEditor";
import { ADMIN_COMMON, POLICIES as C } from "@/copy/app-admin";
import { MIN_GROUP_SIZE } from "@/config/app";
import { API } from "@/config/routes";

export default function Policies() {
  const units = useApi<UnitsResponse>(API.admin.units);
  const conns = useApi<ConnectionsResponse>(API.admin.connections);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<UnitNode | null>(null);
  const [saved, setSaved] = useState(false);

  const columns = conns.data?.connections ?? [];
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (units.data?.units ?? []).filter((u) => !t || `${u.name} ${u.code}`.toLowerCase().includes(t));
  }, [units.data, q]);

  const cell = (u: UnitNode, connectionId: string) => {
    if (u.profile.grants === null) return u.parentId ? ADMIN_COMMON.inherit : C.all;
    const g = u.profile.grants.find((x) => x.connectionId === connectionId);
    if (!g) return <Badge tone="bad">{C.closed}</Badge>;
    if (g.objects === "*") return <Badge tone="good">{C.allObjects}</Badge>;
    const filters = g.objects.reduce((n, o) => n + (o.rowFilters?.length ?? 0), 0);
    const cols = g.objects.reduce((n, o) => n + Object.keys(o.columns ?? {}).length, 0);
    const line = `${filters > 0 ? C.rowFilters(filters) : ""}${filters > 0 && cols > 0 ? C.sep : ""}${cols > 0 ? C.columnsSet(cols) : ""}`;
    return <Stack gap="none"><Text strong truncate>{C.objects(g.objects.length)}</Text>{line && <Label truncate>{line}</Label>}</Stack>;
  };
  const cols: Col<UnitNode>[] = [
    { key: "unit", header: C.th.unit, kind: "title", text: (u) => `${u.name} · ${u.code}`, cell: (u) => (
      <Indent depth={q ? 0 : u.depth}><Stack gap="none"><Text strong truncate>{u.name}</Text><Label truncate>{u.code}</Label></Stack></Indent>
    ) },
    { key: "clearance", header: C.th.clearance, kind: "text", cell: (u) => (u.profile.clearance ? <Badge tone={SENS_TONE[u.profile.clearance]}>{SENS_LABEL[u.profile.clearance]}</Badge> : ADMIN_COMMON.inherit) },
    ...columns.map((c): Col<UnitNode> => ({ key: c.id, header: <span translate="no" title={c.name}>{c.code}</span>, kind: "text", cell: (u) => cell(u, c.id) })),
    { key: "approval", header: C.th.approvalOver, kind: "status", cell: (u) => (u.profile.approvalOver == null ? ADMIN_COMMON.inherit : moneyCompact(u.profile.approvalOver)) },
  ];

  return (
    <>
      <Stack gap="l">
        <Stack gap="s"><Title level={1}>{C.title}</Title><Text tone="muted">{C.sub}</Text></Stack>
        <TenantPolicy />
        <Row gap="s"><Filter value={q} onChange={setQ} placeholder={C.filter} label={C.filter} /></Row>
        <Reveal>{saved && <Notice tone="good" onClose={() => setSaved(false)}>{C.saved}</Notice>}</Reveal>
        <Reveal>{conns.error && <Notice tone="bad" onRetry={conns.reload}>{conns.error}</Notice>}</Reveal>
        <ListState loading={units.loading} error={units.error} onRetry={units.reload} empty={rows.length === 0} emptyText={C.empty} filtered={!!q} onClearFilter={() => setQ("")}>
          <Table rows={rows} cols={cols} rowKey={(u) => u.id} label={C.title} onRow={(u) => setEditing(u)} />
        </ListState>
      </Stack>
      <ProfileEditor unit={editing} initialTab="data" onClose={() => setEditing(null)} onSaved={() => { setSaved(true); units.reload(); }} />
    </>
  );
}

type TenantSettings = Pick<Tenant, "restrictedRouting" | "sensitivityDefaults" | "minGroupSize">;

/** Company-wide defaults: what a column above a unit's clearance becomes, and how restricted data meets external models. */
function TenantPolicy() {
  const { data, error, reload, setData } = useApi<{ tenant: Tenant }>(API.admin.tenant);
  const canEdit = !!useAdminMe()?.user.platformRoles.includes("company_admin");
  const [draft, setDraft] = useState<TenantSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const m = useMutation();
  useEffect(() => {
    if (data) setDraft({ restrictedRouting: data.tenant.restrictedRouting, sensitivityDefaults: { ...data.tenant.sensitivityDefaults }, minGroupSize: data.tenant.minGroupSize });
  }, [data]);
  const dirty = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify({ restrictedRouting: data.tenant.restrictedRouting, sensitivityDefaults: data.tenant.sensitivityDefaults, minGroupSize: data.tenant.minGroupSize });
  const save = async () => {
    if (!draft) return;
    setSaved(false);
    const r = await m.run(() => api<{ tenant: Tenant }>(API.admin.tenant, { method: "PATCH", json: draft }));
    if (r) { setData(r); setSaved(true); }
  };
  if (error) return <Notice tone="bad" onRetry={reload}>{error}</Notice>;
  if (!draft) return <Skeleton rows={1} />;
  return (
    <Section title={C.tenantTitle} note={C.tenantHint}>
      <Grid cols={4}>
        {SENSITIVITIES.map((s) => (
          <Field key={s} label={C.columnOf(SENS_LABEL[s])}>
            {canEdit ? (
              <Select<ColumnMode> value={draft.sensitivityDefaults[s as Sensitivity]} label={C.defaultOf(SENS_LABEL[s])}
                options={COLUMN_MODES.map((mm) => ({ value: mm, label: MODE_LABEL[mm] }))}
                onChange={(v) => { setSaved(false); m.setError(null); setDraft({ ...draft, sensitivityDefaults: { ...draft.sensitivityDefaults, [s]: v } }); }} />
            ) : <span>{MODE_LABEL[draft.sensitivityDefaults[s as Sensitivity]]}</span>}
          </Field>
        ))}
        <Field label={C.restrictedOut}>
          {canEdit ? (
            <Segmented value={draft.restrictedRouting} label={C.restrictedHandling} options={[{ value: "mask", label: C.mask }, { value: "local_model", label: C.toLocal }]}
              onChange={(v) => { setSaved(false); m.setError(null); setDraft({ ...draft, restrictedRouting: v }); }} />
          ) : <span>{draft.restrictedRouting === "local_model" ? C.restrictedLocal : C.restrictedMasked}</span>}
        </Field>
        <Field label={C.minGroup} hint={C.minGroupHint(MIN_GROUP_SIZE.min, MIN_GROUP_SIZE.max)}>
          {canEdit ? <NumberInput value={draft.minGroupSize} onChange={(v) => { setSaved(false); m.setError(null); setDraft({ ...draft, minGroupSize: v ?? MIN_GROUP_SIZE.min }); }} /> : <span className="ap-num">{C.rows(draft.minGroupSize)}</span>}
        </Field>
      </Grid>
      <Reveal>{m.error && <Notice tone="bad" onClose={() => m.setError(null)}>{m.error}</Notice>}</Reveal>
      <Reveal>{saved && !dirty && <Notice tone="good" onClose={() => setSaved(false)}>{C.tenantSaved}</Notice>}</Reveal>
      {canEdit ? (
        dirty && (
          <Row gap="s" wrap={false}>
            <Grow>{null}</Grow>
            <Button tone="ghost" onClick={() => { m.setError(null); setData({ ...data! }); }}>{C.cancel}</Button>
            <Button tone="primary" disabled={m.busy || draft.minGroupSize < MIN_GROUP_SIZE.min || draft.minGroupSize > MIN_GROUP_SIZE.max} onClick={save}>{m.busy ? C.saving : C.saveDefault}</Button>
          </Row>
        )
      ) : <Label>{C.adminOnly}</Label>}
    </Section>
  );
}
