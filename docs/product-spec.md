# Product Specification: SimpleGST

**SimpleGST** is an independent, high-performance web platform and financial export engine engineered for MSMEs, tax consultants, and accountants. It delivers instant report generation, error-proof invoice ingestion, 2B-to-books reconciliation, and deterministic GSTR-3B tax computation with sandbox GSP integration.

---

## 1. System Architecture & Boundaries

```
[ Web Browser Frontend (Vanilla ES6, CSS3, Mobile-first 390px+) ]
                          |  REST API / SSE (Port 3000)
[ Express/Node.js Server (server.js) ]
       ├── /api/mode                  -> System mode ("demo" | "live-sandbox")
       ├── /api/sample-data           -> Canonical demo datasets
       ├── /api/validate              -> Live PAN & GSTIN validator
       ├── /api/invoices/import       -> Excel/CSV import + Error Report generation
       ├── /api/reconciliation        -> Books vs 2B matching engine
       ├── /api/returns/3b-summary    -> Deterministic GSTR-3B liability engine
       ├── /api/export/*              -> Multi-format exporters (JSON, Excel, CSV)
       └── /lib/gsp/*                 -> GSP Adapter Layer (Auth, GSTR1, 2B, 3B, IMS)
```

## 2. Core Functional Modules

### A. Reports & Exports Center
- **Available Reports (6 Types)**:
  1. GSTR-1 Summary & Outward Register
  2. GSTR-3B Summary & Tax Computation
  3. Sales Register (Itemized Invoice Details)
  4. Purchase Register (Itemized Vendor Details)
  5. GSTR-2B vs Books Reconciliation Statement
  6. ITR-1 Sahaj Statement (Tax Computation & Schedule)
- **Supported Export Formats**: Formatted Excel (`.xls` / `.xlsx`), RFC 4180 CSV (`.csv`), GSTN Schema JSON (`.json`).
- **User Experience**: Filter bar (Period, Party/GSTIN, Status, Rate) -> Live Preview Table with sticky Totals Row -> "Generate" with progress bar -> Result Card (filename, rows, size) + Immediate Download buttons + Client-side Export History stored in `localStorage`.

### B. Invoicing & Smart Data Import
- **Manual Bill Entry**: Invoice number, date, party name, GSTIN (live validation), taxable amount, GST rate (0%, 5%, 12%, 18%, 28%), same-state (CGST+SGST) vs other-state (IGST) live calculator.
- **Bulk Excel/CSV Import**: File upload parsing with inline preview.
- **Round-Trip Error Resolution**: If rows contain errors (invalid GSTIN, negative amount, wrong tax split), user downloads a pre-formatted `Error_Report.xlsx` containing the faulty rows and an explicit `Error Reason` column for offline fix and re-upload.
- **Download Sample Template**: Ready-to-use clean CSV/Excel template for sales and purchases.

### C. GSTR-2A/2B Reconciliation Engine
- Matches internal purchase invoices against simulated / sandbox GSTR-2B entries.
- Identifies 4 discrepancy types: Matched, Value Mismatch, Missing in 2B (unfiled by vendor), Missing in Books.
- Single-click triage actions: **Accept** (claim ITC), **Hold** (defer credit), **Ask Supplier** (generate reminder payload).
- Export complete reconciliation audit sheet.

### D. Deterministic GSTR-3B Liability Engine
- Formula: `Total Output Tax - Eligible ITC = Net GST Payable`.
- Rule-based set-off logic (IGST offset first, then CGST/SGST).
- "How Calculated" breakdown drawer explaining every rupee.
- Sandbox-only filing simulator: Confirmation checkbox -> 6-digit OTP verification modal -> Fake ARN issuance. Never submits to live production.

### E. GSP Adapter Layer (`lib/gsp/`)
- MOCK mode by default; LIVE mode enabled when `GSP_BASE_URL`, `GSP_CLIENT_ID`, `GSP_CLIENT_SECRET` are defined.
- Source of truth: `data/api-status.json` (182 APIs). Any endpoint with status `not_working`, `partial`, or `not_tested` returns HTTP 501 / "Not available yet".
- Redaction of tokens and secrets in all server console logs.

---
*SimpleGST is an original, clean-room implementation adhering strictly to public GST specifications.*

