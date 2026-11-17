"use client";
import { useState } from "react";
import type { RoutesResponse, UsageResponse } from "@/platform/api-types";
import type { ModelRoute, Provider } from "@/platform/contract";
import { IPlus, ITrash } from "@/components/icons";
import { api, num } from "@/components/sp/client";
import { moneyCompact } from "@/lib/values";
import { Badge, badges, Button, Field, Grid, Grow, Label, List, ListState, Meter, MultiPick, Notice, NumberInput, Reveal, Row, SaveBar, Section, Segmented, Select, Sheet, Stack, Switch, Table, Text, TextInput, Title, useApi, useMutation, type Col, type Tone } from "@/components/ui";
import { ADMIN_COMMON, MODELS as C } from "@/copy/app-admin";
import { FIELD_MAX_ROUTE, ROUTE_FALLBACKS_MAX, USAGE_DAYS, USAGE_DAYS_DEFAULT, USAGE_TOP_USERS } from "@/config/app";
import { API } from "@/config/routes";

type Draft = Omit<ModelRoute, "tenantId" | "id" | "provider"> & { id?: string; provider: Provider | "" };
const MODELS = C.claude;
const MODEL_LABEL = C.claudeLabel;
const PROVIDER_LABEL: Record<Provider, string> = C.providers;
const PROVIDERS = (Object.keys(PROVIDER_LABEL) as Provider[]).map((value) => ({ value, label: PROVIDER_LABEL[value] }));
const backendOf = (p: Provider) => (p === "claude-login" ? "claude-sdk" as const : p === "codex-login" ? "codex-sdk" as const : "litellm" as const);
const BLANK: Draft = { label: "", provider: "", model: "", backend: "litellm", external: true, fallbacks: [], inputPer1M: 0, outputPer1M: 0, active: true };
const DAYS = USAGE_DAYS.map((value) => ({ value, label: C.days(value) }));
type MeterItem = { key: string; label: string; value: number; max: number; text: string; tone?: Tone; title?: string };
const meterRow = (r: MeterItem) => (
  <Row gap="s" wrap={false}><Grow><Text truncate title={r.title ?? r.label}>{r.label}</Text></Grow><Grow><Meter value={r.value} max={r.max} tone={r.tone} label={r.label} /></Grow><Text size="s" tone="muted">{r.text}</Text></Row>
);

