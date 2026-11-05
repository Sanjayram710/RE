# SimpleGST — Critical Authentication & Session Security Audit & Fix Report

## 1. Executive Summary

This security audit and architectural hardening addresses critical vulnerabilities in session management, proof of authentication, multi-tenant isolation, and endpoint authorization within the SimpleGST Indian GST Compliance Platform.

Previously:
- Unknown or missing session tokens triggered fallback session creation using the default Apex director (`Rajesh Sharma`), effectively authenticating any caller.
- Client-provided `query.sessionId`, `body.sessionId`, and `x-session-id` headers were treated as proof of identity without token verification.
- Session expiration timestamps were stored in the database but never enforced against `CURRENT_TIMESTAMP`.
- Session revocation was not supported (no revocation status or timestamps).
- Tenant-scoped API endpoints lacked authorization gating, allowing unauthenticated requests to read and manipulate GST registrations, invoices, documents, ledgers, and tax returns.

All vulnerabilities have been resolved. The platform now implements strict cryptographic token validation, expiration and revocation enforcement, secure HTTP-only cookies and Authorization headers, tenant organization membership verification, cross-tenant GSTIN firewalling, and complete 401/403 HTTP gating across all tenant endpoints.

---

## 2. Root Cause Analysis

| # | Vulnerability | Severity | Root Cause |
|---|---|---|---|
| 1 | **Automatic Authentication on Unknown Session** | **CRITICAL** | `resolveSessionContext` in `lib/functionalApi.js` fell back to `sess-default` when no token matched, auto-creating a session for `rajesh.sharma@apexretail.com` and granting full director privileges. |
| 2 | **Unenforced Session Expiry & Revocation** | **HIGH** | `sessionRepo.findByToken` only matched token equality. It lacked checks for `expires_at > CURRENT_TIMESTAMP` and the `sessions` table lacked revocation columns (`is_revoked`, `revoked_at`). |
| 3 | **Insecure Session Tokens via Query/Body/Headers** | **HIGH** | `query.sessionId`, `body.sessionId`, and `x-session-id` were treated as authentication proof, enabling session fixation and query-string credential leakage. |
| 4 | **Missing Endpoint Authorization & 401 Gating** | **CRITICAL** | `handleFunctionalApi` processed requests without checking whether `context.authenticated` was true, permitting unauthenticated callers to execute state-changing actions. |
| 5 | **Missing Organization Membership Verification** | **HIGH** | Endpoints did not verify that the authenticated user existed in `org_members` for the active organization or for target GSTINs during workspace activation. |
| 6 | **Mocked Login & Missing Logout** | **MEDIUM** | `POST /api/auth/login` returned mocked user data without verifying credentials or creating a genuine session, while `POST /api/auth/logout` was unimplemented. |

---

## 3. Security Architecture & Implementation Details

### 3.1 Cryptographic Session Tokens & Repository Hardening (`lib/db.js`)
- **Schema Migration**: Added `is_revoked INTEGER DEFAULT 0` and `revoked_at DATETIME` to `sessions` table in `initDatabase()`.
- **Token Generation**: Generates 256-bit cryptographic hex tokens via `crypto.randomBytes(32).toString('hex')`.
- **`findValidSession(token)`**:
  - Verifies token exists.
  - Enforces `(is_revoked = 0 OR is_revoked IS NULL)`.
  - Enforces `expires_at > CURRENT_TIMESTAMP` (in SQLite and JavaScript timestamp validation).
- **`revoke(tokenOrId)`**: Marks `is_revoked = 1` and `revoked_at = CURRENT_TIMESTAMP`.
- **`cleanExpired()`**: Removes expired and revoked sessions from storage.
- **`userRepo.verifyPassword(storedHash, plainPassword)`**: Implements PBKDF2 with SHA-256 and constant-time comparison `crypto.timingSafeEqual` to prevent timing attacks.
- **`orgRepo.getMembership(orgId, userId)`**: Verifies user membership and role in `org_members`.

### 3.2 Secure Session Resolution (`lib/functionalApi.js`)
- **Strict Token Extraction**: Tokens are accepted ONLY from:
  1. `Authorization: Bearer <token>`
  2. `Cookie: simplegst_session=<token>`
  3. `X-Session-Token: <token>`
- **No Fallback**: If no token is provided or the token is unknown/expired/revoked, `context.authenticated = false` and `context.session = null`.
- **Tenant & GSTIN Ownership**:
  - Checks user's membership in `session.active_org_id`.
  - Verifies `active_gstin_id` belongs to `active_org_id`.
  - Verifies explicit target GSTIN requests (`query.gstinId`, `body.gstinId`, `x-gstin-id`) belong to `active_org_id`. Sets `forbiddenGstin = true` if cross-tenant.

