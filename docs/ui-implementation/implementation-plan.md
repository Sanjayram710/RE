# SimpleGST Stitch UI/UX Transformation — Implementation Plan

## 1. Goal & Objectives
Transform the complete SimpleGST Indian GST compliance application into a cohesive, institutional, multi-device responsive platform strictly aligned with the Google Stitch reference designs, while guaranteeing 100% preservation of all existing statutory engines (Rule 88A, RCM cash settlement, Rule 37 180-day tracker, GSTR-1 classification, Return lifecycle validation) and backend APIs.

---

## 2. Phased Architecture Strategy

### Phase 1: Reference Inventory & Visual Baselines (Completed)
- Extracted and cataloged all 13 Stitch module reference packages.
- Established primary visual benchmarks in `docs/ui-implementation/reference-inventory.md`.

### Phase 2: Design System & Architectural Mapping (Completed)
- Formalized palette, typography, radii, elevations, and responsive breakpoints in `docs/ui-implementation/design-system.md`.
- Mapped all routes, containers, and roles in `docs/ui-implementation/screen-mapping.md`.

### Phase 3: Application Shell Overhaul
- **Desktop Sidebar (`#appSidebar`)**: Fixed 256px (`w-64`) left sidebar with corporate branding, entity switcher, primary navigation destinations, active indicators, and user profile card.
- **Top Header (`#appTopHeader`)**: Sticky 64px (`h-16`) header displaying current business entity name, active filing period badge (`Oct 2026 - Due Nov 20`), user role badge, notification bell, and mobile hamburger trigger.
- **Mobile Bottom Navigation (`#appBottomNav`)**: Sticky 56px bottom navigation bar visible only on viewports <= 768px (`Home`, `File GST`, `Bills`, `Reports`, `Experts/More`).
- **Mobile Drawer**: Slide-out drawer with backdrop blur overlay and smooth CSS transition.

### Phase 4: Module Implementation & View Synchronization
- Verify and refine the 12 primary view suites in DOM:
  1. Home Dashboard (`#viewHomeSuite`)
  2. Guided Filing & Nil Return (`#viewCopilotSuite`)
  3. Bills & OCR Split-View (`#viewBillsSuite`)
  4. GSTR-2B ITC Reconciliation (`#viewReconSuite`)
  5. Tax Calc & GSTR-3B Review (`#viewTaxCalcSuite`)
  6. Electronic Ledgers & Reports (`#viewGstSuite`)
  7. CA Practice Hub (`#viewPracticeSuite`)
  8. Compliance Health & Copilot (`#viewComplianceSuite`)
  9. Vendor Communication (`#viewVendorSuite`)
  10. Form GST PMT-06 Modal (`#pmt-06-modal`)
  11. Post-Filing Success ARN Modal (`#arn-success-modal`)
  12. Multi-GSTIN Management (`#viewMultiGstinSuite` / `#viewStartupSuite`)

### Phase 5: Event Wiring & State Management
- Ensure `switchSuite(suiteName)` seamlessly manages active classes, updates navigation links, scrolls to top, and closes mobile drawers.
- Wire data-binding between forms, file uploads, OCR extractions, and ledger balances.
- Ensure modal dialogs (`#pmt-06-modal`, `#arn-success-modal`) open and close cleanly with backdrop dismissal and without alert dialogs.

### Phase 6: Statutory Calculation Integrity & Safety
- Maintain exact mathematical determinism across all calculations (Rule 88A, RCM cash settlement, Rule 37 180-day interest, GSTR-1 classification).
- Watermark all simulated operations clearly with `[SIMULATION MODE — NOT FILED ON GSTN COMMON PORTAL]`.

### Phase 7: Responsive Polish & Multi-Device Testing
- Test and verify fluid layout on:
  - 390px (Mobile)
  - 768px (Tablet)
  - 1280px (Laptop)
  - 1440px+ (Desktop)
- Eliminate horizontal page overflow and clipped controls.

### Phase 8: Visual Regression Verification
- Run local server and capture full-screen screenshots across all modules.
- Compare with Stitch reference designs.

### Phase 9: Automated Test Suite Execution
- Run complete test suite (`npm test`).
- Ensure all 108 tests pass without warnings or failures.

### Phase 10: Final Delivery Report
- Author `docs/ui-implementation/final-implementation-report.md`.
- Synchronize root and `public/` web assets.
- Commit and push to GitHub repository `https://github.com/Sanjayram710/RE.git` on branch `main`.
