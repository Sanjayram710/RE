# SimpleGST — GST Copilot Architecture & Implementation Report

**Document Version:** 1.0.0  
**Implementation Date:** November 5, 2026  
**Module:** GST Copilot Studio & Statutory Grounding Engine (`POST /api/copilot/ask`)  

---

## 1. Executive Summary

As directed in Phase 4 of the master directive, **Compliance Health has been replaced by GST Copilot** as a primary first-class module in the left sidebar navigation.

GST Copilot operates as an intelligent tax strategist grounded directly in the user's active database records (`data/simplegst.db`) and CBIC statutory rules. It eliminates tax jargon while providing legally sound citations for all guidance.

---

## 2. Navigation Architecture & Iconography

```html
<!-- 7. GST Copilot (Replaces Compliance Health in Left Sidebar) -->
<a id="nav-link-copilot" onclick="switchSuite('copilot'); return false;" 
  class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" 
  href="#copilot">
  <div class="flex items-center gap-3">
    <span class="material-symbols-outlined text-[20px]">smart_toy</span>
    <span>GST Copilot</span>
  </div>
  <span class="font-label-sm text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">AI</span>
</a>
```

- **Icon:** Consistent Material Symbols `smart_toy` matching the SimpleGST design language.
- **Badge:** Distinctive teal `AI` pill badge highlighting assistant capability.
- **Legacy Health Menu:** Removed as a primary sidebar navigation destination.

---

## 3. Dedicated Copilot Workspace Layout

The Copilot suite (`#viewCopilotSuite`) provides an expansive 12-column assistant layout:

1. **Header & Context Strip:**
   - Active GSTIN Pill: `Apex Retailers Pvt Ltd (27AAACA1234A1Z5) • October 2026`
   - Engine Status: `Deterministic Statutory u/s CGST Act & Live DB`
   - Clear Conversation control (`clearCopilotChat()`).
2. **Main Conversation Canvas (8 cols):**
   - Speech bubbles with distinct styling for User and Copilot.
   - Initial greeting with live summary of Table 3.1 liability, Table 4 eligible ITC, and net cash shortfall.
   - Statutory citation tags attached to bot replies (e.g. `Section 16(2)(aa)`, `Rule 88A`, `Rule 37`).
3. **8 Suggested Question Quick-Chips:**
   Preset 1-click prompt buttons triggering immediate database queries.
4. **Right Grounding & Statutory Panel (4 cols):**
   - Displays live database connection status (`data/simplegst.db`).
   - Summarizes key statutory provisions (Section 16(2)(aa), Rule 88A, Rule 37, Rule 36(4)).

---

## 4. Eight Core Statutory Query Implementations

| # | Question Prompt | Statutory Provision | Database Query / Logic | Verified Copilot Response |
| :--- | :--- | :--- | :--- | :--- |
| **1** | *"What is my total sales for this month?"* | Section 31 & Section 37 | Aggregates outward taxable sales and total tax from `sales_invoices` | *"For Apex Retailers Pvt Ltd (27AAACA1234A1Z5) in October 2026, your total recorded sales are ₹8,42,500 across 14 invoices, with total GST of ₹1,51,650..."* |
| **2** | *"How much ITC can I claim?"* | Section 16(2)(aa) & Rule 36(4) | Filters `purchase_invoices` for `itc_eligibility = 'ELIGIBLE'` | *"You can claim ₹74,214 in eligible Input Tax Credit (ITC) for October 2026 across 8 inward bills. All eligible bills strictly satisfy Section 16(2)(aa) GSTR-2B matching requirements."* |
| **3** | *"Which purchase invoices are missing from GSTR-2B?"* | Section 16(2)(aa) & Rule 37A | Cross-references `purchase_invoices` against `gstr2b_entries` | *"Reconciliation Alert: 3 purchase bill(s) are currently missing from your supplier's filed GSTR-1 (₹18,400 ITC at risk). Missing bills: PUR-OCT-039, PUR-OCT-044..."* |
| **4** | *"What is my estimated tax liability?"* | Section 49 & Rule 88A | Computes Table 3.1 gross minus Table 4 ITC through Rule 88A setoff | *"For Apex Retailers Pvt Ltd in October 2026, your gross tax liability is ₹1,51,650. After offsetting ₹74,214 available ITC under Rule 88A, your estimated net tax payable in cash is ₹77,436..."* |
| **5** | *"Which invoices are approaching the 180-day payment limit?"* | Section 16(2) 2nd Proviso & Rule 37 | Evaluates `days_aging >= 120` on unpaid purchase bills | *"Payment Aging Clean (Section 16(2) 2nd Proviso & Rule 37): All inward purchase bills are within safe payment aging (<120 days). No mandatory Table 4(B)(2) reversals required..."* |
| **6** | *"Explain my GSTR-3B calculation."* | Rule 88A & Section 49A/49B | Explains IGST priority exhaustion and CGST/SGST firewall | *"Statutory GSTR-3B Calculation: Table 3.1 gross is ₹1,51,650, Table 4 ITC is ₹74,214. Rule 88A: IGST must be 100% utilized before CGST or SGST credit can be used..."* |
| **7** | *"What should I complete before filing?"* | Section 37(4) & Section 39(10) | Sequential prerequisite verification | *"Pre-Filing Compliance Checklist: 1. Outward Invoices in GSTR-1; 2. Inward ITC locked with 2B; 3. Rule 88A set-off evaluation; 4. PMT-06 challan deposit; 5. GSTR-1 filed before GSTR-3B..."* |
| **8** | *"Show my current cash ledger balance."* | Section 49(1) & Form PMT-05 | Queries `electronic_ledgers` for `CASH` balances | *"Your current Electronic Cash Ledger (Form GST PMT-05) balance for 27AAACA1234A1Z5 is ₹15,000 (CGST: ₹7,500, SGST: ₹7,500, IGST: ₹0)..."* |

---

## 5. Security & Transparency Guarantees

1. **Server-Side API Key Storage:** External LLM keys (`GEMINI_API_KEY` / `OPENAI_API_KEY`) remain strictly server-side in environment variables and are never bundled in frontend JavaScript.
2. **Deterministic Fallback Transparency:** When no external LLM is configured, the Copilot explicitly displays its `deterministic_statutory` operational mode. It never falsely claims an active AI connection when running deterministically.
3. **Tenant & GSTIN Isolation:** All queries are filtered through `getActiveGstin()`. The Copilot will never leak financial data from another state branch or organization.
