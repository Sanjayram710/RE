# SimpleGST Platform & Financial Tax Engine

SimpleGST is an independent financial tax platform and export engine built in accordance with public CBDT e-Filing guidelines, GSTN specifications, and statutory requirements. It provides instant report generation, error-proof invoice ingestion with round-trip error fixing, GSTR-2B vs Books reconciliation, deterministic GSTR-3B tax computation, and a GSP adapter layer.

> **Notice:** Demo files. Not official GST portal or income tax portal files.

---

## 1. How to Run

1. Open a terminal in `C:\RE`.
2. Run automated test suite:
   ```bash
   npm test
   ```
3. Run end-to-end audit check:
   ```bash
   node test_e2e_inproc.mjs
   ```
4. Start the web application:
   ```bash
   node server.js
   ```
5. Open your browser at:
   ```
   http://localhost:3000/
   ```

---

## 2. API Endpoints

### System & Core Endpoints
- `GET /api/mode` — Reports current environment: `"demo"` or `"live-sandbox"`.
- `GET /api/sample-data` — Canonical demo dataset for "Malabar Spice Traders" (`32ABCDE1234F1Z5`).
- `POST /api/validate` — Live validator for PAN, GSTIN, and individual invoice line items.
- `GET /api/returns/3b-summary` — Deterministic GSTR-3B tax calculation with "how calculated" breakdown.

### Data Ingestion & Error Round-Trip
- `POST /api/invoices/import` — Ingests sales or purchase invoices, performs statutory field validation, and generates error reports.
- `GET /api/invoices/error-report?reportId=...&format=xlsx` — Downloads formatted error spreadsheet (`.xlsx` or `.csv`) with `Error reason` column for offline fix and re-upload.

### Expert Tax Filing & CA Advisory (`/api/expert/`)
- `GET /api/expert/plans` — Returns active assisted tax filing plans (Salaried, Capital Gains, FAST-DS, Business 44ADA, Notice Defense).
- `POST /api/expert/book` — Schedules simulated CA consultation slot, applies promo discounts (e.g. `TAXHERO65`), and issues meeting room credentials.

### Unified Reports & Export Engine
- `POST /api/export/:report?format=(xlsx|csv|json)&ay=(2025-26|2026-27)`
  - Supported reports:
    1. `sales_register` (Sales Register)
    2. `purchase_register` (Purchase Register)
    3. `reconciliation` (ITC Reconciliation)
    4. `gstr3b` (GSTR-3B Summary)
    5. `error_report` (Import Error Report)
    6. `filing_history` (Filing History)
    7. `gstr1` (GSTR-1 Outward Supplies)
    8. `itr1` (ITR-1 Sahaj Statement - supports AY 2025-26 and AY 2026-27)
  - Real SheetJS `.xlsx` (multi-sheet with `Summary` sheet first, bold frozen headers, auto column widths, Indian currency formatting), RFC 4180 CSV (`.csv`), or GSTN/CBDT compliant JSON (`.json`).

### Assisted Advisory, Prefill, Broker P&L, Vault & Notice Defense
- `GET /api/expert/plans` — Fetch expert CA consultation plans and discount rates.
- `POST /api/expert/book` — Book 1-on-1 CA consultation with instant slot confirmation.
- `GET /api/itr/sample-prefill` — Generate sample CBDT official `prefill.json`.
- `POST /api/itr/prefill-import` — Ingest and normalize official Income Tax Department pre-fill JSON.
- `POST /api/itr/broker-pnl` — Ingest broker CSV statements (Zerodha, Groww, Upstox) and compute 20% STCG, 12.5% LTCG, and ₹1,25,000 Section 112A exemption.
- `GET /api/vault/documents` — List stored documents in tax vault with category filters.
- `POST /api/vault/upload` — Upload and index document in tax vault.
- `POST /api/notices/analyze` — Statutory discrepancy analysis between filed return and CPC computation.
- `POST /api/notices/generate-draft` — Generate formal statutory legal objection draft citing Rule 37BA and Section 154.
- `POST /api/notices/submit-reply` — Simulate official ITD e-filing submission with Document Reference Token.
- `POST /api/itr/set-off-losses` — Execute Section 70 intra-head loss set-off and compute Schedule CFL carry-forward.
- `POST /api/itr/tax-loss-harvesting` — Scan portfolio holdings for year-end loss harvesting to reduce capital gains tax.

