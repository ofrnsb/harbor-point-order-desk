"use client";
import { useEffect, useMemo, useState } from "react";
import type { CatalogPatch, CatalogResponse, ConnectionsResponse } from "@/platform/api-types";
import type { CatalogObject, Sensitivity } from "@/platform/contract";
import { SENSITIVITIES, type CatalogColumn } from "@/platform/contract";
import { ChoiceGroup } from "@/components/ui/choice";
import { api, num, SENS_LABEL } from "@/components/sp/client";
import { useAdminMe } from "@/components/sp/admin/AdminShell";
import { Badge, Button, Filter, Label, List, ListState, Notice, Reveal, Row, Section, Segmented, Select, SENS_TONE, Stack, Switch, Table, Text, Title, useApi, type Col } from "@/components/ui";
import { InlineInput } from "@/components/sp/admin/kit";
import { CATALOG as C } from "@/copy/app-admin";
import { CATALOG_LABEL_MAX } from "@/config/app";
import { API } from "@/config/routes";

type SensFilter = Sensitivity | "all";


/** What the platform learned about a column from its data, each with the correction that removes it. */
type Fix = { encoding?: null; clearDecode?: boolean; clearLink?: boolean; minorUnits?: number | null };
function learned(c: CatalogColumn): { key: string; text: string; clear: Fix; confirm?: Fix }[] {
  return [
    ...(c.minorUnits ? [{ key: "unit", text: C.learned.unit(c.minorUnits), clear: { minorUnits: null } }]
      : c.unitHint ? [{ key: "unit", text: C.learned.unitHint(c.unitHint), clear: { minorUnits: null }, confirm: { minorUnits: c.unitHint } }] : []),
    ...(c.encoding ? [{ key: "enc", text: C.learned.encoding[c.encoding] ?? c.encoding, clear: { encoding: null } }] : []),
    ...(c.decode ? [{ key: "dec", text: C.learned.decode(c.decode.object, c.decode.meanings.slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", "), c.decode.meanings.length), clear: { clearDecode: true } }] : []),
    ...(c.link ? [{ key: "link", text: C.learned.link(`${c.link.object}.${c.link.column}`, Math.round(c.link.overlap * 100)), clear: { clearLink: true } }] : []),
  ];
}

