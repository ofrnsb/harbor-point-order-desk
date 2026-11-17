"use client";
import { useMemo, useState } from "react";
import type { UnitsResponse, UserRow, UsersResponse } from "@/platform/api-types";
import type { Attr, PlatformRole, Role } from "@/platform/contract";
import { ROLES } from "@/platform/contract";
import { IPlus, ITrash } from "@/components/icons";
import { api, PLATFORM_ROLE_LABEL, ROLE_LABEL } from "@/components/sp/client";
import { Badge, badges, Button, Divider, Empty, Field, Filter, Grow, Label, ListState, MultiPick, Notice, Reveal, Row, SaveBar, Segmented, Select, Sheet, Stack, Switch, Table, Text, TextArea, TextInput, Title, useApi, useMutation, type Col } from "@/components/ui";
import { ADMIN_COMMON, USERS as C } from "@/copy/app-admin";
import { ATTR_FORMAT, PASSWORD_MIN, USER_ATTR_ROWS, USER_FIELD_MAX } from "@/config/app";
import { API } from "@/config/routes";

const PLATFORM: { value: PlatformRole; label: string }[] = [
  { value: "company_admin", label: PLATFORM_ROLE_LABEL.company_admin },
  { value: "security_admin", label: PLATFORM_ROLE_LABEL.security_admin },
];
type Draft = { id: string | null; email: string; name: string; title: string; attributes: string; platformRoles: PlatformRole[]; active: boolean; password: string };
const attrsToText = (a: Record<string, Attr>) => Object.entries(a).map(([k, v]) => `${k}${ATTR_FORMAT.pair}${Array.isArray(v) ? v.join(ATTR_FORMAT.list) : v}`).join(ATTR_FORMAT.line);
function textToAttrs(t: string): Record<string, Attr> {
  const out: Record<string, Attr> = {};
  for (const line of t.split(ATTR_FORMAT.line)) {
    const [k, ...rest] = line.split(ATTR_FORMAT.pair);
    const key = k?.trim();
    if (!key) continue;
    const v = rest.join(ATTR_FORMAT.pair).trim();
    out[key] = v.includes(ATTR_FORMAT.list) ? v.split(ATTR_FORMAT.list).map((s) => s.trim()).filter(Boolean) : v;
  }
  return out;
}

