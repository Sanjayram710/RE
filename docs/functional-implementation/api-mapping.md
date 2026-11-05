# SimpleGST API Endpoint Mapping Specification

This document maps all backend REST API endpoints, HTTP methods, authorization requirements, payload structures, and response contracts for the SimpleGST compliance engine.

---

## 1. Authentication & Session Management

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/auth/register` | POST | None | Creates a new user account and default organization |
| `/api/auth/login` | POST | None | Authenticates user credentials and returns session token |
| `/api/auth/session` | GET | Bearer | Returns current authenticated user and active organization |
| `/api/auth/logout` | POST | Bearer | Invalidates active user session |

---

## 2. Multi-GSTIN & Organization Management

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/organizations/current` | GET | Bearer | Retrieves active organization profile and legal constitution |
| `/api/gstins` | GET | Bearer | Lists all registered GSTIN branches for current organization |
| `/api/gstins` | POST | Bearer | Registers a new GSTIN branch with format & PAN link validation |
| `/api/gstins/:id` | PUT | Bearer | Updates trade name, address, or branch jurisdiction |
| `/api/gstins/:id/activate` | POST | Bearer | Sets active workspace GSTIN; all subsequent queries scope to this ID |
| `/api/gstins/:id/deactivate` | POST | Bearer | Deactivates branch within workspace without deleting historical records |

---

## 3. Sales Invoices Management

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/sales` | GET | Bearer | Retrieves sales invoices scoped to active GSTIN and filing period |
| `/api/sales` | POST | Bearer | Creates a new sales invoice with deterministic tax computation |
| `/api/sales/:id` | GET | Bearer | Retrieves full details of a specific sales invoice |
| `/api/sales/:id` | PUT | Bearer | Updates a draft sales invoice |
| `/api/sales/:id` | DELETE | Bearer | Deletes a draft invoice (blocked if period is marked filed) |

---

## 4. Purchase Bills & 180-Day Rule 37 Tracking

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/purchases` | GET | Bearer | Retrieves purchase bills scoped to active GSTIN and filing period |
| `/api/purchases` | POST | Bearer | Records a purchase bill with supplier details, HSN, and tax heads |
| `/api/purchases/:id` | GET | Bearer | Retrieves purchase invoice details and payment aging |
| `/api/purchases/:id/payment` | POST | Bearer | Updates supplier payment status (full/partial) for Rule 37 compliance |
| `/api/purchases/:id` | DELETE | Bearer | Removes a draft purchase bill |

---

## 5. File Upload, Storage & OCR Review

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/documents/upload` | POST | Bearer | Securely stores document outside static path; returns document ID |
| `/api/documents` | GET | Bearer | Lists uploaded documents scoped to active GSTIN |
| `/api/documents/:id/download` | GET | Bearer | Authorized secure streaming download of stored file |
| `/api/ocr/extract` | POST | Bearer | Runs OCR extraction on uploaded file; returns structured fields & confidence |
| `/api/ocr/approve` | POST | Bearer | Human approval and posting of extracted fields into Sales/Purchases table |

---

## 6. GSTR-2B ITC Reconciliation Engine

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/reconciliation/summary` | GET | Bearer | Summary of Matched, Mismatch, Missing, and Blocked Sec 17(5) items |
| `/api/reconciliation/import-2b` | POST | Bearer | Imports official GSTR-2B JSON/Excel file or mock provider sync |
| `/api/reconciliation/run` | POST | Bearer | Executes deterministic reconciliation algorithm between Books and 2B |
| `/api/reconciliation/vendor-notice`| POST | Bearer | Generates Section 16(2)(aa) non-compliance notice draft for supplier |

---

## 7. Tax Calculation & GSTR-3B Return Filing

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/returns/tax-calc` | GET | Bearer | Aggregates Table 3.1 & Table 4; runs Rule 88A set-off matrix |
| `/api/returns/lifecycle-check` | GET | Bearer | Validates Section 37(4) and Section 39(10) filing prerequisites |
| `/api/returns/file` | POST | Bearer | Submits return: Demo mode produces `SIM-ARN`; Live requires GSP credentials |
| `/api/returns/history` | GET | Bearer | Scoped filing history with downloadable receipt acknowledgments |

---

## 8. Electronic Ledgers & Form GST PMT-06

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/ledgers/balances` | GET | Bearer | Cash (PMT-05), Credit (PMT-02), and Liability (PMT-01) balances |
| `/api/challans/generate-pmt06` | POST | Bearer | Generates 14-digit CPIN challan enforcing Rule 87(4) ₹10,000 OTC limit |
| `/api/challans/simulate-payment`| POST | Bearer | Simulates net banking payment and credits Electronic Cash Ledger |
| `/api/ledgers/pmt09-transfer` | POST | Bearer | Executes Rule 87(13) cash transfer across major/minor heads |

---

## 9. Contextual GST Copilot AI Assistant

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/copilot/pipeline` | GET | Bearer | Returns 5-stage pipeline aggregated from actual persisted records |
| `/api/copilot/ask` | POST | Bearer | Natural language query grounded in active GSTIN records and CBIC citations |
| `/api/copilot/status` | GET | Bearer | Returns external AI provider configuration status (Connected / Demo Fallback) |

---

## 10. Reports & Exports

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/reports/sales-register` | GET | Bearer | Scoped Sales Register export (JSON / Excel / CSV) |
| `/api/reports/purchase-register`| GET | Bearer | Scoped Purchase Register export (JSON / Excel / CSV) |
| `/api/reports/gstr1-prep` | GET | Bearer | Statutory GSTR-1 preparation summary (Tables 4, 5, 6, 7, 8, 9, 12) |
| `/api/reports/gstr3b-prep` | GET | Bearer | Statutory GSTR-3B preparation summary (Tables 3.1, 3.2, 4, 5, 6.1) |

