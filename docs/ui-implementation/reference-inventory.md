# Stitch Reference Inventory — SimpleGST Compliance Platform

This inventory documents all 13 reference design packages reverse-engineered from Google Stitch exports located at `stitch_simplegst_compliance_platform/stitch_simplegst_compliance_platform/` and `stitch_screens/`.

---

## 1. Business Owner Home Dashboard
- **Directory / Files**: `business_owner_home_dashboard/code.html`
- **Screenshot**: `stitch_screens/business_owner_home_dashboard.png`
- **Module Name**: Executive Compliance & Filing Dashboard
- **Main Layout**: Responsive 12-column grid over `#f8f9ff` canvas. Left fixed desktop sidebar (w-64), sticky top global header (h-16), main container with maximum content width.
- **Header Structure**: Active Business Entity pill (`Apex Retailers Pvt Ltd` + `27AAACA1234A1Z5`), active filing period badge (`Oct 2026 - Due Nov 20`), user role badge (`Business Owner`), notification bell with unread indicator, and user profile avatar (`Rajesh Sharma, Director`).
- **Cards & Visual Components**:
  - Urgent Action Alert Banner: Amber warning card highlighting upcoming GSTR-3B deadline with "Resume Filing" CTA.
  - KPI Financial Metric Cards: Total Output Tax Liability (₹1,51,650), Net Eligible ITC Available (₹74,214), Net Cash Payable (₹77,436), Compliance Health Score (94/100).
  - Filing Lifecycle Progress Stepper: Visual 4-step cadence (GSTR-1 Filed, GSTR-2B Auto-drafted, GSTR-3B In Progress, Challan Pending).
  - Quick Document Action Bar: Upload Sales Invoice, Upload Purchase Bill, Import Bank Statement.
  - Recent Invoices Table: Clean white container with uppercase tabular headers, amount alignment, and verification status chips.
  - GST Copilot Contextual Sidebar Card: Zero-jargon tax assistant card with statutory guidance shortcuts.
- **Color Tokens**: Primary `#00685f`, Primary Container `#008378`, Surface `#f8f9ff`, Surface Lowest `#ffffff`, Accent Amber `#d97706`, Emerald `#059669`.
- **Target Container**: `#viewHomeSuite`

---

## 2. File GST Guided Filing & Nil Return Workflow
- **Directory / Files**: `file_gst_guided_filing_nil_return_workflow/code.html`
- **Screenshot**: `stitch_screens/file_gst_guided_filing_nil_return_workflow.png`
- **Module Name**: Guided GST Return Filing (GSTR-1 / GSTR-3B)
- **Main Layout**: Centered step-by-step wizard (max-w-5xl) with breadcrumbs, progress tracker, and interactive question panels.
- **Key Features & Components**:
  - 1-Click Nil Return Toggle Banner: Direct path for taxpayers with zero sales, zero purchases, and no reverse charge liability under Section 39.
  - 5-Stage Step Indicator: Step 1 (Period & Eligibility) -> Step 2 (Sales Outward) -> Step 3 (Purchases Inward) -> Step 4 (ITC & Set-off) -> Step 5 (Filing & Verification).
  - Statutory Prerequisites Checklist: Automatic verification of previous period returns (Section 37(4) and Section 39(10) compliance).
  - Tax Rate Classification Selector: 0%, 5%, 12%, 18%, 28% breakdown with real-time tax calculation.
- **Target Container**: `#viewCopilotSuite` (Guided Path)

---

## 3. Bills & Documents Split-View OCR Review
- **Directory / Files**: `bills_documents_document_management_split_view_ocr_review/code.html`
- **Screenshot**: `stitch_screens/bills_documents_document_management_split_view_ocr_review.png`
- **Module Name**: Document Management & AI OCR Split-Screen Verification
- **Main Layout**: 50/50 dual-pane workstation (collapsible to single column on mobile).
  - Left Pane: Interactive document viewer with zoom controls, rotation, and high-fidelity scanned PDF/image rendering.
  - Right Pane: AI Extracted Fields form (Supplier GSTIN, Invoice Number, Invoice Date, Place of Supply, HSN Codes, Taxable Value, CGST, SGST, IGST, Section 16(2)(aa) 2B match badge).
- **Interactive Controls**: Field edit inputs with confidence score indicators, "Verify & Approve" primary button, "Flag for CA Review" button.
- **Target Container**: `#viewBillsSuite`

---