export default function Users() {
  const { data, error, loading, reload } = useApi<UsersResponse>(API.admin.users);
  const units = useApi<UnitsResponse>(API.admin.units);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [member, setMember] = useState<{ unitId: string | null; role: Role }>({ unitId: null, role: "operator" });
  const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation();
  const mem = useMutation();

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => !t || `${u.name} ${u.email} ${u.title} ${u.memberships.map((m) => m.unitName).join(" ")}`.toLowerCase().includes(t));
  }, [data, q]);
  const current: UserRow | null = draft?.id ? data?.users.find((u) => u.id === draft.id) ?? null : null;

  const open = (u: UserRow | null) => {
    save.setError(null); mem.setError(null);
    setMember({ unitId: null, role: "operator" });
    setDraft(u ? { id: u.id, email: u.email, name: u.name, title: u.title, attributes: attrsToText(u.attributes), platformRoles: u.platformRoles, active: u.active, password: "" }
      : { id: null, email: "", name: "", title: "", attributes: "", platformRoles: [], active: true, password: "" });
  };
  const submit = async () => {
    if (!draft) return;
    const payload = { name: draft.name.trim(), title: draft.title.trim(), attributes: textToAttrs(draft.attributes), platformRoles: draft.platformRoles, ...(draft.password ? { password: draft.password } : {}) };
    const ok = await save.run(() => draft.id
      ? api(API.admin.users, { method: "PATCH", json: { id: draft.id, ...payload, active: draft.active } })
      : api(API.admin.users, { method: "POST", json: { email: draft.email.trim(), ...payload } }));
    if (ok) { setNotice(draft.id ? C.updated(draft.name) : C.added(draft.name)); if (draft.id) setDraft(null); else setDraft(null); reload(); }
  };
  const setRole = async (userId: string, unitId: string, role: Role | null) => {
    const ok = await mem.run(() => api(API.admin.memberships, { method: "POST", json: { userId, unitId, role } }));
    if (ok) reload();
  };

  const cols: Col<UserRow>[] = [
    { key: "name", header: C.th.name, kind: "title", cell: (u) => <Stack gap="none"><Text strong truncate>{u.name}</Text><Label truncate>{u.email}</Label></Stack>, text: (u) => `${u.name} · ${u.email}` },
    { key: "title", header: C.th.title, kind: "text", cell: (u) => u.title, text: (u) => u.title },
    { key: "units", header: C.th.units, kind: "wide", cell: (u) => badges(u.memberships.map((m) => C.membership(m.unitName, ROLE_LABEL[m.role])), { empty: C.noUnit }) },
    { key: "platform", header: C.th.platform, kind: "status", cell: (u) => badges(u.platformRoles.map((r) => PLATFORM_ROLE_LABEL[r]), { tone: "info" }) },
    { key: "status", header: C.th.status, kind: "num", cell: (u) => (u.active ? <Badge tone="good">{ADMIN_COMMON.active}</Badge> : <Badge>{ADMIN_COMMON.inactive}</Badge>) },
  ];
  return (
    <>
      <Stack gap="l">
        <Row align="between" wrap={false}>
          <Stack gap="s"><Title level={1}>{C.title}</Title><Text tone="muted">{C.sub}</Text></Stack>
          <Button tone="primary" icon={<IPlus size={14} />} onClick={() => open(null)}>{C.add}</Button>
        </Row>
        <Row gap="s"><Filter value={q} onChange={setQ} placeholder={C.filter} label={C.filterLabel} /></Row>
        <Reveal>{notice && <Notice tone="good" onClose={() => setNotice(null)}>{notice}</Notice>}</Reveal>
        <ListState loading={loading} error={error} onRetry={reload} empty={rows.length === 0} emptyText={C.empty} filtered={!!q} filterText={C.noMatch(q)} onClearFilter={() => setQ("")}>
          <Table rows={rows} cols={cols} rowKey={(u) => u.id} label={C.title} onRow={open} />
        </ListState>
      </Stack>

      <Sheet open={!!draft} title={draft?.id ? draft.name : C.newTitle} sub={draft?.id ? draft.email : C.newSub} onClose={() => setDraft(null)}
        footer={<SaveBar busy={save.busy} error={save.error} onSave={submit} onCancel={() => setDraft(null)} label={draft?.id ? C.save : C.create} />}>
        {draft && (
          <Stack gap="m">
            {!draft.id && <Field label={C.email}><TextInput type="email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} placeholder={C.emailPh} /></Field>}
            <Field label={C.name}><TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} maxLength={USER_FIELD_MAX.name} /></Field>
            <Field label={C.jobTitle}><TextInput value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} maxLength={USER_FIELD_MAX.title} /></Field>
            <Field label={draft.id ? C.newPassword : C.password} hint={draft.id ? C.newPasswordHint : C.passwordHint(PASSWORD_MIN)}><TextInput type="password" autoComplete="new-password" value={draft.password} onChange={(v) => setDraft({ ...draft, password: v })} /></Field>
            <Field label={C.attributes} hint={C.attributesHint}>
              <TextArea mono rows={USER_ATTR_ROWS} value={draft.attributes} onChange={(v) => setDraft({ ...draft, attributes: v })} />
            </Field>
            <Field label={C.platform}><MultiPick values={draft.platformRoles} options={PLATFORM} label={C.platform} onChange={(v) => setDraft({ ...draft, platformRoles: v })} /></Field>
            {draft.id && <Switch checked={draft.active} label={C.accountActive} onChange={(v) => setDraft({ ...draft, active: v })} />}

            {current && (
              <Stack gap="s"><Divider />
                <Title level={3}>{C.unitsRoles}</Title>
                <Reveal>{mem.error && <Notice tone="bad" onClose={() => mem.setError(null)}>{mem.error}</Notice>}</Reveal>
                {current.memberships.length === 0 && <Empty>{C.noUnitYet}</Empty>}
                {current.memberships.map((m) => (
                  <Row key={m.unitId} gap="s" wrap={false}>
                    <Grow><Text strong truncate>{m.unitName}</Text></Grow>
                    <Segmented value={m.role} label={C.roleIn(m.unitName)} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} onChange={(r) => setRole(current.id, m.unitId, r)} />
                    <Button icon={<ITrash size={14} />} tone="ghost" aria-label={C.removeFrom(m.unitName)} onClick={() => setRole(current.id, m.unitId, null)} />
                  </Row>
                ))}
                <Row gap="s" wrap={false}>
                  <Grow><Select value={member.unitId} placeholder={C.pickUnit} label={C.unit} onChange={(v) => setMember((x) => ({ ...x, unitId: v }))}
                    options={(units.data?.units ?? []).filter((u) => !current.memberships.some((m) => m.unitId === u.id)).map((u) => ({ value: u.id, label: `${C.treeIndent.repeat(u.depth)}${u.name}`, hint: u.levelName }))} /></Grow>
                  <Segmented value={member.role} label={C.newRole} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} onChange={(r) => setMember((x) => ({ ...x, role: r }))} />
                  <Button icon={<IPlus size={14} />} tone="secondary" disabled={!member.unitId || mem.busy} onClick={() => member.unitId && setRole(current.id, member.unitId, member.role)}>{C.addMember}</Button>
                </Row>
              </Stack>
            )}
          </Stack>
        )}
      </Sheet>
    </>
  );
}
