"use client";
// The admin console frame: its own left navigation, the signed-in admin, and a guard for people without an admin role.
import { applyWorkspace } from "@/config/locale";
import { API, PAGES } from "@/config/routes";
import { ADMIN } from "@/copy/ui-admin";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { MeResponse } from "@/platform/api-types";
import type { PlatformRole } from "@/platform/contract";
import { Mark } from "@/domain/Mark";
import { IActivity, IArrowLeft, IBox, IChart, IColumns, IDoc, IShield, IUsers, IGlobe, ISearch, IPanel } from "../../icons";
import { D, EASE, MOTION_VARS, stagger } from "../../motion";
import { api, PLATFORM_ROLE_LABEL } from "../client";
import { Notice } from "./kit";

type NavItem = { href: string; label: string; icon: (p: { size?: number }) => React.ReactElement; role: PlatformRole | "any" };
export const NAV: NavItem[] = [
  { href: PAGES.admin.overview, label: ADMIN.nav.overview, icon: IPanel, role: "any" },
  { href: PAGES.admin.org, label: ADMIN.nav.org, icon: IColumns, role: "company_admin" },
  { href: PAGES.admin.users, label: ADMIN.nav.users, icon: IUsers, role: "company_admin" },
  { href: PAGES.admin.connections, label: ADMIN.nav.connections, icon: IGlobe, role: "any" },
  { href: PAGES.admin.catalog, label: ADMIN.nav.catalog, icon: IDoc, role: "any" },
  { href: PAGES.admin.policy, label: ADMIN.nav.policy, icon: IShield, role: "company_admin" },
  { href: PAGES.admin.actions, label: ADMIN.nav.actions, icon: IBox, role: "company_admin" },
  { href: PAGES.admin.models, label: ADMIN.nav.models, icon: IChart, role: "company_admin" },
  { href: PAGES.admin.audit, label: ADMIN.nav.audit, icon: IActivity, role: "security_admin" },
  { href: PAGES.admin.viewAs, label: ADMIN.nav.viewAs, icon: ISearch, role: "company_admin" },
];

const MeCtx = createContext<MeResponse | null>(null);
export const useAdminMe = () => useContext(MeCtx);

/** Holds the outgoing page's router state while it fades out, so the exit shows the old page, not the new one. */
function Frozen({ children }: { children: React.ReactNode }) {
  const ctx = useContext(LayoutRouterContext);
  const frozen = useRef(ctx).current;
  return <LayoutRouterContext.Provider value={frozen}>{children}</LayoutRouterContext.Provider>;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => { setError(null); api<MeResponse>(API.me).then((m) => { applyWorkspace(m.tenant); setMe(m); }).catch((e) => setError(e instanceof Error ? e.message : ADMIN.sessionFailed)); };
  useEffect(load, []);

  const roles = new Set(me?.user.platformRoles ?? []);
  const allowed = (r: NavItem["role"]) => r === "any" || roles.has(r);
  const current = NAV.filter((n) => (n.href === PAGES.admin.overview ? path === PAGES.admin.overview : path.startsWith(n.href)))[0];

  return (
    <MotionConfig reducedMotion="user">
      <div className="sp-ad" style={MOTION_VARS}>
        <nav className="sp-ad-nav" aria-label={ADMIN.console}>
          <a className="sp-ad-brand" href="/">
            <Mark size={20} />
            <span><strong>{ADMIN.brand}</strong><small>{me?.tenant.name ?? ADMIN.console}</small></span>
          </a>
          {/* Items wait for the session, so links the person cannot use never flash in and out. */}
          <ul aria-busy={!me}>
            {me && NAV.filter((n) => allowed(n.role)).map((n, i) => {
              const active = current?.href === n.href;
              const Ico = n.icon;
              return (
                <motion.li key={n.href} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: D.d2, ease: EASE, delay: stagger(i) }}>
                  <Link href={n.href} className="sp-ad-link" data-active={active} aria-current={active ? "page" : undefined}>
                    {active && <motion.span layoutId="sp-ad-hl" className="sp-ad-hl" transition={{ duration: D.d3, ease: EASE }} />}
                    <Ico size={16} />
                    <span>{n.label}</span>
                  </Link>
                </motion.li>
              );
            })}
          </ul>
          <div className="sp-ad-foot">
            {me && (
              <p>
                <strong dir="auto">{me.user.name}</strong>
                <small>{me.user.platformRoles.map((r) => PLATFORM_ROLE_LABEL[r]).join(", ") || ADMIN.noAdminRole}</small>
              </p>
            )}
            <a className="sp-btn" data-tone="quiet" href={PAGES.home}><IArrowLeft size={14} /> {ADMIN.toWorkspace}</a>
          </div>
        </nav>
        <main className="sp-ad-main" id="main">
          {error ? (
            <Notice tone="bad" onRetry={load}>{error}</Notice>
          ) : me && me.user.platformRoles.length === 0 ? (
            <Notice tone="warn">{ADMIN.needAdmin}</Notice>
          ) : me && current && !allowed(current.role) ? (
            <Notice tone="warn">{ADMIN.needRole(PLATFORM_ROLE_LABEL[current.role as PlatformRole])}</Notice>
          ) : (
            <MeCtx.Provider value={me}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={path} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: { duration: D.d2, ease: EASE } }} exit={{ opacity: 0, transition: { duration: D.d1, ease: EASE } }}>
                  <Frozen>{children}</Frozen>
                </motion.div>
              </AnimatePresence>
            </MeCtx.Provider>
          )}
        </main>
      </div>
    </MotionConfig>
  );
}
