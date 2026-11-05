/**
 * SimpleGST Persistent Relational Database Module
 * Built on native Node.js 24 node:sqlite (DatabaseSync)
 * Provides ACID transactions, multi-tenant organization isolation, and multi-GSTIN scoping.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "simplegst.db");
const uploadsDir = path.join(dataDir, "uploads");

// Ensure data & upload directories exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const db = new DatabaseSync(dbPath);

// Enable Foreign Key constraints, WAL mode and busy timeout
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");

/**
 * Initialize all database tables and indexes
 */
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT CHECK(role IN ('OWNER', 'CA', 'ACCOUNTANT', 'AUDITOR')) DEFAULT 'OWNER',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      csrf_token TEXT,
      active_org_id TEXT REFERENCES organizations(id),
      active_gstin_id TEXT REFERENCES gst_registrations(id),
      active_period TEXT DEFAULT '102026',
      expires_at DATETIME NOT NULL,
      is_revoked INTEGER DEFAULT 0,
      revoked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      is_used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pan TEXT NOT NULL,
      legal_type TEXT DEFAULT 'Private Limited Company',
      registered_address TEXT,
      state TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT CHECK(role IN ('OWNER', 'CA', 'ACCOUNTANT', 'AUDITOR')) DEFAULT 'OWNER',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS gst_registrations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      gstin TEXT UNIQUE NOT NULL,
      trade_name TEXT NOT NULL,
      state_code TEXT NOT NULL,
      state_name TEXT NOT NULL,
      address TEXT,
      jurisdiction TEXT,
      is_active INTEGER DEFAULT 1,
      is_primary INTEGER DEFAULT 0,
      filing_frequency TEXT CHECK(filing_frequency IN ('MONTHLY', 'QRMP')) DEFAULT 'MONTHLY',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales_invoices (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
      period TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      invoice_date DATE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_gstin TEXT,
      pos TEXT NOT NULL,
      is_interstate INTEGER DEFAULT 0,
      supply_type TEXT CHECK(supply_type IN ('B2B', 'B2CL', 'B2CS', 'EXPORT_WPAY', 'EXPORT_WOPAY', 'SEZ_WPAY', 'SEZ_WOPAY', 'NIL_EXEMPT')) DEFAULT 'B2B',
      taxable_amount REAL NOT NULL CHECK(taxable_amount >= 0),
      gst_rate REAL NOT NULL,
      igst REAL DEFAULT 0,
      cgst REAL DEFAULT 0,
      sgst REAL DEFAULT 0,
      cess REAL DEFAULT 0,
      total_tax REAL NOT NULL,
      total_amount REAL NOT NULL,
      status TEXT CHECK(status IN ('DRAFT', 'VALIDATED', 'FILED')) DEFAULT 'VALIDATED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gstin_id, invoice_number)
    );

    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
      period TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      invoice_date DATE NOT NULL,
      supplier_name TEXT NOT NULL,
      supplier_gstin TEXT NOT NULL,
      pos TEXT NOT NULL,
      is_interstate INTEGER DEFAULT 0,
      is_rcm INTEGER DEFAULT 0,
      taxable_amount REAL NOT NULL CHECK(taxable_amount >= 0),
      gst_rate REAL NOT NULL,
      igst REAL DEFAULT 0,
      cgst REAL DEFAULT 0,
      sgst REAL DEFAULT 0,
      cess REAL DEFAULT 0,
      total_tax REAL NOT NULL,
      total_amount REAL NOT NULL,
      itc_eligibility TEXT CHECK(itc_eligibility IN ('ELIGIBLE', 'INELIGIBLE_17_5', 'INELIGIBLE_OTHER')) DEFAULT 'ELIGIBLE',
      blocked_reason TEXT,
      payment_status TEXT CHECK(payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID')) DEFAULT 'UNPAID',
      payment_date DATE,
      amount_paid REAL DEFAULT 0,
      days_aging INTEGER DEFAULT 0,
      rule37_interest REAL DEFAULT 0,
      status TEXT DEFAULT 'VALIDATED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gstin_id, invoice_number, supplier_gstin)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
      category TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      status TEXT CHECK(status IN ('UPLOADED', 'PROCESSING', 'PARSED', 'APPROVED', 'FAILED')) DEFAULT 'UPLOADED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ocr_extractions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      raw_text TEXT,
      extracted_fields_json TEXT NOT NULL,
      confidence REAL DEFAULT 0.95,
      status TEXT CHECK(status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING_REVIEW',
      approved_at DATETIME,
      approved_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS gstr2b_entries (
      id TEXT PRIMARY KEY,
      gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
      period TEXT NOT NULL,
      supplier_gstin TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      invoice_date DATE NOT NULL,
      taxable_value REAL NOT NULL,
      igst REAL DEFAULT 0,
      cgst REAL DEFAULT 0,
      sgst REAL DEFAULT 0,
      cess REAL DEFAULT 0,
      filing_date DATE,
      itc_available TEXT DEFAULT 'Y',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reconciliation_results (
      id TEXT PRIMARY KEY,
      gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
      period TEXT NOT NULL,
      purchase_invoice_id TEXT REFERENCES purchase_invoices(id),
      gstr2b_id TEXT REFERENCES gstr2b_entries(id),
      match_status TEXT CHECK(match_status IN ('MATCHED', 'MISMATCH_TAX', 'MISSING_IN_2B', 'BLOCKED_17_5')) NOT NULL,
      variance_amount REAL DEFAULT 0,
      notes TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS electronic_ledgers (
      id TEXT PRIMARY KEY,
      gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
      ledger_type TEXT CHECK(ledger_type IN ('CASH', 'CREDIT', 'LIABILITY')) NOT NULL,
      head TEXT CHECK(head IN ('IGST', 'CGST', 'SGST', 'CESS')) NOT NULL,
      sub_head TEXT CHECK(sub_head IN ('TAX', 'INTEREST', 'PENALTY', 'FEES', 'OTHER')) DEFAULT 'TAX',
      balance REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gstin_id, ledger_type, head, sub_head)
    );

    CREATE TABLE IF NOT EXISTS challans (
      id TEXT PRIMARY KEY,
      gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
      period TEXT NOT NULL,
      cpin TEXT UNIQUE NOT NULL,
      total_amount REAL NOT NULL,
      major_heads_json TEXT NOT NULL,
      payment_mode TEXT CHECK(payment_mode IN ('NET_BANKING', 'NEFT_RTGS', 'OVER_THE_COUNTER')) DEFAULT 'NET_BANKING',
      status TEXT CHECK(status IN ('GENERATED', 'PAID', 'EXPIRED')) DEFAULT 'GENERATED',
      payment_date DATETIME,
      bank_reference TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tax_returns (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
      return_type TEXT CHECK(return_type IN ('GSTR1', 'GSTR3B', 'NIL_3B')) NOT NULL,
      period TEXT NOT NULL,
      status TEXT CHECK(status IN ('DRAFT', 'PREPARED', 'FILED_SIMULATED', 'SIMULATED_NOT_TRANSMITTED', 'FILED_LIVE')) NOT NULL,
      arn TEXT,
      filing_date DATETIME,
      filing_mode TEXT DEFAULT 'EVC_OTP',
      liability_summary_json TEXT,
      itc_summary_json TEXT,
      offset_matrix_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gstin_id, return_type, period)
    );

    CREATE TABLE IF NOT EXISTS copilot_conversations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      gstin_id TEXT NOT NULL,
      user_id TEXT,
      session_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
      message TEXT NOT NULL,
      citations_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      gstin_id TEXT,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Performance and Tenant Scoping Indexes
    CREATE INDEX IF NOT EXISTS idx_sales_gstin_period ON sales_invoices(gstin_id, period);
    CREATE INDEX IF NOT EXISTS idx_purchases_gstin_period ON purchase_invoices(gstin_id, period);
    CREATE INDEX IF NOT EXISTS idx_docs_gstin ON documents(gstin_id);
    CREATE INDEX IF NOT EXISTS idx_recon_gstin_period ON reconciliation_results(gstin_id, period);
    CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id);
  `);

  // Migration for tax_returns status constraint to include SIMULATED_NOT_TRANSMITTED
  try {
    const taxReturnsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tax_returns'").get();
    if (taxReturnsSchema && !taxReturnsSchema.sql.includes("SIMULATED_NOT_TRANSMITTED")) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE tax_returns_migrated (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id),
          gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
          return_type TEXT CHECK(return_type IN ('GSTR1', 'GSTR3B', 'NIL_3B')) NOT NULL,
          period TEXT NOT NULL,
          status TEXT CHECK(status IN ('DRAFT', 'PREPARED', 'FILED_SIMULATED', 'SIMULATED_NOT_TRANSMITTED', 'FILED_LIVE')) NOT NULL,
          arn TEXT,
          filing_date DATETIME,
          filing_mode TEXT DEFAULT 'EVC_OTP',
          liability_summary_json TEXT,
          itc_summary_json TEXT,
          offset_matrix_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(gstin_id, return_type, period)
        );
        INSERT INTO tax_returns_migrated SELECT * FROM tax_returns;
        DROP TABLE tax_returns;
        ALTER TABLE tax_returns_migrated RENAME TO tax_returns;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch (err) {
    console.warn("tax_returns migration check error:", err.message);
  }

  // Session table columns migration for multi-tenant context isolation and security revocation
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN active_org_id TEXT REFERENCES organizations(id)");
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN active_gstin_id TEXT REFERENCES gst_registrations(id)");
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN active_period TEXT DEFAULT '102026'");
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN is_revoked INTEGER DEFAULT 0");
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN revoked_at DATETIME");
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN csrf_token TEXT");
  } catch {}
}

// Auto-initialize on module load
initDatabase();

// ============================================================================
// REPOSITORY METHODS
// ============================================================================

export const sessionRepo = {
  create({ id, userId, token, csrfToken, activeOrgId, activeGstinId, activePeriod = "102026", expiresAt }) {
    const sId = id || `sess-${crypto.randomUUID()}`;
    const sToken = token || crypto.randomBytes(32).toString("hex");
    const sCsrf = csrfToken || crypto.randomBytes(24).toString("hex");
    const exp = expiresAt || new Date(Date.now() + 7 * 86400000).toISOString();
    const stmt = db.prepare(`
      INSERT INTO sessions (id, user_id, token, csrf_token, active_org_id, active_gstin_id, active_period, expires_at, is_revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);
    stmt.run(sId, userId, sToken, sCsrf, activeOrgId || null, activeGstinId || null, activePeriod, exp);
    return this.findById(sId);
  },

  findById(id) {
    const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
    return stmt.get(id);
  },

  findByToken(token) {
    if (!token || typeof token !== "string") return null;
    const stmt = db.prepare("SELECT * FROM sessions WHERE token = ?");
    return stmt.get(token);
  },

  findValidSession(token) {
    if (!token || typeof token !== "string") return null;
    const stmt = db.prepare(`
      SELECT * FROM sessions 
      WHERE token = ? 
        AND (is_revoked = 0 OR is_revoked IS NULL)
        AND expires_at > CURRENT_TIMESTAMP
    `);
    const sess = stmt.get(token);
    if (!sess) return null;
    // Extra JS check in case of SQLite timestamp formatting differences
    if (new Date(sess.expires_at).getTime() <= Date.now()) {
      return null;
    }
    // Auto-populate csrf_token if missing from legacy records
    if (!sess.csrf_token) {
      const generatedCsrf = crypto.randomBytes(24).toString("hex");
      db.prepare("UPDATE sessions SET csrf_token = ? WHERE id = ?").run(generatedCsrf, sess.id);
      sess.csrf_token = generatedCsrf;
    }
    return sess;
  },

  revoke(tokenOrId) {
    if (!tokenOrId) return false;
    const stmt = db.prepare(`
      UPDATE sessions 
      SET is_revoked = 1, revoked_at = CURRENT_TIMESTAMP 
      WHERE token = ? OR id = ?
    `);
    const res = stmt.run(tokenOrId, tokenOrId);
    return res.changes > 0;
  },

  revokeUserSessions(userId) {
    if (!userId) return false;
    const stmt = db.prepare(`
      UPDATE sessions 
      SET is_revoked = 1, revoked_at = CURRENT_TIMESTAMP 
      WHERE user_id = ? AND (is_revoked = 0 OR is_revoked IS NULL)
    `);
    const res = stmt.run(userId);
    return res.changes > 0;
  },

  cleanExpired() {
    return db.prepare("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP OR is_revoked = 1").run();
  },

  updateContext(tokenOrId, { orgId, gstinId, period }) {
    const session = this.findByToken(tokenOrId) || this.findById(tokenOrId);
    if (!session) return null;
    const newOrgId = orgId !== undefined ? orgId : session.active_org_id;
    const newGstinId = gstinId !== undefined ? gstinId : session.active_gstin_id;
    const newPeriod = period !== undefined ? period : session.active_period;
    db.prepare(`
      UPDATE sessions 
      SET active_org_id = ?, active_gstin_id = ?, active_period = ?
      WHERE id = ?
    `).run(newOrgId, newGstinId, newPeriod, session.id);
    return this.findById(session.id);
  }
};

