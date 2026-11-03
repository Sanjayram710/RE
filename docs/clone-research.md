# Flow & Architecture Research

This document captures the behavior, user experience, data flows, validation mechanics, and file formats observed from public documentation, developer guidelines, knowledge base articles, and statutory GST requirements.

Demo files. Not official GST portal or income tax portal files.

---

## 1. Reports Center & Generate-Then-Download Pattern

### Steps
1. User navigates to **Business** > **Reports** > **All Reports** (or "View All Reports" on dashboard).
2. Selects target report: Sales Register, Purchase Register, ITC Reconciliation, GSTR-3B Summary, Error Report, or Filing History.
3. Configures parameters via filters:
   - **Business/GSTIN**: Dropdown selecting the active entity.
   - **Return Period / Date Range**: Monthly (e.g. October 2026, 102026) or custom date range (From Date - To Date).
   - **Document Type / Status**: All / Active / Cancelled / Mismatched.
   - **Rate / Tax Slab**: 0%, 5%, 12%, 18%, 28%.
4. Clicks action button: **"Generate Report"** (or **"Export Report"**).
5. Frontend transitions to an asynchronous processing state: "Generating report... please wait" with progress bar or spinner.
6. Once ready, status badge shifts to "Ready" and a result card surfaces showing filename, row count, file size, and timestamp.
7. User clicks **"Download Excel"** (.xlsx via SheetJS) or **"Download CSV"** (.csv). Prior exports are kept in an **Export History** table.

### Button and Filter Labels
- *Buttons*: `Generate Report`, `Download Excel`, `Download CSV`, `Refresh Data from GSTN`, `Export to Excel`, `View Details`.
- *Filters*: `Select Business (GSTIN)`, `Period (Month/Year)`, `Document Type`, `Tax Slab (%)`, `Filing Status (Filed / Unfiled)`.

### Report & File Types
- **Excel Spreadsheet** (`.xlsx`): Multi-sheet workbook with Summary tab first, bold frozen header row, and Indian number formatting.
- **CSV RFC 4180** (`.csv`): Standard comma-delimited export.
- **GST Offline Tool JSON** (`.json`): Official GSTN GSTR-1 / GSTR-3B schema compliant JSON.

### Validation & Error Messages
- "No records found for selected period."
- "Report generation in progress. You can continue working while we generate your file."
- "Export failed: Date range exceeds maximum allowed window (12 months)."

### Verification Status
- Workflow & Filters: **Verified** (`docs/evidence/reports-center-flow.md`)
- Async Job / Status Polling: **Verified** (`docs/evidence/reports-center-flow.md`)
- Multi-sheet Excel (.xlsx) structure with Summary first: **Verified** (`docs/evidence/reports-center-flow.md`)

---

## 2. Sales & Purchase Import (Excel Upload), Validation & Error File Round-Trip

### Steps
1. User enters **Invoices** / **Import** section and selects tab: **Sales** or **Purchases**.
2. Optional: clicks **"Download Sample Template"**.
3. Drags & drops or clicks to browse file (`.xlsx` or `.csv`).
4. System parses rows client-side / server-side and performs multi-level validation:
   - Header format verification.
   - Field format validations (GSTIN structure, Invoice Date DD-MM-YYYY, Invoice Number regex `^[a-zA-Z0-9/-]{1,16}$`).
   - Financial arithmetic: Taxable Value * Rate = Tax Amount (IGST vs CGST + SGST check based on Place of Supply).
5. Validation Summary modal displays:
   - Total rows parsed: e.g. 50
   - Valid rows ready to import: e.g. 48
   - Erroneous rows: e.g. 2
6. Options offered:
   - **"Review & Fix Errors Inline"**: Opens editable table grid.
   - **"Download Error Report"**: Exports an Excel (.xlsx) file containing only the erroneous records with the same layout as the import template plus an appended column `Error reason`.
   - **"Import Valid Invoices Only"**: Ingests the 48 clean rows, leaving the 2 for correction.
7. Error Round-Trip: User fixes errors in the downloaded Excel file and re-uploads it; system reconciles and merges the updated rows.

