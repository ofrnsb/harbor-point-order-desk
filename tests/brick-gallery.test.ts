// The brick gallery at /dev/bricks shows every brick the agent can use, each case built the agent's way. A brick added
// to the schema without a gallery entry, or a case that no longer builds, fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Node } from "../src/lib/bata/schema.ts";
import { BRICK_GALLERY } from "../src/components/bata/gallery.ts";

const bricks: string[] = ((Node as unknown as { _zod: { def: { getter: () => { options: { shape: { brick: { value: string } } }[] } } } })._zod.def.getter()).options.map((o) => o.shape.brick.value);

test("every brick in the schema has its own gallery entry with several cases", () => {
  assert.equal(bricks.length, 25);
  assert.deepEqual(bricks.filter((b) => !BRICK_GALLERY.some((g) => g.brick === b)), [], "bricks missing from /dev/bricks");
  for (const g of BRICK_GALLERY) assert.ok(g.cases.length >= (["divider", "decide"].includes(g.brick) ? 1 : 2), `${g.brick} shows its variants`);
});

test("every gallery case builds through the agent's schema and resolver", () => {
  const broken = BRICK_GALLERY.flatMap((g) => g.cases.filter((c) => !c.block).map((c) => `${c.id} ${c.label}: ${c.problem}`));
  assert.deepEqual(broken, []);
});
