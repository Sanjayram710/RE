# SimpleGST — Master UI Action & Interactive Control Functional Audit

**Document Version:** 1.0.0  
**Audit Date:** November 5, 2026  
**Repository:** `https://github.com/Sanjayram710/RE.git`  
**Target Environment:** Node.js 24 + SQLite Relational Engine (`node:sqlite`) + Vanilla JS Frontend  

---

## 1. Audit Methodology & Status Definitions

Every visible interactive element across the entire SimpleGST application has been audited across six critical dimensions:
1. **Intended Action**: Functional business purpose of the control.
2. **Frontend Event Handler**: Presence and correctness of `onclick`, `onchange`, `onsubmit`, or DOM event listeners.
3. **Backend API Endpoint**: Target REST route on the Node.js server.
4. **Operation Execution**: Actual execution logic on the server.
5. **Persistence**: Commitment to SQLite database (`data/simplegst.db`) or filesystem (`data/uploads/`).
6. **UI State & Feedback**: Correct display of loading, success toast, modal closure, or error alerts.

### Status Classification:
- **`WORKING`**: Fully operational end-to-end; frontend triggers backend, data persists, and UI updates dynamically.
- **`PARTIALLY WORKING`**: Frontend or backend executes, but lacks complete parameter binding or persistence.
- **`BROKEN`**: Event handler throws JS error, misses target DOM element, or backend returns HTTP 4xx/5xx.
- **`SIMULATED`**: Operates on simulated/mock data or sandbox stub; explicitly labelled for statutory transparency.
- **`NOT IMPLEMENTED`**: Inert decorative control with missing event listener or stubbed alert.

---

## 2. Global Navigation & Top Header Bar

| Element | Location / Selector | Intended Action | Frontend Handler | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Mobile Drawer Toggle** | Header Left `button[onclick="toggleMobileSidebar()"]` | Open/close responsive sidebar drawer on mobile viewports (<1024px) | `toggleMobileSidebar()` | N/A (DOM state) | `WORKING` | Ensure smooth backdrop blur and touch targets >= 44px. |
| **Organization / GSTIN Switcher** | Header Left `#currentFilingEntityName` | Toggle branch dropdown and activate selected state branch | `toggleFilingDropdown(event)`, `selectFilingEntity(gstin, name, branch)` | `POST /api/gstins/:id/activate`, `GET /api/dashboard/summary` | `WORKING` | Refresh all metric cards and active GSTIN across all open suites. |
| **Filing Period Selector** | Header Left `#global-filing-period` | Switch active tax filing period (e.g., Oct 2026, Nov 2026) | `togglePeriodMenu()`, `selectFilingPeriod(period)` | `GET /api/dashboard/summary?period=...` | `PARTIALLY WORKING` | Add interactive dropdown to select tax periods and trigger metric recalculations. |
| **Kiosk Mode Toggle** | Header Right (Beside Role Selector) | Enter/exit distraction-free fullscreen kiosk view | `toggleKioskMode()` | N/A (Fullscreen API + LocalStorage) | `NOT IMPLEMENTED` | Implement Phase 3 Kiosk Mode button, keyboard shortcut (Esc), and fullscreen handling. |
| **User Role Switcher** | Header Right `#currentUserRole` | Switch between Business Owner and Chartered Accountant roles | `toggleRoleMenu()`, `switchRole('owner'|'ca')` | N/A (Client state) | `WORKING` | Toggles CA Practice Hub highlights and compliance privilege options. |
| **Expert Help Shortcut** | Header Right `button[title="CA Expert Help"]` | Open Tax Experts consultation suite | `switchSuite('expert')` | `GET /api/expert/booking` | `WORKING` | Connects directly to CA consultation booking and AIS review. |
| **Notifications Bell** | Header Right `button[onclick="toggleNotificationDrawer()"]` | Open notifications drawer showing filing deadlines & notices | `toggleNotificationDrawer()` | `GET /api/notifications` | `WORKING` | Displays real deadline countdowns and vendor risk alerts. |
| **User Profile Dropdown** | Header Right `#profileDropdownMenu` | View profile details, past returns, and logout | `toggleProfileDropdown(event)`, `openProfileModal()`, `logoutAction()` | `POST /api/auth/logout`, `GET /api/profile` | `WORKING` | Closes on outside clicks and shows real session details. |

---

## 3. Left Sidebar Navigation