### Button and Filter Labels
- *Buttons*: `Upload File`, `Download Sample Template`, `Review & Fix Errors`, `Download Error Report`, `Import Valid Rows`, `Save and Validate`.
- *Filters*: `Invoice Type (Sales / Purchase)`, `Import Mode`, `Date Range`.

### Report & File Types
- Ingestion Templates: `.xlsx`, `.csv`.
- Error Output: `Import_Error_Report_<Timestamp>.xlsx` containing template layout + `Error reason` column.

### Validation & Error Messages
- "Invalid GSTIN format: Must be 15 characters (e.g. 32ABCDE1234F1Z5)."
- "Place of supply mismatch: For interstate supply (PoS != State Code), IGST is mandatory; CGST/SGST must be 0."
- "Duplicate invoice number: Invoice 'INV-042' already exists for this financial year."
- "Invoice date cannot be in a future period."
- "Tax calculation discrepancy: Expected CGST 9% (₹900) but found ₹850."

### Verification Status
- Template format & error column round-trip: **Verified** (`docs/evidence/import-error-flow.md`)
- Inline error correction vs error spreadsheet: **Verified** (`docs/evidence/import-error-flow.md`)
- State-code POS logic: **Inferred** (`CGST Act Section 10 & 12 - Place of Supply Rules`)

---

## 3. GSTR-2A/2B Reconciliation Statuses & Actions

### Steps
1. User navigates to **ITC & Reconciliation**.
2. Data Source Sync:
   - Books: Purchase Register (PR) imported from ERP / Excel.
   - Portal: Auto-fetched GSTR-2B via GSP API (or JSON upload).
3. Engine runs fuzzy and deterministic matching algorithms:
   - Rule 1: Exact match on GSTIN + Invoice Number + Date (within 30 days) + Tax Amount (+/- ₹1 rounding tolerance).
   - Rule 2: Partial match (slight typo in invoice number or date difference).
   - Rule 3: Missing in 2B (in books, supplier unfiled).
   - Rule 4: Missing in Books (in 2B, not entered in ERP).
4. Results presented in 4 Buckets:
   - **Matched**: Invoices aligned; 100% ITC claimable.
   - **Mismatch in Value / Tax**: Amounts diverge.
   - **Missing in 2B**: Unfiled by vendor; high risk of ITC disallowance under Section 16(2)(aa).
   - **Missing in Books**: Supplier reported invoice, user hasn't claimed ITC yet.
5. User takes Document or Supplier-level actions:
   - **Accept**: Claim ITC in upcoming GSTR-3B.
   - **Hold**: Defer ITC claim to next period pending vendor payment / receipt of goods.
   - **Ask Supplier / Send Reminder**: Triggers communication (WhatsApp / Email notification) with discrepancy details.
6. Export reconciliation statement to Excel (.xlsx) for audit trail.

### Button and Filter Labels
- *Buttons*: `Run Reconciliation`, `Accept ITC`, `Hold ITC`, `Request Supplier`, `Explain Mismatch`, `Export Reconciliation Report`.
- *Filters*: `Bucket (All, Matched, Mismatched, Missing in 2B, Missing in Books)`, `Supplier GSTIN`, `Tax Period`, `Mismatch Amount Range`.

### Report & File Types
- Reconciliation Workbook: `.xlsx` with sheets `Summary`, `Matched`, `Mismatch`, `Missing_in_2B`, `Missing_in_PR`.

### Validation & Error Messages
- "ITC Restricted: Cannot claim ITC as invoice is missing from auto-drafted GSTR-2B."
- "Date discrepancy: Invoice dated 15-Aug in books but reported as 15-Sep by supplier."
- "Tax variance exceeds ₹1.00 tolerance."

### Verification Status
- 4 matching categories & action statuses (Accept/Hold/Reject): **Verified** (`docs/evidence/reconcile-actions.md`)
- Section 16(2)(aa) compliance rules: **Inferred** (`CGST Act Section 16(2)(aa)`)
- Supplier communication flow: **Verified** (`docs/evidence/reconcile-actions.md`)

---

## 4. GSTR-3B and GSTR-1 Preparation Steps

