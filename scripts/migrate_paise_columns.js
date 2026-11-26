/**
 * Reversible Additive Integer-Paise Shadow Column Migration Script
 *
 * Usage:
 *   node scripts/migrate_paise_columns.js --test-copy
 *     Clones data/simplegst.db into data/backups/, applies additive *_paise INTEGER
 *     columns, verifies 100% rupee-to-paise parity on all rows, then rolls back
 *     the columns on the copy without touching the live database.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const rootDir = path.resolve(process.cwd());
const liveDbPath = path.join(rootDir, "data", "simplegst.db");
const backupsDir = path.join(rootDir, "data", "backups");

const MIGRATIONS = [
  {
    table: "sales_invoices",
    cols: ["taxable_amount", "igst", "cgst", "sgst", "cess", "total_tax", "total_amount"]
  },
  {
    table: "purchase_invoices",
    cols: ["taxable_amount", "igst", "cgst", "sgst", "cess", "total_tax", "total_amount", "amount_paid"]
  }
];

function getColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

export function applyPaiseMigration(db) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const { table, cols } of MIGRATIONS) {
      const existing = new Set(getColumns(db, table));
      for (const col of cols) {
        const paiseCol = `${col}_paise`;
        if (!existing.has(paiseCol)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${paiseCol} INTEGER DEFAULT 0;`);
        }
        db.exec(`UPDATE ${table} SET ${paiseCol} = CAST(ROUND(COALESCE(${col}, 0) * 100) AS INTEGER);`);
      }
    }
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function verifyPaiseParity(db) {
  const report = {};
  for (const { table, cols } of MIGRATIONS) {
    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
    const mismatches = [];
    for (const col of cols) {
      const bad = db.prepare(
        `SELECT COUNT(*) as cnt FROM ${table} WHERE ABS((${col}_paise / 100.0) - ROUND(COALESCE(${col}, 0), 2)) > 0.001`
      ).get();
      if (bad.cnt > 0) mismatches.push({ col, mismatchCount: bad.cnt });
    }
    report[table] = { rowsChecked: countRow.cnt, mismatches };
  }
  return report;
}

export function rollbackPaiseMigration(db) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const { table, cols } of MIGRATIONS) {
      const existing = new Set(getColumns(db, table));
      for (const col of cols) {
        const paiseCol = `${col}_paise`;
        if (existing.has(paiseCol)) {
          db.exec(`ALTER TABLE ${table} DROP COLUMN ${paiseCol};`);
        }
      }
    }
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

if (process.argv.includes("--test-copy")) {
  if (!fs.existsSync(liveDbPath)) {
    console.error("Live DB not found at", liveDbPath);
    process.exit(1);
  }
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupsDir, `simplegst.db.bak.${stamp}`);
  const testCopyPath = path.join(backupsDir, `simplegst.migration-test.${stamp}.db`);

  fs.copyFileSync(liveDbPath, backupPath);
  fs.copyFileSync(liveDbPath, testCopyPath);
  console.log("[Backup] Created backup at:", backupPath);

  const db = new DatabaseSync(testCopyPath);
  const beforeCols = getColumns(db, "sales_invoices");
  applyPaiseMigration(db);
  const afterCols = getColumns(db, "sales_invoices");
  const parity = verifyPaiseParity(db);
  console.log("[Migrate] Parity verification:", JSON.stringify(parity));

  rollbackPaiseMigration(db);
  const rolledBackCols = getColumns(db, "sales_invoices");
  db.close();

  const cleanRollback = JSON.stringify(beforeCols) === JSON.stringify(rolledBackCols);
  console.log("[Rollback] Columns before:", beforeCols.length, "after migrate:", afterCols.length, "after rollback:", rolledBackCols.length, "exact match:", cleanRollback);
  fs.unlinkSync(testCopyPath);
  if (!cleanRollback) process.exit(1);
}
