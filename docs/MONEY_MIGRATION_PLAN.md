# Money Migration Plan — Rupee Floats to Integer Paise

## 1. Objective
Eliminate IEEE-754 floating-point precision errors in GST calculations (e.g., `0.1 + 0.2 !== 0.3`, Rule 88A cross-utilization, 18% GST splits, and Rule 37 proportional reversals) by performing all monetary math in **integer paise** (`1 INR = 100 paise`).

---

## 2. Phased Strategy (Zero-Downtime & Reversible)

### Stage A (Phase 1 — Implemented Now): Integer-Paise Boundary Calculation
- **Existing SQLite columns remain untouched** (`taxable_amount REAL`, `igst REAL`, `cgst REAL`, `sgst REAL`, `cess REAL`, `total_tax REAL`, `total_amount REAL`) so zero existing schemas, queries, or tests break.
- Introduce `lib/moneyPaise.js`:
  - `toPaise(rupees)` -> `Math.round((Number(rupees) + Number.EPSILON) * 100)` (strict integer)
  - `fromPaise(paise)` -> `Math.trunc(paise) / 100`
  - `addPaise(...vals)`, `subPaise(a, b)`, `minPaise(...vals)`, `percentOfPaise(paise, pct)`
- Refactor `lib/rule88aEngine.js` and calculation boundaries in `lib/functionalApi.js` to convert inputs with `toPaise()`, run all allocations/subtractions in integer paise, and convert back with `fromPaise()` at the boundary.

### Stage B (Future Schema Migration — Additive & Reversible)
When migrating stored columns, **never mutate existing `REAL` columns in place**. Instead:
1. **Mandatory Backup**: Copy `data/simplegst.db` to `data/backups/simplegst.db.bak.<ISO-timestamp>` before any DDL.
2. **Additive Shadow Columns**: Add `*_paise INTEGER` columns (`taxable_amount_paise`, `igst_paise`, `cgst_paise`, `sgst_paise`, `cess_paise`, `total_tax_paise`, `total_amount_paise`) to `sales_invoices`, `purchase_invoices`, `electronic_ledgers`, and `challans`.
3. **Backfill & Parity Verification**:
   - `UPDATE sales_invoices SET taxable_amount_paise = CAST(ROUND(taxable_amount * 100) AS INTEGER), ...`
   - Assert `COUNT(*) WHERE ABS((taxable_amount_paise / 100.0) - taxable_amount) > 0.001 === 0`.
4. **Reversibility (Rollback)**:
   - Because original `REAL` columns are preserved untouched during Stage B, rollback simply stops reading `*_paise` columns (or drops them via `ALTER TABLE ... DROP COLUMN` / restoring the timestamped backup).

---

## 3. Verification Script
`scripts/migrate_paise_columns.js` implements:
- `--test-copy`: Clones `data/simplegst.db` into `data/backups/`, applies the additive `*_paise` migration on the **copy**, verifies 100% row parity, executes the rollback on the **copy**, and verifies schema restoration without ever mutating the live database.