### Enterprise GST: E-Invoice, E-Way Bill, Vendor Risk, Multi-GSTIN & GSTR-9
- `POST /api/einvoice/generate` — Generate 64-char SHA-256 IRN and statutory dynamic QR code payload.
- `POST /api/einvoice/cancel` — Cancel active E-Invoice within statutory 24-hour window.
- `GET /api/einvoice/details` — Fetch E-Invoice record by IRN.
- `GET /api/einvoice/list` — List registered E-Invoices in IRP sandbox ledger.
- `POST /api/ewaybill/generate` — Generate 12-digit statutory E-Way Bill with Rule 138(10) distance validity.
- `POST /api/ewaybill/update-part-b` — Update vehicle number for transshipment or breakdown.
- `POST /api/ewaybill/cancel` — Cancel E-Way Bill within 24 hours.
- `GET /api/ewaybill/list` — List active E-Way Bills in sandbox ledger.
- `GET /api/vendor-risk/leaderboard` — Centralized vendor risk ranking and blocked ITC under Section 16(2)(aa).
- `POST /api/vendor-risk/withholding-notice` — Generate formal Payment Withholding Notice with WhatsApp sharing.
- `GET /api/multi-gstin/summary` — Aggregate multi-state branch GSTINs under single corporate PAN.
- `GET /api/gstr9/consolidate` — Full-year auto-consolidation of monthly returns into GSTR-9 Tables 4, 6, 8, and 9.

### GSP Adapter Layer (`/api/gsp/`)
- `POST /api/gsp/auth/otp` — Request OTP for GST portal authentication.
- `POST /api/gsp/auth/token` — Exchange OTP for session auth token.
- `GET /api/gsp/gstr1/summary` — Fetch GSTR-1 outward filing summary.
- `POST /api/gsp/gstr1/file` — Sandbox filing for GSTR-1 (requires OTP + consent).
- `GET /api/gsp/gstr2b/details` — Fetch auto-drafted GSTR-2B ITC details.
- `GET /api/gsp/gstr3b/details` — Fetch GSTR-3B status and due dates.
- `POST /api/gsp/gstr3b/offset` — Offset liability against credit and cash ledgers.
- `POST /api/gsp/gstr3b/file` — Sandbox filing for GSTR-3B (requires OTP + consent).
- `GET /api/gsp/ims/invoices` — Returns HTTP 501 / "Not available yet" (status: partial).
- `POST /api/gsp/ims/action` — Submit IMS supplier action.

---

## 3. Demo vs Live Mode

- **Demo Mode (Default):**
  - Enabled automatically when GSP environment variables are missing.
  - Returns realistic mock data matching the exact shapes of GSTN responses.
  - Return filing endpoints generate simulated ARNs (e.g. `AA321026...`).
  - Displays visible mode badge: `"Demo Mode (Simulated)"` and notice `"Demo files. Not official GST portal or income tax portal files."`.
- **Live Sandbox Mode:**
  - Activated when `GSP_BASE_URL`, `GSP_CLIENT_ID`, and `GSP_CLIENT_SECRET` are provided in `.env`.
  - Routes traffic to the designated GSP gateway sandbox environment.
  - Sanitizes and redacts all secrets, passwords, OTPs, and auth tokens from server logs.
  - Safety Guarantee: Filing endpoints are strictly sandbox-only and never submitted to production.

---

## 4. Evidence Table

