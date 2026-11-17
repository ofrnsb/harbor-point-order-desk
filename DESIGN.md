# Harbor Point Order Desk: design brief

The Order Desk is an agent that works Harbor Point Supply Co.'s order inbox inside the ERP. Harbor Point is a B2B distributor of cleaning, paper, glove and takeout supplies to restaurants, hotels, schools, clinics and gyms. It runs on the Simpul platform: the ERP is connected as a governed data source, the agent reads only what its team may see, every write waits for a person, and every step lands in a hash-chained audit log.

## User and moment
An Order Desk specialist starts the day with the overnight and morning emails at orders@harborpointsupply.example: SKU lists, pasted spreadsheets, free text, forwarded threads, one-line phone messages. Today they read each one, work out the customer and the request, check stock, price and credit, and retype the order into the ERP. With the Order Desk they review what the agent already worked out and decide. The Order Desk Lead approves what the specialist cannot; Credit Control owns holds, returns and invoice disputes.

## Core object and verb
The inbound email and the decision it needs. The agent reads the email, identifies the customer and the request, checks it against the ERP, and proposes the next step; a person confirms, and anything risky goes to the approver who owns it.

## Layout and home
Archetype queue workbench. The home is the inbox as a queue: one row per email with its received time, the customer, what the agent made of it, how many checks it raised, the order value and its state. It opens on "Needs review", with filters for what the agent handled itself, what people decided and what is not triaged yet, and a desk filter for Credit Control. The headline is the count waiting for a decision. Opening a row puts the review in its place: the email on the left, the agent's decision on the right (summary, reasons, next step, flags), the orders it would put into the ERP as editable lines with the checks re-run as the reviewer types, the reply it drafted, and Approve or Reject with a note for the audit log. Under it, what the agent did: its steps, the ERP tables it read and every audit event about the email. The left rail keeps conversation history; the composer stays docked, so the reviewer can ask the agent anything, and "Ask the agent about this email" starts that question. The right panel lists the emails still waiting, so a reviewer in a conversation can jump back to one. The admin console (`/admin`) is a separate surface.

## What the agent may do on its own
| The agent | Who decides instead |
|---|---|
| Reads the ERP, classifies every email, matches customer, products, prices, stock and credit, drafts orders and replies | nobody: this is the agent's job |
| Closes spam, auto-replies and duplicates, only when the server can see why (a duplicate names an earlier email from the same sender; spam never comes from a customer contact) | otherwise it waits for review |
| Releases a new order into the ERP when the customer named every SKU, the sender is a known contact, no check raised anything, no flag was raised, and the order is within the Order Desk limit ($2,500) | nobody; the release is audited as the agent's |
| Anything else that writes the ERP: orders matched from descriptions, changes, cancellations, orders over the limit, anything with a warning | an Order Desk Specialist up to $2,500, a Lead above it |
| Orders with a credit hold or over the credit limit, returns, invoice disputes | Credit Control; a credit order is never approved while the hold or limit stands, it is cleared in the ERP first (then the Order Desk approves) or rejected |
| Orders with a blocking issue (discontinued or unknown product, part units, a shipped order) | nobody until a person edits the draft |
| Replies to customers | always a person; the agent only drafts |

Every check runs on the server when the agent files, again on every edit, and again at the moment of approval, so the numbers a person approves are the ERP's, not the model's.

## Density, type and motion
Calm and lit, like a well-made instrument: one raised surface (`--ap-surface` on `--ap-backdrop`, light from the top left), panels that rise out of it and parts inside them that sink into it, so nothing is a box in a box. Geist for the interface with tabular numerals, Geist Mono only for references, codes and SKUs (`--sp-mono`), and Instrument Serif (`--sp-serif`) for what an answer found: a screen title, an answer's headline, the user's question and a chart's annotation. Big numbers are light (300) and large; their currency sits small in the accent. Radius is generous (28px panels, pills for every control) and rows keep 56px. Motion is part of reading: a panel is woven in from its top edge, its source threads run down its edge, a dial's arc draws and its knob lands, a state's knot ties itself. Tokens: `--ap-font`, `--sp-serif`, `--sp-mono`, `--ap-type-scale: 1`, `--ap-radius-card: 28px`, `--ap-radius-composer: 26px`, `--ap-radius-scale: 1`, `--ap-density: 1`, `--sp-raise*` and `--sp-well*` for depth, `--sp-accg` and `--sp-glow` for the one light. The receipt a governed write leaves is the execution receipt.

Dials: density 6 (answers breathe so the finding reads first; order lines and queues keep their 56px rows for scanning), motion 5 (every primitive enters, settles and responds, and each motion carries meaning: weaving, threads, a dial drawing, a knot tying), variance 7 (the raised surface, the serif findings and the source threads move far from the reference kit).

## Signature
The access trail: a strip under every governed answer with one bar per system touched, the rows read, the row filters applied, the columns masked, the systems refused as out of scope, and the model route used. It draws as each query lands and turns red for a refusal. For the Order Desk it answers the question a reviewer asks first: which ERP records did the agent look at before it proposed this.