export default function Catalog() {
  const conns = useApi<ConnectionsResponse>(API.admin.connections);
  const [connId, setConnId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // The data map links here with ?c=<connection>&o=<object>: that connection is shown with the object selected.
  useEffect(() => {
    if (connId || !conns.data?.connections[0]) return;
    const sp = new URLSearchParams(window.location.search);
    const want = sp.get("c");
    setConnId(conns.data.connections.some((c) => c.id === want) ? want : conns.data.connections[0].id);
    setSelected(sp.get("o"));
  }, [conns.data, connId]);
  const cat = useApi<CatalogResponse>(connId ? API.admin.catalog(connId) : null);
  const [q, setQ] = useState("");
  const [sens, setSens] = useState<SensFilter>("all");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const canWrite = !!useAdminMe()?.user.platformRoles.includes("security_admin");

  const patch = async (p: CatalogPatch, key: string) => {
    setSaving(key);
    setErr(null);
    try {
      const r = await api<{ object: CatalogObject }>(API.admin.catalogEdit, { method: "PATCH", json: p });
      cat.setData((d) => d && { ...d, objects: d.objects.map((o) => (o.name === r.object.name ? r.object : o)) });
    } catch (e) { setErr(e instanceof Error ? e.message : C.saveFailed); }
    finally { setSaving(null); }
  };

  const objects = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (cat.data?.objects ?? []).filter((o) => (!t || `${o.name} ${o.label} ${o.columns.map((c) => `${c.name} ${c.label}`).join(" ")}`.toLowerCase().includes(t))
      && (sens === "all" || o.columns.some((c) => c.sensitivity === sens)));
  }, [cat.data, q, sens]);
  const obj = objects.find((o) => o.name === selected) ?? null;
  const columns = useMemo(() => (obj?.columns ?? []).filter((c) => sens === "all" || c.sensitivity === sens), [obj, sens]);
  const totals = useMemo(() => {
    const all = (cat.data?.objects ?? []).flatMap((o) => o.columns);
    return { cols: all.length, restricted: all.filter((c) => c.sensitivity === "restricted").length, auto: all.filter((c) => c.sensitivitySource === "auto").length };
  }, [cat.data]);
  const changes = (o: CatalogObject) => (o.changed ? o.changed.renamed.length + o.changed.added.length + o.changed.removed.length + o.changed.retyped.length : 0);
  const notes = (o: CatalogObject) => [o.unionOf ? C.learned.family(o.unionOf.length) : null, o.history ? C.learned.history : null, o.codeTable ? C.learned.codeTable : null, changes(o) ? C.learned.changed(o.changed!) : null].filter((x): x is string => !!x);

  const objCols: Col<CatalogObject>[] = [
    { key: "object", header: C.th.object, kind: "wide", cell: (o) => <Stack gap="none"><Text strong truncate>{o.label || o.name}</Text><Label truncate>{o.name}</Label></Stack>, text: (o) => `${o.label} · ${o.name}` },
    { key: "kind", header: C.th.kind, kind: "code", cell: (o) => (o.kind === "collection" ? C.kind.collection : o.kind === "view" ? C.kind.view : C.kind.table) },
    { key: "rows", header: C.th.rows, kind: "num", cell: (o) => num(o.rowEstimate) },
    { key: "columns", header: C.th.columns, kind: "num", cell: (o) => num(o.columns.length) },
    { key: "notes", header: C.th.notes, kind: "title", cell: (o) => { const n = notes(o); return n.length ? <Badge tone={changes(o) ? "warn" : "neutral"}>{n[0]}</Badge> : ""; }, text: (o) => notes(o).join("\n") },
    { key: "exposed", header: C.th.exposed, kind: "badge", cell: (o) => <Switch checked={o.exposed} label={o.exposed ? C.open : C.hidden} disabled={!canWrite || saving === o.name} onChange={(v) => patch({ connectionId: o.connectionId, object: o.name, exposed: v }, o.name)} /> },
  ];
  const colCols: Col<CatalogColumn>[] = obj ? [
    { key: "name", header: C.th.column, kind: "title", cell: (c) => <Stack gap="none"><Text strong truncate mono>{c.name}</Text><Label truncate>{[c.pk ? C.pk : "", c.fk ? C.fk(c.fk.object).trim() : "", ...learned(c).map((n) => n.text)].filter(Boolean).join(" · ")}</Label></Stack>, text: (c) => [c.name, ...learned(c).map((n) => n.text)].join("\n") },
    { key: "type", header: C.th.type, kind: "code", cell: (c) => c.nativeType },
    { key: "label", header: C.th.label, kind: "text", cell: (c) => <InlineInput value={c.label} label={C.columnLabelOf(c.name)} disabled={!canWrite} maxLength={CATALOG_LABEL_MAX} onSave={(v) => patch({ connectionId: obj.connectionId, object: obj.name, column: { name: c.name, label: v } }, `${obj.name}.${c.name}`)} /> },
    { key: "sens", header: C.th.sens, kind: "wide", cell: (c) => (
      <ChoiceGroup value={c.sensitivity} label={C.sensOf(c.name)} options={SENSITIVITIES.map((s) => ({ value: s, label: SENS_LABEL[s], tone: SENS_TONE[s] }))}
        suggested={c.sensitivitySource === "auto"} selectedTitle={c.sensitivitySource === "auto" ? C.autoTitle : C.adminTitle}
        disabled={!canWrite || saving === `${obj.name}.${c.name}`} onChange={(s) => patch({ connectionId: obj.connectionId, object: obj.name, column: { name: c.name, sensitivity: s } }, `${obj.name}.${c.name}`)} />
    ) },
  ] : [];

  return (
    <Stack gap="l">
      <Stack gap="s"><Title level={1}>{C.title}</Title><Text tone="muted">{C.sub}</Text></Stack>
      <Row gap="s">
        {conns.data && conns.data.connections.length > 0 && (
          <Select value={connId} label={C.connection} options={conns.data.connections.map((c) => ({ value: c.id, label: C.connectionOption(c.code, c.name), hint: C.objects(num(c.objects)) }))} onChange={(v) => { setConnId(v); setSelected(null); }} />
        )}
        <Filter value={q} onChange={setQ} placeholder={C.filter} label={C.filterLabel} />
        <Segmented value={sens} label={C.sensFilter} options={[{ value: "all", label: C.all }, ...SENSITIVITIES.map((s) => ({ value: s, label: SENS_LABEL[s] }))]} onChange={setSens} />
      </Row>
      {cat.data && <Text size="s" tone="muted">{C.summary(num(cat.data.objects.length), num(totals.cols), num(totals.restricted), num(totals.auto))}{canWrite ? "" : ` ${C.readOnly}`}</Text>}
      <Reveal>{err && <Notice tone="bad" onClose={() => setErr(null)}>{err}</Notice>}</Reveal>
      <ListState loading={conns.loading || cat.loading} error={conns.error ?? cat.error} onRetry={() => { conns.reload(); cat.reload(); }}
        empty={objects.length === 0} emptyText={conns.data?.connections.length === 0 ? C.noConnections : C.empty}
        filtered={!!q.trim() || sens !== "all"} filterText={C.noMatch} onClearFilter={() => { setQ(""); setSens("all"); }}>
        <Table rows={objects} cols={objCols} rowKey={(o) => o.name} label={C.title} selected={selected} onRow={(o) => setSelected((s) => (s === o.name ? null : o.name))} />
      </ListState>
      {obj && (
        <Section flush title={obj.label || obj.name} note={[C.objectMeta(obj.name, obj.kind === "collection" ? C.kind.collection : obj.kind === "view" ? C.kind.view : C.kind.table, num(obj.rowEstimate)), ...notes(obj)].join(" · ")}
          actions={<><Label>{C.objectLabel}</Label><InlineInput value={obj.label} label={C.labelOf(obj.name)} placeholder={C.labelPh} disabled={!canWrite} maxLength={CATALOG_LABEL_MAX} onSave={(v) => patch({ connectionId: obj.connectionId, object: obj.name, label: v }, obj.name)} /></>}>
          {canWrite && obj.changed?.renamed.filter(([from]) => obj.changed!.was?.some((w) => w.name === from)).map(([from, to]) => (
            <Row key={`${from}>${to}`} gap="s">
              <Text>{C.learned.renameAsk(from, to)}</Text>
              <Button tone="ghost" disabled={saving === obj.name} onClick={() => patch({ connectionId: obj.connectionId, object: obj.name, rename: { from, to, same: true } }, obj.name)}>{C.learned.renameSame}</Button>
              <Button tone="ghost" disabled={saving === obj.name} onClick={() => patch({ connectionId: obj.connectionId, object: obj.name, rename: { from, to, same: false } }, obj.name)}>{C.learned.renameDifferent}</Button>
            </Row>
          ))}
          <Table rows={columns} cols={colCols} rowKey={(c) => c.name} label={C.th.column} empty={C.noMatch}
            expand={(c) => {
              const ns = learned(c);
              return (
                <List size="m" items={ns} rowKey={(n) => n.key} empty={C.learned.none} render={(n) => (
                  <Row gap="s" wrap={false}>
                    <Text truncate>{n.text}{c.semanticsSource === "admin" ? ` · ${C.learned.confirmed}` : ""}</Text>
                    {canWrite && n.confirm && <Button tone="ghost" disabled={saving === `${obj!.name}.${c.name}`} onClick={() => patch({ connectionId: obj!.connectionId, object: obj!.name, column: { name: c.name, ...n.confirm } }, `${obj!.name}.${c.name}`)}>{C.learned.confirm}</Button>}
                    {canWrite && <Button tone="ghost" disabled={saving === `${obj!.name}.${c.name}`} onClick={() => patch({ connectionId: obj!.connectionId, object: obj!.name, column: { name: c.name, ...n.clear } }, `${obj!.name}.${c.name}`)}>{C.learned.wrong}</Button>}
                  </Row>
                )} />
              );
            }} />
        </Section>
      )}
    </Stack>
  );
}
