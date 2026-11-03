# DESIGN.md — SimpleGST FinTech Design System

> **Design Intelligence & Art Direction Specification**  
> Inspired by `ui-ux-pro-max-skill`, `awesome-design-md`, `taste-skill`, and `design-motion-principles`.  
> Built for: High-trust, precise, frictionless tax compliance & financial e-filing.

---

## 1. Brand Identity & Personality

* **Aesthetic Tone:** Calm, authoritative, and frictionless FinTech. Like Stripe's precision engineered with Indian tax domain nuance.
* **Target Users:** Individual taxpayers (salaried & investors), CAs/Tax practitioners, and SME business owners.
* **Core Philosophy:** "Design System First, Zero Generic AI Vibe, High Legibility, Absolute Trust".
* **Golden Rules:**
  1. No rainbow or arbitrary card colors. Color is functional, semantic, and restrained.
  2. Numbers, currencies, and alphanumeric identifiers (PAN, GSTIN, IRN) must strictly use tabular numerals (`tabular-nums`) with `JetBrains Mono` or `Inter`.
  3. Every interactive control must provide tactile feedback (hover elevation, active compression, focus rings).
  4. Fully responsive: clean and frictionless down to 390px mobile screens without overflow or squished text.

---

## 2. Color System & Tokens

### Primary & Canvas Tokens
```css
:root {
  /* Surfaces & Canvases */
  --bg-canvas: #F8FAFC;          /* Clean slate-gray canvas */
  --bg-surface: #FFFFFF;         /* Pure white card backgrounds */
  --bg-surface-elevated: #FFFFFF;/* Elevated panels & modals */
  --bg-surface-subtle: #F1F5F9;  /* Inactive pills, code blocks, borders */
  
  /* Text & Ink */
  --text-main: #0F172A;          /* Slate 900: High-contrast primary headers */
  --text-body: #334155;          /* Slate 700: Body copy & form labels */
  --text-muted: #64748B;         /* Slate 500: Subtitles, helper text, timestamps */
  --text-subtle: #94A3B8;        /* Slate 400: Placeholders, inactive icons */

  /* Brand Accents */
  --brand-primary: #1E40AF;      /* Deep sapphire blue: Trust & primary CTAs */
  --brand-accent: #2563EB;       /* Electric blue: Active states, links, focus rings */
  --brand-hover: #1D4ED8;        /* Deep hover tone */
  --brand-soft: #EFF6FF;         /* 5% tint for highlights & badges */

  /* FinTech Status Tokens */
  --status-success: #059669;     /* Emerald 600: Qualified ITC, Refunds, Valid */
  --status-success-bg: #ECFDF5;
  --status-success-border: #A7F3D0;

  --status-warning: #D97706;     /* Amber 600: Mismatch, Review, Due soon */
  --status-warning-bg: #FFFBEB;
  --status-warning-border: #FDE68A;

  --status-danger: #DC2626;      /* Ruby 600: Blocked ITC, Scrutiny Notice, Errors */
  --status-danger-bg: #FEF2F2;
  --status-danger-border: #FECACA;

  --status-advisory: #7C3AED;    /* Violet 600: CA Expert Advice, Tax Optimizations */
  --status-advisory-bg: #F5F3FF;
  --status-advisory-border: #DDD6FE;
  
  /* Borders & Hairlines */
  --border-subtle: #E2E8F0;      /* Standard 1px divider */
  --border-card: rgba(226, 232, 240, 0.85);
  --border-focus: #2563EB;
}
```

---

## 3. Typography & Hierarchy

* **Primary Font Stack:** `'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
* **Monospace Font Stack:** `'JetBrains Mono', Consolas, Monaco, monospace`
* **Scale & Tracking:**
  - **Display (H1):** `24px / 32px` desktop (`20px / 28px` mobile), font-weight: `700`, letter-spacing: `-0.03em`.
  - **Card Header (H2):** `17px / 24px`, font-weight: `600`, letter-spacing: `-0.015em`.
  - **Section Subheader:** `11px / 16px`, font-weight: `700`, uppercase, letter-spacing: `+0.06em`, color: `--text-muted`.
  - **Body Standard:** `14px / 20px`, font-weight: `400` / `500`.
  - **Monospace Figures:** `14px` or `16px`, `font-variant-numeric: tabular-nums lining-nums`. Indian numbering format: `₹12,45,000` via `.toLocaleString('en-IN')`.

---

## 4. Spacing & Elevation

* **Grid Base:** 4px baseline rhythm (`4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `48px`).
* **Radius Hierarchy:**
  - Pills & Badges: `9999px` (Full capsule)
  - Inputs & Action Buttons: `8px` - `10px`
  - Cards & Modals: `14px` - `16px`
* **Shadow Hierarchy:**
  ```css
  --shadow-subtle: 0 1px 2px 0 rgba(15, 23, 42, 0.04);
  --shadow-card: 0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.03);
  --shadow-hover: 0 10px 20px -3px rgba(15, 23, 42, 0.07), 0 4px 6px -2px rgba(15, 23, 42, 0.03);
  --shadow-popover: 0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.04);
  ```

---

## 5. Motion & Micro-interactions (`design-motion-principles`)

* **Speed & Easing:**
  - Micro-interactions (hover, active press): `150ms cubic-bezier(0.16, 1, 0.3, 1)`
  - Card expansion / accordions: `220ms cubic-bezier(0.2, 0.8, 0.2, 1)`
  - Modals & Drawers: `280ms cubic-bezier(0.16, 1, 0.3, 1)`
* **Active Press Feedback:**
  - Buttons scale to `transform: scale(0.985)` on `:active`.
* **Subtle Indicator Pulse:**
  - Status indicators (e.g., Demo Mode, GSP Live Sync) gently pulse at `2s infinite ease-in-out`.
* **Zero Decorative Blobs:**
  - Animations exist exclusively to guide attention, confirm actions, or explain state transitions.

---

## 6. Layout & Responsiveness

* **Desktop Layout:** Two-column split with sticky computation sidebar on the right (`width: 380px`), form workbench on the left (`flex: 1`).
* **Mobile Layout (<900px down to 390px):**
  - Top navigation splits into a clean primary brand bar and a smooth horizontally scrolling segmented suite bar.
  - Form grids collapse to single-column without cramping.
  - Sticky summary drawer on mobile provides instant visibility of tax payable/refund.
* **Statutory Notice:**
  - Preserved requirement: `"Demo files. Not official GST portal or income tax portal files."`
  - Integrated into a sleek compliance info chip directly below navigation.
