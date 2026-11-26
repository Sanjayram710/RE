# DESIGN.md — SimpleGST Design System & Motion Spec

Simple, plain-English GST filing for ordinary retail shop owners with no accounting background.
Visual & motion reference: `SimpleGST_ all sections (animated) (1).html` (prototype data/behaviour is **never** copied; all amounts, statuses, invoices, and ARNs come from verified backend APIs).

> **Single Source of Truth (`public/` vs Root)**:
> `server.js` checks `public/` before root. Root files (`index.html`, `app.js`, `style.css`, `landing.html`, `simplegst-app-v2.html`) are synced to `public/` by `npm run build` (`scripts/sync_public.js`), while modular Phase 2+ assets live directly under `public/v2/` and are preserved untouched.

---

## 1. Colour Tokens

| Token | Light Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | Primary canvas |
| `--bg2` | `#f6f7fc` | Secondary / table header / input surface |
| `--card` | `#ffffff` | Card surface |
| `--ink` | `#12142b` | Primary headings & body (`>= 4.5:1` contrast) |
| `--mut` | `#5f6487` | Secondary & meta text (`>= 4.5:1` contrast) |
| `--line` | `#e6e8f2` | Hairline borders & dividers |
| `--acc` | `#4b3fe0` | Brand Indigo accent (swappable via CSS tokens) |
| `--on` | `#ffffff` | Text on accent |
| `--soft` | `#eeedfe` | Soft accent tint & nav hover pill |
| `--ok` / `--okb` | `#0b7a4b` / `#e3f6ec` | Done / Eligible ITC |
| `--warn` / `--warnb` | `#944d00` / `#fff4e5` | Due / Simulation / Needs CA Review |
| `--bad` / `--corb` | `#c93b25` / `#fde8e5` | Error / Delete / Overdue |

---

## 2. Typography & Layout

- **Display / Headings / KPI Numerals**: `Plus Jakarta Sans` (`500`, `700`, `800`), tight tracking (`-0.04em` to `-0.06em`).
- **Body / Tables**: `Inter` (`400`, `500`, `600`), `15px/1.5`.
- **Money**: Formatted from **integer paise** with Indian grouping and `font-variant-numeric: tabular-nums`. Zero float math in the browser.
- **Cards**: `36px` (`28px` on mobile) border radius, `1px solid var(--line)`, **one filled highlight card** (`.kc.hi`) per screen.
- **Targets & Accessibility**: Minimum `44px x 44px` interactive targets, visible `:focus-visible` outlines, `<label>` on all controls, and mobile bottom tab bar under `768px`.

---

## 3. Shared Motion System (`public/v2/motion.js`)

All animations animate `transform` and `opacity` only (plus SVG `stroke-dashoffset`), live in `public/v2/motion.js`, and respect both `@media (prefers-reduced-motion: reduce)` and the Settings **"Reduce animations"** switch (`[data-reduce-motion="true"]`). Motion never blocks data fetching, buttons, or forms.

| Animation | Token / Timing | Easing / Notes |
|---|---|---|
| Global ease | `--ease` | `cubic-bezier(.2, .8, .2, 1)` |
| Top bar drop-in (`dn`) | `800ms` | `transform: translateY(-100%) -> none` |
| Nav sliding pill (`.ni`) | `500ms` (`transform`, `width`), `300ms` (`opacity`) | Shared layout indicator for active & hovered tab |
| Page transition curtain (`.cu`) | `500ms` in + `550ms` out (~`1.1s` total) | Sweeps **UP only** (`translateY(101%) -> 0 -> -101%`); word reveal `900ms` (`70ms` stagger), chips `600ms` (`80ms` stagger), bar `800ms`; data fetch starts immediately; clicks ignored while running |
| Page section stagger (`up`) | `700ms`, `70ms` per child | `translateY(34px)` + `opacity: 0 -> 1` |
| Greeting word reveal (`wd`) | `1000ms`, `200ms` delay + `110ms` stagger | `translateY(110%) rotate(4deg) -> none` |
| Progress ring (`.rg .p`) | `2000ms`, `500ms` delay | SVG `stroke-dashoffset` sweep |
| Step rows (`rs`) | `800ms` (`300ms`, `450ms`, `600ms` delays) | `translateX(60px) -> none` |
| KPI count-up | `1300ms` | Quartic ease-out `1 - (1 - p)^4` on integer paise |
| Highlight blobs (`bl`) | `7s` & `9s` alternate | Soft radial glow inside `.kc.hi` |
| Table rows (`r` / `rm`) | `600ms` (`80ms` stagger) / `450ms` delete slide-out | Followed by Undo toast (`4500ms`) |
| Copilot FAB & panel (`.pn`) | Ripple `2.4s`, panel `550ms` (`scale(.2) -> 1`) | Grows from bottom-right corner; typing dots + typewriter |
| Mascot (`.mas`, `>= 1400px` desktop) | Bob `3.5s`, blink `4s`, cursor-follow eyes | Bubble reflects **real** filing progress |
| Scroll progress (`.pb`) & strip (`.mq`) | `scaleX` on scroll / `28s linear infinite` | Strip displays **real** due date, steps done, and ITC |
| Desktop card glow & `.mag` buttons | Pointer-move (`pointer: fine` only) | Disabled on touch/mobile |
| Filing celebration (`cf2`) | `1.8s–3.2s` confetti | Triggers **only** after genuine `POST /api/returns/gstr3b/file` `"Filed (simulation)"` success |
