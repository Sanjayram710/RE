# SimpleGST Stitch Design System Specification

## 1. Executive Summary & Philosophy
The SimpleGST design system is engineered to provide a high-trust, institutional, yet effortless digital workspace for Indian GST compliance. It serves Chartered Accountants (CAs), tax practitioners, enterprise CFOs, and MSME business owners who handle legally binding financial returns under statutory deadlines.

The visual theme combines crisp enterprise clarity with modern FinTech ergonomics:
- **Clean surfaces**: Soft `#f8f9ff` canvas with pure white `#ffffff` elevated containers.
- **Deep institutional anchor**: Slate Navy `#0b1c30` for authoritative headers and readable data rows.
- **Government-grade validation tone**: Pine Teal `#00685f` (Primary) and `#008378` (Primary Container) for verified status and primary actions.
- **Strict status semantics**: Emerald `#059669` (Matched/Filed), Amber `#d97706` (Due Soon/Variance), Ruby `#ba1a1a` (Blocked/Deficit), and Indigo `#4b41e1` (AI Copilot/Advisory).

---

## 2. Color Tokens

### Surface & Background Tokens
| Token | Hex Value | Usage |
|---|---|---|
| `surface` / `background` | `#f8f9ff` | Global foundation canvas |
| `surface-container-lowest` | `#ffffff` | Elevated cards, modals, table bodies |
| `surface-container-low` | `#eff4ff` | Secondary card fills, sidebar hover |
| `surface-container` | `#e5eeff` | Section backgrounds, pill containers |
| `surface-container-high` | `#dce9ff` | Selected navigation items, badge backgrounds |
| `surface-container-highest`| `#d3e4fe` | Active borders and highlights |

### Content & Typography Tokens
| Token | Hex Value | Usage |
|---|---|---|
| `on-surface` | `#0b1c30` | Primary headings, table text, card titles |
| `on-surface-variant` | `#3d4947` | Secondary text, form labels, table headers |
| `secondary` | `#565e74` | Subtext, timestamps, helper descriptions |
| `outline` | `#6d7a77` | Standard input borders and card dividers |
| `outline-variant` | `#bcc9c6` | Subtle hairlines, table borders, inactive tabs |

### Brand & Interactive Accent Tokens
| Token | Hex Value | Usage |
|---|---|---|
| `primary` | `#00685f` | Primary CTA buttons, active sidebar links, verified checkmarks |
| `on-primary` | `#ffffff` | Text on primary buttons and badges |
| `primary-container` | `#008378` | Hover state on primary buttons, accent banners |
| `on-primary-container`| `#f4fffc` | Text on primary containers |
| `tertiary` | `#4b41e1` | GST Copilot brand color, AI suggestion chips |
| `tertiary-container` | `#645efb` | Copilot action triggers, AI message cards |

### Statutory Status Semantics
| Status | Text Color | Background Color | Border Color | Meaning |
|---|---|---|---|---|
| **Matched / Filed** | `#065f46` | `#ecfdf5` | `#a7f3d0` | Verified on GSTR-2B or filed on GST portal |
| **Pending / Due** | `#92400e` | `#fffbeb` | `#fde68a` | Upcoming statutory deadline or unfiled return |
| **Mismatch / Action** | `#991b1b` | `#fef2f2` | `#fecaca` | Tax/value variance, Rule 37 180-day trigger |
| **Blocked Credit** | `#4338ca` | `#eef2ff` | `#c7d2fe` | Section 17(5) blocked ITC (Food, Motor Vehicles) |

---

## 3. Typography Scale
SimpleGST utilizes a dual-font system pairing **Plus Jakarta Sans** for headlines and structural hierarchy with **Inter** for dense tabular data and forms.

| Scale Token | Font Family | Size | Weight | Line Height | Application |
|---|---|---|---|---|---|
| `display-lg` | Plus Jakarta Sans | 40px | 700 (Bold) | 48px | Welcome titles, Hero metrics |
| `headline-lg` | Plus Jakarta Sans | 28px | 600 (SemiBold) | 36px | Main page titles, Section banners |
| `headline-md` | Plus Jakarta Sans | 20px | 600 (SemiBold) | 26px | Card headers, Modal titles |
| `headline-sm` | Plus Jakarta Sans | 16px | 600 (SemiBold) | 22px | Group titles, Table column headers |
| `body-lg` | Inter | 16px | 400 (Regular) | 24px | Descriptive text, Copilot responses |
| `body-md` | Inter | 14px | 400 (Regular) | 20px | Standard paragraph text, form hints |
| `body-sm` | Inter | 12px | 400 (Regular) | 18px | Timestamp text, metadata captions |
| `label-lg` | Inter | 14px | 600 (SemiBold) | 20px | Primary button labels, active tab text |
| `label-md` | Inter | 12px | 500 (Medium) | 16px | Form input labels, secondary buttons |
| `label-sm` | Inter | 11px | 600 (SemiBold) | 14px | Status pills, badge text |
| `numeric-lg` | Inter (Tabular) | 24px | 600 (SemiBold) | 30px | KPI currency metrics (₹) |
| `numeric-md` | Inter (Tabular) | 14px | 500 (Medium) | 20px | Table cell amounts, GSTIN codes |

---

## 4. Spacing & Elevation System

### Radius Tokens
- `sm`: 4px (`0.25rem`) — Status badges, micro tags, checkboxes
- `DEFAULT`: 8px (`0.5rem`) — Form inputs, standard buttons, select dropdowns
- `md`: 12px (`0.75rem`) — Standard cards, tab containers, preview tiles
- `lg`: 16px (`1rem`) — Major containers, modal dialogs, drawer panels
- `full`: 9999px — Status pills, toggle switches, user avatars

### Elevation & Shadows
- **Card Resting**: `0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.05)` with a 1px solid `#e2e8f0` border.
- **Card Hover**: `0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.05)`.
- **Dropdowns & Popovers**: `0 10px 15px -3px rgba(15, 23, 42, 0.08)` with a 1px solid `#cbd5e1` outline.
- **Modals & Drawers**: `0 20px 25px -5px rgba(15, 23, 42, 0.12)` over a `bg-slate-900/60` backdrop blur.

---

## 5. Responsive Grid & Breakpoint Architecture
- **Mobile (< 768px)**:
  - Sidebar hidden, accessed via hamburger drawer.
  - Sticky bottom navigation bar (5 core actions: Home, File GST, Bills & Docs, Reports, More/CA Hub).
  - Single-column stacked cards. Tables adapt to horizontal scroll with sticky headers.
- **Tablet (768px - 1279px)**:
  - Collapsed icon rail or slide-out navigation.
  - 2-column KPI grids, 16px gutter spacing.
- **Desktop (>= 1280px)**:
  - Fixed 256px (`w-64`) left sidebar.
  - 12-column grid with 24px gutters.
  - Dedicated side trays for contextual actions (GST Copilot, Split-View OCR Review).

