# Evidence Artifact: Invoice Import & Error Report Round-Trip
File: docs/evidence/import-error-flow.md

## Observed Import Template & Error Handling
- Ingestion Format: Excel (.xlsx) / CSV tabular templates.
- Standard Ingestion Fields:
  - Invoice Number
  - Invoice Date
  - Party Name
  - Party GSTIN
  - Place of Supply (POS)
  - Taxable Value
  - Rate (%)
- Validation Engine Behavior:
  - Validates GSTIN structure (15 characters) and Indian state code jurisdiction.
  - Enforces tax split consistency: Intra-state (CGST + SGST) vs Inter-state (IGST).
  - Isolates failed rows with error descriptions.
- Error Report Structure:
  - Downloads an Excel spreadsheet retaining the exact template layout with an appended column "Error reason" / "Error Description".
  - Round-trip workflow: Taxpayers correct the row values in the downloaded file and re-upload.

