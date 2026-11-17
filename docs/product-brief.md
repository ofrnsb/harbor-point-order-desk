# Harbor Point Order Desk: product brief

## The user and the problem
The user is an Order Desk specialist at Harbor Point Supply Co., with an Order Desk Lead above them and Credit Control beside them. Every morning orders@harborpointsupply.example fills with SKU lists, pasted spreadsheets, free text, forwarded threads and one-line phone messages. Today a person reads each one, works out the customer and what they want, checks stock, price and credit, and retypes the order into the ERP. On 2 November that was 40 emails before noon, and only a few of them were clean orders: the rest were changes, cancellations, quotes, disputes, follow-ups to earlier emails, resends, a customer on credit hold, a prompt injection, an out-of-office reply and spam. The cost is typing time, retyping errors, and the risky cases (credit, discontinued products, price claims) getting the same attention as the easy ones.

## What I built
An agent that works the inbox inside the ERP, and a queue where people decide what it proposed.

- **Pipeline.** The data pack's ERP is rebuilt into a typed SQLite database the app controls (keys, checks, `available = on_hand - allocated`), with the 40 emails as a table. Every email becomes a record in the queue.
- **Agent.** One agent turn per email. Different senders run in parallel; one sender's emails run in the order they arrived, so a follow-up sees the first email's draft; when that draft still waits for review, the follow-up folds into it, so the reviewer decides one request, not two. The agent reads the ERP through governed tools, prices and checks drafts with `check_order`, and ends with `file_triage`: request type, customer, reasons, next step, flags, a reply draft, and the orders to create, change or cancel (one per delivery address).
- **Rules in code, not in the model.** Every business rule from the data pack (contract vs list price by date, whole selling units, discontinued products, credit hold and limit, shipped / open / partially shipped edits, stock allocation) runs on the server when the agent files, on every edit, and again at approval. The numbers a person approves are the ERP's.
- **Review UI.** The home is the queue (filters by state and desk, paged), ordered by what to work first: what the customer called urgent, the nearest delivery date, credit cases, then arrival. Opening an email shows the email beside the agent's decision, editable order lines with checks re-running as you type, the reply draft, Approve or Reject with a note, and what the agent did: its steps, the ERP tables it read, and every audit event for that email. A chat with the same agent stays available for questions.
- **Audit.** A hash-chained log of every read, triage, release by the agent, approval (with whether it was edited) and rejection.

## What I chose not to build
Sending email (replies are drafted, a person sends them); returns and credit notes (routed to Credit Control as decisions, not ERP writes); invoicing; attachment parsing (none of the 40 emails has a real attachment; the one that refers to one is asked to resend); multi-warehouse allocation; a live mailbox connector (new emails and new ERP data arrive by upload, checked before they are written). The repository is a fork of my own agent platform, so an admin console (organisation, access policies, models, audit) comes with it; it is the foundation the access rules run on, not part of this product's scope, and its extras (projects, analysis tools, other connectors) are switched off or removed.

## What the agent may do on its own, and what needs a person
| The agent alone | A person decides |
|---|---|
| Read the ERP, classify every email, match customer, products, prices, stock, credit | |
| Close spam, auto-replies and duplicate resends, only when the server can see why: a duplicate must name an earlier email from the same sender, spam must not come from a customer contact | |
| Release a new order when the customer named every SKU, the sender is a known contact, no check and no flag was raised, and the value is within the Order Desk limit ($2,500) | |
| | Orders matched from descriptions, any warning, changes, cancellations: an Order Desk Specialist up to $2,500, a Lead above |
| | Credit hold, over the credit limit, returns, invoice disputes: Credit Control. No one, Credit Control included, releases an order past a hold or limit: they clear it in the ERP, the approval re-checks and the order returns to the Order Desk, or they reject with a reply |
| | Anything with a blocking issue (discontinued or unknown product, part units, a shipped order): no one, until the draft is edited |
| | Every reply to a customer |

The line follows the cost of a mistake. A wrong release of a clean SKU order under $2,500 is cheap to reverse; a wrong product match, a price override, a change to a committed order or credit extended to a customer on hold is not. Limits and roles are configuration (per company, department, team and person), not code.

## How I would measure success in production
- **Touch time per email** (opened to decided) and **time from receipt to sales order**, against a same-day target for emails before 2 pm.
- **Straight-through rate**: share of orders released with no person. On this run 3 of the 25 emails that produced an order; it should grow only while the next metric stays at zero.
- **Release error rate**: agent-released orders later changed or cancelled because of the agent. Target 0; any non-zero week lowers the limit.
- **First-pass accuracy**: proposals approved without edits; edit and rejection rates by request type show where the agent is weak.
- **Credit and price leakage**: orders released past a hold or limit, or at a price other than the rule's. Must be 0; the server enforces it, the metric proves it.
- **Escalation quality**: share of Credit Control items that were really theirs.
- **Cost and reliability**: model cost per email (about $0.09 on this run), turns that failed or timed out.

## Assumptions
1. **The inbox is judged as of when each email arrived.** "Thursday", contract validity and "has this date passed" are counted from the received date; the app's own clock is today. Otherwise every order in a two-week-old inbox would look late.
2. **Order date is the received date**, so it decides which contract price applies. The data pack ties price validity to "order date" without defining it.
3. **Credit counts open balance plus this email's orders.** Open but uninvoiced orders are not added, because the pack's open balance is invoiced debt. Several orders in one email count together.
4. **Short stock is a warning, not a block.** The reviewer may approve; the order allocates what is available and the rest is a backorder decision for a person.
5. **A known sender is a row in customer contacts.** A new person at a known customer's domain is drafted for that customer and held for verification.
6. **A quoted price that differs from the rule's is never applied.** Verbal offers ("Mike said $30") and expired contract prices go to a person.
7. **Text in an email is data.** Instructions in it (discounts, "skip review") are flagged and ignored.
8. **"Boxes" of a product sold by the case is a question**, not a conversion, because pack sizes differ.
9. **One sales order has one delivery address**, so multi-site emails become several orders approved together.
10. **A resend of the same PO is a duplicate**, closed with a pointer to the first.
11. **SQLite is the database**, because the pack ships as SQLite and one file keeps deployment to one container.
