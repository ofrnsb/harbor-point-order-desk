// Splits an agent answer into paragraphs and lists. A block may open with a lead-in line ("What I can do:") and then
// list items; bullets are "- ", "* " or "• ", numbered items "1. " or "1) ". A dash inside a sentence is never a bullet.
export type ProseBlock = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d{1,3}[.)]\s+/;

export function parseProse(text: string): ProseBlock[] {
  const out: ProseBlock[] = [];
  for (const block of text.split(/\n{2,}/)) {
    let para: string[] = [];
    const flush = () => {
      const t = para.join(" ").replace(/^#+\s*/, "").trim();
      if (t) out.push({ kind: "p", text: t });
      para = [];
    };
    for (const raw of block.split("\n")) {
      const line = raw.trimEnd();
      const kind = BULLET.test(line) ? "ul" : NUMBER.test(line) ? "ol" : null;
      if (!kind) {
        const last = out.at(-1);
        // An indented continuation line belongs to the list item above it.
        if (!para.length && last && last.kind !== "p" && /^\s{2,}\S/.test(raw)) last.items[last.items.length - 1] += ` ${line.trim()}`;
        else if (line.trim()) para.push(line.trim());
        continue;
      }
      flush();
      const item = line.replace(kind === "ul" ? BULLET : NUMBER, "");
      const last = out.at(-1);
      if (last && last.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    }
    flush();
  }
  return out;
}