export default function Models() {
  const { data, error, loading, reload } = useApi<RoutesResponse>(API.admin.routes);
  const [days, setDays] = useState<(typeof USAGE_DAYS)[number]>(USAGE_DAYS_DEFAULT);
  const usage = useApi<UsageResponse>(API.admin.usage(days));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation();
  const del = useMutation();
  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const chooseProvider = (provider: Provider) => {
    if (draft?.provider === provider) return;
    set({ provider, backend: backendOf(provider), model: provider === "claude-login" ? "sonnet" : provider === "codex-login" ? "default" : "", external: provider !== "ollama" && provider !== "vllm" });
  };

  const submit = async () => {
    if (!draft) return;
    if (!draft.provider) { save.setError(C.needProvider); return; }
    if (!draft.model.trim()) { save.setError(C.needModel); return; }
    const body = { ...draft, provider: draft.provider, model: draft.model.trim(), backend: backendOf(draft.provider) };
    const ok = await save.run(() => api(API.admin.routes, { method: draft.id ? "PATCH" : "POST", json: body }));
    if (ok) { setNotice(C.saved(draft.label)); setDraft(null); reload(); }
  };
  const remove = async (r: ModelRoute) => {
    if (!window.confirm(C.confirmDelete(r.label))) return;
    const ok = await del.run(() => api(API.admin.route(r.id), { method: "DELETE" }));
    if (ok) { setNotice(C.deleted(r.label)); reload(); }
  };
  const u = usage.data;
  const maxRoute = Math.max(1, ...(u?.byRoute.map((r) => r.cost) ?? [1]));
  const maxUser = Math.max(1, ...(u?.byUser.map((r) => r.cost) ?? [1]));

  const cols: Col<ModelRoute>[] = [
    { key: "route", header: C.th.route, kind: "title", cell: (r) => <Stack gap="none"><Text strong truncate>{r.label}</Text><Label truncate>{C.providerModel(PROVIDER_LABEL[r.provider], r.model)}</Label></Stack>, text: (r) => r.label },
    { key: "model", header: C.th.model, kind: "text", cell: (r) => MODEL_LABEL[r.model] ?? r.model },
    { key: "fallbacks", header: C.th.fallbacks, kind: "title", cell: (r) => badges(r.fallbacks.map((f) => data?.routes.find((x) => x.id === f)?.label ?? f), { empty: ADMIN_COMMON.none }) },
    { key: "price", header: C.th.price, kind: "status", cell: (r) => C.priceInOut(num(r.inputPer1M), num(r.outputPer1M)) },
    { key: "status", header: C.th.status, kind: "code", cell: (r) => (r.active ? <Badge tone="good">{ADMIN_COMMON.active}</Badge> : <Badge>{ADMIN_COMMON.inactive}</Badge>) },
    { key: "actions", header: <span className="ap-sr">{ADMIN_COMMON.deleteSr}</span>, kind: "icon", cell: (r) => <Button tone="ghost" icon={<ITrash size={14} />} aria-label={ADMIN_COMMON.deleteNamed(r.label)} onClick={() => remove(r)} /> },
  ];
  const maxUnit = Math.max(1, ...(u?.byUnit.map((x) => x.cost) ?? [0]));
  return (
    <>
      <Stack gap="l">
        <Row align="between" wrap={false}>
          <Stack gap="s"><Title level={1}>{C.title}</Title><Text tone="muted">{C.sub}</Text></Stack>
          <Button tone="primary" icon={<IPlus size={14} />} onClick={() => { save.setError(null); setDraft({ ...BLANK }); }}>{C.add}</Button>
        </Row>
        <Reveal>{notice && <Notice tone="good" onClose={() => setNotice(null)}>{notice}</Notice>}</Reveal>
        <Reveal>{del.error && <Notice tone="bad" onClose={() => del.setError(null)}>{del.error}</Notice>}</Reveal>
        <ListState loading={loading} error={error} onRetry={reload} empty={!data?.routes.length} emptyText={C.empty}>
          <Table rows={data?.routes ?? []} cols={cols} rowKey={(r) => r.id} label={C.title} onRow={(r) => { save.setError(null); setDraft({ ...r }); }} />
        </ListState>
        <Row gap="s"><Grow><Title level={2}>{C.usage}</Title></Grow><Segmented value={days} label={C.period} options={DAYS} onChange={setDays} /></Row>
        <ListState loading={usage.loading} error={usage.error} onRetry={usage.reload} empty={!u} emptyText={C.noUsage}>
          {u && (
            <Grid cols={3}>
              <Section title={C.byUnit}>
                <List size="m" rowKey={(r) => r.key} render={meterRow} empty={C.noUsagePeriod} items={[...u.byUnit].sort((a, b) => b.cost - a.cost).map((r): MeterItem => ({
                  key: r.unitId, label: r.unitName, value: r.cost,
                  // Against its budget when it has one; otherwise beside the costliest team, in a neutral tone.
                  max: r.limit || maxUnit, tone: r.limit ? (r.cost >= r.limit ? "bad" : r.cost >= r.limit * 0.8 ? "warn" : "good") : "info",
                  text: r.limit ? `${moneyCompact(r.cost)}${C.ofLimit(moneyCompact(r.limit))}` : moneyCompact(r.cost),
                }))} />
              </Section>
              <Section title={C.byRoute}>
                <List size="m" rowKey={(r) => r.key} render={meterRow} items={u.byRoute.map((r): MeterItem => ({ key: r.routeId, label: r.label, value: r.cost, max: maxRoute, text: moneyCompact(r.cost), title: C.routeTip(num(r.inputTokens), num(r.outputTokens), num(r.calls)) }))} />
              </Section>
              <Section title={C.topUsers}>
                <List size="m" rowKey={(r) => r.key} render={meterRow} items={u.byUser.slice(0, USAGE_TOP_USERS).map((r): MeterItem => ({ key: r.userId, label: r.name, value: r.cost, max: maxUser, text: C.userCost(moneyCompact(r.cost), num(r.calls)) }))} />
              </Section>
            </Grid>
          )}
        </ListState>
      </Stack>

      <Sheet open={!!draft} title={draft?.id ? draft.label : C.newTitle} sub={C.sheetSub} onClose={() => setDraft(null)}
        footer={<SaveBar busy={save.busy} error={save.error} onSave={submit} onCancel={() => setDraft(null)} />}>
        {draft && (
          <Stack gap="m">
            <Field label={C.label}><TextInput value={draft.label} onChange={(v) => set({ label: v })} placeholder={C.labelPh} maxLength={FIELD_MAX_ROUTE.label} /></Field>
            <Field label={C.provider} hint={C.providerHint}>
              <Select value={draft.provider || null} options={PROVIDERS} onChange={chooseProvider} label={C.providerLabel} />
            </Field>
            <Reveal swap id={draft.provider === "claude-login" ? "claude" : draft.provider ? "gateway" : "none"}>
              {draft.provider === "claude-login" ? (
                <Field label={C.claudeModel}>
                  <Segmented value={(["sonnet", "opus", "haiku"].includes(draft.model) ? draft.model : "sonnet") as "sonnet" | "opus" | "haiku"} label={C.claudeModel} options={MODELS.map((m) => ({ value: m.value, label: m.label, hint: m.hint }))} onChange={(v) => set({ model: v })} />
                </Field>
              ) : draft.provider ? (
                <Field label={draft.provider === "codex-login" ? C.codexModel : C.litellmModel} hint={draft.provider === "codex-login" ? C.codexHint : C.litellmHint}>
                  <TextInput mono value={draft.model} onChange={(v) => set({ model: v })} placeholder={C.litellmPh} maxLength={FIELD_MAX_ROUTE.model} />
                </Field>
              ) : <Label>{C.pickProvider}</Label>}
            </Reveal>
            <Switch checked={draft.external} label={C.external} onChange={(v) => set({ external: v })} />
            <Field label={C.fallbacks} hint={C.fallbacksHint}>
              <MultiPick values={draft.fallbacks} label={C.fallbacksLabel} options={(data?.routes ?? []).filter((r) => r.id !== draft.id).map((r) => ({ value: r.id, label: r.label }))} onChange={(v) => set({ fallbacks: v.slice(0, ROUTE_FALLBACKS_MAX) })} />
            </Field>
            <Grid cols={2}>
              <Field label={C.priceIn}><NumberInput value={draft.inputPer1M} onChange={(v) => set({ inputPer1M: v ?? 0 })} /></Field>
              <Field label={C.priceOut}><NumberInput value={draft.outputPer1M} onChange={(v) => set({ outputPer1M: v ?? 0 })} /></Field>
            </Grid>
            <Switch checked={draft.active} label={C.activeLabel} onChange={(v) => set({ active: v })} />
          </Stack>
        )}
      </Sheet>
    </>
  );
}