export const userRepo = {
  create({ email, passwordHash, fullName, role = "OWNER" }) {
    const id = `usr-${crypto.randomUUID()}`;
    const stmt = db.prepare("INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)");
    stmt.run(id, email.toLowerCase(), passwordHash, fullName, role);
    return this.findById(id);
  },

  findByEmail(email) {
    const stmt = db.prepare("SELECT * FROM users WHERE email = ?");
    return stmt.get(email.toLowerCase());
  },

  findById(id) {
    const stmt = db.prepare("SELECT id, email, full_name, role, created_at FROM users WHERE id = ?");
    return stmt.get(id);
  },

  hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = crypto.pbkdf2Sync(password, salt, 10000, 32, "sha256").toString("hex");
    return `pbkdf2$${salt}$10000$${derivedKey}`;
  },

  verifyPassword(storedHash, plainPassword) {
    if (!storedHash || !plainPassword || typeof storedHash !== "string" || typeof plainPassword !== "string") {
      return false;
    }
    // Strictly require properly formatted salted PBKDF2: pbkdf2$salt$iterations$derivedKey
    // Explicitly reject plaintext, simple sha256, and hardcoded dev strings
    if (!storedHash.startsWith("pbkdf2$")) {
      return false;
    }
    const parts = storedHash.split("$");
    if (parts.length !== 4) return false;
    const [, salt, iterationsStr, derivedKey] = parts;
    const iterations = parseInt(iterationsStr, 10);
    // Reject development bypass string or malformed parameters
    if (!salt || isNaN(iterations) || iterations < 1000 || !derivedKey || salt === "development_hash_apex") {
      return false;
    }
    try {
      const keyBuf = crypto.pbkdf2Sync(plainPassword, salt, iterations, 32, "sha256");
      const derivedBuf = Buffer.from(derivedKey, "hex");
      if (keyBuf.length !== derivedBuf.length) return false;
      return crypto.timingSafeEqual(keyBuf, derivedBuf);
    } catch {
      return false;
    }
  },

  isLegacyPassword(storedHash) {
    if (!storedHash || typeof storedHash !== "string") return true;
    if (!storedHash.startsWith("pbkdf2$")) return true;
    const parts = storedHash.split("$");
    if (parts.length !== 4) return true;
    const [, salt, iterationsStr, derivedKey] = parts;
    const iterations = parseInt(iterationsStr, 10);
    if (!salt || isNaN(iterations) || iterations < 1000 || !derivedKey || salt === "development_hash_apex") {
      return true;
    }
    return false;
  },

  updatePassword(userId, newPasswordHash) {
    const stmt = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
    const res = stmt.run(newPasswordHash, userId);
    return res.changes > 0;
  }
};

