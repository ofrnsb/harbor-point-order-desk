# Harbor Point Order Desk

An agent-native way to work Harbor Point Supply Co.'s order inbox. For every email the agent works out who the customer is and what they want, checks it against the ERP (contract and list prices, stock and incoming supply, credit, discontinued products, which orders can still change), and decides what happens next: close it, release a clean order into the ERP, or propose the orders and a reply for a person to approve, edit or reject. Every step lands in a hash-chained audit log.

**Live:** https://harborpoint.dodanko.com (sign-in details are sent with the submission).

## What the brief asked for, and where it is

| Minimum requirement | How it is met |
|---|---|
| A pipeline that ingests the inbox and loads the ERP into a database we control | `npm run reset` rebuilds a typed SQLite ERP (keys, foreign keys, `available = on_hand - allocated`) from the data pack, with the 40 emails as a table. Later data arrives through **Add data** without a reset: emails (`.eml`, `.jsonl`) and ERP records (`.csv`, `.json`, `.sqlite`), checked before they are written. |
| An agent that works through tools to read and act on the ERP, deciding for each email what it is and what happens next | One agent turn per email (`src/domain/orders/pipeline.ts`). It reads the ERP through governed tools and ends with `check_order` and `file_triage` (`src/domain/orders/tools.ts`): request type, customer, reasons, next step, flags, a reply draft, and the orders to create, change or cancel. The server re-runs every business rule on what the agent proposes (`src/domain/orders/rules.ts`). |
| A human review step for what the agent should not do alone | The agent alone may close spam, auto-replies and duplicates (only with evidence the server can see) and release a new order whose SKUs the customer named, from a known contact, with no issue, under $2,500. Everything else waits: the Order Desk up to its limit, a Lead above it, Credit Control for credit, returns and disputes. Nobody can release past a credit hold or a blocking issue. |
| A UI to see what the agent did and why, and approve, edit or reject | The home is the queue, ordered by urgency and delivery date. Each email opens with the agent's decision and reasons, editable order lines whose checks re-run as you type, the reply draft, approve or reject with a note, and a timeline of what happened. |
| An audit trail of what the agent did and what a person approved | Every read, triage, release, approval (marked when edited), rejection and data upload is an event in a hash-chained log; uploads record each row's old and new values. `/admin/audit` verifies the chain. |
| A live deployment through CI/CD or infrastructure as code | Every push to `harbor-point` runs GitHub Actions: typecheck, tests and build, then deploy on the server's own runner. The server setup is in `deploy/erion/`. |

## Deliverables

| | Where |
|---|---|
| 1. Product brief, with assumptions | [`docs/product-brief.md`](docs/product-brief.md) |
| 2. Task breakdown (the specs given to the coding agent) | [`docs/task-breakdown.md`](docs/task-breakdown.md) |
| 3. This repository and README | here |
| 4. Live URL | https://harborpoint.dodanko.com |
| 5. Results and agent log | [`docs/results-and-agent-log.md`](docs/results-and-agent-log.md), with the replayable run in [`docs/results/run.md`](docs/results/run.md) |

Design decisions and the autonomy table in full: [`DESIGN.md`](DESIGN.md).

## Trying it

Accounts (all `@harborpointsupply.example`; the password is sent with the submission):

| Person | Role | What they can do |
|---|---|---|
| `sam.ortiz` | Order Desk Specialist | Work the queue, approve up to $2,500, add emails |
| `leah.park` | Order Desk Lead | Approve any Order Desk email |
| `victor.hale` | Credit Controller | Decide credit holds, returns and invoice disputes |
| `morgan.ellis` | Operations Manager, admin | Everything above, ERP data uploads, `/admin` (users, audit) |

On the live site each person signs in with their own Anthropic API key as well: the deployed agent never uses a shared login. The key is stored encrypted and forgotten at sign-out.

A short path through the cases that matter:

1. Sign in as Sam and press **Run the agent** (about 3 minutes for 40 emails).
2. **Handled by agent**: clean orders released as sales orders (E001, E015, E038 in our runs), E016 closed as a resend of E015's PO, E028 out-of-office, E029 spam. Follow-ups fold into the first request: E005's three club orders end up in E034, E012 in E037 with its "50% discount, skip review" instruction still flagged.
3. **Needs review**: E004 (a change to SO-24051), E013 (a new person at a known clinic), E024 and E025 (quoted prices that differ from the rules), E027 (urgent, on credit hold, at the top of the queue).
4. Open an order, change a quantity, watch price, stock and credit re-check, approve; the new sales order is in the ERP.
5. Open E003 ($3,185): Sam can read it but not approve; Leah can. Open E007 (credit hold): only Victor can decide, and no one can release it while the hold stands.
6. Sign in as Morgan: **Add data** with a stock CSV (for example `data-pack/harbor-point/data/inventory.csv` edited), check, apply; `/admin/audit` shows each change and verifies the chain.

