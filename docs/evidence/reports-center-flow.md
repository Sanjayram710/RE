# Evidence Artifact: Reports Center & Generate-Then-Download Pattern
File: docs/evidence/reports-center-flow.md

## Observed UI & Architecture
- Navigation: Business > Reports > All Reports
- Filters observed:
  - Document Date / Filing Period (Month/Year selector)
  - Business Entity / GSTIN selector
  - Tax Slab Rate (0%, 5%, 12%, 18%, 28%)
  - Party Name / GSTIN filter
- Action & State:
  - Button: "Generate Report" / "Export Report"
  - Asynchronous progress state with progress indicator
  - Result card displaying filename, row count, and file size
  - Download buttons: "Download Excel" (.xlsx) and "Download CSV"
- Backing for:
  - Reports center and generate-then-download UX pattern
  - Export History table cached in client storage

