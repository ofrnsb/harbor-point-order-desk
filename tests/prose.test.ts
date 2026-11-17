import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProse } from "../src/components/prose.ts";

test("a lead-in line followed by bullets becomes a paragraph and a list", () => {
  const text = "Look up information:\n- Your accounts and cards.\n- Card and savings transactions.\n- The status of any complaint.";
  assert.deepEqual(parseProse(text), [
    { kind: "p", text: "Look up information:" },
    { kind: "ul", items: ["Your accounts and cards.", "Card and savings transactions.", "The status of any complaint."] },
  ]);
});

test("numbered steps become an ordered list, and other bullet marks are recognised", () => {
  assert.deepEqual(parseProse("Do this:\n1. Block the card.\n2) Order a new one."), [
    { kind: "p", text: "Do this:" },
    { kind: "ol", items: ["Block the card.", "Order a new one."] },
  ]);
  assert.deepEqual(parseProse("* one\n• two"), [{ kind: "ul", items: ["one", "two"] }]);
});

test("a dash inside a sentence or a negative figure is not a bullet", () => {
  assert.deepEqual(parseProse("Spending fell -5% this month - mostly groceries."), [{ kind: "p", text: "Spending fell -5% this month - mostly groceries." }]);
  assert.deepEqual(parseProse("-5% fee change"), [{ kind: "p", text: "-5% fee change" }]);
});

test("text after a list in the same block starts a new paragraph, and blank lines separate blocks", () => {
  assert.deepEqual(parseProse("Options:\n- A\n- B\nPick one.\n\nAnything else?"), [
    { kind: "p", text: "Options:" },
    { kind: "ul", items: ["A", "B"] },
    { kind: "p", text: "Pick one." },
    { kind: "p", text: "Anything else?" },
  ]);
});

test("an indented line continues the list item above it; headings lose their marks", () => {
  assert.deepEqual(parseProse("- Block a card\n  and send a replacement.\n- Dispute"), [{ kind: "ul", items: ["Block a card and send a replacement.", "Dispute"] }]);
  assert.deepEqual(parseProse("## What I can do"), [{ kind: "p", text: "What I can do" }]);
  assert.deepEqual(parseProse(""), []);
});