export const passwordResetRepo = {
  create(userId) {
    const id = `rst-${crypto.randomUUID()}`;
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins
    db.prepare("INSERT INTO password_resets (id, user_id, token, expires_at, is_used) VALUES (?, ?, ?, ?, 0)")
      .run(id, userId, token, expiresAt);
    return { id, token, expiresAt };
  },

  findValidToken(token) {
    if (!token || typeof token !== "string") return null;
    const stmt = db.prepare(`
      SELECT * FROM password_resets 
      WHERE token = ? AND is_used = 0 AND expires_at > CURRENT_TIMESTAMP
    `);
    const res = stmt.get(token);
    if (!res) return null;
    if (new Date(res.expires_at).getTime() <= Date.now()) return null;
    return res;
  },

  markUsed(token) {
    return db.prepare("UPDATE password_resets SET is_used = 1 WHERE token = ?").run(token);
  }
};

export const orgRepo = {
  create({ name, pan, legalType = "Private Limited Company", registeredAddress = "", state = "" }) {
    const id = `org-${crypto.randomUUID()}`;
    const stmt = db.prepare("INSERT INTO organizations (id, name, pan, legal_type, registered_address, state) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(id, name, pan.toUpperCase(), legalType, registeredAddress, state);
    return stmt.get ? this.findById(id) : null;
  },

  findById(id) {
    const stmt = db.prepare("SELECT * FROM organizations WHERE id = ?");
    return stmt.get(id);
  },

  addMember(orgId, userId, role = "OWNER") {
    const id = `mem-${crypto.randomUUID()}`;
    const stmt = db.prepare("INSERT OR REPLACE INTO org_members (id, org_id, user_id, role) VALUES (?, ?, ?, ?)");
    stmt.run(id, orgId, userId, role);
  },

  getMembership(orgId, userId) {
    return db.prepare("SELECT * FROM org_members WHERE org_id = ? AND user_id = ?").get(orgId, userId);
  },

  getUserOrgs(userId) {
    const stmt = db.prepare(`
      SELECT o.*, m.role as user_role 
      FROM organizations o 
      JOIN org_members m ON o.id = m.org_id 
      WHERE m.user_id = ?
    `);
    return stmt.all(userId);
  }
};

export const gstinRepo = {
  create({ orgId, gstin, tradeName, stateCode, stateName, address = "", jurisdiction = "", isPrimary = 0, filingFrequency = "MONTHLY" }) {
    const id = `gstin-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO gst_registrations 
      (id, org_id, gstin, trade_name, state_code, state_name, address, jurisdiction, is_active, is_primary, filing_frequency) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    stmt.run(id, orgId, gstin.toUpperCase(), tradeName, stateCode, stateName, address, jurisdiction, isPrimary ? 1 : 0, filingFrequency);
    return this.findById(id);
  },

  findById(id) {
    const stmt = db.prepare("SELECT * FROM gst_registrations WHERE id = ?");
    return stmt.get(id);
  },

  findByGstin(gstin) {
    const stmt = db.prepare("SELECT * FROM gst_registrations WHERE gstin = ?");
    return stmt.get(gstin.toUpperCase());
  },

  listByOrg(orgId) {
    const stmt = db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? ORDER BY is_primary DESC, created_at ASC");
    return stmt.all(orgId);
  },

  setPrimary(orgId, gstinId) {
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.prepare("UPDATE gst_registrations SET is_primary = 0 WHERE org_id = ?").run(orgId);
      db.prepare("UPDATE gst_registrations SET is_primary = 1 WHERE id = ? AND org_id = ?").run(gstinId, orgId);
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  },

  updateStatus(id, isActive) {
    const stmt = db.prepare("UPDATE gst_registrations SET is_active = ? WHERE id = ?");
    stmt.run(isActive ? 1 : 0, id);
    return this.findById(id);
  }
};

export const salesRepo = {
  create(data) {
    const id = data.id || `inv-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO sales_invoices (
        id, org_id, gstin_id, period, invoice_number, invoice_date, customer_name,
        customer_gstin, pos, is_interstate, supply_type, taxable_amount, gst_rate,
        igst, cgst, sgst, cess, total_tax, total_amount, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, data.orgId, data.gstinId, data.period, data.invoiceNumber, data.invoiceDate,
      data.customerName, data.customerGstin || null, data.pos, data.isInterstate ? 1 : 0,
      data.supplyType || "B2B", data.taxableAmount, data.gstRate, data.igst || 0,
      data.cgst || 0, data.sgst || 0, data.cess || 0, data.totalTax, data.totalAmount,
      data.status || "VALIDATED"
    );
    return this.findById(id);
  },

  findById(id) {
    const stmt = db.prepare("SELECT * FROM sales_invoices WHERE id = ?");
    return stmt.get(id);
  },

  list(gstinId, period) {
    let sql = "SELECT * FROM sales_invoices WHERE gstin_id = ?";
    const params = [gstinId];
    if (period) {
      sql += " AND period = ?";
      params.push(period);
    }
    sql += " ORDER BY invoice_date DESC";
    return db.prepare(sql).all(...params);
  },

  delete(id) {
    const stmt = db.prepare("DELETE FROM sales_invoices WHERE id = ?");
    stmt.run(id);
  }
};

export const purchaseRepo = {
  create(data) {
    const id = data.id || `pur-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO purchase_invoices (
        id, org_id, gstin_id, period, invoice_number, invoice_date, supplier_name,
        supplier_gstin, pos, is_interstate, is_rcm, taxable_amount, gst_rate,
        igst, cgst, sgst, cess, total_tax, total_amount, itc_eligibility, blocked_reason,
        payment_status, payment_date, amount_paid, days_aging, rule37_interest, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, data.orgId, data.gstinId, data.period, data.invoiceNumber, data.invoiceDate,
      data.supplierName, data.supplierGstin, data.pos, data.isInterstate ? 1 : 0,
      data.isRcm ? 1 : 0, data.taxableAmount, data.gstRate, data.igst || 0,
      data.cgst || 0, data.sgst || 0, data.cess || 0, data.totalTax, data.totalAmount,
      data.itcEligibility || "ELIGIBLE", data.blockedReason || null,
      data.paymentStatus || "UNPAID", data.paymentDate || null, data.amountPaid || 0,
      data.daysAging || 0, data.rule37Interest || 0, data.status || "VALIDATED"
    );
    return this.findById(id);
  },

  findById(id) {
    const stmt = db.prepare("SELECT * FROM purchase_invoices WHERE id = ?");
    return stmt.get(id);
  },

  list(gstinId, period) {
    let sql = "SELECT * FROM purchase_invoices WHERE gstin_id = ?";
    const params = [gstinId];
    if (period) {
      sql += " AND period = ?";
      params.push(period);
    }
    sql += " ORDER BY invoice_date DESC";
    return db.prepare(sql).all(...params);
  },

  updatePayment(id, { paymentStatus, paymentDate, amountPaid, daysAging, rule37Interest }) {
    const stmt = db.prepare(`
      UPDATE purchase_invoices 
      SET payment_status = ?, payment_date = ?, amount_paid = ?, days_aging = ?, rule37_interest = ?
      WHERE id = ?
    `);
    stmt.run(paymentStatus, paymentDate, amountPaid, daysAging, rule37Interest, id);
    return this.findById(id);
  },

  delete(id) {
    const stmt = db.prepare("DELETE FROM purchase_invoices WHERE id = ?");
    stmt.run(id);
  }
};

export const documentRepo = {
  create({ orgId, gstinId, category, originalFilename, storedFilename, fileType, fileSizeBytes, storagePath }) {
    const id = `doc-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO documents 
      (id, org_id, gstin_id, category, original_filename, stored_filename, file_type, file_size_bytes, storage_path, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED')
    `);
    stmt.run(id, orgId, gstinId, category, originalFilename, storedFilename, fileType, fileSizeBytes, storagePath);
    return this.findById(id);
  },

  findById(id) {
    const stmt = db.prepare("SELECT * FROM documents WHERE id = ?");
    return stmt.get(id);
  },

  listByGstin(gstinId, category) {
    let sql = "SELECT * FROM documents WHERE gstin_id = ?";
    const params = [gstinId];
    if (category && category !== "all") {
      sql += " AND category = ?";
      params.push(category);
    }
    sql += " ORDER BY created_at DESC";
    return db.prepare(sql).all(...params);
  },

  updateStatus(id, status) {
    const stmt = db.prepare("UPDATE documents SET status = ? WHERE id = ?");
    stmt.run(status, id);
    return this.findById(id);
  },

  delete(id) {
    const doc = this.findById(id);
    if (doc) {
      if (fs.existsSync(doc.storage_path)) {
        try { fs.unlinkSync(doc.storage_path); } catch (e) {}
      }
      db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    }
  }
};

export const ocrRepo = {
  saveExtraction({ documentId, rawText = "", extractedFields, confidence = 0.95 }) {
    const id = `ocr-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO ocr_extractions (id, document_id, raw_text, extracted_fields_json, confidence, status)
      VALUES (?, ?, ?, ?, ?, 'PENDING_REVIEW')
    `);
    stmt.run(id, documentId, rawText, JSON.stringify(extractedFields), confidence);
    return this.findById(id);
  },

  findById(id) {
    const stmt = db.prepare("SELECT * FROM ocr_extractions WHERE id = ?");
    return stmt.get(id);
  },

  findByDocumentId(documentId) {
    const stmt = db.prepare("SELECT * FROM ocr_extractions WHERE document_id = ? ORDER BY id DESC LIMIT 1");
    return stmt.get(documentId);
  },

  approve(id, userId) {
    const stmt = db.prepare(`
      UPDATE ocr_extractions 
      SET status = 'APPROVED', approved_at = CURRENT_TIMESTAMP, approved_by = ?
      WHERE id = ?
    `);
    stmt.run(userId, id);
    return this.findById(id);
  }
};

export const gstr2bRepo = {
  create(data) {
    const id = data.id || `g2b-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO gstr2b_entries (
        id, gstin_id, period, supplier_gstin, supplier_name, invoice_number,
        invoice_date, taxable_amount, igst, cgst, sgst, cess, total_tax,
        filing_date, gstr1_filing_status, itc_availability, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, data.gstinId, data.period, data.supplierGstin, data.supplierName,
      data.invoiceNumber, data.invoiceDate, data.taxableAmount, data.igst || 0,
      data.cgst || 0, data.sgst || 0, data.cess || 0, data.totalTax,
      data.filingDate || new Date().toISOString().split("T")[0],
      data.gstr1FilingStatus || "FILED", data.itcAvailability || "Y",
      data.status || "MATCHED"
    );
    return this.findById(id);
  },

  findById(id) {
    return db.prepare("SELECT * FROM gstr2b_entries WHERE id = ?").get(id);
  },

  list(gstinId, period) {
    let sql = "SELECT * FROM gstr2b_entries WHERE gstin_id = ?";
    const params = [gstinId];
    if (period) {
      sql += " AND period = ?";
      params.push(period);
    }
    sql += " ORDER BY invoice_date DESC";
    return db.prepare(sql).all(...params);
  }
};

export const ledgerRepo = {
  getBalance(gstinId, ledgerType) {
    const stmt = db.prepare(`
      SELECT head, sub_head, balance 
      FROM electronic_ledgers 
      WHERE gstin_id = ? AND ledger_type = ?
    `);
    return stmt.all(gstinId, ledgerType);
  },

  getTotals(gstinId) {
    const stmt = db.prepare(`
      SELECT ledger_type, SUM(balance) as total 
      FROM electronic_ledgers 
      WHERE gstin_id = ? 
      GROUP BY ledger_type
    `);
    const rows = stmt.all(gstinId);
    const totals = { CASH: 0, CREDIT: 0, LIABILITY: 0 };
    rows.forEach(r => { totals[r.ledger_type] = r.total; });
    return totals;
  },

  creditCashLedger(gstinId, head, subHead, amount) {
    const stmt = db.prepare(`
      INSERT INTO electronic_ledgers (id, gstin_id, ledger_type, head, sub_head, balance)
      VALUES (?, ?, 'CASH', ?, ?, ?)
      ON CONFLICT(gstin_id, ledger_type, head, sub_head) 
      DO UPDATE SET balance = balance + excluded.balance, updated_at = CURRENT_TIMESTAMP
    `);
    const id = `led-${crypto.randomUUID()}`;
    stmt.run(id, gstinId, head, subHead, amount);
  }
};

export const challanRepo = {
  create({ gstinId, period, cpin, totalAmount, majorHeads, paymentMode = "NET_BANKING" }) {
    const id = `ch-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO challans (id, gstin_id, period, cpin, total_amount, major_heads_json, payment_mode, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'GENERATED')
    `);
    stmt.run(id, gstinId, period, cpin, totalAmount, JSON.stringify(majorHeads), paymentMode);
    return this.findById(id);
  },

  findById(id) {
    const stmt = db.prepare("SELECT * FROM challans WHERE id = ?");
    return stmt.get(id);
  },

  markPaid(id, bankRef) {
    const stmt = db.prepare(`
      UPDATE challans 
      SET status = 'PAID', payment_date = CURRENT_TIMESTAMP, bank_reference = ?
      WHERE id = ?
    `);
    stmt.run(bankRef, id);
    return this.findById(id);
  },

  listByGstin(gstinId) {
    const stmt = db.prepare("SELECT * FROM challans WHERE gstin_id = ? ORDER BY created_at DESC");
    return stmt.all(gstinId);
  }
};

export const returnRepo = {
  saveDraft({ orgId, gstinId, returnType, period, status, liabilitySummary, itcSummary, offsetMatrix, arn = null }) {
    const id = `ret-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO tax_returns (
        id, org_id, gstin_id, return_type, period, status, arn, filing_date,
        liability_summary_json, itc_summary_json, offset_matrix_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gstin_id, return_type, period) DO UPDATE SET
        status = excluded.status,
        arn = excluded.arn,
        filing_date = excluded.filing_date,
        liability_summary_json = excluded.liability_summary_json,
        itc_summary_json = excluded.itc_summary_json,
        offset_matrix_json = excluded.offset_matrix_json
    `);
    const filingDate = (arn || status === 'SIMULATED_NOT_TRANSMITTED' || status === 'FILED_SIMULATED') ? new Date().toISOString() : null;
    stmt.run(
      id, orgId, gstinId, returnType, period, status, arn, filingDate,
      JSON.stringify(liabilitySummary || {}), JSON.stringify(itcSummary || {}), JSON.stringify(offsetMatrix || {})
    );
    return this.get(gstinId, returnType, period);
  },

  get(gstinId, returnType, period) {
    const stmt = db.prepare("SELECT * FROM tax_returns WHERE gstin_id = ? AND return_type = ? AND period = ?");
    return stmt.get(gstinId, returnType, period);
  },

  listByGstin(gstinId) {
    const stmt = db.prepare("SELECT * FROM tax_returns WHERE gstin_id = ? ORDER BY period DESC");
    return stmt.all(gstinId);
  }
};

