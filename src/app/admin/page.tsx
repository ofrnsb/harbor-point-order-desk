"use client";
import type { AdminOverview } from "@/platform/api-types";
import { IArrowRight, ICheck } from "@/components/icons";
import { agoId, num } from "@/components/sp/client";
import { moneyText } from "@/lib/values";
import { Badge, Figure, Grid, Grow, Label, List, ListState, Meter, Row, Section, Split, Stack, Text, Title, useApi, type Tone } from "@/components/ui";
import { Steps } from "@/components/ui/steps";
import type { ReactNode } from "react";
import { ADMIN_COMMON, OVERVIEW } from "@/copy/app-admin";
import { AUDIT_HASH_CHARS } from "@/config/app";
import { PAGES } from "@/config/routes";
import { API } from "@/config/routes";

const TILES: { key: keyof AdminOverview["counts"]; href: string }[] = [
  { key: "pendingApprovals", href: PAGES.admin.audit },
  { key: "units", href: PAGES.admin.org },
  { key: "users", href: PAGES.admin.users },
  { key: "connections", href: PAGES.admin.connections },
  { key: "objects", href: PAGES.admin.catalog },
  { key: "restrictedColumns", href: PAGES.admin.catalog },
  { key: "actions", href: PAGES.admin.actions },
  { key: "routes", href: PAGES.admin.models },
];

export default function Overview() {
  const { data, error, loading, reload } = useApi<AdminOverview>(API.admin.overview);
  const a = data?.attention;
  const items: { key: string; tone: Tone; n: number | null; title: string; line?: string; href: string }[] = !a ? [] : [
    ...(a.approvals.count ? [{ key: "approvals", tone: "warn" as Tone, n: a.approvals.count, title: OVERVIEW.attention.approvals(a.approvals.count), line: a.approvals.oldestAt ? OVERVIEW.attention.approvalsLine(agoId(a.approvals.oldestAt)) : "", href: PAGES.admin.audit }] : []),
    ...a.failing.map((f) => ({ key: `fail:${f.connectionId}`, tone: "bad" as Tone, n: null, title: OVERVIEW.attention.failing(f.code), line: f.note, href: PAGES.admin.connections })),
  ];
  return (
    <Stack gap="l">
      <Stack gap="s"><Title level={1}>{OVERVIEW.title}</Title><Text tone="muted">{OVERVIEW.sub}</Text></Stack>
      <ListState loading={loading} error={error} onRetry={reload} empty={!data} emptyText={OVERVIEW.empty}>
        {data && (
          <>
            <Onboarding counts={data.counts} />
            <Split ratio="3:2">
              <Section title={OVERVIEW.attentionTitle} flush>
                <List size="m" items={items} rowKey={(it) => it.key} href={(it) => it.href} empty={<Row gap="s" wrap={false}><ICheck size={16} /><Text tone="good">{OVERVIEW.attentionNone}</Text></Row>}
                  render={(it) => (
                    <Row gap="m" wrap={false}>
                      <Badge tone={it.tone}>{it.n ?? "!"}</Badge>
                      <Grow><Stack gap="none"><Text strong truncate>{it.title}</Text>{it.line && <Label truncate>{it.line}</Label>}</Stack></Grow>
                      <Row gap="s" wrap={false}><Text size="s" tone="accent">{OVERVIEW.attention.open}</Text><IArrowRight size={14} /></Row>
                    </Row>
                  )} />
              </Section>
              <Stack gap="m">
                <Section>
                  <Figure label={OVERVIEW.spend} value={moneyText(data.spendThisMonth)} sub={data.budgetMonthly ? OVERVIEW.budgetOf(moneyText(data.budgetMonthly)) : OVERVIEW.noBudget} />
                  {data.budgetMonthly ? <Meter value={data.spendThisMonth} max={data.budgetMonthly} tone={data.spendThisMonth > data.budgetMonthly * 0.8 ? "warn" : "info"} label={OVERVIEW.spend} /> : null}
                </Section>
                <Section>
                  <Figure label={OVERVIEW.auditChain} tone={data.audit.ok ? "good" : "bad"}
                    value={data.audit.ok ? OVERVIEW.auditIntactShort : OVERVIEW.auditBroken(num(data.audit.brokenAt ?? 0))}
                    sub={data.auditHead ? `${OVERVIEW.auditChecked(num(data.audit.checked))} · #${num(data.auditHead.seq)} ${data.auditHead.hash.slice(0, AUDIT_HASH_CHARS)}` : OVERVIEW.auditNone} />
                </Section>
              </Stack>
            </Split>
            <Section title={OVERVIEW.setupTitle}>
              <Grid cols={2}>
                <Pairs rows={TILES.filter((t) => t.key !== "pendingApprovals").map((t) => [<a key={t.key} href={t.href} className="sp-ov-link">{OVERVIEW.tiles[t.key]}</a>, <span key={`${t.key}-n`} className="ap-num">{num(data.counts[t.key])}</span>])} />
                <Pairs rows={[
                  [OVERVIEW.restrictedOut, data.tenant.restrictedRouting === "local_model" ? OVERVIEW.restrictedLocal : OVERVIEW.restrictedMasked],
                  [OVERVIEW.levels, data.tenant.levels.join(OVERVIEW.levelSep)],
                  [OVERVIEW.tzCurrency, `${data.tenant.timezone} · ${data.tenant.currency}`],
                  [OVERVIEW.minGroup, OVERVIEW.rows(data.tenant.minGroupSize)],
                ]} />
              </Grid>
            </Section>
          </>
        )}
      </ListState>
    </Stack>
  );
}

function Pairs({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return <List items={rows} rowKey={(_, i) => String(i)} size="m" render={([k, v]) => <Row align="between" wrap={false}><Label>{k}</Label><Text>{v}</Text></Row>} />;
}

/** First steps for a new installation. */
function Onboarding({ counts }: { counts: AdminOverview["counts"] }) {
  const steps = [
    { done: counts.connections > 0, href: PAGES.admin.connections, ...OVERVIEW.steps.connections },
    { done: counts.objects > 0, href: PAGES.admin.catalog, ...OVERVIEW.steps.catalog },
    { done: counts.units > 1, href: PAGES.admin.org, ...OVERVIEW.steps.units },
    { done: counts.routes > 0, href: PAGES.admin.models, ...OVERVIEW.steps.model },
    { done: counts.users > 1, href: PAGES.admin.users, ...OVERVIEW.steps.users },
  ];
  if (steps.every((s) => s.done)) return null;
  return <Steps label={OVERVIEW.onboardLabel} items={steps.map((s) => ({ href: s.href, title: s.title, text: s.done ? ADMIN_COMMON.done : s.line, done: s.done }))} />;
}