### Steps
1. **GSTR-1 Preparation**:
   - Collect outward supplies (B2B, B2C Large, B2C Small, Credit/Debit Notes, Exports, Nil Rated).
   - Review Table-wise summary (Table 4 B2B, Table 5 B2CL, Table 7 B2CS, Table 9B CDNR).
   - Validate checksum and payload schema.
   - Action: "Generate JSON" / "Upload to GSTN".
   - Filing Step: Authenticate via OTP (EVC) or DSC.
2. **GSTR-3B Preparation**:
   - Auto-population:
     - Table 3.1: Tax on Outward Supplies (from GSTR-1).
     - Table 4: Eligible ITC (from GSTR-2B reconciliation, net of held/ineligible items).
     - Table 5.1: Interest and Late Fee calculation.
   - Computation of Net Liability:
     - `Output Tax - Eligible ITC = Net Tax Payable`.
     - Cross-utilization set-off rules applied: IGST credit first offsets IGST liability, then CGST, then SGST. CGST credit offsets CGST, then IGST. SGST credit offsets SGST, then IGST.
   - Action: "Offset Liability" (utilizing electronic credit ledger, remaining balance paid via cash ledger challan).
   - Final Step: Review summary -> Check confirmation checkbox -> Enter 6-digit OTP (EVC modal) -> Return Filed (Generates ARN).

### Button and Filter Labels
- *Buttons*: `Auto-populate from 1 & 2B`, `Calculate Tax`, `View Calculation Details ("How Calculated")`, `Offset Liability`, `Proceed to File`, `Verify OTP`, `Download Draft 3B`.
- *Filters*: `Filing Period (Month/Quarter)`, `Financial Year`.

### Report & File Types
- `GSTR1_<GSTIN>_<Period>.json` (GSTN Offline Tool Schema v3.0+)
- `GSTR3B_<GSTIN>_<Period>.json`
- `GSTR3B_Computation_Summary.xlsx`

### Validation & Error Messages
- "Eligible ITC cannot exceed GSTR-2B auto-drafted value by more than statutory limit."
- "Insufficient cash ledger balance: Please generate Challan CPIN to pay ₹X."
- "Invalid OTP: Please enter the 6-digit code received on registered mobile."

### Verification Status
- Form 3.1, 4, 5.1, 6.1 flow: **Verified** (`docs/evidence/filing-otp-modal.md`)
- EVC OTP verification modal & ARN generation: **Verified** (`docs/evidence/filing-otp-modal.md`)
- Section 49 cross-utilization set-off rules: **Inferred** (`CGST Act Section 49, 49A, 49B`)
- Deterministic calculation vs AI copilot distinction: **Inferred** (`Standard statutory tax practice`)

---

## 5. Reminders and CA/Client Access

### Steps
1. **Automated Reminders**:
   - System monitors filing calendar (GSTR-1 on 11th, GSTR-3B on 20th).
   - Triggers notifications via WhatsApp, SMS, and Email at T-5 days, T-2 days, and Due Date.
   - Supplier reminders for unfiled 2B invoices: Single click dispatches message formatted as: *"Dear [Supplier], invoice [No] dated [Date] for ₹[Amount] is not showing in our GSTR-2B. Please file GSTR-1 to ensure ITC credit."*
2. **CA / Multi-Client Dashboard**:
   - Multi-tenant workspace for tax practitioners and accountants.
   - High-level Client List showing: Client Name, GSTIN, Filing Status (GSTR-1 & 3B), RAG compliance status indicator (Green = Complete, Amber = Pending, Red = Overdue), Next Due Date.
   - Bulk actions: "Run Bulk 2B Sync", "Batch Export Reports", "File All Ready Returns".
   - Client access permission levels: Read-Only Client Review, Invoicing Only, Full Filing Access.

### Button and Filter Labels
- *Buttons*: `Send Reminder`, `Share on WhatsApp`, `Invite Client`, `Switch Client`, `Bulk Reconcile`, `File Ready Returns`.
- *Filters*: `RAG Status (All / Green / Amber / Red)`, `Assigned Staff`, `Filing Period`.