| Claim / Finding | Backing Reference / File | Status |
|---|---|---|
| Reports Center generate-then-download async UX pattern | `docs/evidence/reports-center-flow.md` | **Verified** |
| Multi-sheet Excel (.xlsx) export with "Summary" sheet first | `docs/evidence/reports-center-flow.md` | **Verified** |
| Sales & purchase import with Excel Error Report round-trip | `docs/evidence/import-error-flow.md` | **Verified** |
| Error Report matching import template layout plus "Error reason" column | `docs/evidence/import-error-flow.md` | **Verified** |
| GSTR-2B vs Books reconciliation buckets (Matched, Mismatch, Missing in 2B) | `docs/evidence/reconcile-actions.md` | **Verified** |
| Document actions: Accept ITC, Hold (defer), and Ask Supplier | `docs/evidence/reconcile-actions.md` | **Verified** |
| WhatsApp / email supplier reminder notices for unfiled invoices | `docs/evidence/reconcile-actions.md` | **Verified** |
| Return filing EVC OTP modal requiring consent declaration & ARN issuance | `docs/evidence/filing-otp-modal.md` | **Verified** |
| GSTR-3B Form structure (Tables 3.1, 4, 5.1, 6.1) | `docs/evidence/filing-otp-modal.md` | **Verified** |
| ITR 4-Step Stepper & Two-Column UI (Personal Info, Income, Deductions, Summary) | `docs/evidence/itr-efiling-flow.md` | **Verified** |
| ITR Identification & Inline Mobile Error Validation UI | `docs/evidence/itr-efiling-flow.md` | **Verified** |
| ITR 8 Income Source Cards & Form 16 Action UI | `docs/evidence/itr-efiling-flow.md` | **Verified** |
| ITR Tax Summary Hero & Review Calculation Breakdown UI | `docs/evidence/itr-efiling-flow.md` | **Verified** |
| User Profile Menu & Sidebar Expert/Live Support Guidance UI | `docs/evidence/itr-efiling-flow.md` | **Verified** |
| Expert Tax Filing Plans & 24hr Guaranteed Turnaround | `docs/evidence/expert-tax-filing.md` | **Verified** |
| Notice Safeguard & 100% Advisory Fee Refund Guarantee | `docs/evidence/expert-tax-filing.md` | **Verified** |
| Dual-Layer Accuracy (Automated Scan + Assigned Chartered Accountant) | `docs/evidence/expert-tax-filing.md` | **Verified** |
| Foreign Asset / FAST-DS Disclosure & Valuation Support | `docs/evidence/expert-tax-filing.md` | **Verified** |
| Official CBDT Pre-fill JSON Ingestion (`prefill.json`) | `docs/evidence/expert-tax-filing.md` | **Verified** |
| Broker Tax P&L Statement Parser (Zerodha, Groww, Upstox) | `docs/evidence/expert-tax-filing.md` | **Verified** |
| Notice Defense 4-Stage Board (143(1), 139(9), 148, 154) | `docs/evidence/expert-tax-filing.md` | **Verified** |
| In-App Tax Document Vault (Form 16, AIS, 26AS, Broker) | `docs/evidence/expert-tax-filing.md` | **Verified** |
| GSP status ledger (182 APIs, status gating for partial/not_working) | `data/api-status.json` | **Verified** |
| Section 49 cross-utilization set-off rules (IGST first, then CGST/SGST) | `CGST Act Section 49, 49A, 49B` | **Inferred** |
| Section 16(2)(aa) restriction disallowing ITC on unfiled 2B invoices | `CGST Act Section 16(2)(aa)` | **Inferred** |
| Section 115BAC New Tax Regime Slabs & ₹75k Standard Deduction | `Finance (No. 2) Act, 2024` | **Inferred** |
| Place of Supply (POS) intra-state (CGST+SGST) vs inter-state (IGST) rules | `CGST Act Section 10 & 12` | **Inferred** |
| Multi-client CA practice management workspace | `Standard CA practice management` | **Inferred** |
| Rule 48(4) E-Invoice 64-char SHA-256 IRN & dynamic QR code | `CGST Rules Rule 48(4) & NIC Schema v1.03` | **Inferred** |
| Rule 138 E-Way Bill 12-digit number & distance validity calculation | `CGST Rules Rule 138 & 138(10)` | **Inferred** |
| Sections 70, 71, 74 Capital loss set-off & 8-year carry forward | `Income Tax Act Section 70, 71, 74` | **Inferred** |
| Section 16(2)(aa) Vendor Compliance & Payment Withholding Notice | `CGST Act Section 16(2)(aa)` | **Inferred** |
| Section 25 Multi-GSTIN corporate PAN aggregation | `CGST Act Section 25` | **Inferred** |
| Section 44 GSTR-9 Annual Return auto-consolidation (Tables 4, 6, 8, 9) | `CGST Act Section 44` | **Inferred** |
| Fine-grained client access permission levels | None | **Not seen** |
