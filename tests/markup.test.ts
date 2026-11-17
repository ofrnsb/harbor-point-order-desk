// A component that takes arbitrary content must not put it inside <p>: a <div> or another <p> passed in breaks the
// HTML and React reports a hydration error. Checked on the source, since the browser is the only other place it shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.join(process.cwd(), "src/components");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

/** Props a component receives as free content: `children` and anything typed ReactNode. */
function contentProps(sf: ts.SourceFile): Set<string> {
  const names = new Set(["children"]);
  const visit = (n: ts.Node) => {
    if (ts.isPropertySignature(n) && n.type?.getText(sf).includes("ReactNode")) names.add(n.name.getText(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return names;
}

function contentInParagraphs(file: string): string[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const props = contentProps(sf);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === "p") {
      for (const c of n.children) {
        const name = ts.isJsxExpression(c) && c.expression && ts.isIdentifier(c.expression) ? c.expression.text : "";
        if (props.has(name)) found.push(`${path.relative(process.cwd(), file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} <p>{${name}}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

test("no component wraps free content in a <p>", () => {
  const found = walk(ROOT).filter((f) => f.endsWith(".tsx")).flatMap(contentInParagraphs);
  assert.deepEqual(found, []);
});
