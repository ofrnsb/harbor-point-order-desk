"use client";
// Dev-only gallery at /dev/home: each home section with the product's own panel data, and why an empty one is empty.
import { DEV } from "@/copy/ui-dev";
import type { PanelData } from "@/lib/types";
import { renderSection } from "./Stage";
import { HOME_SECTIONS, sectionHasData, type HomeSection } from "./home-data";
import { ui } from "@/domain/ui";

const NEEDS: Record<HomeSection, string> = DEV.preview.needs;

const noop = () => {};

export function HomePreview({ panel }: { panel: PanelData }) {
  return (
    <main className="ap-preview">
      <header className="ap-preview-head">
        <h1>{DEV.preview.title}</h1>
        <p>
          {DEV.preview.introA}<code>{DEV.preview.introCode}</code>{DEV.preview.introB}<code>{DEV.preview.introLink}</code>{DEV.preview.introC}
        </p>
      </header>
      {HOME_SECTIONS.map((s) => {
        const has = s.startsWith("suggestion") ? ui.capabilities.length > 0 : sectionHasData(s, panel);
        return (
          <section key={s} className="ap-preview-item" data-preview={s} data-has-data={has}>
            <h2 className="ap-preview-name">{s}</h2>
            {has ? (
              renderSection(s, { panel, error: null, onRefresh: noop, onOpenPanel: noop, onAsk: noop, onSelect: noop })
            ) : (
              <p className="ap-preview-empty">{DEV.preview.noData(NEEDS[s])}</p>
            )}
          </section>
        );
      })}
    </main>
  );
}
