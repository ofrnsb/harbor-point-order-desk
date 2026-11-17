"use client";
// Projects in the rail: each one is a working context (goal, instructions, chosen sources) its conversations run in.
import { INPUT_MAX } from "@/config/ui";
import { API } from "@/config/routes";
import { PROJECTS } from "@/copy/ui-workspace";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useState } from "react";
import type { Project } from "@/platform/contract";
import type { ScopeSystem } from "@/platform/api-types";
import { IBox, IPencil, IPlus } from "../icons";
import { D, EASE, FADE, stagger } from "../motion";
import { Field, MultiPick, SaveBar, Sheet, TextArea, TextInput } from "./admin/kit";
import { Button, Label, Notice, Row, Stack, Text } from "@/components/ui";
import { NavItem, NavList, NavSection, NavTool } from "@/components/ui/nav";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "./client";

export type ProjectsData = { projects: Project[]; systems: ScopeSystem[] };

export const ProjectList = memo(function ProjectList({ data, error, activeId, onPick, onNew, onEdit, onRetry }: {
  data: ProjectsData | null; error: string | null; activeId: string | null;
  onPick: (id: string | null) => void; onNew: () => void; onEdit: (p: Project) => void; onRetry: () => void;
}) {
  return (
    <NavSection title={PROJECTS.title} action={{ label: PROJECTS.new, icon: <IPlus size={13} />, onClick: onNew, disabled: !data }}>
      <AnimatePresence mode="popLayout" initial={false}>
      {error ? (
        <motion.div key="error" {...FADE}><Notice tone="bad" onRetry={onRetry}>{PROJECTS.failed}</Notice></motion.div>
      ) : !data ? (
        <motion.div key="loading" {...FADE}><Skeleton rows={2} height={52} /></motion.div>
      ) : (
        <motion.div key="list" {...FADE}>
          <NavList>
            <li><NavItem mark={<IBox size={16} />} title={PROJECTS.none} sub={PROJECTS.wholeScope} active={activeId === null} onClick={() => onPick(null)} /></li>
            <AnimatePresence initial={false}>
            {data.projects.map((p, i) => (
              <motion.li key={p.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: D.d1, ease: EASE } }} transition={{ duration: D.d2, ease: EASE, delay: stagger(i), layout: { duration: D.d3, ease: EASE } }}>
                <NavItem mark={p.name.trim().charAt(0).toUpperCase()} title={p.name} sub={p.goal || sourceLine(p, data.systems)} active={p.id === activeId} onClick={() => onPick(p.id)} hint={p.goal || undefined}
                  tool={<NavTool icon={<IPencil size={13} />} label={PROJECTS.edit} aria={PROJECTS.editOf(p.name)} onClick={() => onEdit(p)} />} />
              </motion.li>
            ))}
            </AnimatePresence>
          </NavList>
        </motion.div>
      )}
      </AnimatePresence>
    </NavSection>
  );
});

export function sourceLine(p: Project, systems: ScopeSystem[]): string {
  if (!p.sources.length) return PROJECTS.wholeScope;
  const codes = new Set(p.sources.map((s) => systems.find((x) => x.connectionId === s.split("/")[0])?.code).filter(Boolean));
  return PROJECTS.sources(p.sources.length, [...codes].join(", "));
}

type Draft = { name: string; goal: string; instructions: string; sources: string[] };

export function ProjectSheet({ open, unitId, data, editing, onClose, onSaved, onDeleted }: {
  open: boolean; unitId: string; data: ProjectsData; editing: Project | null;
  onClose: () => void; onSaved: (p: Project) => void; onDeleted: (id: string) => void;
}) {
  const [d, setD] = useState<Draft>({ name: "", goal: "", instructions: "", sources: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setD(editing
      ? { name: editing.name, goal: editing.goal, instructions: editing.instructions, sources: editing.sources }
      : { name: "", goal: "", instructions: "", sources: [] });
    setError(null);
    setConfirmDelete(false);
  }, [open, editing]);

  const q = `unitId=${encodeURIComponent(unitId)}`;
  const save = async () => {
    if (!d.name.trim()) return setError(PROJECTS.needName);
    setBusy(true);
    setError(null);
    try {
      const body = { name: d.name, goal: d.goal, instructions: d.instructions, sources: d.sources };
      const saved = await api<Project>(editing ? API.project(editing.id, q) : API.projects(q), { method: editing ? "PATCH" : "POST", json: body });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : PROJECTS.saveFailed);
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api(API.project(editing.id, q), { method: "DELETE" });
      onDeleted(editing.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : PROJECTS.deleteFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      title={editing ? PROJECTS.sheetEdit(editing.name) : PROJECTS.newTitle}
      sub={PROJECTS.sheetSub}
      onClose={onClose}
      footer={
        <SaveBar
          busy={busy}
          error={error}
          onSave={save}
          onCancel={onClose}
          label={editing ? PROJECTS.save : PROJECTS.create}
          danger={editing && (
            <AnimatePresence mode="wait" initial={false}>
              {confirmDelete
                ? <motion.span key="sure" {...FADE}><Button tone="danger" data-commit disabled={busy} onClick={del}>{PROJECTS.deleteAll}</Button></motion.span>
                : <motion.span key="ask" {...FADE}><Button tone="ghost" onClick={() => setConfirmDelete(true)}>{PROJECTS.delete}</Button></motion.span>}
            </AnimatePresence>
          )}
        />
      }
    >
      <Stack gap="m">
        <Field label={PROJECTS.name}>
          <TextInput value={d.name} onChange={(name) => setD((x) => ({ ...x, name }))} placeholder={PROJECTS.namePlaceholder} maxLength={INPUT_MAX.projectName} />
        </Field>
        <Field label={PROJECTS.goal} hint={PROJECTS.goalHint}>
          <TextInput value={d.goal} onChange={(goal) => setD((x) => ({ ...x, goal }))} placeholder={PROJECTS.goalPlaceholder} maxLength={INPUT_MAX.projectGoal} />
        </Field>
        <Field label={PROJECTS.instructions} hint={PROJECTS.instructionsHint}>
          <TextArea value={d.instructions} onChange={(instructions) => setD((x) => ({ ...x, instructions }))} rows={4} placeholder={PROJECTS.instructionsPlaceholder} />
        </Field>
        <Stack gap="s">
          <Stack gap="none"><Text strong size="s">{PROJECTS.dataSources}</Text><Label>{PROJECTS.dataSourcesHint}</Label></Stack>
          {data.systems.length === 0 ? (
            <Label>{PROJECTS.noSources}</Label>
          ) : data.systems.map((s) => (
            <Stack key={s.connectionId} gap="s">
              <Row gap="s" wrap={false}><Text strong size="s">{s.name}</Text><Text size="s" tone="muted" mono>{s.code}</Text></Row>
              <MultiPick
                label={PROJECTS.objectsOf(s.name)}
                values={d.sources.filter((k) => k.startsWith(`${s.connectionId}/`))}
                options={s.objects.map((o) => ({ value: `${s.connectionId}/${o.name}`, label: o.label }))}
                onChange={(picked) => setD((x) => ({ ...x, sources: [...x.sources.filter((k) => !k.startsWith(`${s.connectionId}/`)), ...picked] }))}
              />
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Sheet>
  );
}