### Verification Status
- WhatsApp reminder notices & vendor chase: **Verified** (`docs/evidence/reconcile-actions.md`)
- Multi-client CA practice dashboard: **Inferred** (`Standard CA practice management`)
- Fine-grained client access permissions: **Not seen**

---

## 6. Income Tax (ITR) E-Filing & Computation Flow

### Steps
1. User selects filing entity (e.g. PAN `CVBBC4433W`).
2. Navigates 4-step stepper: Personal Info -> Income Sources -> Tax Saving -> Tax Summary.
3. Personal Info validates permanent information (name matching 5th char of PAN, DOB, father's name) and identification (12-digit Aadhaar, 10-char PAN, 10-digit mobile with required field validation, and email).
4. Income Sources allows adding salary manually or parsing Form 16, plus 7 additional income heads.
5. Tax Saving captures Chapter VI-A deductions and TDS from Form 26AS/AIS.
6. Tax Summary presents dynamic computation (Gross Income, Deductions, Taxable Income, Total Tax, Tax Already Paid, Refund Available), comparison between New Regime (Section 115BAC) and Old Regime, and sandbox e-filing with simulated EVC OTP.

### Verification Status
- 4-Step Stepper & Two-Column Layout with Sidebar: **Verified** (`docs/evidence/itr-efiling-flow.md`)
- Identification & Inline Mobile Validation Warning: **Verified** (`docs/evidence/itr-efiling-flow.md`)
- 8 Income Category Cards & Form 16 Action: **Verified** (`docs/evidence/itr-efiling-flow.md`)
- Tax Summary Hero Card & Old vs New Regime Comparison: **Verified** (`docs/evidence/itr-efiling-flow.md`)
- Profile Dropdown Menu & Support Drawer: **Verified** (`docs/evidence/itr-efiling-flow.md`)
- Section 115BAC New Regime Slabs & Standard Deduction: **Inferred** (`Finance (No. 2) Act, 2024 / Income-tax Act, 1961`)

---

## 7. Tax Filing from Experts & Assisted Advisory

### Steps
1. User accesses "Tax Filing from Experts" from top navigation or user menu.
2. Selects from domain-specific offerings (Salaried, Capital Gains, Foreign Assets/FAST-DS, Business 44ADA, Notice Management).
3. Evaluates plan deliverables, turnaround times, and statutory safeguards (24hr filing, 100% Notice Protect, full fee refund on calculation error).
4. Tests potential tax savings using the real-time Smart Savings Estimator.
5. Schedules 1-on-1 consultation with an assigned Chartered Accountant, applies promo discounts (e.g. `TAXHERO65`), and receives booking reference with video consultation room.

### Verification Status
- Expert Plan Offerings & 24hr Filing Guarantee: **Verified** (`docs/evidence/expert-tax-filing.md`)
- Foreign Asset / FAST-DS Disclosure Plan Tiers: **Verified** (`docs/evidence/expert-tax-filing.md`)
- Dual-Layer Accuracy (AI + CA Review): **Verified** (`docs/evidence/expert-tax-filing.md`)
- Notice Protect & 100% Fee Refund Guarantee: **Verified** (`docs/evidence/expert-tax-filing.md`)
- Annual Refund Growth Metric (₹5,346 Cr): **Verified** (`docs/evidence/expert-tax-filing.md`)
- Black Money Act penalty relief & Section 139(9) defective notice rules: **Inferred** (`Black Money Act, 2015 / Section 139(9)`)

---

## 8. Reverse-Engineered Deep Capabilities & Missing Workflows

### 1. Official CBDT Pre-Fill JSON Parser (`prefill.json` from incometax.gov.in)
- **Workflow**: Assessees download their prefill JSON containing verified salary TDS, non-salary TDS, Advance Tax, and bank accounts from the e-Filing portal. SimpleGST ingests and normalizes this structure directly.
- **Verification Status**: **Verified** (`docs/evidence/expert-tax-filing.md` / `Screenshot 2026-11-03 105151.png`)

### 2. Broker Tax P&L Statement Parser (Zerodha, Groww, Upstox)
- **Workflow**: Drag-and-drop ingestion of broker trade registers. Evaluates holding periods (< 12 months for STCG vs >= 12 months for LTCG), applies the revised Finance Act 2024 rates (STCG @ 20%, LTCG @ 12.5%), and deducts the enhanced Section 112A ₹1,25,000 exemption limit.
- **Verification Status**: **Verified** (`docs/evidence/expert-tax-filing.md` / `Screenshot 2026-11-03 105120.png` & `105141.png`)

### 3. Interactive Notice Defense & Scrutiny Board (143(1), 139(9), 148)
- **Workflow**: 4-stage pipeline (DIN Ingestion -> Discrepancy Matrix Diff -> Legal Objection Reply Draft -> Simulated ITD Submission). Computes discrepancy between filed return and CPC computation (Form 24Q late filing TDS credit mismatch, disallowed 80D), generates legal reply citing Rule 37BA, Section 199, Section 154, and Section 205, and provides simulated e-filing receipt.
- **Verification Status**: **Verified** (`docs/evidence/expert-tax-filing.md` / `Screenshot 2026-11-03 105206.png` & `105217.png`)

### 4. In-App Tax Document Vault
- **Workflow**: Centralized encrypted repository managing Form 16, AIS/TIS, Form 26AS, Broker Reports, and ITR-V Ack with category filters and upload capability.
- **Verification Status**: **Verified** (`docs/evidence/expert-tax-filing.md`)

---

## 9. Enterprise Compliance & Capital Optimization Engines

### 1. E-Invoicing & IRP Sandbox Engine (Rule 48(4) & NIC Schema v1.03)
- **Workflow**: Generates a 64-character SHA-256 Invoice Reference Number (IRN) computed from `SupplierGSTIN + FinYear + DocType + DocNum`. Validates mandatory fields, creates digital signature payload, and produces the statutory Signed QR code string.
- **Verification Status**: **Inferred** (`CGST Rules Rule 48(4) & NIC Schema v1.03`)

### 2. E-Way Bill (EWB) Lifecycle Engine (Rule 138)
- **Workflow**: Mandatory for goods consignments > ₹50,000. Generates 12-digit statutory E-Way Bill number, calculates distance validity under Rule 138(10) (1 day per 200 km for regular cargo, 1 day per 20 km for over-dimensional), supports Part-B vehicle updates, and 24-hour cancellation.
- **Verification Status**: **Inferred** (`CGST Rules Rule 138 & 138(10)`)

### 3. Capital Gains Tax-Loss Harvesting & Loss Set-Off (Sections 70, 71, 74)
- **Workflow**: Models statutory intra-head set-off (STCL against STCG & LTCG; LTCL against LTCG only), computes Schedule CFL 8-year loss carry-forward ledgers, and scans open portfolio positions for tax-loss harvesting sales before March 31.
- **Verification Status**: **Inferred** (`Income Tax Act Sections 70, 71, 74`)

### 4. Vendor Compliance & "ITC at Risk" Command Center (Section 16(2)(aa))
- **Workflow**: Centralized vendor leaderboard ranking suppliers by blocked ITC, calculating compliance health %, and auto-generating formal statutory payment withholding notices with 1-click WhatsApp/email sharing.
- **Verification Status**: **Inferred** (`CGST Act Section 16(2)(aa) & Section 41`)

### 5. Multi-GSTIN Pan-India Corporate Hub (Section 25)
- **Workflow**: Aggregates all state branch GSTINs registered under a single 10-digit corporate PAN, presenting pan-India turnover, output liability, available ITC, and filing calendar compliance.
- **Verification Status**: **Inferred** (`CGST Act Section 25`)

### 6. GSTR-9 Annual Return Auto-Consolidation (Section 44)
- **Workflow**: Auto-consolidates 12 monthly GSTR-1 and GSTR-3B filings into statutory Tables 4 (outward supplies), 6 (ITC availed), 8 (2A/2B reconciliation diff), and 9 (tax paid in cash vs credit).
- **Verification Status**: **Inferred** (`CGST Act Section 44 & Rule 80`)




