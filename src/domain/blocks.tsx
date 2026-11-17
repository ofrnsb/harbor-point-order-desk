import type { BlockOverrides } from "@/components/blocks/Blocks";
import { Stamp } from "@/components/sp/Stamp";
import type { Field } from "@/lib/types";
import { SLIP } from "@/copy/domain-ui";

// Execution receipt: the slip a governed write leaves behind. The executor's first field is the new reference; the rest are
// matched by label so the slip shows system, rows, who confirmed, who approved and the audit sequence in fixed places.
const pick = (fields: Field[], re: RegExp) => fields.find((f) => re.test(f.label));

export const blocks: BlockOverrides = {
  receipt: (a) => {
    const [ref, ...rest] = a.receipt ?? [];
    const system = pick(rest, SLIP.match.system);
    const rows = pick(rest, SLIP.match.rows);
    const confirmed = pick(rest, SLIP.match.confirmed);
    const approver = pick(rest, SLIP.match.approver);
    const audit = pick(rest, SLIP.match.audit);
    const status = pick(rest, SLIP.match.status);
    const used = new Set([system, rows, confirmed, approver, audit, status].filter(Boolean));
    const others = rest.filter((f) => !used.has(f));
    const waiting = !!status && SLIP.match.waiting.test(status.value);
    return (
      <div className="sp-slip" data-waiting={waiting}>
        <div className="sp-slip-head">
          <span>{waiting ? SLIP.waiting : SLIP.done}</span>
          {waiting && <Stamp state="waiting" label={SLIP.waitingStamp} meta={ref?.value} />}
        </div>
        {system && (
          <p className="sp-slip-target" translate="no">
            {system.value}
            {rows && <span className="ap-num">{SLIP.rowsSep}{rows.value}</span>}
          </p>
        )}
        <dl className="sp-slip-rows">
          {[confirmed, approver, status, ...others].filter((f): f is Field => !!f).map((f, i) => (
            <div key={`${f.label}-${i}`}>
              <dt>{f.label}</dt>
              <dd dir="auto">{f.value}</dd>
            </div>
          ))}
        </dl>
        {audit && (
          <p className="sp-slip-audit ap-num" translate="no">
            {audit.label} {audit.value}
          </p>
        )}
      </div>
    );
  },
};
