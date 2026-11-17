# agent-starter design system

Open-horizon, borderless workspace engine for domain-specific AI agentic platforms. Light theme only. The entire viewport is one continuous luminous plane (`--ap-backdrop`) with zero outer box walls around the workspace, one brand accent per product, and semantic tones (`good`, `warn`, `bad`, `info`) reserved strictly for state.

Treat this kit as a living spatial engine, not a fixed wireframe or a template. Every product built from it should feel bespoke to its domain's core object from the very first second. Two kinds of rules follow: **principles** hold in every product; everything else is the **reference composition**, a starting point each product reshapes from its sector, user and use case, with the reasons in its `DESIGN.md`.

## Spatial freedom and archetypes (`src/domain/ui.ts` + `src/domain/domain.css`)
- **Three reference archetypes** (choose per product, never by default) via optional `layout` in `src/domain/ui.ts` (or `?layout=` URL preview):
  1. `"editorial"` (shipped default): the three zones people everywhere already know from chat assistants. A docked `256px` history rail resting on `--ap-backdrop` (brand, a quiet New conversation row, search, grouped history; no account or session footer), the conversation in the center with a floating composer, and the Inspector sliding in from the right only when there is something to inspect. The top bar holds only the conversation title and the Inspector toggle.
  2. `"horizon"`: no rail; history lives in a `⌘K` popover from the top bar. For single-purpose kiosks where history matters little.
  3. `"workbench"`: the Inspector stays open beside the conversation, for domains where one live object or map stays anchored through multi-turn work.
