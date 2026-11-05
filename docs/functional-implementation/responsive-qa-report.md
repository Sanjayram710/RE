# SimpleGST — Responsive UI & Cross-Device QA Report

**Document Version:** 1.0.0  
**Audit Date:** November 5, 2026  
**Target Viewports:** 320px, 360px, 375px, 390px, 414px, 430px, 1366px, 1440px, 1920px  

---

## 1. Executive Summary

The SimpleGST platform was evaluated across desktop, tablet, and mobile viewports to ensure strict adherence to the Google Stitch design system, zero horizontal viewport overflow, readable typography, and touch-accessible controls.

All layout tests passed across all 9 targeted breakpoints with **zero clipping, zero layout overlap, and complete responsive integrity**.

---

## 2. Viewport Test Matrix & Observations

| Device / Viewport | Width × Height | Navigation Layout | Dashboard Grid | Modals & Tables | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Small Mobile** | 320 × 568 px | Off-canvas drawer (hidden by default) | 1 Column stacked (`grid-cols-1`) | Tables scroll horizontally in container; zero page overflow | **PASS** |
| **Android Standard** | 360 × 800 px | Off-canvas drawer + hamburger | 1 Column stacked | Modals fit within 90% screen height with vertical scroll | **PASS** |
| **iPhone SE / Small** | 375 × 667 px | Off-canvas drawer + hamburger | 1 Column stacked | Header elements compress gracefully; entity name truncates safely | **PASS** |
| **iPhone 12/13/14** | 390 × 844 px | Off-canvas drawer + backdrop tap | 1–2 Columns (`sm:grid-cols-2`) | Touch targets $\ge 44 \times 44\text{ px}$; form inputs readable | **PASS** |
| **iPhone Plus / Max** | 414 × 896 px | Off-canvas drawer + backdrop tap | 2 Columns | Financial cards display side-by-side with full digits visible | **PASS** |
| **iPhone 15/16 Pro Max**| 430 × 932 px | Off-canvas drawer + backdrop tap | 2 Columns | Optimal vertical rhythm and generous spacing | **PASS** |
| **Standard Laptop** | 1366 × 768 px | Fixed 256px Left Sidebar (`lg:pl-64`) | 4 Columns (`xl:grid-cols-4`) | Exact visual density match to attached desktop screenshot | **PASS** |
| **MacBook / Widescreen**| 1440 × 900 px | Fixed 256px Left Sidebar | 4 Columns | Perfect alignment between sidebar, header, and content canvas | **PASS** |
| **Full HD Display** | 1920 × 1080 px| Fixed 256px Left Sidebar | 4 Columns (max-w-[1600px] centered) | No stretching; whitespace controlled with max-width container | **PASS** |

---

## 3. Responsive Component Audits

### 3.1 Mobile Navigation Drawer
- **Trigger:** Accessible via hamburger menu button (`span.material-symbols-outlined: menu`) in top left header.
- **Transition:** Smooth CSS hardware-accelerated transform: `-translate-x-full` to `translate-x-0` with `transition-transform duration-300`.
- **Backdrop Overlay:** `#sidebarBackdrop` applies semi-transparent dark backdrop (`bg-slate-900/50 backdrop-blur-xs`) that dismisses the menu on tap outside.
- **Touch Sizing:** All navigation items provide padding $\ge 12\text{px}$ ensuring effortless finger taps.

### 3.2 Four Financial Overview Cards
- **Breakpoint Behavior:**
  - `< 640px`: Stacks vertically as 1 column (`grid-cols-1`) for clear readability of large monetary figures (`font-numeric-lg`).
  - `640px – 1280px`: Two-column grid (`sm:grid-cols-2`) grouping Sales + Purchases on row 1 and Net Tax + Eligible ITC on row 2.
  - `> 1280px`: Full 4-column desktop banner (`xl:grid-cols-4`) perfectly reproducing the Stitch reference screenshot.

### 3.3 Tables & Horizontal Overflow Defense
- **Defensive CSS:** All data tables (Recent Activity, Inward Registers, GSTR-2B Recon, Ledgers) are wrapped in `<div class="overflow-x-auto">`.
- **Integrity Rule:** Page body has `overflow-x: hidden`, preventing the viewport from shifting horizontally while allowing tables to be scrolled naturally on touch devices.

### 3.4 Modal Dialogues & Overlays
- **Sizing Rule:** `max-w-2xl` / `max-w-4xl` with `w-full my-auto max-h-[90vh] overflow-y-auto`.
- **Mobile Experience:** Modals expand to fill screen margins cleanly with `p-4 sm:p-6` padding, avoiding clipped buttons or out-of-reach save actions.
- **Dismissal:** Tap on backdrop or click on the top-right `close` button immediately closes the modal without alert interruptions.
