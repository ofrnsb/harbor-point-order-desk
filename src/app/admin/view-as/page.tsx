"use client";
import { useEffect, useState } from "react";
import type { SimulateResponse, UsersResponse } from "@/platform/api-types";
import { ROLE_LABEL } from "@/components/sp/client";
import { ScopePanel } from "@/components/sp/Workspace";
import { Badge, Grid, Label, List, ListState, Notice, Reveal, Row, Section, Select, Stack, Text, Title, useApi } from "@/components/ui";
import { VIEW_AS as C } from "@/copy/app-admin";
import { API } from "@/config/routes";

const CAN = (["read", "propose", "approve", "administer"] as const satisfies readonly (keyof SimulateResponse["can"])[]).map((key) => ({ key, label: C.can[key] }));

export default function ViewAs() {
  const users = useApi<UsersResponse>(API.admin.users);
  const [userId, setUserId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const user = users.data?.users.find((u) => u.id === userId) ?? null;
  useEffect(() => { setUnitId(user?.memberships[0]?.unitId ?? null); }, [user]);
  const sim = useApi<SimulateResponse>(userId && unitId ? API.admin.simulate(userId, unitId) : null);

  return (
    <Stack gap="l">
      <Stack gap="s"><Title level={1}>{C.title}</Title><Text tone="muted">{C.sub}</Text></Stack>
      <Row gap="s">
        <Select value={userId} label={C.user} placeholder={C.pickUser} options={(users.data?.users ?? []).filter((u) => u.memberships.length).map((u) => ({ value: u.id, label: u.name, hint: u.title }))} onChange={setUserId} />
        {user && <Select value={unitId} label={C.unit} placeholder={C.pickUnit} options={user.memberships.map((m) => ({ value: m.unitId, label: m.unitName, hint: ROLE_LABEL[m.role] }))} onChange={setUnitId} />}
      </Row>
      <Reveal>{users.error && <Notice tone="bad" onRetry={users.reload}>{users.error}</Notice>}</Reveal>
      {!userId ? <Section><Text tone="muted">{C.prompt}</Text></Section> : (
        <ListState loading={sim.loading} error={sim.error} onRetry={sim.reload} empty={!sim.data} emptyText={C.noUnit}>
          {sim.data && (
            <Grid cols={2}>
              <Section title={C.as(sim.data.user.userName, sim.data.user.name)} note={C.path(sim.data.user.path, ROLE_LABEL[sim.data.user.role])}>
                <List size="m" items={CAN} rowKey={(c) => c.key}
                  render={(c) => <Row align="between" wrap={false}><Label>{c.label}</Label>{sim.data!.can[c.key] ? <Badge tone="good">{C.yes}</Badge> : <Badge>{C.no}</Badge>}</Row>} />
              </Section>
              <Section><ScopePanel scope={sim.data.scope} error={null} onRetry={sim.reload} /></Section>
            </Grid>
          )}
        </ListState>
      )}
    </Stack>
  );
}
