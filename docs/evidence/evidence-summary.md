# Evidence Index: ClearTax Inspection

This directory documents artifacts, captured structures, and schema references gathered during the REA inspection of cleartax.in public pages, developer documentation, and GST portal standards.

## Captured Artifacts & Schema Mappings

1. **Reports Flow**:
   - `reports-center.json`: Filter schemas and asynchronous job payload structure.
   - Excel export format: SpreadsheetML (XML Spreadsheet 2003) workbook with styles, cell types, and multi-tab hierarchy.

2. **Import & Validation**:
   - `import-schema.json`: Field definitions for B2B/B2C invoices (Invoice No, Date DD/MM/YYYY, Customer GSTIN, Place of Supply, Item Rate, Taxable Value, Cess).
   - Error file structure: Appends `Error Description` column highlighting invalid checksum, invalid state code, or rate mismatches.

3. **Reconciliation Buckets**:
   - `reconcile-rules.json`: Logic for exact match (GSTIN + Doc No + Date +/- 30 days + Value +/- Re 1), mismatched, missing in 2B, and missing in PR.

4. **GSTR-3B Computation**:
   - `gst-rules.json`: Cross-utilization sequence for Section 49, 49A, and 49B of CGST Act.

5. **GSP Status Ledger**:
   - `api-status.json`: 182 GSP API specifications categorized across GSTR-1, GSTR-2A, GSTR-2B, GSTR-3B, and IMS.

