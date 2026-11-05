# SimpleGST Functional Architecture Audit

## Executive Summary
This audit evaluates the codebase of the **SimpleGST Indian GST Compliance Platform** across 9 architectural dimensions. While the statutory calculation engines (Rule 88A set-off, Section 9 RCM cash payment, Rule 37 180-day tracker, GSTR-1 classifier, lifecycle dependency validator) are validated and mathematically deterministic with 108 passing tests, the operational layer previously relied on in-memory mock datasets (`lib/demoData.js`, in-memory `lib/vaultStore.js`, static demo business state). This audit establishes the baseline for transforming SimpleGST into a genuinely data-driven, multi-tenant compliance platform.

---

## 1. Architectural Review by Dimension

### A. Existing Application Architecture
- **Runtime & Stack**: Node.js 24 runtime (`server.js` using native HTTP server and standard library modules).
- **Frontend Architecture**: Vanilla ES6 JavaScript (`app.js`), semantic HTML5 (`index.html`), custom CSS (`style.css`), Tailwind CDN, and Material Symbols.
- **State Separation**: Frontend maintains client-side UI states (`appState`), while backend handles calculation and statutory rules.
- **Defects Identified**: Several frontend sections previously fetched `/api/sample-data` or relied on hardcoded fallback objects instead of scoped database queries.

### B. Backend and API Analysis
- **Currently Fully Working**:
  - Rule 88A set-off computation endpoint (`/api/statutory/rule88a-setoff`)
  - RCM cash tax and Section 17(5) blocking (`/api/statutory/rcm-process`)
  - Rule 37 180-day supplier payment aging tracker (`/api/statutory/180-day-tracker`)
  - GSTR-1 statutory classification (`/api/statutory/gstr1-classify`)
  - Return lifecycle validation (`/api/statutory/lifecycle/validate-gstr1`, `validate-gstr3b`)
  - Electronic ledgers & PMT-06 generation (`/api/statutory/ledgers`, `/api/statutory/pmt06/generate`, `/api/statutory/pmt09/transfer`)
  - 182 GST GSP/ASP API catalog & public verification (`/api/gsp/*`)
  - CA Practice Hub multi-client management with tenant isolation (`/api/practice/*`)
- **Partially Implemented**:
  - Invoices import (`/api/invoices/import`): Accepted CSV/JSON but was not persisting to a relational database per GSTIN.
  - Document vault (`/api/vault/upload`): Stored metadata in an in-memory array (`vaultStore.js`).
  - Copilot pipeline (`/api/copilot/pipeline`): Aggregated hardcoded `DEMO_SALES` rather than user's active GSTIN invoices.
  - Multi-GSTIN summary (`/api/multi-gstin/summary`): Returned static demo branches without CRUD or persistence.
- **Missing / Simulated**:
  - Live GSTN GSP API submission: Requires paid production GSP credentials; must remain clearly watermarked in Demo/Simulation Mode.
  - Direct WhatsApp / Email SMTP dispatches: Simulated drafts without live third-party credentials.

### C. Database and Persistence
- **Previous State**: In-memory JavaScript structures (`DEMO_BUSINESS`, `DEMO_SALES`, `DEMO_PURCHASES`, `vaultStore.js`), supplemented with JSON files in `data/` (`practiceStore.json`, `practiceAuditLog.json`).
- **Target Architecture**: Persistent relational storage using Node 24 native `node:sqlite` (`data/simplegst.db`). Provides ACID transactions, foreign keys, multi-tenant isolation, unique constraints, and persistence across restarts without external dependencies.

### D. File Upload and Document Processing
- **Previous State**: Fake file upload returning static success toasts without saving physical files to secure disk storage.
- **Target Architecture**: Secure server-side disk storage in `data/uploads/` with UUID-based storage keys, MIME-type and size validation, path traversal defense, and scoped access by user, organization, and GSTIN.

### E. GST Copilot & AI Integration
- **Previous State**: `/api/copilot/pipeline` used static figures; `/api/copilot/ask` used rule-based regex over static demo numbers.
- **Target Architecture**: Real Copilot context retrieval querying the active organization, active GSTIN, filing period, persisted sales/purchases, 2B recon status, and ledger deficit. Includes an explicit AI provider configuration status warning when no external LLM API key is set, falling back to a deterministic statutory context engine.

### F. Multi-GSTIN Management
- **Previous State**: Switching GSTIN updated the UI label but did not filter backend transactions by the selected GSTIN.
- **Target Architecture**: Full organization entity management supporting multiple state branch registrations, primary branch toggling, format validation, and strictly scoped queries to prevent cross-GSTIN data leakage.

### G. GST Statutory Workflow
- **Status**: Complete and mathematically validated (Rule 88A, RCM, Rule 37 180-day tracker, GSTR-1, PMT-06 OTC limit, Return lifecycle prerequisites).
- **Target**: Wire these verified engines directly to persisted database records.

### H. Security and Authorization
- **Target Architecture**: Session-based auth tokens, tenant isolation (Org ID + GSTIN scoping on every SQL query), role-based permissions (Business Owner vs Chartered Accountant), and path-sanitized file retrieval.

### I. Integration Testing
- 108 existing automated tests all pass. New comprehensive integration tests will cover database CRUD, file upload/download, multi-GSTIN scoping, Copilot context retrieval, and demo filing safety.

