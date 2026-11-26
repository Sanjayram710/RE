# DESIGN.md — SimpleGST Design System

Simple, plain-English GST filing for ordinary retail shop owners with no accounting background.
This file is the single source of truth for SimpleGST's UI, motion, accessibility, and copy standards.

> **Single Source of Truth (`public/` vs Root)**:
> `server.js` serves static assets from `public/` first (falling back to root). Historically, `public/` mirrored root HTML/CSS/JS files for static hosting compatibility. Root files (and `public/v2/` modules starting in Phase 2) are the single authoring source of truth; `npm run build` runs `scripts/sync_public.js` and verifies SHA-256 byte-for-byte parity before any release.

---

## 1. Visual Direction (KrewsUp-Inspired Prototype Tokens)

- **Canvas & Surfaces**:
  - Primary canvas: `#FFFFFF` (`--bg`)
  - Soft secondary surface: `#F6F7FC` (`--bg2`)
  - Card surface: `#FFFFFF` (`--card`)
  - Hairline borders: `1px solid #E6E8F2` (`--line`)
- **Brand & Status Colour Tokens** (swappable via CSS custom properties):
  - Brand accent (`--acc`): `#4B3FE0` (Indigo) · text on accent (`--on`): `#FFFFFF`
  - Soft brand tint (`--soft`): `#EEEDFE`
  - Ink primary (`--ink`): `#12142B` · secondary (`--mut`): `#5F6487` (all text >= 4.5:1 WCAG AA contrast)
  - Success / Eligible ITC (`--ok` / `--okb`): `#0B7A4B` / `#E3F6EC`
  - Warning / Needs Review (`--warn` / `--warnb`): `#B25E00` / `#FFF4E5`
  - Error / Tax Due (`--cor` / `--corb`): `#E8553D` / `#FDE8E5`
- **Card & Surface Rules**:
  - Card border-radius: `24px`–`36px` (`28px` default).
  - **One filled highlight card per screen** (e.g. "Estimated Tax to Pay" or primary CTA card); all other cards stay white with hairline `#E6E8F2` borders.
  - Generous whitespace; no dense accounting tables on the main dashboard.

---

## 2. Typography

- **Display / Headings / Big Numerals**: `Plus Jakarta Sans`, weights `600`, `700`, `800`, tight tracking (`-0.03em` to `-0.045em`).
- **Body & Tables**: `Inter`, weights `400`, `500`, `600`, `15px/1.5`.
- **Financial Amounts**: Always formatted in Indian numbering (`₹1,23,456.00`) with `font-variant-numeric: tabular-nums`. Computed in **integer paise** on the backend; never hardcoded in the frontend.

---

## 3. Navigation & Layout

- **Desktop Top Bar**:
  - Brand wordmark (`SimpleGST`) on left.
  - Centered pill navigation (`Home`, `File GST`, `Invoices`, `History`, `Copilot`, `Tax Experts`, `Start a business`, `Settings`).
  - Always-visible **GSTIN / Branch switcher** and authenticated user menu on the right.
- **Mobile (`<= 768px`)**:
  - Sticky bottom tab bar (`Home`, `File GST`, `Invoices`, `Copilot`, `More`) with `>= 44px` touch targets.
- **One Clear Focus Per Screen**:
  - Numbered sections (`01`, `02`, `03`…), big numerals, short friendly copy.
  - Guided filing uses 5 clear steps with saved draft progress (`filing_drafts` per `org + gstin + period`):
    1. Add sales bills
    2. Add purchase bills
    3. Check tax credit and reconciliation
    4. Review tax payable (Rule 88A + RCM)
    5. Review and submit the GST return (**Simulation** clearly labelled)

---

## 4. Restrained Motion

- **Allowed**:
  - Page fade-up (`<= 400ms`, `cubic-bezier(.2,.8,.2,1)`)
  - Progress bar and ring stroke transitions
  - Count-up on amounts when real API data loads
  - Skeleton loaders during async fetches
  - Inline Copilot panel slide-in
  - Table row add/remove transitions and toast with **Undo**
- **Not Allowed**:
  - Confetti, mascots, full-screen wipes, cursor-follow effects, marquees, or looping decorative animations.
- **Accessibility**: Everything respects `@media (prefers-reduced-motion: reduce)`.

---

## 5. States, Accessibility & Honest Labelling

- Every view implements explicit **Loading** (skeleton), **Empty** (plain-English next step), **Error** (actionable retry), and **Success** states.
- Minimum interactive target size: `44px x 44px`. Visible `:focus-visible` outlines (`2px solid var(--acc)`). Proper `<label>`, `aria-live`, and `aria-current="page"`.
- **Simulation Labelling**: When live GSP credentials are not active, every OTP step, ARN receipt, status badge, and history row must explicitly display **"Simulation"** / **"Filed (simulation)"** — never an official-looking `"Filed"` status without `"(simulation)"`.
- **CA Review Transparency**: Every statutory rule reference and plain-English explanation is flagged `needsCaReview: true` in an exportable CA review list (`caReviewItems`).
- **Copilot Honesty**: GST Copilot answers strictly from deterministic backend tool results and never invents tax amounts, rules, or filing statuses.