export const auditRepo = {
  log({ orgId, gstinId = null, userId = null, action, entityType, entityId, details = {} }) {
    const id = `aud-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, org_id, gstin_id, user_id, action, entity_type, entity_id, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, orgId, gstinId, userId, action, entityType, entityId, JSON.stringify(details));
  },

  list(orgId) {
    const stmt = db.prepare("SELECT * FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 100");
    return stmt.all(orgId);
  }
};

/**
 * Development-Only Seed Command
 * Populates clean, clearly-tagged test records for local testing and development.
 */
export function seedDevelopmentData() {
  console.log("[Seed] Checking if development database requires seeding...");
  const existingOrg = db.prepare("SELECT COUNT(*) as cnt FROM organizations").get();
  if (existingOrg && existingOrg.cnt > 0) {
    console.log("[Seed] Database already contains records. Skipping seed.");
    return;
  }

  console.log("[Seed] Creating development seed organization and multi-GSTIN branches...");
  db.exec("BEGIN IMMEDIATE;");
  try {
    // 1. Create Default User
    const user = userRepo.create({
      email: "rajesh.sharma@apexretail.com",
      passwordHash: userRepo.hashPassword("ApexAdmin@2026"),
      fullName: "Rajesh Sharma",
      role: "OWNER"
    });

    // 2. Create Default Organization
    const org = orgRepo.create({
      name: "Apex Retailers Pvt Ltd",
      pan: "AAACA1234A",
      legalType: "Private Limited Company",
      registeredAddress: "402 Nariman Point, Mumbai, Maharashtra 400021",
      state: "Maharashtra"
    });
    orgRepo.addMember(org.id, user.id, "OWNER");

    // 3. Create Multi-GSTIN State Branches
    const mhBranch = gstinRepo.create({
      orgId: org.id,
      gstin: "27AAACA1234A1Z5",
      tradeName: "Apex Retailers - Mumbai Main",
      stateCode: "27",
      stateName: "Maharashtra",
      address: "402 Nariman Point, Mumbai 400021",
      jurisdiction: "Ward 4, Mumbai Central",
      isPrimary: 1,
      filingFrequency: "MONTHLY"
    });

    const kaBranch = gstinRepo.create({
      orgId: org.id,
      gstin: "29AAACB1234F1Z5",
      tradeName: "Apex Retailers - Bangalore Tech Hub",
      stateCode: "29",
      stateName: "Karnataka",
      address: "12 Koramangala 5th Block, Bangalore 560034",
      jurisdiction: "Range 2, South Bangalore",
      isPrimary: 0,
      filingFrequency: "MONTHLY"
    });

    const klBranch = gstinRepo.create({
      orgId: org.id,
      gstin: "32ABCDE1234F1Z5",
      tradeName: "Apex Retailers - Cochin Spices & Exports",
      stateCode: "32",
      stateName: "Kerala",
      address: "Building 4, Spices Market Yard, Mattancherry, Kochi 682002",
      jurisdiction: "Ernakulam Circle 1",
      isPrimary: 0,
      filingFrequency: "MONTHLY"
    });

    // 4. Seed Real Sales Invoices for October 2026 (Maharashtra)
    salesRepo.create({
      orgId: org.id,
      gstinId: mhBranch.id,
      period: "102026",
      invoiceNumber: "APX-MH-2026-001",
      invoiceDate: "2026-10-05",
      customerName: "Reliance Retail Ltd",
      customerGstin: "27AAACR7055K1ZX",
      pos: "27",
      isInterstate: false,
      supplyType: "B2B",
      taxableAmount: 450000,
      gstRate: 18,
      cgst: 40500,
      sgst: 40500,
      igst: 0,
      totalTax: 81000,
      totalAmount: 531000,
      status: "VALIDATED"
    });

    salesRepo.create({
      orgId: org.id,
      gstinId: mhBranch.id,
      period: "102026",
      invoiceNumber: "APX-MH-2026-002",
      invoiceDate: "2026-10-14",
      customerName: "D-Mart Hypermarkets",
      customerGstin: "27AABCA3322E1Z8",
      pos: "27",
      isInterstate: false,
      supplyType: "B2B",
      taxableAmount: 392500,
      gstRate: 18,
      cgst: 35325,
      sgst: 35325,
      igst: 0,
      totalTax: 70650,
      totalAmount: 463150,
      status: "VALIDATED"
    });

    // 5. Seed Real Purchases for October 2026 (Maharashtra)
    purchaseRepo.create({
      orgId: org.id,
      gstinId: mhBranch.id,
      period: "102026",
      invoiceNumber: "SUPP-MH-8812",
      invoiceDate: "2026-10-08",
      supplierName: "Mahindra Logistics Ltd",
      supplierGstin: "27AAACM1234B1Z2",
      pos: "27",
      isInterstate: false,
      isRcm: false,
      taxableAmount: 220000,
      gstRate: 18,
      cgst: 19800,
      sgst: 19800,
      igst: 0,
      totalTax: 39600,
      totalAmount: 259600,
      itcEligibility: "ELIGIBLE",
      paymentStatus: "FULLY_PAID",
      paymentDate: "2026-10-20",
      amountPaid: 259600,
      daysAging: 12
    });

    purchaseRepo.create({
      orgId: org.id,
      gstinId: mhBranch.id,
      period: "102026",
      invoiceNumber: "SUPP-DL-4019",
      invoiceDate: "2026-10-18",
      supplierName: "Delhi Paper & Packaging Solutions",
      supplierGstin: "07AAACD5544E1Z0",
      pos: "27",
      isInterstate: true,
      isRcm: false,
      taxableAmount: 192300,
      gstRate: 18,
      cgst: 0,
      sgst: 0,
      igst: 34614,
      totalTax: 34614,
      totalAmount: 226914,
      itcEligibility: "ELIGIBLE",
      paymentStatus: "UNPAID",
      amountPaid: 0,
      daysAging: 17
    });

    // 6. Seed GSTR-2B Auto-Drafted Entries for 2B Reconciliation
    const insert2B = db.prepare(`
      INSERT INTO gstr2b_entries 
      (id, gstin_id, period, supplier_gstin, supplier_name, invoice_number, invoice_date, taxable_value, igst, cgst, sgst, cess, filing_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    insert2B.run(`g2b-${crypto.randomUUID()}`, mhBranch.id, "102026", "27AAACM1234B1Z2", "Mahindra Logistics Ltd", "SUPP-MH-8812", "2026-10-08", 220000, 0, 19800, 19800, "2026-11-11");
    insert2B.run(`g2b-${crypto.randomUUID()}`, mhBranch.id, "102026", "07AAACD5544E1Z0", "Delhi Paper & Packaging Solutions", "SUPP-DL-4019", "2026-10-18", 192300, 34614, 0, 0, "2026-11-12");

    // 7. Seed Initial Ledgers
    ledgerRepo.creditCashLedger(mhBranch.id, "CGST", "TAX", 7500);
    ledgerRepo.creditCashLedger(mhBranch.id, "SGST", "TAX", 7500);

    auditRepo.log({
      orgId: org.id,
      gstinId: mhBranch.id,
      userId: user.id,
      action: "DEV_DATABASE_SEEDED",
      entityType: "ORGANIZATION",
      entityId: org.id,
      details: { environment: "development", source: "seedDevelopmentData" }
    });

    db.exec("COMMIT;");
    console.log("[Seed] Development database initialized with Apex Retailers Pvt Ltd (3 state branches).");
  } catch (err) {
    db.exec("ROLLBACK;");
    console.error("[Seed] Error seeding development database:", err);
  }
}