- **Home principles (every product):** the product's own object and the user's real data lead, including the signature; one focal point; one greeting line, no intro paragraph, no data or session chips; everything fits one viewport at 1280x720.
- **Home building blocks (`src/components/HomeSections.tsx`):** Greeting, Spotlight, Records, Board, Agenda, KeyFigures, Suggestions (pills or cards). Each draws from `panel()`, owns its loading and error state and takes no space when empty. Pick and order them with `ui.home`, or compose by hand.
- **Home reference arrangement (`src/components/Stage.tsx`, reshape it per product):** the greeting, then the live records from `panel()` (the highlighted record's signature beside up to three compact rows when it is compact, `homeVisual: "side"`, or above them when it is long, `"wide"`; the list name and View all; hovering a row switches the signature, a click opens it in the Inspector), then up to four equal-width suggestion pills, with the composer docked at the bottom. A product may replace it entirely with the arrangement its object calls for: a live board, a map, a queue, today's schedule.
- **Bespoke expression per domain (the theme contract in `src/domain/domain.css`):**
  - Colour: `--ap-backdrop` (surface temperature from the domain's physical world) and `--ap-accent` (single brand hue). The shell ships neutral paper and a graphite accent so it reads as unbranded.
  - Type: `--ap-font`, `--ap-font-display` (editorial serif, humanist sans, or technical grotesk) and `--ap-type-scale`, which every font size and line height reads.
  - Shape: `--ap-radius-card`, `--ap-radius-composer`, `--ap-radius-pill` (squarer for precise sectors such as banking, round for consumer) and `--ap-radius-scale` for every other corner.
  - Feel: `--ap-density` (every padding and gap), the shadow tokens `--ap-lift`, `--ap-lift-hover`, `--ap-float`, and the surfaces `--ap-surface`, `--ap-sunk`, `--ap-hairline`.
  - Motion: `motionScale` in `ui.ts`.
  - Artifacts: the receipt after a confirmed action is the sector's own (`src/domain/blocks.tsx`), never the generic fields list.
  - Every item returned by `domain.panel()` in `src/domain/index.ts` should populate `visual` so `<Signature />` comes alive immediately on the Home Stage and in the Inspector without extra clicks.
  - When a domain's core object calls for a custom spatial stage (for example an interactive floor map, departure board, or portfolio curve), extend `src/components/Stage.tsx` freely.

## Depth and borderless hierarchy
- Four surface tiers, zero box walls dividing the viewport:
  1. `--ap-backdrop` + subtle top radial accent wash: unified full-viewport open canvas, Top Horizon bar, and unboxed switcher/index rows.
  2. `--ap-stage` (`84%` white + `16%` backdrop + `--ap-float`): floating Context Inspector sheet on desktop.
  3. `--ap-surface` (`#ffffff` + `--ap-lift` / `--ap-lift-hover`): Live Stage spotlight card, answer cards, active switcher pills, and quick-intent pills.
  4. `--ap-surface` (`#ffffff` + `--ap-float`): floating composer (`2px` `42%` accent ring on focus), `⌘K` History popover, model menu, trace popover, and mobile sheets.
- Inset controls (`--ap-sunk`, `--ap-sunk-strong`): search field, form inputs, `<Signature />` instrument wells, and user prompt bubbles use tonal inset fills instead of box borders.
- Hairlines (`1px` `--ap-hairline`): single edge only, inset to text margins (`ItemCard` and Stage facts top edge, `Compare` attribute rows, `Metrics` secondary stats, session footer seam). Never wrap a box inside another bordered box.

## Global typography and worldwide usability
- Stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, "Noto Sans", "Hiragino Sans", "PingFang SC", system-ui, sans-serif`.
- Scale: body `15/24-25` (`400`), stage headline `clamp(27px, 3.2vw, 35px)` (`600`, `--ap-font-display`), spotlight title `19/25` (`600`), card and section titles `14-16/20-22` (`600`), secondary `13/19`, minimum caption and badge `12/17-20` (`500-600`).
- Tracking: `0` on body and captions, `-0.008em` to `-0.015em` max on headings and hero numerals so non-Latin scripts and word spacing stay crisp.
- All dynamic prose, titles, and inputs carry `dir="auto"` / `unicode-bidi: plaintext` for mixed LTR/RTL scripts. Dynamic numbers, prices, and timestamps use `.ap-num` (`tabular-nums`) and `src/components/format.ts`.
- Text contrast `>= 4.5:1` across all three ink tiers (`--ap-ink`, `--ap-ink-2`, `--ap-ink-3`). Every top-level control pairs its icon with a clear text label on desktop and `>= 38-42px` hit targets on touch screens.

## Motion
- Tokens (`src/components/motion.ts` and `:root`): `EASE = cubic-bezier(0.16, 1, 0.3, 1)`, durations `120 / 180 / 240 / 360 ms`, springs `stiffness: 420, damping: 34`.
- Animate `transform` and `opacity` only (height via `motion` `layout`). Never `transition: all`. Every closed popover, drawer, or sheet unmounts cleanly via `AnimatePresence`.
- Elements rendered with `motion.*` use `whileHover` and `whileTap` and never receive CSS `transform` transitions. Plain HTML controls join the `:is(...)` motion list at the bottom of `src/app/globals.css` (`scale(0.97)` on `:active`).
- Target: `MotionProbe` p95 frame time `<= 20ms`, zero frames over `33ms`, full `prefers-reduced-motion` support.

## Answers in the conversation
- Activity bubbles ride inline in the agent label row (fixed 28px row), so the answer and its caret never jump while tools run.
- The answer types out at a client-paced, even speed (`src/components/typing.ts`: 90 to 320 chars/s following the backlog, never a burst at the end), with a thin text cursor inline at the end of the last line; text before a tool call stays and the answer continues as a new paragraph. The live turn and its saved message share one keyed instance, so typing never restarts or jumps when the stream ends. After a 200ms beat the components open as one height-animated block with a 60ms stagger, then the action row, then follow-ups. The log follows the bottom with one eased scroll that yields to any user input.
- Answer text goes through `parseProse` (`src/components/prose.ts`): paragraphs, bulleted lists (`-`, `*`, `•`) and numbered lists (`1.`, `1)`) render as `p`, `ul` and `ol` in `.ap-answer`, with markers in `--ap-ink-3`; heading marks are stripped to plain lines.
- Principle: long results stay usable at 1,000 items. Reference implementation: a list of up to 3 items renders as full cards; longer lists render as compact rows on one surface: 56px rows with title, one muted line, amount and status; inset hairlines between rows; height capped at about seven rows with a fade mask and its own scroll; a Filter field from 9 items; at most 100 rows rendered, the filter narrows the rest. Clicking a row opens its detail in the Inspector, and the row's primary action swaps in for the status on hover or focus.