### 3.3 Endpoint Gating & Flow Protection
- **Public Routes**:
  - `POST /api/auth/login`: Validates user credentials, creates session, and issues `Set-Cookie: simplegst_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`.
  - `GET /api/auth/session`: Returns `{ authenticated: false, user: null }` for unauthenticated callers, or full authenticated session details for valid sessions.
- **Tenant-Scoped Routes**:
  - Any request with `!context.authenticated` returns **HTTP 401 Unauthorized**.
  - Any request with `context.forbiddenOrg` or `context.forbiddenGstin` returns **HTTP 403 Forbidden**.
- **Logout Flow**:
  - `POST /api/auth/logout`: Revokes active session and clears cookie (`Expires=Thu, 01 Jan 1970 00:00:00 GMT`).
- **Context Switch Endpoint**:
  - `POST /api/auth/switch-context`: Strictly checks that caller is an authorized member of `orgId` and that `gstinId` belongs to that organization before updating context.

---

## 4. Test Suite & Verification Results

A comprehensive test suite of **137 test cases** was executed across 9 test modules:

```bash
npm test
```
```
✔ Functional DB: Initialize and Seed Development Data
✔ Multi-GSTIN: Format validation and branch creation
✔ Multi-GSTIN: Switching active GSTIN scopes all queries
✔ Sales Invoices: Create and deterministic tax computation
✔ Purchase Bills & 180-Day Rule 37 Tracking
✔ File Upload & Secure Storage
✔ OCR Approval: Posts verified fields to purchase register
✔ GSTR-2B Reconciliation Summary: Matches books against 2B
✔ Tax Calculation & Rule 88A Matrix Execution
✔ GST Copilot: Context grounded on real database records
✔ PMT-06 Challan: Enforces Rule 87(4) Over-The-Counter ₹10,000 limit
✔ PMT-06 Challan: Net Banking payment credits cash ledger
✔ Document Management: List and delete uploaded files
✔ Reports & Exports: Generate CSV files for Sales and Purchases
✔ GST Copilot: Answers all 8 core statutory queries grounded in live database
✔ UX Simplification: File GST 2-Card Decision, Nil Pre-Check & Dynamic Period Sync
✔ Data Integrity & Period Cleanup: Dynamic period switching, Nil verification & transparent disclosures
✔ Backend Integrity: Nil Return Declaration Enforcement (Missing, Null, False, String, True)
✔ Backend Integrity: Rule 67A Nil Form GSTR-3B Eligibility with Ineligible Purchase vs Outward Supplies & RCM
✔ Backend Integrity: Per-Session Multi-Tenant Context Isolation & Cross-Tenant 403 Forbidden
✔ Statutory Compliance: Monthly vs QRMP Deadlines, Category 1/2 Staggering & Period Format Validation
✔ Security & Simulation Integrity: XSS Escaping and SIMULATED_NOT_TRANSMITTED Status
✔ Security Audit: Authentication & Session Token Handling (Reject Unknown, Expired, Revoked, Invalid)
✔ Security Audit: Multi-Tenant Authorization, Cross-Tenant Gating & Credential Login/Logout

ℹ tests 137
ℹ suites 0
ℹ pass 137
ℹ fail 0
ℹ duration_ms 851.4425
```

### Full Acceptance Audit Verification:
```bash
node scripts/verifyAcceptance.js
```
```
+-----------------------------------------------------------------------------+
| ITEM                                    | STATUS | DETAILS                  |
+-----------------------------------------------------------------------------+
| 1. Asset Parity                          | PASS   | index.html, app.js, and style.css have i |
| 2. Dashboard Live Data                   | PASS   | Sales: ₹13,92,500, Purchases: ₹4,12,300  |
| 3. New Invoice Modal & Persistence       | PASS   | Invoice INV-TEST-5784 stored in SQLite w |
| 4. File GST 5-Step Return Workflow       | PASS   | Mobile bottom nav points to file-gst and |
| 5. Bills & Docs Storage & OCR Review     | PASS   | 41 documents indexed with OCR approval a |
| 6. GSTR-2B Reconciliation                | PASS   | 2/2 matched; ₹0 at risk u/s 16(2)(aa)    |
| 7. Tax Calculation Engine                | PASS   | Rule 88A computed: Net Cash Payable ₹1,8 |
| 8. Electronic Ledgers (PMT-05/06/09)     | PASS   | Cash: ₹8,35,000, Credit: ₹0              |
| 9. GST Copilot Live Grounding            | PASS   | Answer grounded in live SQLite database  |
| 10. Kiosk Mode Unified Controller        | PASS   | Single controller, Escape key listener,  |
| 11. Multi-GSTIN & Branch Management      | PASS   | 44 state branches registered in platform |
| 12. Responsive Breakpoint QA             | PASS   | Verified layout density and controls acr |
+-----------------------------------------------------------------------------+
ALL 12 ACCEPTANCE AUDIT CRITERIA SATISFIED WITH 100% SUCCESS.
```