| Navigation Item | Target Suite | Intended Action | Frontend Event | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Brand Logo** | `#viewHomeSuite` | Return to Home Dashboard | `switchSuite('home')` | `GET /api/dashboard/summary` | `WORKING` | Highlights active nav state and resets scroll. |
| **Quick File CTA** | `#viewCopilotSuite` | Launch 5-step return filing or nil return wizard | `switchSuite('copilot')` | `GET /api/returns/tax-calc` | `WORKING` | Opens guided filing workflow for active period. |
| **1. Home** | `#viewHomeSuite` | Display main executive dashboard | `switchSuite('home')` | `GET /api/dashboard/summary` | `WORKING` | Dynamic metric cards from SQLite DB. |
| **2. File GST** | `#viewCopilotSuite` | 5-step guided return preparation and Nil filing | `switchSuite('file-gst')` | `POST /api/returns/nil-filing`, `POST /api/returns/file` | `WORKING` | Explicit confirmation for Nil returns; watermarked simulation receipts. |
| **3. Bills & Docs** | `#viewBillsSuite` | Inward bills repository, OCR review & upload | `switchSuite('bills')` | `GET /api/documents`, `POST /api/documents/upload` | `WORKING` | Drag & drop upload, preview, streaming download, and deletion. |
| **4. Reconciliation** | `#viewReconSuite` | GSTR-2B vs Purchase Register matching | `switchSuite('recon')` | `GET /api/reconciliation/summary` | `WORKING` | Matched, mismatch, missing in books, and missing in 2B views. |
| **5. Tax Calc (3B)** | `#viewTaxCalcSuite` | Rule 88A setoff matrix & cash liability calc | `switchSuite('taxcalc')` | `GET /api/returns/tax-calc` | `WORKING` | Strict IGST exhaustion and CGST/SGST isolation. |
| **6. Ledgers & Reports** | `#viewGstSuite` | Electronic Ledgers (Cash, Credit, Liability) & exports | `switchSuite('gst')` | `GET /api/ledgers/balances`, `GET /api/reports/...` | `WORKING` | Real ledger balances and downloadable Excel/CSV reports. |
| **7. GST Copilot** (Replacing Compliance Health) | `#viewCopilotSuite` | Zero-jargon AI tax assistant grounded on DB records | `switchSuite('copilot')` | `POST /api/copilot/ask`, `GET /api/copilot/status` | `PARTIALLY WORKING` | Upgrade to dedicated full-featured chat workspace with suggested prompts. |
| **8. Vendor Hub** | `#viewVendorSuite` | Vendor risk leaderboard & Rule 37 180-day notices | `switchSuite('vendor')` | `GET /api/vendors/risk`, `POST /api/vendors/notice` | `WORKING` | Dispatches WhatsApp/Email reminders for unfiled supplier bills. |
| **9. CA Practice Hub** | `#viewPracticeSuite` | Multi-client practice management & audit logs | `switchSuite('practice')` | `GET /api/practice/clients`, `GET /api/practice/audit` | `WORKING` | Client switching with strict tenant isolation. |
| **10. Tax Experts** | `#viewExpertSuite` | 1-on-1 CA consultation & notice reply draft | `switchSuite('expert')` | `POST /api/expert/book` | `WORKING` | Interactive schedule booking and consultation room. |
| **11. Settings & Multi-GSTIN** | `#viewStartupSuite` | Add state GSTIN branches & legal preferences | `switchSuite('startup')` | `GET /api/gstins`, `POST /api/gstins` | `WORKING` | Validates GSTIN structure and adds state branches dynamically. |

---

## 4. Home Dashboard Section

| Element | Intended Action | Frontend Handler | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Sync Portal Button** | Synchronize data with GSTN / GSP | `syncPortalData()` | `GET /api/gsp/health`, `GET /api/mode` | `WORKING` | Displays live GSTN sync status badge and refreshes ledgers. |
| **+ New Invoice Button** | Open modal to create and record outward sales invoice | `openNewInvoiceModal()` | `POST /api/sales` | `WORKING` | Validates recipient GSTIN, tax rates, and saves directly to SQLite DB. |
| **Continue Filing Purchases ->** | Progress from Step 1 to Step 2 (Purchases) | `switchSuite('bills')` | `GET /api/purchases` | `WORKING` | Opens Bills & Documents suite focused on inward bills. |
| **Review Step 1 Sales** | Inspect outward sales register | `switchSuite('gst')` | `GET /api/sales` | `WORKING` | Navigates to Sales Register view with filter options. |
| **Filing Stepper Items (1 to 5)** | Direct navigation to respective filing stage | `switchFilingStep(step)` | Respective suite APIs | `WORKING` | Seamless navigation across Sales, Purchases, ITC, Tax Calc, and GSTR-3B. |
| **View Ledger -> Link** | Navigate to Electronic Ledgers & Balance Statements | `switchSuite('gst')` | `GET /api/ledgers/balances` | `WORKING` | Jumps to electronic cash, credit, and liability ledger tables. |
| **Recent Activity Rows** | View invoice detail / voucher slip | `viewInvoiceDetail(id)` | `GET /api/sales/:id`, `GET /api/purchases/:id` | `WORKING` | Populates invoice drawer with line items and verification seal. |

