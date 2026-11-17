"use client";
// First run: name the company, its org levels and the first admin. The server sets the session, then the admin
// continues to connecting a database.
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { IAlert, IArrowDown, IArrowUp, IPlus, ITrash } from "@/components/icons";
import { D, EASE, FADE } from "@/components/motion";
import { AutoHeight } from "@/components/blocks/AutoHeight";
import { api } from "@/components/sp/client";
import { Field, Notice, Reveal, TextInput, useRowKeys } from "@/components/sp/admin/kit";
import { Mark } from "@/domain/Mark";
import { SETUP as C } from "@/copy/app-pages";
import { EMAIL_PATTERN, SETUP_FIELD_MAX, SETUP_LEVELS, SETUP_SKELETON_ROWS } from "@/config/app";
import { TIME_ZONE } from "@/config/locale";
import { API, PAGES } from "@/config/routes";
import { PASSWORD_MIN } from "@/config/app";

type Status = { needed: boolean; tokenRequired: boolean };
const DEFAULT_LEVELS: string[] = [...C.defaultLevels];

export default function Setup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [company, setCompany] = useState({ name: "", legalName: "", industry: "", timezone: TIME_ZONE });
  const [levels, setLevels] = useState<string[]>(DEFAULT_LEVELS);
  const [admin, setAdmin] = useState({ name: "", email: "", title: "", password: "" });
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    api<Status>(API.setup).then(setStatus).catch((e) => setLoadError(e instanceof Error ? e.message : C.loadFailed));
  };
  useEffect(load, []);

  const cleanLevels = levels.map((l) => l.trim()).filter(Boolean);
  const missing = [
    !company.name.trim() && C.missing.name,
    !company.legalName.trim() && C.missing.legalName,
    !company.industry.trim() && C.missing.industry,
    (cleanLevels.length < SETUP_LEVELS.min || cleanLevels.length > SETUP_LEVELS.max) && C.missing.levels(SETUP_LEVELS.min, SETUP_LEVELS.max),
    !admin.name.trim() && C.missing.adminName,
    !EMAIL_PATTERN.test(admin.email.trim()) && C.missing.adminEmail,
    admin.password.length < PASSWORD_MIN && C.missing.adminPassword(PASSWORD_MIN),
    status?.tokenRequired && !token.trim() && C.missing.token,
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (missing.length) { setError(C.completeFirst(missing)); return; }
    setBusy(true);
    setError(null);
    try {
      await api(API.setup, {
        method: "POST",
        json: {
          company: { name: company.name.trim(), legalName: company.legalName.trim(), industry: company.industry.trim(), timezone: company.timezone.trim() || TIME_ZONE, levels: cleanLevels },
          admin: { name: admin.name.trim(), email: admin.email.trim(), title: admin.title.trim(), password: admin.password },
          ...(status?.tokenRequired ? { token: token.trim() } : {}),
        },
      });
      window.location.assign(PAGES.admin.connections);
    } catch (e) {
      const msg = e instanceof Error ? e.message : C.failed;
      if (C.alreadyDone.test(msg)) { setStatus((s) => (s ? { ...s, needed: false } : s)); }
      setError(msg);
      setBusy(false);
    }
  };

  const levelKeys = useRowKeys(levels.length);
  const moveLevel = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= levels.length) return;
    levelKeys.swap(i, j);
    setLevels((ls) => { const n = [...ls]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  };
  const removeLevel = (i: number) => { levelKeys.removeAt(i); setLevels((ls) => ls.filter((_, j) => j !== i)); };

  return (
    <MotionConfig reducedMotion="user">
    <main className="sp-signin">
      <motion.section className="sp-signin-card sp-setup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d3, ease: EASE }}>
        <header className="sp-signin-head">
          <span className="sp-signin-mark"><Mark size={28} /></span>
          <div>
            <h2>{C.title}</h2>
            <p>{C.lead}</p>
          </div>
        </header>

        <AutoHeight>
        <AnimatePresence mode="wait" initial={false}>
        {loadError ? (
          <motion.div key="error" {...FADE}><Notice tone="bad" onRetry={load}>{loadError}</Notice></motion.div>
        ) : !status ? (
          <motion.div key="loading" {...FADE}><div className="sp-q-skel" aria-hidden>{Array.from({ length: SETUP_SKELETON_ROWS }, (_, i) => i).map((i) => <span key={i} className="sp-skel" />)}</div></motion.div>
        ) : !status.needed ? (
          <motion.div key="done" className="sp-form" {...FADE}>
            <Notice tone="info">{C.done}</Notice>
            <a className="sp-btn" data-tone="primary" href={PAGES.signIn}>{C.toSignIn}</a>
          </motion.div>
        ) : (
          <motion.form key="form" {...FADE} className="sp-setup-body" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <section className="sp-form">
              <h3 className="sp-setup-h">{C.stepCompany}</h3>
              <div className="sp-form-row" data-cols="2">
                <Field label={C.companyName}><TextInput value={company.name} onChange={(v) => setCompany({ ...company, name: v })} placeholder={C.companyName} maxLength={SETUP_FIELD_MAX.name} /></Field>
                <Field label={C.legalName}><TextInput value={company.legalName} onChange={(v) => setCompany({ ...company, legalName: v })} placeholder={C.legalNamePh} maxLength={SETUP_FIELD_MAX.legalName} /></Field>
              </div>
              <div className="sp-form-row" data-cols="2">
                <Field label={C.industry}><TextInput value={company.industry} onChange={(v) => setCompany({ ...company, industry: v })} placeholder={C.industryPh} maxLength={SETUP_FIELD_MAX.industry} /></Field>
                <Field label={C.timezone} hint={C.timezoneHint}><TextInput mono value={company.timezone} onChange={(v) => setCompany({ ...company, timezone: v })} placeholder={TIME_ZONE} maxLength={SETUP_FIELD_MAX.timezone} /></Field>
              </div>
            </section>

            <section className="sp-form">
              <h3 className="sp-setup-h">{C.stepLevels}</h3>
              <p className="sp-field-hint">{C.levelsHint(SETUP_LEVELS.min, SETUP_LEVELS.max)}</p>
              <ol className="sp-levels">
                <AnimatePresence initial={false}>
                {levels.map((l, i) => (
                  <motion.li key={levelKeys.keys[i]} className="sp-level" layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: D.d1, ease: EASE } }} transition={{ duration: D.d2, ease: EASE, layout: { duration: D.d3, ease: EASE } }}>
                    <span className="sp-level-n ap-num" aria-hidden>{i + 1}</span>
                    <input className="sp-input" dir="auto" value={l} maxLength={SETUP_FIELD_MAX.level} aria-label={C.level(i + 1)} onChange={(e) => setLevels((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button type="button" className="sp-btn" data-tone="quiet" aria-label={C.levelUp(i + 1)} disabled={i === 0} onClick={() => moveLevel(i, -1)}><IArrowUp size={14} /></button>
                    <button type="button" className="sp-btn" data-tone="quiet" aria-label={C.levelDown(i + 1)} disabled={i === levels.length - 1} onClick={() => moveLevel(i, 1)}><IArrowDown size={14} /></button>
                    <button type="button" className="sp-btn" data-tone="quiet" aria-label={C.levelDelete(i + 1)} disabled={levels.length <= SETUP_LEVELS.min} onClick={() => removeLevel(i)}><ITrash size={14} /></button>
                  </motion.li>
                ))}
                </AnimatePresence>
              </ol>
              {levels.length < SETUP_LEVELS.max && <button type="button" className="sp-btn sp-setup-add" onClick={() => setLevels((ls) => [...ls, ""])}><IPlus size={14} /> {C.addLevel}</button>}
            </section>

            <section className="sp-form">
              <h3 className="sp-setup-h">{C.stepAdmin}</h3>
              <div className="sp-form-row" data-cols="2">
                <Field label={C.adminName}><TextInput value={admin.name} onChange={(v) => setAdmin({ ...admin, name: v })} maxLength={SETUP_FIELD_MAX.adminName} /></Field>
                <Field label={C.adminTitle}><TextInput value={admin.title} onChange={(v) => setAdmin({ ...admin, title: v })} placeholder={C.adminTitlePh} maxLength={SETUP_FIELD_MAX.adminTitle} /></Field>
              </div>
              <Field label={C.adminEmail} hint={C.adminEmailHint}><TextInput type="email" value={admin.email} onChange={(v) => setAdmin({ ...admin, email: v })} placeholder={C.adminEmailPh} /></Field>
              <Field label={C.adminPassword} hint={C.adminPasswordHint(PASSWORD_MIN)}><TextInput type="password" value={admin.password} onChange={(v) => setAdmin({ ...admin, password: v })} autoComplete="new-password" aria-label={C.adminPassword} /></Field>
              {status.tokenRequired && (
                <Field label={C.token} hint={C.tokenHint}><TextInput mono type="password" value={token} onChange={setToken} autoComplete="off" /></Field>
              )}
            </section>

            <Reveal>{error && <p className="sp-savebar-err" role="alert"><IAlert size={14} /> {error}</p>}</Reveal>
            <button type="submit" className="sp-btn sp-setup-go" data-tone="primary" disabled={busy}>{busy ? C.submitting : C.submit}</button>
          </motion.form>
        )}
        </AnimatePresence>
        </AutoHeight>
      </motion.section>
    </main>
    </MotionConfig>
  );
}
