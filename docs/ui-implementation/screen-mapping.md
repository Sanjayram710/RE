# SimpleGST Application Screen & Route Mapping

This document maps all existing application routes, containers, modals, and statutory features to their corresponding Stitch reference screens.

---

## Screen Mapping Matrix

| # | Feature / Workflow | Stitch Screen Reference | DOM Container ID | Navigation Action |
|---|---|---|---|---|
| 1 | **Executive Home Dashboard** | `business_owner_home_dashboard` | `#viewHomeSuite` | `switchSuite('home')` |
| 2 | **Guided GST Filing & Nil Return** | `file_gst_guided_filing_nil_return_workflow` | `#viewCopilotSuite` | `switchSuite('copilot')` |
| 3 | **Bills & Document Split-View OCR** | `bills_documents_document_management_split_view_ocr_review` | `#viewBillsSuite` | `switchSuite('bills')` |
| 4 | **GSTR-2B ITC Reconciliation** | `file_gst_gstr_2b_input_tax_credit_itc_reconciliation_engine` | `#viewReconSuite` | `switchSuite('recon')` |
| 5 | **Tax Calc & GSTR-3B Review** | `file_gst_tax_calculation_final_gstr_3b_return_review` | `#viewTaxCalcSuite` | `switchSuite('taxcalc')` |
| 6 | **Electronic Ledgers & Reports** | `electronic_ledgers_comprehensive_gst_reports` | `#viewGstSuite` | `switchSuite('gst')` |
| 7 | **CA Practice Hub** | `ca_practice_hub_client_management` | `#viewPracticeSuite` | `switchSuite('practice')` |
| 8 | **Compliance Health & Copilot** | `gst_compliance_health_score_gst_copilot_studio` | `#viewComplianceSuite` | `switchSuite('compliance')` |
| 9 | **Vendor Communication Hub** | `bills_documents_vendor_communication_compliance_reminders_hub` | `#viewVendorSuite` | `switchSuite('vendor')` |
| 10 | **Form GST PMT-06 Challan Modal** | `file_gst_form_gst_pmt_06_challan_generation_payment_modal` | `#pmt-06-modal` | `openPmt06Modal()` / `closePmt06Modal()` |
| 11 | **ARN Acknowledgment Receipt** | `file_gst_post_filing_success_arn_statutory_acknowledgment` | `#arn-success-modal` | `showArnModal()` / `closeArnModal()` |
| 12 | **Multi-GSTIN & Entity Hub** | `business_onboarding_multi_gstin_management_hub` | `#viewMultiGstinSuite` | `switchSuite('multigstin')` |
| 13 | **Tax Experts Assisted Filing** | Custom Stitch-adapted Consultation Modal | `#expertAssistedModal` / `#viewExpertSuite` | `switchSuite('expert')` |
| 14 | **Startup Business Onboarding** | `business_onboarding_multi_gstin_management_hub` | `#viewStartupSuite` | `switchSuite('startup')` |

---

## User Role Separation
- **Business Owner Experience**:
  - Accessible items: Home Dashboard, Guided GST Filing, Bills & Documents, Reports & Ledgers, Compliance Health, Vendor Communication, Multi-GSTIN settings.
  - CA Practice Hub is excluded from standard business owner navigation to prevent unauthorized access.
- **Chartered Accountant (CA) Experience**:
  - Primary access to CA Practice Hub with multi-client portfolio management, period-wise compliance status, authorized signing, and audit trails.
  - Client context switcher allows a CA to inspect a specific client's books in read-only or filing mode under strict tenant isolation.