---

## 5. File GST & Nil Return Filing Workflow

| Element | Intended Action | Frontend Handler | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **File Nil Return Card** | 1-Click Nil GST return filing | `fileNilReturnConfirm()` | `POST /api/returns/nil-filing` | `WORKING` | Validates zero sales/purchases, prompts confirmation, issues watermarked receipt. |
| **Guided 5-Step Pipeline Card** | Launch full 5-stage return wizard | `startGuidedFiling()` | `GET /api/returns/tax-calc` | `WORKING` | Navigates step-by-step through Sales -> Purchases -> ITC -> Calc -> Review. |
| **Audit Trail Button** | Inspect statutory compliance audit history | `openAuditTrailModal()` | `GET /api/practice/audit` | `WORKING` | Displays immutable timestamped log of filing operations. |
| **Prior GSTR-3B Summary** | Download previous tax period summary | `downloadPriorSummary()` | `GET /api/reports/gstr3b/summary` | `WORKING` | Downloads structured JSON/PDF summary of prior period returns. |

---

## 6. Bills & Documents Suite

| Element | Intended Action | Frontend Handler | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Single / Multi File Upload** | Upload PDF/Image/CSV invoices | `handleFileUpload(files)` | `POST /api/documents/upload` | `WORKING` | Multipart form upload, stores in `data/uploads/`, records in DB. |
| **Drag & Drop Upload Zone** | Drag files directly into bills canvas | `setupDragAndDrop()` | `POST /api/documents/upload` | `WORKING` | Visual dragover cues, validates MIME type and 15MB size limit. |
| **Document Search Input** | Filter documents by supplier name or invoice # | `filterDocuments(query)` | Client search on active DB rows | `WORKING` | Debounced search across invoice number and supplier fields. |
| **Category Filter Tabs** | Filter by All, Inward Bills, Sales, Bank Statements | `filterDocumentCategory(cat)` | `GET /api/documents?category=...` | `WORKING` | Filters table rows dynamically. |
| **Download Original Document** | Authenticated download of uploaded voucher | `downloadDocument(id)` | `GET /api/documents/:id/download` | `WORKING` | Streaming download with path traversal defenses (`data/uploads/`). |
| **Delete Document Button** | Remove unapproved draft invoice | `deleteDocument(id)` | `DELETE /api/documents/:id` | `WORKING` | Deletes file from disk and cascade-deletes DB record. |
| **Review OCR Button** | Open split-view OCR verification panel | `openOcrReview(id)` | `POST /api/ocr/extract` | `WORKING` | Shows side-by-side invoice preview with editable fields. |

---

## 7. OCR Extraction & Human Review Pipeline

| Element | Intended Action | Frontend Handler | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Extract OCR Fields** | Extract supplier, GSTIN, amount, tax | `triggerOcrExtraction(docId)` | `POST /api/ocr/extract` | `WORKING` | Returns line items, tax heads, and confidence score. |
| **Editable Field Inputs** | Manual correction of extracted values | Two-way input binding | N/A (Client state) | `WORKING` | Allows tax reviewer to amend any field before committing. |
| **Approve & Commit Button** | Post verified invoice to Purchase Register | `approveOcrInvoice(docId)` | `POST /api/ocr/approve` | `WORKING` | Creates row in `purchase_invoices` with link to document. |
| **Duplicate Prevention Check** | Guard against re-posting existing invoice | Backend duplicate check | `POST /api/ocr/approve` | `WORKING` | Checks `(gstin_id, invoice_number, supplier_gstin)` uniqueness. |

---

## 8. GSTR-2B Reconciliation Suite

