# DESIGN.md — SimpleGST design system

Simple, friendly GST filing for small business owners. Plain words first, GST terms second.
This file is the source of truth for the UI in `index.html`, `landing.html`, `app.js` and `style.css`
(the `public/` copies are served and must stay identical).

## 1. Brand

- Logos: `public/brand/simplegst-wordmark.png` (header, sign-in, landing) and
  `public/brand/simplegst-mark.png` (app icon, favicon source). `public/brand/favicon-32.png` is the favicon.
- Never recolour, stretch or redraw the logos. Wordmark height 28–32px.
- Brand green comes from the logo: `#0A6B4F`.

## 2. Colour

| Token | Value | Use |
|---|---|---|
| brand / `primary` | `#0A6B4F` | Primary buttons, active nav, links |
| brand hover / `primary-container` | `#08583F` | Hover on primary |
| brand soft / `surface-container-high` | `#E8F3EE` | Active nav background, chips |
| ink / `on-surface` | `#111827` | Headings and body |
| ink 2 / `on-surface-variant` | `#4B5563` | Secondary text |
| ink 3 / `secondary` | `#6B7280` | Meta text (12.5px and up only) |
| canvas / `surface` | `#F6F8FA` | Page background |
| line / `outline-variant` | `#E6E9EE` | Card borders, dividers |

Tints have a fixed meaning and are never decorative:

| Meaning | Soft | Strong |
|---|---|---|
| Sales | `#EEF4FF` | `#2F6FEB` |
| Purchases | `#F3F0FF` | `#6D4FD8` |
| Done / tax credit | `#EAF6EF` | `#15803D` |
| Due / tax to pay | `#FFF5E6` | `#B45309` |
| Error | `#FDECEC` | `#B91C1C` |

The Tailwind config in each page defines a `brand-50 … brand-900` scale; use it instead of blue/indigo.
CSS custom properties `--sg-*` in `style.css` mirror these values.

## 3. Type

- One family: **Figtree** (400/500/600/700). Amounts use `tabular-nums`.
- Scale: page title 28 · card title 19–20 · stat 24 · body 15 · meta 13. Nothing below 12px.

## 4. Icons

- **Material Symbols Rounded**, weight 400, unfilled, 20–22px. One library everywhere.
- Icons sit beside labels; icon-only buttons need `aria-label`.
- **No emojis and no decorative Unicode symbols** anywhere in the UI, alerts or generated text.

## 5. Components (see `style.css`, "SimpleGST design system")

- `sidebar-nav-link` + `is-active`: the main navigation. Items: Home, File GST, My Invoices,
  Documents, GST Copilot, Tax Experts, Start a business, Settings. Grouped pages (Purchases,
  Reconciliation, Tax calculation, Vendors) highlight their parent via `SIDEBAR_NAV_ALIASES` in `app.js`.
- Mobile bottom bar: Home, File, Invoices, Copilot, More (opens the drawer).
- `sg-card`: white, 1px line border, 14px radius, no shadow.
- `sg-step` (`is-sales` / `is-purchases` / `is-file`, plus `is-done`): the Home 3-step filing card.
- `sg-tile` (`blue` / `violet` / `green` / `amber` / `brand`): 40px tinted icon tile for stats.
- `sg-btn-primary`: the single main action on a screen.
- `sg-chip`, `sg-pill-due`: period chip and due-date countdown.
- Shadows only on menus and dialogs. No gradients, glass or blur.

## 6. Motion

- 150–200ms colour/border transitions for hover and menus. No pulsing dots, glows, floating
  badges or infinite loops. `prefers-reduced-motion` turns transitions off.

## 7. GST Copilot

- Page: `#viewCopilotSuite`. Chat controller: `askCopilotPrompt`, `handleCopilotSubmit`,
  `clearCopilotChat` in `app.js`, calling the existing `POST /api/copilot/ask`.
- Copilot answers from the active GSTIN's records using fixed rules (sales, ITC, missing in 2B,
  tax liability, 180-day bills, 3B explanation, filing checklist, cash ledger, nil returns).
  It is not a free-form AI model; the UI must not claim otherwise.
- Entry points: sidebar, mobile bottom bar, Home "Ask GST Copilot" card.

## 8. Writing

- Customer words first: "Bills from your suppliers", "Tax credit (ITC)", "Tax to pay".
- No superlatives ("100%", "India's most trusted") and no engineering jargon in labels.