## 4. GSTR-2B Input Tax Credit (ITC) Reconciliation Engine
- **Directory / Files**: `file_gst_gstr_2b_input_tax_credit_itc_reconciliation_engine/code.html`
- **Screenshot**: `stitch_screens/file_gst_gstr_2b_input_tax_credit_itc_reconciliation_engine.png`
- **Module Name**: GSTR-2B vs Books Invoice Reconciliation
- **Main Layout**: Full-width data table with filter tabs and reconciliation summary strip.
- **Summary Metrics**: Total Matched ITC (₹62,450), Mismatches in Value/Tax (₹8,920), Missing in GSTR-2B (₹14,200), Ineligible / Section 17(5) Blocked ITC (₹4,500).
- **Tabbed Table**:
  - Matched (Green badge `#059669`)
  - Value Mismatch (Amber badge `#d97706`)
  - Missing in 2B (Red badge `#ba1a1a`)
  - Blocked Credit Sec 17(5) (Purple badge `#4b41e1`)
- **Actions**: "Send Reminder to Vendor", "Accept with Variance", "Export Reconciliation Excel".
- **Target Container**: `#viewReconSuite`

---

## 5. Tax Calculation & Final GSTR-3B Return Review
- **Directory / Files**: `file_gst_tax_calculation_final_gstr_3b_return_review/code.html`
- **Module Name**: Statutory Tax Calculation & Rule 88A ITC Set-off Matrix
- **Main Layout**: Multi-section audit summary with head-wise tax matrix.
- **Key Tables**:
  - Table 3.1: Outward taxable supplies, inter-state, intra-state, and RCM inward liability.
  - Table 4: Eligible ITC (Import, Services, Inward Supplies) less Reversals (Rule 37 180-day, Rule 42/43).
  - Rule 88A Statutory Offset Matrix: Order of set-off ensuring IGST credit is 100% utilized before CGST/SGST, and strict prohibition of cross-utilization between CGST and SGST.
  - Cash Deficit & Challan CTA: Prominent card showing remaining cash liability with "Generate PMT-06 Challan" trigger.
- **Target Container**: `#viewTaxCalcSuite`

---

## 6. Electronic Ledgers & Comprehensive GST Reports
- **Directory / Files**: `electronic_ledgers_comprehensive_gst_reports/code.html`
- **Module Name**: Electronic Ledgers (PMT-01, PMT-02, PMT-05) & Statutory Registers
- **Main Layout**: Tabbed ledger dashboard with live simulated balance summaries.
  - Cash Ledger (Form GST PMT-05): Major heads (IGST, CGST, SGST, Cess) and minor heads (Tax, Interest, Penalty, Fees, Other).
  - Credit Ledger (Form GST PMT-02): Current input tax credit balance available for set-off.
  - Liability Register (Form GST PMT-01): Return liabilities and demand payments.
  - PMT-09 Major/Minor Head Cash Transfer Simulator: Rule 87(13) compliant transfer form.
- **Target Container**: `#viewGstSuite`

---

## 7. CA Practice Hub Client Management
- **Directory / Files**: `ca_practice_hub_client_management/code.html`
- **Screenshot**: `stitch_screens/ca_practice_hub_client_management.png`
- **Module Name**: Multi-Client Workspace & Practice Management
- **Main Layout**: Multi-client compliance matrix table with tenant-isolated search and filter.
- **Components**:
  - CA Practice KPI Cards: Total Assigned Clients (24), Filings Due This Week (8), Reconciliation Blocks (3), Pending DSC Approvals (5).
  - Client Roster Table: Client Name, Trade Name, Registered PAN, State Branches (GSTINs), Filing Cadence (Monthly / QRMP), GSTR-1 Status, GSTR-3B Status, Audit Logs.
  - Client Context Switcher: One-click "Switch to Client Context" button.
- **Target Container**: `#viewPracticeSuite`

---

## 8. GST Compliance Health Score & Copilot Studio
- **Directory / Files**: `gst_compliance_health_score_gst_copilot_studio/code.html`
- **Screenshot**: `stitch_screens/gst_compliance_health_score_gst_copilot_studio.png`
- **Module Name**: Compliance Health Score & Statutory Copilot
- **Main Layout**: Two-column layout with visual compliance gauge on left and interactive conversational AI Copilot on right.
- **Key Features**:
  - Internal Compliance Gauge: Visual radial score (0-100) reflecting filing punctuality, ITC match ratio, and 180-day vendor payment health. Clearly labeled as an internal analytical score (never an official GSTN rating).
  - Statutory AI Assistant: Chat interface providing CBIC circular and notification citations for tax queries, draft reply generator for SCN notices, and "Consult Human CA" escalation CTA.
