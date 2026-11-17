# Harbor Point Order Desk

This is the Harbor Point Order Desk, built on a fork of the Simpul agent platform (not the `agent-starter-ag` foundation). Read `README.md` for setup and architecture, and `DESIGN.md` for product and UX decisions.

- Preserve hierarchical access rules: child units can narrow parent scope, and missing policy attributes fail closed.
- Require confirmation for writes, configured approvals above thresholds, and preserve the hash-chained audit log.
- Never write to `data-pack/`; the working ERP is rebuilt from it by `npm run reset`. Do not reset or delete an existing data store without explicit approval.
- Every route lives in `src/config/routes.ts`, every number in `src/config/*`, every user-facing word in `src/copy/*`. Everything is in English.
- Run `npm run verify` after project changes.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
