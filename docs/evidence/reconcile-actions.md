# Evidence Artifact: GSTR-2B vs Books Reconciliation & Vendor Actions
File: docs/evidence/reconcile-actions.md

## Observed Reconciliation Buckets
1. Matched: Identical GSTIN, Invoice Number, Date, and Tax values between Purchase Register and GSTR-2B.
2. Value / Date Mismatch: Invoices present in both datasets but differing in tax amounts or filing dates.
3. Missing in GSTR-2B: Purchase invoices recorded in books where the supplier has not filed GSTR-1.
4. Missing in Books: Invoices appearing in GSTR-2B not yet entered in taxpayer's purchase register.

## Document-Level Actions
- "Accept": Authorize claiming of eligible ITC in Table 4 of GSTR-3B.
- "Hold": Mark ITC as pending to prevent statutory disallowance.
- "Ask Supplier" / "Send Reminder": Generate supplier notification (via WhatsApp / Email) requesting supplier to file GSTR-1.