- **Target Container**: `#viewComplianceSuite`

---

## 9. Vendor Communication & Compliance Reminders Hub
- **Directory / Files**: `bills_documents_vendor_communication_compliance_reminders_hub/code.html`
- **Screenshot**: `stitch_screens/bills_documents_vendor_communication_compliance_reminders_hub.png`
- **Module Name**: Vendor Non-Compliance & Section 16(2)(aa) Communication Hub
- **Main Layout**: Vendor list on left with detail preview and draft generator on right.
- **Components**:
  - Defaulting Supplier List: Filterable by ITC at Risk, Delay in Days, and Return Status.
  - Multi-Channel Message Composer: WhatsApp template preview, Formal Legal Email draft, and Statutory Payment Notice generator.
  - Approval Before Dispatch: Human review check to prevent automated spamming.
- **Target Container**: `#viewVendorSuite`

---

## 10. Form GST PMT-06 Challan Generation Modal
- **Directory / Files**: `file_gst_form_gst_pmt_06_challan_generation_payment_modal/code.html`
- **Screenshot**: `stitch_screens/file_gst_form_gst_pmt_06_challan_generation_payment_modal.png`
- **Module Name**: Statutory Tax Payment Challan Generation
- **Main Layout**: Accessible modal dialog (`#pmt-06-modal`) with dark backdrop blur overlay.
- **Key Features**:
  - Rule 87(6) Calculation: Gross Liability less Credit Ledger Offset less Available Cash = Net Cash Challan Amount.
  - Head-Wise Breakdown Matrix: Major heads (IGST, CGST, SGST, Cess) and Minor heads.
  - Payment Mode Selector: E-Payment (Net Banking / NEFT / RTGS) and Over-The-Counter (enforcing Rule 87(4) ₹10,000 OTC limit).
  - 14-Digit CPIN Simulation: Clearly watermarked simulated CPIN with 15-day expiry date.
  - Close / Cancel handling with backdrop dismissal and zero popup alerts.
- **Target Container**: `#pmt-06-modal`

---

## 11. Post-Filing Success ARN Statutory Acknowledgment Modal
- **Directory / Files**: `file_gst_post_filing_success_arn_statutory_acknowledgment/code.html`
- **Screenshot**: `stitch_screens/file_gst_post_filing_success_arn_statutory_acknowledgment.png`
- **Module Name**: Post-Filing Success ARN Receipt
- **Main Layout**: Verified filing acknowledgment modal (`#arn-success-modal`) with official styling.
- **Components**:
  - Green Verified Checkmark header.
  - Acknowledgment Reference Number (ARN) card with simulated watermark `[SIMULATION MODE — NOT FILED ON GSTN COMMON PORTAL]`.
  - Filing Metadata: Filing Date & Timestamp, Filing Mode (EVC OTP), Legal Entity Name, GSTIN, Tax Period.
  - Final Tax Settlement Summary Table: Tax offsets from Credit PMT-02 and Cash PMT-05.
  - Action CTAs: "Download Signed Acknowledgment PDF", "View in Ledgers", "Return to Dashboard".
- **Target Container**: `#arn-success-modal`

---

## 12. Business Onboarding & Multi-GSTIN Management Hub
- **Directory / Files**: `business_onboarding_multi_gstin_management_hub/code.html`
- **Screenshot**: `stitch_screens/business_onboarding_multi_gstin_management_hub.png`
- **Module Name**: Corporate Entity Multi-State Branch Hub
- **Main Layout**: Entity summary cards with state-wise GSTIN branch list.
- **Components**:
  - Corporate PAN Header: Displays parent PAN, Entity Type (Private Limited Company), and Total Registered State Branches.
  - 2-Tier PAN Discovery: Tier 1 structural checksum validator + Tier 2 registered state branch discovery.
  - State Branch Cards: State name, State Code (e.g., 27 Maharashtra, 29 Karnataka, 32 Kerala), Branch GSTIN, Branch Compliance Status, and Primary Branch toggle.
  - "Add State Branch" modal trigger.
- **Target Container**: `#viewMultiGstinSuite` / `#viewStartupSuite`

---

## 13. Stitch Design System Specification
- **Directory / Files**: `simplegst_design_system/DESIGN.md`
- **Specifications**: Defines complete color tokens, typography scales (`Plus Jakarta Sans` for displays/headings, `Inter` for body and labels, monospace for tabular numbers), border radii (4px, 8px, 12px, 16px, 9999px), elevations, and responsive breakpoints (390px, 768px, 1280px, 1440px).