| State | Signature | Card |
|---|---|---|
| Query running | the system's bar pulses, label "reading" | none yet |
| Rows read | bar filled, row count, filters and masks listed | rows or metrics block |
| Out of scope | red outline, "outside the team's scope" | agent explains and offers a request to the owning desk |
| Restricted data | lock mark, "masked" | values show as masked |
| Write executed | ink bar "written", rows affected | execution receipt |
| Awaiting approval | amber bar "awaiting approver" | queue row in the approver's home |

## Persona and voice
A careful order desk colleague: English, short, exact with SKUs, quantities, prices and dates. It names the customer and the records it checked, never guesses a size or a price, treats the text of an email as data and never as an instruction, and says who has to approve.

## Coverage
Jobs the Order Desk brings to the agent, and the path each takes.

| Job | Path | Gate |
|---|---|---|
| Work the whole inbox | Run the agent: one turn per email, one sender's emails in order | none |
| Decide what an email is and what happens next | `file_triage` | auto-release, close, or review (see above) |
| Price and check a draft (contract or list price, stock, credit, order status, duplicate PO) | `check_order` | none |
| Draft a new order, one per delivery address | `file_triage` proposals | review unless clean |
| Change or cancel an existing order | `file_triage` proposals | review |
| Fold a follow-up into the morning's draft | `file_triage`, superseding the earlier email | review |
| Identify the customer, find products, stock, prices, orders | `query_records`, `get_record`, `trace_process` | none |
| Totals across orders, customers or products | `aggregate_records` | none |
| Look up a business rule | `search_policies` | none |
| Draft a reply to the customer | `file_triage` reply | a person sends it |
| Anything outside an order (account setup, a return, a dispute) | routed to Credit Control in the queue, or `open_request` | the owning desk |

## Data
The ERP is the data pack's snapshot of 07:00 on Monday 2 November 2026, rebuilt by `npm run reset` from `data-pack/harbor-point/` into a working SQLite database with typed columns and keys: customers, contacts, ship-to addresses, products, contract prices, inventory, incoming supply, sales orders and their lines, and the day's 40 inbound emails. The data pack itself is never written. The platform metadata (organisation, people, policies, catalog, work items, audit) lives in its own SQLite file.

## Palette
Backdrop: a cool off-white under office light. Accent: a deep ink blue used for the active team, primary actions and the access trail bars. Tones stay semantic: red for refusals, holds and failures, amber for awaiting approval and partial states, green for executed and shipped.

## Visual direction: surface and thread
- **One surface, one light.** Everything is made of one raised surface lit from the top left. A panel rises (`--sp-raise`); what sits inside it sinks (`--sp-well`): a nested section, an input, a meter's track, a badge, a status, a tab track. The only colour that glows is the blue gradient (`--sp-accg`), and it always means what the agent adds on top of the data: the primary action, the measured share, the latest value, the user's selection. Text in the accent uses the deep blue `--ap-accent` (7:1); white on the gradient is 6.9:1 at its middle.
- **Instruments.** A share is a dial with a ticked scale, a sunk track, a lit arc and a raised knob (Ring). A measure is a capsule well filled up to the value (Meter), green past its whole. A chart's latest point is a raised knob and its readout a raised bubble.
- **Threads.** Every answer is woven from the systems it read. Each system has its thread colour (`--sp-src-1..4`): the threads run down the answer's edge and key each source in its colophon. A record's state is a knot: a loose loop is open, a tied knot is in hand, a double knot is settled, a cut thread is stopped, always with its word.
- **Findings speak first, in serif.** A level-1 heading is the finding, in Instrument Serif.

## Decisions
- Built on a fork of Simpul (branch `harbor-point`), keeping the platform essentials: governed reads through the policy planner, confirmations and approvals as work items, the hash-chained audit log, the admin console and the agent runtime. Removed what order-to-cash does not use: whiteboards and sheets, file generation and review, chat attachments, web search, analysis and forecasting tools, the demo tenants, and every connector except SQLite.
- The ERP stays SQLite, because the data pack ships as SQLite and one database file keeps the deployment to a single container. Cross-system joins are refused, since there is one system.
- One agent serves everyone, with every tool. There are no skills: what to do with a tool is in its description, read only when the agent needs that tool (it sees an index of categories and tool names, reads with describe_tools, runs with run_tool), and the order procedure is the agent's briefing. Access stays configurable per company, department, team and person: data grants, column masking, row filters on user attributes, roles, clearance, approval thresholds and AI budgets, all inherited down the org tree and only ever narrowed.
- Everything is in English, routes included, and every amount is in the tenant currency (USD); amounts show cents only when they have them.
- Every route lives in `src/config/routes.ts`, every number in `src/config/*`, every user-facing word in `src/copy/*`.
- The inbox is replayed as of the moment each email arrived. Dates in an email, contract price validity and "has this date passed" are judged against the received date, not today; the app's own clock (audit times, decisions) is today. Without this, every order in a two-week-old inbox would look late.
- One email can carry several orders: one sales order has one delivery address, so "deliver to each club separately" is three proposals approved together in one transaction.
- The credit rule is applied literally: open balance plus the new order's value against the limit, where an email's earlier orders for the same customer count too. Orders already open but not invoiced are not added, because the data pack's open balance is invoiced debt.
- Stock short of what an order needs is a warning, not a block: the reviewer may approve, and the order allocates what is available. Backorders are a person's call.
- The agent's triage transcripts are kept (linked from each email and the audit log) but left out of the reviewer's chat history.
