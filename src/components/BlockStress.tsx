"use client";
// Dev-only stress page at /dev/blocks: every answer block under hostile scenarios, at phone width and at the
// conversation's width side by side, so one look shows what breaks.
import { DEV } from "@/copy/ui-dev";
import { BlockView } from "./blocks/Blocks";
import { SCENARIOS } from "./stress-fixtures";
import { LEGO_FIXTURES } from "./lego/views";
import { BATA_FIXTURES } from "./bata/fixtures";

const ctx = { onSelect: () => {}, onAsk: () => {}, onActionDone: () => {}, selected: "", latest: false };

/** `?only=gantt,sheet` narrows the page to scenarios whose id contains one of the words, to chase one warning. */
export function BlockStress({ only }: { only?: string }) {
  const words = only?.split(",").map((w) => w.trim()).filter(Boolean) ?? [];
  const all = [...SCENARIOS, ...BATA_FIXTURES, ...LEGO_FIXTURES].filter((s) => !words.length || words.some((w) => s.id.includes(w)));
  return (
    <main className="ap-preview ap-stress">
      <header className="ap-preview-head">
        <h1>{DEV.stress.title}</h1>
        <p>{DEV.stress.intro}</p>
      </header>
      {all.map((s) => (
        <section key={s.id} className="ap-preview-item" data-scenario={s.id}>
          <h2 className="ap-preview-name">{s.label}</h2>
          <div className="ap-stress-row">
            <div className="ap-stress-frame" data-width="phone">
              <BlockView b={s.block} ctx={ctx} />
            </div>
            <div className="ap-stress-frame" data-width="column">
              <BlockView b={s.block} ctx={ctx} />
            </div>
          </div>
        </section>
      ))}
    </main>
  );
}