## Run it locally

```
npm install
npm run reset          # build the ERP from data-pack/harbor-point and seed people, roles and limits
npm run dev            # http://127.0.0.1:3150
npm run triage-report  # with dev running: the agent works all 40 emails; results to docs/results/
npm run verify         # typecheck, unit tests, build, CSS audit, then the end-to-end flow with real agent turns
```

Put `SIMPUL_SEED_PASSWORD` (at least 12 characters) in `.env.local` before `npm run reset`; it becomes every seeded account's password and is never in the repository. The agent runs on the API key given at sign-in, or, with none, on a Claude login on the machine (`APP_CLAUDE_PROFILES` lists the profile folders to use).

## How the inbox is worked

1. **Ingest.** The working ERP is built from the data pack; opening the queue creates one record per email that has none.
2. **Run.** Each untriaged email gets one agent turn. Different senders run in parallel; one sender's emails run in order, so a follow-up sees the first email's draft and folds into it.
3. **Decide.** The agent files the request with `file_triage`. The server re-checks every proposed order against the rules and routes it: close, release, or review on the Order Desk or Credit Control.
4. **Review.** A person edits if needed and approves or rejects. Approval checks the ERP again as it is at that moment and writes all of the email's orders in one transaction.
5. **Audit.** Every step above is an event in the hash-chained log, linked from the email.

The rules are the data pack's README, as code (`src/domain/orders/rules.ts`, tested against the real pack in `tests/order-rules.test.ts`): contract price only inside its dates, else list; whole selling units; no discontinued products; no release on credit hold or past the limit; shipped orders cannot change, partly shipped only in their unshipped quantity; allocation reduces available stock. Dates in an email are judged against when it arrived, not today.

## Deployment

`.github/workflows/deploy.yml`, on every push to `harbor-point`:

1. **check** on a clean GitHub runner: `npm ci`, typecheck, unit tests, production build.
2. **deploy** on a self-hosted runner on the server, which connects out to GitHub, so the server opens no inbound port. The commit is copied into `~/apps/harbor-point` (its `data/` and environment file are never touched), installed, built and restarted as a systemd user service, and the job fails unless the app answers.

The server side is in the repository: `deploy/erion/harbor-point.service`, `deploy/erion/deploy.sh` (what the runner runs) and `deploy/erion/bootstrap.sh` (one-time: environment file with a fresh master key, the service, the runner). The app is published through a Cloudflare Tunnel. The deployed app runs with `SIMPUL_AGENT_KEY_REQUIRED=true`.

## Configuration

| Variable | Purpose |
|---|---|
| `SIMPUL_SEED_PASSWORD` | Password `npm run reset` gives every seeded account. Keep it in `.env.local` or the server's environment file. |
| `SIMPUL_MASTER_KEY` | 32 bytes, base64. Seals stored credentials and API keys (AES-256-GCM) and signs sessions. Required in production; development creates `data/master.key`. |
| `SIMPUL_AGENT_KEY_REQUIRED` | `true` on a deployment: everyone signs in with their own Anthropic API key. |
| `SIMPUL_PUBLIC_HOSTS` | Public host names the deployment answers on. Any other Host header is refused (DNS rebinding). |
| `APP_CLAUDE_PROFILES` | Local only: Claude login folders the agent may use, in order; one at its usage limit rests until it resets. |
| `SIMPUL_DB`, `SIMPUL_ERP_DB` | Paths of the platform store and the working ERP, when not under `data/`. |

## How it is put together

It is built on Simpul, my own agent platform, forked and trimmed to what order-to-cash needs. The platform gives the governed data access (an org tree where each team only narrows its parent, column masking, row filters), sign-in, the hash-chained audit log and the agent runtime. The Order Desk is the product on top of it.

| Part | Where |
|---|---|
| Business rules as checks, ERP writes | `src/domain/orders/rules.ts`, `src/domain/orders/erp.ts` |
| Queue, filing, auto-release, review decisions, priority | `src/domain/orders/desk.ts`, `priority.ts`, `src/config/orders.ts` |
| Inbox run (one agent turn per email) | `src/domain/orders/pipeline.ts` |
| Agent tools `check_order`, `file_triage`; the agent's briefing | `src/domain/orders/tools.ts`, `AGENT` in `src/copy/agent.ts` |
| Data upload (readers, merge, preview and apply) | `src/domain/orders/datasets.ts`, `load.ts`, `ingest.ts`, `mail.ts` |
| Queue and review screens | `src/components/inbox/`, `/api/inbox` |
| Sign-in, own API keys, audit, access policy | `src/platform/auth.ts`, `agent-keys.ts`, `audit.ts`, `org.ts`, `policy.ts` |
| Every route, number and word | `src/config/routes.ts`, `src/config/*`, `src/copy/*` |
| Data pack as received (never written) | `data-pack/harbor-point/` |