| Element | Intended Action | Frontend Handler | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Auto-Match Invoices Button** | Re-run GSTR-2B matching algorithm | `runReconciliation()` | `GET /api/reconciliation/summary` | `WORKING` | Compares books with 2B entries; flags variance > ₹1.00. |
| **Filter Tabs (Matched / Missing)** | Inspect categorized reconciliation items | `filterReconTab(status)` | Client filter on recon summary | `WORKING` | Switches table between Matched, Missing in Books, and Missing in 2B. |
| **Export Recon Report Button** | Download reconciliation matrix in CSV | `exportReconReport()` | `GET /api/reports/reconciliation/csv` | `WORKING` | Streams CSV report with GSTIN, Invoice #, Values, and Matching status. |

---

## 9. Tax Calculation & Form GST PMT-06 Challans

| Element | Intended Action | Frontend Handler | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Compute Tax Set-Off** | Execute Rule 88A calculation engine | `recalculateTaxOffset()` | `GET /api/returns/tax-calc` | `WORKING` | Evaluates gross liability vs eligible ITC under Rule 88A order. |
| **Generate PMT-06 Button** | Create Form GST PMT-06 challan | `generatePmt06Challan()` | `POST /api/challans/generate-pmt06` | `WORKING` | Enforces Rule 87(4) ₹10,000 OTC limit; issues 14-digit CPIN. |
| **Simulate Payment Button** | Complete net banking payment | `submitChallanPayment()` | `POST /api/challans/simulate-payment` | `WORKING` | Credits cash ledger in DB; marks challan PAID with bank CIN. |
| **PMT-06 Modal Close (X)** | Dismiss challan modal | `closePmt06Modal()` | N/A (DOM state) | `WORKING` | Smoothly hides modal backdrop and container (`style="display: none;"`). |

---

## 10. GST Copilot (Dedicated AI Tax Assistant)

| Element | Intended Action | Frontend Handler | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Copilot Message Input** | User question submission | `onKeyDown / submit` | `POST /api/copilot/ask` | `WORKING` | Accepts plain English tax questions. |
| **Suggested Prompts Chips** | 1-click preset questions | `askCopilotPreset(question)` | `POST /api/copilot/ask` | `WORKING` | Triggers immediate query for Sales, ITC, 2B recon, or 180-day aging. |
| **Clear Conversation** | Reset chat history | `clearCopilotHistory()` | N/A (Client state) | `WORKING` | Clears conversation bubble history. |
| **Data Source Citations** | Show grounding database records | Render source pills | `POST /api/copilot/ask` | `WORKING` | Cites active GSTIN, invoice counts, and CBIC statutory rules. |
| **AI Provider Status Indicator** | Show connection or deterministic fallback | `loadCopilotStatus()` | `GET /api/copilot/status` | `WORKING` | Explicitly states whether connected to external LLM or deterministic engine. |

---

## 11. Kiosk Mode Controls

| Element | Intended Action | Frontend Handler | Backend Endpoint | Status | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Kiosk Mode Button (Header)** | Enter distraction-free fullscreen view | `toggleKioskMode()` | N/A (Fullscreen API) | `WORKING` | Toggles `.kiosk-mode` CSS class on `body` and requests fullscreen. |
| **Exit Kiosk Floating Pill** | Exit Kiosk mode and restore layout | `exitKioskMode()` | N/A (Exit fullscreen) | `WORKING` | Exits fullscreen, restores full navigation, and removes floating pill. |
| **Keyboard Escape Handler** | Exit on ESC keypress | `keydown (Escape)` | N/A (Keyboard listener) | `WORKING` | Listens to `Escape` key to gracefully exit Kiosk Mode anytime. |

---

## 12. Responsive Mobile Controls

| Element | Breakpoints Checked | Intended Action | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Mobile Hamburger Button** | < 1024px | Toggle slide-over sidebar drawer | `WORKING` | Touch target 44×44px, smooth sliding transition. |
| **Backdrop Tap to Dismiss** | < 1024px | Tap outside sidebar to close drawer | `WORKING` | Dismisses drawer immediately without accidental clicks. |
| **Horizontal Table Scroll** | 320px–430px | Prevent page horizontal scroll on tables | `WORKING` | Wrapped in `overflow-x-auto` with sticky headers. |
| **Modal Viewport Bounds** | 320px–430px | Keep modals within screen bounds | `WORKING` | Modals sized `max-w-full max-h-[90vh] overflow-y-auto`. |

