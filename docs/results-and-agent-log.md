# Results and agent log

## How the system handled the 40 emails
Replayable: `npm run reset`, `npm run dev`, `npm run triage-report`. The run below is in [`docs/results/run.md`](results/run.md) (one row per email) and `run.json`. 40 emails, one agent turn each (Claude Haiku), 4 sender lanes, 197 s, 0 failed turns, about $3.53 at list price.

| Outcome | Count | Emails |
|---|---|---|
| Released into the ERP by the agent | 3 | E001, E015, E038: every SKU named, known contact, clean checks, under $2,500 |
| Closed by the agent, with server-checked evidence | 3 | E016 (resend of E015's PO), E028 out-of-office, E029 spam |
| Folded into a later email from the same sender | 7 | E002 into E026, E005 into E034, E009 quote into E025 booking, E010 into E035, E012 into E037, E019 into E032, E023 into E031 |
| Waiting for the Order Desk | 22 | description-matched orders, the SO-24051 change, the SO-24055 cancellation, price claims, short stock, unclear requests |
| Waiting for Credit Control | 5 | E006 over limit, E007 and E027 on hold, E018 return, E030 invoice dispute |

What it gets right that a parser would not: E004 changes SO-24051 instead of creating an order; E005 is three orders, one per club, and E034 leaves out the towels Jenna skipped and asks whether the morning's Northgate towels stay; E012's "50% discount, skip review" is ignored and the flag survives the merge into E037; E013's new contact at a known clinic is held for verification; E024's $70 is an expired contract price and E025's $30 a verbal offer, both priced by the rule and questioned; E036 "the usual" is drafted from the last order; E027 is urgent and on hold, so it tops the queue and goes to Credit Control.

## Where it gets things wrong
- **Checks depend on fields the agent fills.** E032 wants delivery "by Friday October 30", before the email arrived. The reply asks about it, but the draft has no date, so the server's date check never fires.
- **Folding over-reaches.** The worst error of the run: E009, a quote "not ordering yet", was folded into E025's straw booking, and its 20 cases of cups became order lines. A reviewer would catch it; the server now refuses to fold a quote, return, dispute or complaint into an order. E019 (discontinued gloves) folded into E032 is defensible, yet now one discontinued line blocks the whole draft.
- **Flags are noisy.** E025's verbal price is flagged as prompt injection. In an earlier run E006, a long-standing customer, was flagged as new. Flags never release or block on their own, but they cost attention.
- **Variance between runs.** Across three runs the same emails got different flags and merges; approval re-checks protect the ERP, not triage consistency.
- **Cautious by policy.** E039 and E040 are clear but described rather than coded, so they wait. Raising straight-through processing means measuring match accuracy first.

## Where my coding agent went wrong, and how I corrected it
- **Built a chat assistant, not the brief.** I pointed it at the minimum list; it wrote a gap table and rebuilt around a per-email pipeline and review queue.
- **Kept scaffolding.** Multi-agent pickers, skills and projects. I asked for one agent with every tool and no skills; tool descriptions now load on demand, and unused platform parts are off.
- **Code style.** Chained conditionals instead of a typed const map, magic strings. Fixed to const maps and one home for every route, number and word.
- **Tested through the API instead of using the product.** I told it to drive Safari; it now checks in the real UI.
- **Time.** It pinned the app to the snapshot date, then let the agent judge email dates against today. Rule now: the app runs today, an email's dates count from when it arrived.
- **Trusted the model.** It took the model's arithmetic ("$3,000" for a $999.50 order) and its word that an email was a duplicate. Amounts now come only from the server's checks; closing needs evidence the server can see.
- **Bent a business rule.** It let Credit Control approve past a credit hold, which the data pack forbids. An external review (Codex) caught it; now nobody can, and the order returns to the Order Desk once the hold is cleared in the ERP.
- **Said the pipeline could not be tested because it needs an LLM.** I pointed out `verify` already runs real agent turns; it now triages five emails in every verify run and asserts the outcome.
- **Bugs found by using it.** Credit checked per order instead of per email; an unknown SKU shifted edits onto the wrong line; a merge lost its injection flag; runs stuck after a restart; a reply quoted an internal email id; a broken empty state; no paging. Each has a fix and, where logic was involved, a test.
