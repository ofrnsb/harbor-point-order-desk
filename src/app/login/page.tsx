"use client";
// Sign in with a work email and password. Installations behind a company SSO proxy never reach this page.
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SIGN_IN_HINT_MS } from "@/config/app";
import { D, EASE } from "@/components/motion";
import { Notice, Reveal, TextInput } from "@/components/sp/admin/kit";
import { api, redirectIfSetupNeeded } from "@/components/sp/client";
import { Mark } from "@/domain/Mark";
import { SIGN_IN as C } from "@/copy/app-pages";
import { API, PAGES } from "@/config/routes";

/** Where to go after signing in: the page that sent the person here, when it is one of ours. */
function nextPage(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : PAGES.home;
}

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyRequired, setKeyRequired] = useState(false);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The key's note shows briefly when the field is entered, then gets out of the way.
  const flashHint = () => {
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), SIGN_IN_HINT_MS);
  };
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void redirectIfSetupNeeded();
    api<{ agentKeyRequired?: boolean }>(API.config).then((c) => setKeyRequired(!!c.agentKeyRequired)).catch(() => setKeyRequired(false));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError(C.missing);
    if (keyRequired && !apiKey.trim()) return setError(C.apiKeyMissing);
    setBusy(true);
    setError(null);
    try {
      await api(API.auth.login, { method: "POST", json: { email, password, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) } });
      window.location.assign(nextPage());
    } catch (err) {
      setError(err instanceof Error ? err.message : C.failed);
      setBusy(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <main className="sp-signin">
        <motion.section className="sp-signin-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d3, ease: EASE }}>
          <header className="sp-signin-head">
            <span className="sp-signin-mark"><Mark size={28} /></span>
            <div>
              <h2>{C.title}</h2>
            </div>
          </header>

          <form className="sp-signin-form" onSubmit={submit} noValidate>
            <TextInput type="email" value={email} onChange={setEmail} placeholder={C.email} aria-label={C.email} autoComplete="username" autoFocus />
            <div className="sp-signin-secret">
              <TextInput type={shown ? "text" : "password"} value={password} onChange={setPassword} placeholder={C.password} aria-label={C.password} autoComplete="current-password" />
              <button type="button" className="sp-signin-reveal" aria-pressed={shown} onClick={() => setShown((s) => !s)}>{shown ? C.hide : C.show}</button>
            </div>
            <div className="sp-signin-key" onFocus={flashHint}>
              <TextInput type="password" value={apiKey} onChange={setApiKey} placeholder={C.apiKey} aria-label={C.apiKey} autoComplete="off" />
              <AnimatePresence>
                {hint && (
                  <motion.small key="hint" className="sp-signin-hint" role="status" initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: D.d2, ease: EASE }}>
                    {keyRequired ? C.apiKeyHint : `${C.apiKeyHint} ${C.apiKeyOptional}`}
                  </motion.small>
                )}
              </AnimatePresence>
            </div>
            <Reveal>{error && <Notice tone="bad">{error}</Notice>}</Reveal>
            <button type="submit" className="sp-ui-btn" data-tone="primary" disabled={busy}>{busy ? C.signingIn : C.submit}</button>
          </form>

        </motion.section>
      </main>
    </MotionConfig>
  );
}
