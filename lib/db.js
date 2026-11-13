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
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || "simplegst_onboarding_sensitive_vault_key_2026";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(ENCRYPTION_SECRET).digest();

export function encryptSensitive(text) {
  if (!text || typeof text !== "string") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptSensitive(encryptedText) {
  if (!encryptedText || typeof encryptedText !== "string" || !encryptedText.includes(":")) return null;
  try {
    const [ivHex, authTagHex, encHex] = encryptedText.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

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

    CREATE TABLE IF NOT EXISTS user_onboarding (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      current_step INTEGER DEFAULT 1,
      status TEXT CHECK(status IN ('IN_PROGRESS', 'COMPLETED')) DEFAULT 'IN_PROGRESS',
      pan TEXT,
      gstin TEXT,
      aadhaar_encrypted TEXT,
      aadhaar_last4 TEXT,
      bank_holder_name TEXT,
      bank_account_encrypted TEXT,
      bank_account_last4 TEXT,
      bank_ifsc TEXT,
      bank_name TEXT,
      bank_branch TEXT,
      business_legal_name TEXT,
      business_trade_name TEXT,
      business_type TEXT,
      business_category TEXT,
      business_email TEXT,
      business_mobile TEXT,
      business_address TEXT,
      business_state TEXT,
      business_city TEXT,
      business_pincode TEXT,
      business_activity TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      match_status TEXT CHECK(match_status IN ('MATCHED', 'EXACT_MATCH', 'PARTIAL_MATCH', 'MISMATCH_TAX', 'MISSING_IN_2B', 'MISSING_IN_BOOKS', 'DUPLICATE', 'BLOCKED_17_5', 'INELIGIBLE_17_5')) NOT NULL,
      variance_amount REAL DEFAULT 0,
      supplier_name TEXT,
      supplier_gstin TEXT,
      invoice_number TEXT,
      invoice_date DATE,
      books_taxable REAL DEFAULT 0,
      books_tax REAL DEFAULT 0,
      books_igst REAL DEFAULT 0,
      books_cgst REAL DEFAULT 0,
      books_sgst REAL DEFAULT 0,
      gstr2b_taxable REAL DEFAULT 0,
      gstr2b_tax REAL DEFAULT 0,
      gstr2b_igst REAL DEFAULT 0,
      gstr2b_cgst REAL DEFAULT 0,
      gstr2b_sgst REAL DEFAULT 0,
      action TEXT DEFAULT 'PENDING',
      investigation_notes TEXT,
      field_diffs_json TEXT,
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

    CREATE TABLE IF NOT EXISTS startup_profiles (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_structure TEXT CHECK(business_structure IN ('PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'OTHER')),
      proposed_business_name TEXT,
      business_activity TEXT,
      business_description TEXT,
      business_state TEXT,
      business_pincode TEXT,
      business_address TEXT,
      founder_pan TEXT,
      entity_pan TEXT,
      founder_name TEXT,
      identity_doc_status TEXT DEFAULT 'PENDING',
      registration_reference_number TEXT,
      registration_status TEXT DEFAULT 'NOT_STARTED',
      gst_eligibility_type TEXT DEFAULT 'TURNOVER_THRESHOLD',
      gst_arn TEXT,
      gstin TEXT,
      gst_status TEXT DEFAULT 'NOT_APPLIED',
      bank_holder_name TEXT,
      bank_name TEXT,
      bank_ifsc TEXT,
      bank_account_last4 TEXT,
      accounting_scheme TEXT DEFAULT 'REGULAR',
      opening_balance REAL DEFAULT 0,
      invoice_prefix TEXT DEFAULT 'INV/',
      invoice_starting_number INTEGER DEFAULT 1,
      default_hsn TEXT DEFAULT '9983',
      default_gst_rate REAL DEFAULT 18,
      current_stage INTEGER DEFAULT 1,
      completed_stages_json TEXT DEFAULT '[]',
      overall_progress INTEGER DEFAULT 0,
      stage_data_json TEXT DEFAULT '{}',
      checklist_json TEXT DEFAULT '{}',
      business_subtype TEXT,
      documents_json TEXT DEFAULT '[]',
      activation_status TEXT DEFAULT 'NOT_ACTIVATED',
      gst_exemption_reason TEXT,
      business_category TEXT,
      district TEXT,
      nature_of_operations TEXT,
      commencement_date TEXT,
      partner_details_json TEXT DEFAULT '[]',
      cin TEXT,
      din_details_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id)
    );

    -- Performance and Tenant Scoping Indexes
    CREATE INDEX IF NOT EXISTS idx_sales_gstin_period ON sales_invoices(gstin_id, period);
    CREATE INDEX IF NOT EXISTS idx_purchases_gstin_period ON purchase_invoices(gstin_id, period);
    CREATE INDEX IF NOT EXISTS idx_docs_gstin ON documents(gstin_id);
    CREATE INDEX IF NOT EXISTS idx_recon_gstin_period ON reconciliation_results(gstin_id, period);
    CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id);
    CREATE INDEX IF NOT EXISTS idx_startup_org ON startup_profiles(org_id);
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

  // Migration for reconciliation_results schema update
  try {
    const reconSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'reconciliation_results'").get();
    if (reconSchema && (!reconSchema.sql.includes("EXACT_MATCH") || !reconSchema.sql.includes("books_taxable"))) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE IF NOT EXISTS reconciliation_results_migrated (
          id TEXT PRIMARY KEY,
          gstin_id TEXT NOT NULL REFERENCES gst_registrations(id),
          period TEXT NOT NULL,
          purchase_invoice_id TEXT REFERENCES purchase_invoices(id),
          gstr2b_id TEXT REFERENCES gstr2b_entries(id),
          match_status TEXT CHECK(match_status IN ('MATCHED', 'EXACT_MATCH', 'PARTIAL_MATCH', 'MISMATCH_TAX', 'MISSING_IN_2B', 'MISSING_IN_BOOKS', 'DUPLICATE', 'BLOCKED_17_5', 'INELIGIBLE_17_5')) NOT NULL,
          variance_amount REAL DEFAULT 0,
          supplier_name TEXT,
          supplier_gstin TEXT,
          invoice_number TEXT,
          invoice_date DATE,
          books_taxable REAL DEFAULT 0,
          books_tax REAL DEFAULT 0,
          books_igst REAL DEFAULT 0,
          books_cgst REAL DEFAULT 0,
          books_sgst REAL DEFAULT 0,
          gstr2b_taxable REAL DEFAULT 0,
          gstr2b_tax REAL DEFAULT 0,
          gstr2b_igst REAL DEFAULT 0,
          gstr2b_cgst REAL DEFAULT 0,
          gstr2b_sgst REAL DEFAULT 0,
          action TEXT DEFAULT 'PENDING',
          investigation_notes TEXT,
          field_diffs_json TEXT,
          notes TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        DROP TABLE IF EXISTS reconciliation_results;
        ALTER TABLE reconciliation_results_migrated RENAME TO reconciliation_results;
        CREATE INDEX IF NOT EXISTS idx_recon_gstin_period ON reconciliation_results(gstin_id, period);
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch (err) {
    console.warn("reconciliation_results migration error:", err.message);
  }

  // GSTR-2B table migrations
  try { db.exec("ALTER TABLE gstr2b_entries ADD COLUMN total_tax REAL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE gstr2b_entries ADD COLUMN taxable_amount REAL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE gstr2b_entries ADD COLUMN gstr1_filing_status TEXT DEFAULT 'FILED'"); } catch {}
  try { db.exec("ALTER TABLE gstr2b_entries ADD COLUMN source_filename TEXT"); } catch {}

  // Onboarding migrations for users
  try {
    db.exec("ALTER TABLE users ADD COLUMN mobile_number TEXT");
  } catch {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN onboarding_status TEXT DEFAULT 'COMPLETED'");
  } catch {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN onboarding_step INTEGER DEFAULT 4");
  } catch {}

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

  // Bills & Docs relational migrations: link invoices directly to uploaded documents
  try {
    db.exec("ALTER TABLE sales_invoices ADD COLUMN document_id TEXT REFERENCES documents(id)");
  } catch {}
  try {
    db.exec("ALTER TABLE purchase_invoices ADD COLUMN document_id TEXT REFERENCES documents(id)");
  } catch {}
  try {
    db.exec("ALTER TABLE documents ADD COLUMN rejection_reason TEXT");
  } catch {}
  try {
    db.exec("ALTER TABLE ocr_extractions ADD COLUMN rejection_reason TEXT");
  } catch {}
  try {
    db.exec("ALTER TABLE sales_invoices ADD COLUMN line_items_json TEXT");
  } catch {}
  try {
    db.exec("ALTER TABLE purchase_invoices ADD COLUMN line_items_json TEXT");
  } catch {}

  // Startup Express relational migrations
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN business_subtype TEXT"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN documents_json TEXT DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN activation_status TEXT DEFAULT 'NOT_ACTIVATED'"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN gst_exemption_reason TEXT"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN business_category TEXT"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN district TEXT"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN nature_of_operations TEXT"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN commencement_date TEXT"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN partner_details_json TEXT DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN cin TEXT"); } catch {}
  try { db.exec("ALTER TABLE startup_profiles ADD COLUMN din_details_json TEXT DEFAULT '[]'"); } catch {}
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
  create({ email, passwordHash, fullName, mobileNumber = null, role = "OWNER", onboardingStatus = "IN_PROGRESS", onboardingStep = 1 }) {
    const id = `usr-${crypto.randomUUID()}`;
    const stmt = db.prepare("INSERT INTO users (id, email, password_hash, full_name, mobile_number, role, onboarding_status, onboarding_step) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(id, email.toLowerCase(), passwordHash, fullName, mobileNumber, role, onboardingStatus, onboardingStep);
    return this.findById(id);
  },

  findByEmail(email) {
    const stmt = db.prepare("SELECT * FROM users WHERE email = ?");
    return stmt.get(email.toLowerCase());
  },

  findById(id) {
    const stmt = db.prepare("SELECT id, email, full_name, mobile_number, role, onboarding_status, onboarding_step, created_at FROM users WHERE id = ?");
    return stmt.get(id);
  },

  updateOnboarding(userId, { status = null, step = null } = {}) {
    db.prepare("UPDATE users SET onboarding_status = COALESCE(?, onboarding_status), onboarding_step = COALESCE(?, onboarding_step) WHERE id = ?").run(status ?? null, step ?? null, userId);
    return this.findById(userId);
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

export const onboardingRepo = {
  findByUserId(userId) {
    const stmt = db.prepare("SELECT * FROM user_onboarding WHERE user_id = ?");
    return stmt.get(userId);
  },

  createOrUpdateStep1(userId) {
    const existing = this.findByUserId(userId);
    if (!existing) {
      const id = `onb-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO user_onboarding (id, user_id, current_step, status)
        VALUES (?, ?, 2, 'IN_PROGRESS')
      `).run(id, userId);
    } else {
      db.prepare(`
        UPDATE user_onboarding
        SET current_step = MAX(current_step, 2), updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(userId);
    }
    userRepo.updateOnboarding(userId, { step: 2 });
    return this.findByUserId(userId);
  },

  saveStep2(userId, { pan, gstin, aadhaar }) {
    let aadhaarEncrypted = null;
    let aadhaarLast4 = null;
    if (aadhaar && aadhaar.trim()) {
      const cleanAadhaar = aadhaar.replace(/[\s-]+/g, "");
      aadhaarEncrypted = encryptSensitive(cleanAadhaar);
      aadhaarLast4 = cleanAadhaar.slice(-4);
    }
    const existing = this.findByUserId(userId);
    if (!existing) {
      const id = `onb-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO user_onboarding (id, user_id, current_step, status, pan, gstin, aadhaar_encrypted, aadhaar_last4)
        VALUES (?, ?, 3, 'IN_PROGRESS', ?, ?, ?, ?)
      `).run(id, userId, pan.toUpperCase(), gstin.toUpperCase(), aadhaarEncrypted, aadhaarLast4);
    } else {
      db.prepare(`
        UPDATE user_onboarding
        SET pan = ?, gstin = ?, aadhaar_encrypted = COALESCE(?, aadhaar_encrypted), aadhaar_last4 = COALESCE(?, aadhaar_last4),
            current_step = MAX(current_step, 3), updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(pan.toUpperCase(), gstin.toUpperCase(), aadhaarEncrypted, aadhaarLast4, userId);
    }
    userRepo.updateOnboarding(userId, { step: 3 });
    return this.findByUserId(userId);
  },

  saveStep3(userId, { accountHolderName, accountNumber, ifsc, bankName, branchName }) {
    let bankAccountEncrypted = null;
    let bankAccountLast4 = null;
    if (accountNumber && accountNumber.trim()) {
      const cleanAcc = accountNumber.replace(/[\s-]+/g, "");
      bankAccountEncrypted = encryptSensitive(cleanAcc);
      bankAccountLast4 = cleanAcc.slice(-4);
    }
    db.prepare(`
      UPDATE user_onboarding
      SET bank_holder_name = ?, bank_account_encrypted = ?, bank_account_last4 = ?, bank_ifsc = ?, bank_name = ?, bank_branch = ?,
          current_step = MAX(current_step, 4), updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(accountHolderName, bankAccountEncrypted, bankAccountLast4, ifsc.toUpperCase(), bankName, branchName, userId);
    userRepo.updateOnboarding(userId, { step: 4 });
    return this.findByUserId(userId);
  },

  saveStep4(userId, data) {
    db.prepare(`
      UPDATE user_onboarding
      SET business_legal_name = ?, business_trade_name = ?, business_type = ?, business_category = ?,
          business_email = ?, business_mobile = ?, business_address = ?, business_state = ?, business_city = ?,
          business_pincode = ?, business_activity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(
      data.legalName ?? null, data.tradeName ?? null, data.businessType ?? null, data.businessCategory ?? null,
      data.businessEmail ?? null, data.businessMobile ?? null, data.businessAddress ?? null, data.state ?? null, data.city ?? null,
      data.pincode ?? null, data.businessActivity ?? null, userId
    );
    return this.findByUserId(userId);
  },

  completeOnboarding(userId) {
    db.prepare(`
      UPDATE user_onboarding
      SET status = 'COMPLETED', current_step = 4, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(userId);
    userRepo.updateOnboarding(userId, { status: "COMPLETED", step: 4 });
    return this.findByUserId(userId);
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
    return this.findById(id);
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
  },

  findByUserId(userId) {
    const orgs = this.getUserOrgs(userId);
    return orgs.length > 0 ? orgs[0] : null;
  },

  findByPan(pan) {
    if (!pan) return null;
    return db.prepare("SELECT * FROM organizations WHERE pan = ?").get(pan.toUpperCase());
  },

  list() {
    return db.prepare("SELECT * FROM organizations ORDER BY created_at ASC").all();
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
    let validDocId = null;
    const candidateDocId = data.documentId || data.document_id;
    if (candidateDocId) {
      const exists = db.prepare("SELECT id FROM documents WHERE id = ?").get(candidateDocId);
      if (exists) validDocId = exists.id;
    }

    const stmt = db.prepare(`
      INSERT INTO sales_invoices (
        id, org_id, gstin_id, period, invoice_number, invoice_date, customer_name,
        customer_gstin, pos, is_interstate, supply_type, taxable_amount, gst_rate,
        igst, cgst, sgst, cess, total_tax, total_amount, status, document_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, data.orgId, data.gstinId, data.period, data.invoiceNumber, data.invoiceDate,
      data.customerName, data.customerGstin || null, data.pos, data.isInterstate ? 1 : 0,
      data.supplyType || "B2B", data.taxableAmount, data.gstRate, data.igst || 0,
      data.cgst || 0, data.sgst || 0, data.cess || 0, data.totalTax, data.totalAmount,
      data.status || "VALIDATED", validDocId
    );
    const lineItemsJson = data.lineItems ? (typeof data.lineItems === "string" ? data.lineItems : JSON.stringify(data.lineItems)) : (data.line_items_json || null);
    if (lineItemsJson) {
      try {
        db.prepare("UPDATE sales_invoices SET line_items_json = ? WHERE id = ?").run(lineItemsJson, id);
      } catch {}
    }
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
    let validDocId = null;
    const candidateDocId = data.documentId || data.document_id;
    if (candidateDocId) {
      const exists = db.prepare("SELECT id FROM documents WHERE id = ?").get(candidateDocId);
      if (exists) validDocId = exists.id;
    }

    const stmt = db.prepare(`
      INSERT INTO purchase_invoices (
        id, org_id, gstin_id, period, invoice_number, invoice_date, supplier_name,
        supplier_gstin, pos, is_interstate, is_rcm, taxable_amount, gst_rate,
        igst, cgst, sgst, cess, total_tax, total_amount, itc_eligibility, blocked_reason,
        payment_status, payment_date, amount_paid, days_aging, rule37_interest, status, document_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, data.orgId, data.gstinId, data.period, data.invoiceNumber, data.invoiceDate,
      data.supplierName, data.supplierGstin, data.pos, data.isInterstate ? 1 : 0,
      data.isRcm ? 1 : 0, data.taxableAmount, data.gstRate, data.igst || 0,
      data.cgst || 0, data.sgst || 0, data.cess || 0, data.totalTax, data.totalAmount,
      data.itcEligibility || "ELIGIBLE", data.blockedReason || null,
      data.paymentStatus || "UNPAID", data.paymentDate || null, data.amountPaid || 0,
      data.daysAging || 0, data.rule37Interest || 0, data.status || "VALIDATED",
      validDocId
    );
    const lineItemsJson = data.lineItems ? (typeof data.lineItems === "string" ? data.lineItems : JSON.stringify(data.lineItems)) : (data.line_items_json || null);
    if (lineItemsJson) {
      try {
        db.prepare("UPDATE purchase_invoices SET line_items_json = ? WHERE id = ?").run(lineItemsJson, id);
      } catch {}
    }
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
    const stmt = db.prepare(`
      SELECT d.*, 
             o.id as ocr_id,
             o.extracted_fields_json,
             o.confidence,
             o.status as ocr_status,
             o.approved_at,
             si.id as sales_invoice_id,
             si.invoice_number as linked_sales_invoice_no,
             pi.id as purchase_invoice_id,
             pi.invoice_number as linked_purchase_invoice_no
      FROM documents d
      LEFT JOIN ocr_extractions o ON o.id = (
        SELECT id FROM ocr_extractions WHERE document_id = d.id ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN sales_invoices si ON si.document_id = d.id
      LEFT JOIN purchase_invoices pi ON pi.document_id = d.id
      WHERE d.id = ?
    `);
    const doc = stmt.get(id);
    if (!doc) return null;
    return this._normalizeDoc(doc);
  },

  _normalizeDoc(doc) {
    let extracted = null;
    let isDraft = false;
    if (doc.extracted_fields_json) {
      try {
        extracted = JSON.parse(doc.extracted_fields_json);
        if (extracted && extracted.isDraft) isDraft = true;
      } catch {}
    }

    let finalStatus = "PENDING_REVIEW";
    if (doc.ocr_status === "APPROVED" || doc.status === "APPROVED") {
      finalStatus = "APPROVED";
    } else if (doc.ocr_status === "REJECTED") {
      finalStatus = "REJECTED";
    } else if (isDraft) {
      finalStatus = "DRAFT";
    } else if (doc.status === "FAILED") {
      finalStatus = "FAILED";
    }

    return {
      ...doc,
      filename: doc.original_filename || doc.filename || "Document.pdf",
      file_size: doc.file_size_bytes ?? doc.file_size ?? 0,
      extracted_invoice: extracted,
      is_draft: isDraft,
      status: finalStatus,
      invoice_number: doc.linked_sales_invoice_no || doc.linked_purchase_invoice_no || extracted?.invoiceInfo?.invoiceNumber || extracted?.invoiceNumber || null,
      invoice_date: extracted?.invoiceInfo?.invoiceDate || extracted?.invoiceDate || null,
      party_name: extracted?.partyName || extracted?.seller?.name || extracted?.buyer?.name || null,
      party_gstin: extracted?.gstin || extracted?.seller?.gstin || extracted?.buyer?.gstin || null,
      taxable_amount: extracted?.totals?.taxableAmount ?? extracted?.taxableValue ?? extracted?.taxableAmount ?? 0,
      total_amount: extracted?.totals?.totalAmount ?? extracted?.totalInvoiceValue ?? extracted?.totalAmount ?? 0
    };
  },

  listByGstin(gstinId, options = {}) {
    const category = typeof options === "string" ? options : options?.category;
    const status = options?.status;
    const search = options?.search;

    let sql = `
      SELECT d.*, 
             o.id as ocr_id,
             o.extracted_fields_json,
             o.confidence,
             o.status as ocr_status,
             o.approved_at,
             si.id as sales_invoice_id,
             si.invoice_number as linked_sales_invoice_no,
             pi.id as purchase_invoice_id,
             pi.invoice_number as linked_purchase_invoice_no
      FROM documents d
      LEFT JOIN ocr_extractions o ON o.id = (
        SELECT id FROM ocr_extractions WHERE document_id = d.id ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN sales_invoices si ON si.document_id = d.id
      LEFT JOIN purchase_invoices pi ON pi.document_id = d.id
      WHERE d.gstin_id = ?
    `;
    const params = [gstinId];
    if (category && category !== "all" && category !== "") {
      sql += " AND d.category = ?";
      params.push(category);
    }
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      sql += " AND (d.original_filename LIKE ? OR o.extracted_fields_json LIKE ?)";
      params.push(q, q);
    }
    sql += " ORDER BY d.created_at DESC";
    const rawDocs = db.prepare(sql).all(...params);
    let normalized = rawDocs.map(d => this._normalizeDoc(d));
    if (status && status !== "all" && status !== "") {
      normalized = normalized.filter(d => d.status === status);
    }
    return normalized;
  },

  getDashboardStats(gstinId) {
    const allDocs = this.listByGstin(gstinId);
    return {
      total: allDocs.length,
      sales: allDocs.filter(d => d.category === "sales_invoice").length,
      purchases: allDocs.filter(d => d.category === "purchase_bill").length,
      expenses: allDocs.filter(d => d.category === "expense_bill").length,
      credit_notes: allDocs.filter(d => d.category === "credit_note").length,
      debit_notes: allDocs.filter(d => d.category === "debit_note").length,
      other: allDocs.filter(d => !["sales_invoice", "purchase_bill", "expense_bill", "credit_note", "debit_note"].includes(d.category)).length,
      pending_review: allDocs.filter(d => d.status === "PENDING_REVIEW").length,
      approved: allDocs.filter(d => d.status === "APPROVED").length,
      rejected: allDocs.filter(d => d.status === "REJECTED").length,
      draft: allDocs.filter(d => d.status === "DRAFT").length,
      failed: allDocs.filter(d => d.status === "FAILED").length,
      recent: allDocs.slice(0, 5)
    };
  },

  updateStatus(id, status, rejectionReason = null) {
    try {
      if (rejectionReason) {
        db.prepare("UPDATE documents SET rejection_reason = ? WHERE id = ?").run(rejectionReason, id);
      }
      if (['UPLOADED', 'PROCESSING', 'PARSED', 'APPROVED', 'FAILED'].includes(status)) {
        db.prepare("UPDATE documents SET status = ? WHERE id = ?").run(status, id);
      }
    } catch {}
    return this.findById(id);
  },

  delete(id) {
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
    if (doc) {
      if (doc.storage_path && fs.existsSync(doc.storage_path)) {
        try { fs.unlinkSync(doc.storage_path); } catch (e) {}
      }
      let invNumber = null;
      try {
        const ocr = db.prepare("SELECT extracted_fields_json FROM ocr_extractions WHERE document_id = ? ORDER BY id DESC LIMIT 1").get(id);
        if (ocr && ocr.extracted_fields_json) {
          const parsed = JSON.parse(ocr.extracted_fields_json);
          invNumber = parsed.invoiceNumber || parsed.invoice_number || parsed.invoiceInfo?.invoiceNumber || null;
        }
      } catch (e) {}

      // Delete the specific linked sales or purchase invoice associated with this document alone
      try {
        db.prepare("DELETE FROM sales_invoices WHERE document_id = ?").run(id);
      } catch (e) {}
      try {
        db.prepare("DELETE FROM purchase_invoices WHERE document_id = ?").run(id);
      } catch (e) {}

      if (invNumber && doc.gstin_id) {
        try {
          db.prepare("DELETE FROM sales_invoices WHERE gstin_id = ? AND invoice_number = ? AND (document_id = ? OR document_id IS NULL)").run(doc.gstin_id, invNumber, id);
        } catch (e) {}
        try {
          db.prepare("DELETE FROM purchase_invoices WHERE gstin_id = ? AND invoice_number = ? AND (document_id = ? OR document_id IS NULL)").run(doc.gstin_id, invNumber, id);
        } catch (e) {}
      }

      try {
        db.prepare("DELETE FROM ocr_extractions WHERE document_id = ?").run(id);
      } catch (e) {}
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

  saveDraft(documentId, draftFields) {
    const existing = this.findByDocumentId(documentId);
    const draftPayload = { ...draftFields, isDraft: true };
    if (existing) {
      db.prepare(`
        UPDATE ocr_extractions 
        SET extracted_fields_json = ?, status = 'PENDING_REVIEW'
        WHERE id = ?
      `).run(JSON.stringify(draftPayload), existing.id);
      return this.findById(existing.id);
    } else {
      const id = `ocr-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO ocr_extractions (id, document_id, raw_text, extracted_fields_json, confidence, status)
        VALUES (?, ?, '', ?, 0.95, 'PENDING_REVIEW')
      `).run(id, documentId, JSON.stringify(draftPayload));
      return this.findById(id);
    }
  },

  reject(documentId, reason = "Rejected by user", userId = null) {
    const existing = this.findByDocumentId(documentId);
    if (existing) {
      db.prepare(`
        UPDATE ocr_extractions 
        SET status = 'REJECTED', rejection_reason = ?
        WHERE id = ?
      `).run(reason, existing.id);
    }
    try {
      db.prepare("UPDATE documents SET rejection_reason = ? WHERE id = ?").run(reason, documentId);
    } catch {}
    return true;
  },

  approve(id, userId) {
    const stmt = db.prepare(`
      UPDATE ocr_extractions 
      SET status = 'APPROVED', approved_at = CURRENT_TIMESTAMP, approved_by = ?
      WHERE id = ?
    `);
    stmt.run(userId, id);
    const updated = this.findById(id);
    if (updated) {
      try {
        db.prepare("UPDATE documents SET status = 'APPROVED' WHERE id = ?").run(updated.document_id);
      } catch {}
    }
    return updated;
  }
};

export const gstr2bRepo = {
  create(data) {
    const id = data.id || `g2b-${crypto.randomUUID()}`;
    const txVal = data.taxableValue !== undefined ? Number(data.taxableValue) : Number(data.taxableAmount || 0);
    const igst = Number(data.igst || 0);
    const cgst = Number(data.cgst || 0);
    const sgst = Number(data.sgst || 0);
    const cess = Number(data.cess || 0);
    const totalTax = data.totalTax !== undefined ? Number(data.totalTax) : (igst + cgst + sgst + cess);

    const stmt = db.prepare(`
      INSERT INTO gstr2b_entries (
        id, gstin_id, period, supplier_gstin, supplier_name, invoice_number,
        invoice_date, taxable_value, taxable_amount, igst, cgst, sgst, cess, total_tax,
        filing_date, itc_available, gstr1_filing_status, source_filename
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      data.gstinId || data.gstin_id,
      data.period,
      String(data.supplierGstin || data.supplier_gstin || "").trim().toUpperCase(),
      data.supplierName || data.supplier_name || "Supplier",
      String(data.invoiceNumber || data.invoice_number || "").trim(),
      data.invoiceDate || data.invoice_date,
      txVal,
      txVal,
      igst,
      cgst,
      sgst,
      cess,
      totalTax,
      data.filingDate || data.filing_date || new Date().toISOString().split("T")[0],
      data.itcAvailable || data.itc_available || "Y",
      data.gstr1FilingStatus || data.gstr1_filing_status || "FILED",
      data.sourceFilename || data.source_filename || null
    );
    return this.findById(id);
  },

  bulkCreate(gstinId, period, records = []) {
    const inserted = [];
    const stmt = db.prepare(`
      INSERT INTO gstr2b_entries (
        id, gstin_id, period, supplier_gstin, supplier_name, invoice_number,
        invoice_date, taxable_value, taxable_amount, igst, cgst, sgst, cess, total_tax,
        filing_date, itc_available, gstr1_filing_status, source_filename
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN TRANSACTION;");
    try {
      for (const r of records) {
        const id = r.id || `g2b-${crypto.randomUUID()}`;
        const txVal = r.taxableValue !== undefined ? Number(r.taxableValue) : Number(r.taxableAmount || 0);
        const igst = Number(r.igst || 0);
        const cgst = Number(r.cgst || 0);
        const sgst = Number(r.sgst || 0);
        const cess = Number(r.cess || 0);
        const totalTax = r.totalTax !== undefined ? Number(r.totalTax) : (igst + cgst + sgst + cess);

        stmt.run(
          id,
          gstinId,
          period,
          String(r.supplierGstin || r.supplier_gstin || "").trim().toUpperCase(),
          r.supplierName || r.supplier_name || "Supplier",
          String(r.invoiceNumber || r.invoice_number || "").trim(),
          r.invoiceDate || r.invoice_date,
          txVal,
          txVal,
          igst,
          cgst,
          sgst,
          cess,
          totalTax,
          r.filingDate || r.filing_date || new Date().toISOString().split("T")[0],
          r.itcAvailable || r.itc_available || "Y",
          r.gstr1FilingStatus || r.gstr1_filing_status || "FILED",
          r.sourceFilename || r.source_filename || null
        );
        inserted.push(id);
      }
      db.exec("COMMIT;");
      return inserted;
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
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
  },

  count(gstinId, period) {
    let sql = "SELECT COUNT(*) as count FROM gstr2b_entries WHERE gstin_id = ?";
    const params = [gstinId];
    if (period) {
      sql += " AND period = ?";
      params.push(period);
    }
    const res = db.prepare(sql).get(...params);
    return res ? res.count : 0;
  },

  deleteByGstinPeriod(gstinId, period) {
    if (!gstinId || !period) return 0;
    const info = db.prepare("DELETE FROM gstr2b_entries WHERE gstin_id = ? AND period = ?").run(gstinId, period);
    return info.changes;
  },

  delete(id) {
    const info = db.prepare("DELETE FROM gstr2b_entries WHERE id = ?").run(id);
    return info.changes > 0;
  }
};

export const reconciliationRepo = {
  saveBatch(gstinId, period, items = []) {
    db.exec("BEGIN TRANSACTION;");
    try {
      db.prepare("DELETE FROM reconciliation_results WHERE gstin_id = ? AND period = ?").run(gstinId, period);

      const insertStmt = db.prepare(`
        INSERT INTO reconciliation_results (
          id, gstin_id, period, purchase_invoice_id, gstr2b_id, match_status,
          variance_amount, supplier_name, supplier_gstin, invoice_number, invoice_date,
          books_taxable, books_tax, books_igst, books_cgst, books_sgst,
          gstr2b_taxable, gstr2b_tax, gstr2b_igst, gstr2b_cgst, gstr2b_sgst,
          action, investigation_notes, field_diffs_json, notes
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `);

      for (const it of items) {
        insertStmt.run(
          it.id || `recon-${crypto.randomUUID()}`,
          gstinId,
          period,
          it.purchase_invoice_id || null,
          it.gstr2b_id || null,
          it.match_status,
          it.variance_amount || 0,
          it.supplier_name || null,
          it.supplier_gstin || null,
          it.invoice_number || null,
          it.invoice_date || null,
          it.books_taxable || 0,
          it.books_tax || 0,
          it.books_igst || 0,
          it.books_cgst || 0,
          it.books_sgst || 0,
          it.gstr2b_taxable || 0,
          it.gstr2b_tax || 0,
          it.gstr2b_igst || 0,
          it.gstr2b_cgst || 0,
          it.gstr2b_sgst || 0,
          it.action || "PENDING",
          it.investigation_notes || null,
          it.field_diffs_json || null,
          it.notes || null
        );
      }
      db.exec("COMMIT;");
      return items.length;
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  },

  list(gstinId, period, filterStatus = null) {
    let sql = "SELECT * FROM reconciliation_results WHERE gstin_id = ?";
    const params = [gstinId];
    if (period) {
      sql += " AND period = ?";
      params.push(period);
    }
    if (filterStatus && filterStatus !== "ALL") {
      if (filterStatus === "MATCHED" || filterStatus === "EXACT_MATCH") {
        sql += " AND match_status IN ('MATCHED', 'EXACT_MATCH')";
      } else if (filterStatus === "MISMATCH" || filterStatus === "PARTIAL_MATCH") {
        sql += " AND match_status IN ('PARTIAL_MATCH', 'MISMATCH_TAX')";
      } else {
        sql += " AND match_status = ?";
        params.push(filterStatus);
      }
    }
    sql += " ORDER BY CASE match_status WHEN 'PARTIAL_MATCH' THEN 1 WHEN 'MISSING_IN_2B' THEN 2 WHEN 'MISSING_IN_BOOKS' THEN 3 WHEN 'BLOCKED_17_5' THEN 4 ELSE 5 END, invoice_date DESC";
    return db.prepare(sql).all(...params);
  },

  findById(id) {
    return db.prepare("SELECT * FROM reconciliation_results WHERE id = ?").get(id);
  },

  updateAction(id, { action, investigationNotes, notes }) {
    const existing = this.findById(id);
    if (!existing) return null;

    const newAction = action || existing.action;
    const newNotes = investigationNotes !== undefined ? investigationNotes : existing.investigation_notes;
    const addlNotes = notes !== undefined ? notes : existing.notes;

    db.prepare(`
      UPDATE reconciliation_results 
      SET action = ?, investigation_notes = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newAction, newNotes, addlNotes, id);

    return this.findById(id);
  },

  deleteByGstinPeriod(gstinId, period) {
    const info = db.prepare("DELETE FROM reconciliation_results WHERE gstin_id = ? AND period = ?").run(gstinId, period);
    return info.changes;
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
  },

  debitCashLedger(gstinId, head, subHead, amount) {
    const stmt = db.prepare(`
      INSERT INTO electronic_ledgers (id, gstin_id, ledger_type, head, sub_head, balance)
      VALUES (?, ?, 'CASH', ?, ?, ?)
      ON CONFLICT(gstin_id, ledger_type, head, sub_head) 
      DO UPDATE SET balance = MAX(0, balance - excluded.balance), updated_at = CURRENT_TIMESTAMP
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

export const startupRepo = {
  findByOrg(orgId) {
    if (!orgId) return null;
    const stmt = db.prepare("SELECT * FROM startup_profiles WHERE org_id = ?");
    const row = stmt.get(orgId);
    if (!row) return null;
    return this._formatRow(row);
  },

  _formatRow(row) {
    let completedStages = [];
    let stageData = {};
    let checklist = {};
    let documents = [];
    let partnerDetails = [];
    let dinDetails = [];
    try {
      if (row.completed_stages_json) completedStages = JSON.parse(row.completed_stages_json);
    } catch {}
    try {
      if (row.stage_data_json) stageData = JSON.parse(row.stage_data_json);
    } catch {}
    try {
      if (row.checklist_json) checklist = JSON.parse(row.checklist_json);
    } catch {}
    try {
      if (row.documents_json) documents = JSON.parse(row.documents_json);
    } catch {}
    try {
      if (row.partner_details_json) partnerDetails = JSON.parse(row.partner_details_json);
    } catch {}
    try {
      if (row.din_details_json) dinDetails = JSON.parse(row.din_details_json);
    } catch {}

    const formatted = {
      ...row,
      completed_stages: completedStages,
      stage_data: stageData,
      checklist: checklist,
      documents: documents,
      partner_details: partnerDetails,
      din_details: dinDetails
    };

    formatted.next_recommended_action = this.getNextRecommendedAction(formatted);
    return formatted;
  },

  calculateProgress(completedStages = []) {
    if (!Array.isArray(completedStages)) return 0;
    const unique = [...new Set(completedStages.filter(s => s >= 1 && s <= 7))];
    if (unique.length >= 7) return 100;
    return Math.round((unique.length / 7) * 100);
  },

  getNextRecommendedAction(profile) {
    if (!profile) {
      return {
        stage: 1,
        title: "Select Business Structure",
        description: "Choose your legal business entity (Proprietorship, Partnership, LLP, Pvt Ltd, etc.) to configure your statutory compliance path.",
        ctaText: "Select Structure",
        actionUrl: "#startupWizardView"
      };
    }
    const completed = new Set(profile.completed_stages || []);
    if (!profile.business_structure) {
      return {
        stage: 1,
        title: "Select Business Structure",
        description: "Select your organizational framework to unlock customized checklists and registration pathways.",
        ctaText: "Select Structure",
        actionUrl: "#startupWizardView"
      };
    }
    if (!completed.has(1)) {
      return {
        stage: 1,
        title: "Complete Business & Trade Details",
        description: "Enter your trade name, business activity, category, and principal place of business.",
        ctaText: "Complete Stage 1",
        actionUrl: "#startupWizardView"
      };
    }
    if (!completed.has(2)) {
      return {
        stage: 2,
        title: "PAN & Identity Verification",
        description: `Provide ${profile.business_structure === 'PROPRIETORSHIP' ? 'Proprietor individual' : 'Entity'} PAN and verify signatory identity credentials.`,
        ctaText: "Complete Stage 2",
        actionUrl: "#startupWizardView"
      };
    }
    if (!completed.has(3)) {
      return {
        stage: 3,
        title: "Review Business Licences & Registrations",
        description: "Review statutory registrations (MSME Udyam, Shop & Establishment, Trade Licence) based on your business activities.",
        ctaText: "Complete Stage 3",
        actionUrl: "#startupWizardView"
      };
    }
    if (!completed.has(4)) {
      return {
        stage: 4,
        title: "Establish GST Registration Status",
        description: "Prepare and track your GST registration application (ARN/GSTIN) or record turnover statutory exemption.",
        ctaText: "Complete Stage 4",
        actionUrl: "#startupWizardView"
      };
    }
    if (!completed.has(5)) {
      return {
        stage: 5,
        title: "Configure Banking & Accounting",
        description: "Set up your operational current bank account details and choose your statutory accounting method.",
        ctaText: "Complete Stage 5",
        actionUrl: "#startupWizardView"
      };
    }
    if (!completed.has(6)) {
      return {
        stage: 6,
        title: "Set Up Rule 46 Compliant Invoicing",
        description: "Configure sequential invoice numbering prefix, default HSN, and preview a GST-compliant tax invoice.",
        ctaText: "Complete Stage 6",
        actionUrl: "#startupWizardView"
      };
    }
    if (!completed.has(7) || profile.activation_status === "NOT_ACTIVATED") {
      return {
        stage: 7,
        title: "Activate Compliance Workspace",
        description: "Verify pre-activation readiness and launch your operational business workspace.",
        ctaText: "Launch Workspace",
        actionUrl: "#startupWizardView"
      };
    }
    return {
      stage: 7,
      title: "Workspace Active & Operational",
      description: "Your business workspace is active. Sales, purchases, ledgers, and compliance filing modules are ready.",
      ctaText: "Go to Workspace",
      actionUrl: "#viewHomeSuite"
    };
  },

  selectStructure(orgId, userId, structure, subtype = null, force = false) {
    if (!orgId) return null;
    let profile = this.findByOrg(orgId);
    if (!profile) {
      profile = this.upsert(orgId, userId, {
        business_structure: structure,
        business_subtype: subtype
      });
      return { success: true, profile };
    }

    const laterStages = (profile.completed_stages || []).filter(s => s > 1);
    if (laterStages.length > 0 && profile.business_structure && profile.business_structure !== structure && !force) {
      return {
        warning: true,
        requiresConfirmation: true,
        message: `Switching structure from ${profile.business_structure} to ${structure} will adapt registration requirements and checklists. Existing stage details will be retained where compatible.`
      };
    }

    const updated = this.upsert(orgId, userId || profile.user_id, {
      business_structure: structure,
      business_subtype: subtype
    });
    return { success: true, profile: updated };
  },

  upsert(orgIdOrObj, userId, data = {}) {
    let orgId = orgIdOrObj;
    let uId = userId;
    let payload = data;
    if (typeof orgIdOrObj === "object" && orgIdOrObj !== null) {
      orgId = orgIdOrObj.org_id;
      uId = orgIdOrObj.user_id;
      payload = { ...orgIdOrObj };
      delete payload.org_id;
      delete payload.user_id;
    }
    const existing = this.findByOrg(orgId);
    const now = new Date().toISOString();
    if (!existing) {
      const id = `sup-${crypto.randomUUID()}`;
      const completedStages = payload.completed_stages || [];
      const progress = this.calculateProgress(completedStages);
      const stageData = payload.stage_data || {};
      const checklist = payload.checklist || {};
      const documents = payload.documents_json !== undefined ? payload.documents_json : JSON.stringify(payload.documents || []);

      db.prepare(`
        INSERT INTO startup_profiles (
          id, org_id, user_id, business_structure, proposed_business_name,
          business_activity, business_description, business_state, business_pincode, business_address,
          founder_pan, entity_pan, founder_name, identity_doc_status,
          registration_reference_number, registration_status, gst_eligibility_type, gst_arn, gstin, gst_status,
          bank_holder_name, bank_name, bank_ifsc, bank_account_last4, accounting_scheme, opening_balance,
          invoice_prefix, invoice_starting_number, default_hsn, default_gst_rate,
          current_stage, completed_stages_json, overall_progress, stage_data_json, checklist_json,
          business_subtype, documents_json, activation_status, gst_exemption_reason,
          business_category, district, nature_of_operations, commencement_date,
          partner_details_json, cin, din_details_json,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?
        )
      `).run(
        id, orgId, uId,
        payload.business_structure || null,
        payload.proposed_business_name || null,
        payload.business_activity || null,
        payload.business_description || null,
        payload.business_state || null,
        payload.business_pincode || null,
        payload.business_address || null,
        payload.founder_pan ? payload.founder_pan.toUpperCase() : null,
        payload.entity_pan ? payload.entity_pan.toUpperCase() : null,
        payload.founder_name || null,
        payload.identity_doc_status || "PENDING",
        payload.registration_reference_number || null,
        payload.registration_status || "NOT_STARTED",
        payload.gst_eligibility_type || "TURNOVER_THRESHOLD",
        payload.gst_arn || null,
        payload.gstin ? payload.gstin.toUpperCase() : null,
        payload.gst_status || "NOT_APPLIED",
        payload.bank_holder_name || null,
        payload.bank_name || null,
        payload.bank_ifsc ? payload.bank_ifsc.toUpperCase() : null,
        payload.bank_account_last4 || null,
        payload.accounting_scheme || "REGULAR",
        Number(payload.opening_balance) || 0,
        payload.invoice_prefix || "INV/",
        Number(payload.invoice_starting_number) || 1,
        payload.default_hsn || "9983",
        Number(payload.default_gst_rate) || 18,
        Number(payload.current_stage) || 1,
        JSON.stringify(completedStages),
        progress,
        JSON.stringify(stageData),
        JSON.stringify(checklist),
        payload.business_subtype || null,
        documents,
        payload.activation_status || "NOT_ACTIVATED",
        payload.gst_exemption_reason || null,
        payload.business_category || null,
        payload.district || null,
        payload.nature_of_operations || null,
        payload.commencement_date || null,
        payload.partner_details_json !== undefined ? payload.partner_details_json : JSON.stringify(payload.partner_details || []),
        payload.cin || null,
        payload.din_details_json !== undefined ? payload.din_details_json : JSON.stringify(payload.din_details || []),
        now, now
      );
      return this.findByOrg(orgId);
    } else {
      const completedStages = payload.completed_stages !== undefined ? payload.completed_stages : existing.completed_stages;
      const progress = this.calculateProgress(completedStages);
      const stageData = payload.stage_data !== undefined ? { ...existing.stage_data, ...payload.stage_data } : existing.stage_data;
      const checklist = payload.checklist !== undefined ? { ...existing.checklist, ...payload.checklist } : existing.checklist;

      let documentsJson = existing.documents_json;
      if (payload.documents_json !== undefined) {
        documentsJson = payload.documents_json;
      } else if (payload.documents !== undefined) {
        documentsJson = JSON.stringify(payload.documents);
      }

      let partnerJson = existing.partner_details_json;
      if (payload.partner_details_json !== undefined) {
        partnerJson = payload.partner_details_json;
      } else if (payload.partner_details !== undefined) {
        partnerJson = JSON.stringify(payload.partner_details);
      }

      let dinJson = existing.din_details_json;
      if (payload.din_details_json !== undefined) {
        dinJson = payload.din_details_json;
      } else if (payload.din_details !== undefined) {
        dinJson = JSON.stringify(payload.din_details);
      }

      db.prepare(`
        UPDATE startup_profiles SET
          business_structure = COALESCE(?, business_structure),
          proposed_business_name = COALESCE(?, proposed_business_name),
          business_activity = COALESCE(?, business_activity),
          business_description = COALESCE(?, business_description),
          business_state = COALESCE(?, business_state),
          business_pincode = COALESCE(?, business_pincode),
          business_address = COALESCE(?, business_address),
          founder_pan = COALESCE(?, founder_pan),
          entity_pan = COALESCE(?, entity_pan),
          founder_name = COALESCE(?, founder_name),
          identity_doc_status = COALESCE(?, identity_doc_status),
          registration_reference_number = COALESCE(?, registration_reference_number),
          registration_status = COALESCE(?, registration_status),
          gst_eligibility_type = COALESCE(?, gst_eligibility_type),
          gst_arn = COALESCE(?, gst_arn),
          gstin = COALESCE(?, gstin),
          gst_status = COALESCE(?, gst_status),
          bank_holder_name = COALESCE(?, bank_holder_name),
          bank_name = COALESCE(?, bank_name),
          bank_ifsc = COALESCE(?, bank_ifsc),
          bank_account_last4 = COALESCE(?, bank_account_last4),
          accounting_scheme = COALESCE(?, accounting_scheme),
          opening_balance = COALESCE(?, opening_balance),
          invoice_prefix = COALESCE(?, invoice_prefix),
          invoice_starting_number = COALESCE(?, invoice_starting_number),
          default_hsn = COALESCE(?, default_hsn),
          default_gst_rate = COALESCE(?, default_gst_rate),
          current_stage = COALESCE(?, current_stage),
          completed_stages_json = ?,
          overall_progress = ?,
          stage_data_json = ?,
          checklist_json = ?,
          business_subtype = COALESCE(?, business_subtype),
          documents_json = COALESCE(?, documents_json),
          activation_status = COALESCE(?, activation_status),
          gst_exemption_reason = COALESCE(?, gst_exemption_reason),
          business_category = COALESCE(?, business_category),
          district = COALESCE(?, district),
          nature_of_operations = COALESCE(?, nature_of_operations),
          commencement_date = COALESCE(?, commencement_date),
          partner_details_json = COALESCE(?, partner_details_json),
          cin = COALESCE(?, cin),
          din_details_json = COALESCE(?, din_details_json),
          updated_at = CURRENT_TIMESTAMP
        WHERE org_id = ?
      `).run(
        payload.business_structure !== undefined ? payload.business_structure : null,
        payload.proposed_business_name !== undefined ? payload.proposed_business_name : null,
        payload.business_activity !== undefined ? payload.business_activity : null,
        payload.business_description !== undefined ? payload.business_description : null,
        payload.business_state !== undefined ? payload.business_state : null,
        payload.business_pincode !== undefined ? payload.business_pincode : null,
        payload.business_address !== undefined ? payload.business_address : null,
        payload.founder_pan !== undefined ? (payload.founder_pan ? payload.founder_pan.toUpperCase() : null) : null,
        payload.entity_pan !== undefined ? (payload.entity_pan ? payload.entity_pan.toUpperCase() : null) : null,
        payload.founder_name !== undefined ? payload.founder_name : null,
        payload.identity_doc_status !== undefined ? payload.identity_doc_status : null,
        payload.registration_reference_number !== undefined ? payload.registration_reference_number : null,
        payload.registration_status !== undefined ? payload.registration_status : null,
        payload.gst_eligibility_type !== undefined ? payload.gst_eligibility_type : null,
        payload.gst_arn !== undefined ? payload.gst_arn : null,
        payload.gstin !== undefined ? (payload.gstin ? payload.gstin.toUpperCase() : null) : null,
        payload.gst_status !== undefined ? payload.gst_status : null,
        payload.bank_holder_name !== undefined ? payload.bank_holder_name : null,
        payload.bank_name !== undefined ? payload.bank_name : null,
        payload.bank_ifsc !== undefined ? (payload.bank_ifsc ? payload.bank_ifsc.toUpperCase() : null) : null,
        payload.bank_account_last4 !== undefined ? payload.bank_account_last4 : null,
        payload.accounting_scheme !== undefined ? payload.accounting_scheme : null,
        payload.opening_balance !== undefined ? Number(payload.opening_balance) : null,
        payload.invoice_prefix !== undefined ? payload.invoice_prefix : null,
        payload.invoice_starting_number !== undefined ? Number(payload.invoice_starting_number) : null,
        payload.default_hsn !== undefined ? payload.default_hsn : null,
        payload.default_gst_rate !== undefined ? Number(payload.default_gst_rate) : null,
        payload.current_stage !== undefined ? Number(payload.current_stage) : null,
        JSON.stringify(completedStages),
        progress,
        JSON.stringify(stageData),
        JSON.stringify(checklist),
        payload.business_subtype !== undefined ? payload.business_subtype : null,
        documentsJson,
        payload.activation_status !== undefined ? payload.activation_status : null,
        payload.gst_exemption_reason !== undefined ? payload.gst_exemption_reason : null,
        payload.business_category !== undefined ? payload.business_category : null,
        payload.district !== undefined ? payload.district : null,
        payload.nature_of_operations !== undefined ? payload.nature_of_operations : null,
        payload.commencement_date !== undefined ? payload.commencement_date : null,
        partnerJson,
        payload.cin !== undefined ? payload.cin : null,
        dinJson,
        orgId
      );
      return this.findByOrg(orgId);
    }
  },

  saveStage(orgId, userIdOrStage, stageNumberOrData, stageDataOrNone = {}) {
    let userId = userIdOrStage;
    let stageNumber = stageNumberOrData;
    let stageData = stageDataOrNone;
    if (typeof userIdOrStage === "number" || (typeof userIdOrStage === "string" && !isNaN(Number(userIdOrStage)) && typeof stageNumberOrData === "object")) {
      stageData = stageNumberOrData || {};
      stageNumber = Number(userIdOrStage);
      userId = null;
    }
    let profile = this.findByOrg(orgId);
    if (!profile) {
      profile = this.upsert(orgId, userId, {});
    }
    const stageNum = Number(stageNumber) || 1;
    const completed = new Set(profile.completed_stages || []);
    completed.add(stageNum);
    const updatedStages = Array.from(completed).sort((a, b) => a - b);
    const nextStage = Math.min(Math.max(profile.current_stage || 1, stageNum + 1), 7);

    const mergedStageData = {
      ...(profile.stage_data || {}),
      [`stage_${stageNum}`]: stageData
    };

    const updateData = {
      current_stage: nextStage,
      completed_stages: updatedStages,
      stage_data: mergedStageData
    };

    if (stageNum === 1) {
      const bStruct = stageData.business_structure || stageData.businessStructure;
      const bSubtype = stageData.business_subtype || stageData.businessSubtype;
      const bName = stageData.proposed_business_name || stageData.proposedBusinessName;
      const bAct = stageData.business_activity || stageData.businessActivity;
      const bCat = stageData.business_category || stageData.businessCategory;
      const bDesc = stageData.business_description || stageData.businessDescription;
      const bState = stageData.business_state || stageData.businessState;
      const bDistrict = stageData.district;
      const bPin = stageData.business_pincode || stageData.businessPincode;
      const bAddr = stageData.business_address || stageData.businessAddress;
      const bOps = stageData.nature_of_operations || stageData.natureOfOperations;
      const bDate = stageData.commencement_date || stageData.commencementDate;
      const bCin = stageData.cin;

      if (bStruct) updateData.business_structure = bStruct;
      if (bSubtype !== undefined) updateData.business_subtype = bSubtype;
      if (bName) updateData.proposed_business_name = bName;
      if (bAct) updateData.business_activity = bAct;
      if (bCat) updateData.business_category = bCat;
      if (bDesc) updateData.business_description = bDesc;
      if (bState) updateData.business_state = bState;
      if (bDistrict) updateData.district = bDistrict;
      if (bPin) updateData.business_pincode = bPin;
      if (bAddr) updateData.business_address = bAddr;
      if (bOps) updateData.nature_of_operations = bOps;
      if (bDate) updateData.commencement_date = bDate;
      if (bCin) updateData.cin = bCin;
      if (stageData.founder_name || stageData.founderName) {
        updateData.founder_name = stageData.founder_name || stageData.founderName;
      }
      if (stageData.partner_details || stageData.partnerDetails) {
        updateData.partner_details_json = JSON.stringify(stageData.partner_details || stageData.partnerDetails);
      }
      if (stageData.din_details || stageData.dinDetails) {
        updateData.din_details_json = JSON.stringify(stageData.din_details || stageData.dinDetails);
      }
    } else if (stageNum === 2) {
      const fPan = stageData.founder_pan || stageData.founderPan;
      const ePan = stageData.entity_pan || stageData.entityPan;
      const fName = stageData.founder_name || stageData.founderName;
      const idStatus = stageData.identity_doc_status || stageData.identityDocStatus;
      if (fPan) updateData.founder_pan = fPan.toUpperCase();
      if (ePan) updateData.entity_pan = ePan.toUpperCase();
      if (fName) updateData.founder_name = fName;
      if (idStatus) updateData.identity_doc_status = idStatus;
    } else if (stageNum === 3) {
      const regRef = stageData.registration_reference_number || stageData.registrationReferenceNumber;
      const regStatus = stageData.registration_status || stageData.registrationStatus;
      if (regRef) updateData.registration_reference_number = regRef;
      if (regStatus) updateData.registration_status = regStatus;
      if (stageData.checklist) {
        updateData.checklist = { ...(profile.checklist || {}), ...stageData.checklist };
      }
    } else if (stageNum === 4) {
      const gstElig = stageData.gst_eligibility_type || stageData.gstEligibilityType;
      const gstArn = stageData.gst_arn || stageData.gstArn;
      const gstin = stageData.gstin;
      const gstStat = stageData.gst_status || stageData.gstStatus;
      const gstExemptReason = stageData.gst_exemption_reason || stageData.gstExemptionReason;
      if (gstElig) updateData.gst_eligibility_type = gstElig;
      if (gstArn) updateData.gst_arn = gstArn;
      if (gstin) updateData.gstin = gstin.toUpperCase();
      if (gstStat) updateData.gst_status = gstStat;
      if (gstExemptReason) updateData.gst_exemption_reason = gstExemptReason;
    } else if (stageNum === 5) {
      const bHolder = stageData.bank_holder_name || stageData.bankHolderName;
      const bName = stageData.bank_name || stageData.bankName;
      const bIfsc = stageData.bank_ifsc || stageData.bankIfsc;
      const bLast4 = stageData.bank_account_last4 || stageData.bankAccountLast4;
      const aScheme = stageData.accounting_scheme || stageData.accountingScheme;
      const opBal = stageData.opening_balance !== undefined ? stageData.opening_balance : stageData.openingBalance;
      if (bHolder) updateData.bank_holder_name = bHolder;
      if (bName) updateData.bank_name = bName;
      if (bIfsc) updateData.bank_ifsc = bIfsc.toUpperCase();
      if (bLast4) updateData.bank_account_last4 = bLast4;
      if (aScheme) updateData.accounting_scheme = aScheme;
      if (opBal !== undefined) updateData.opening_balance = Number(opBal);
    } else if (stageNum === 6) {
      const pfx = stageData.invoice_prefix || stageData.invoicePrefix;
      const sNum = stageData.invoice_starting_number !== undefined ? stageData.invoice_starting_number : stageData.invoiceStartingNumber;
      const hsn = stageData.default_hsn || stageData.defaultHsn;
      const rate = stageData.default_gst_rate !== undefined ? stageData.default_gst_rate : stageData.defaultGstRate;
      if (pfx) updateData.invoice_prefix = pfx;
      if (sNum !== undefined) updateData.invoice_starting_number = Number(sNum);
      if (hsn) updateData.default_hsn = hsn;
      if (rate !== undefined) updateData.default_gst_rate = Number(rate);
    } else if (stageNum === 7) {
      // Stage 7 triggers workspace activation
      return this.activateWorkspace(orgId, userId || profile?.user_id).profile;
    }

    return this.upsert(orgId, userId || profile?.user_id, updateData);
  },

  updateChecklist(orgId, userIdOrKey, checklistKeyOrChecked, isCheckedOrNone) {
    let userId = userIdOrKey;
    let checklistKey = checklistKeyOrChecked;
    let isChecked = isCheckedOrNone;
    if (isCheckedOrNone === undefined) {
      checklistKey = userIdOrKey;
      isChecked = checklistKeyOrChecked;
      userId = null;
    }
    let profile = this.findByOrg(orgId);
    if (!profile) {
      profile = this.upsert(orgId, userId, {});
    }
    const checklist = { ...(profile.checklist || {}), [checklistKey]: !!isChecked };
    return this.upsert(orgId, userId || profile?.user_id, { checklist });
  },

  addDocument(orgId, doc) {
    const profile = this.findByOrg(orgId);
    if (!profile) return null;
    const documents = Array.isArray(profile.documents) ? [...profile.documents] : [];
    documents.push(doc);
    return this.upsert(orgId, profile.user_id, {
      documents_json: JSON.stringify(documents)
    });
  },

  removeDocument(orgId, docId) {
    const profile = this.findByOrg(orgId);
    if (!profile) return null;
    const documents = (profile.documents || []).filter(d => d.id !== docId);
    return this.upsert(orgId, profile.user_id, {
      documents_json: JSON.stringify(documents)
    });
  },

  activateWorkspace(orgId, userId) {
    if (!orgId) return { success: false, error: "Missing organization ID" };
    const profile = this.findByOrg(orgId);
    if (!profile) return { success: false, error: "Startup profile not found" };

    // Readiness checks
    const missing = [];
    if (!profile.business_structure) missing.push("Business structure not selected");
    if (!profile.proposed_business_name) missing.push("Proposed business/trade name missing");
    if (!profile.business_state) missing.push("Business state missing");
    if (!profile.founder_pan && !profile.entity_pan) missing.push("PAN details missing");

    const isGstRegistered = profile.gst_status === "APPROVED" || profile.gst_status === "APPROVED_ACTIVE" || Boolean(profile.gstin);
    const isNonGstExempt = profile.gst_eligibility_type === "EXEMPT_BELOW_THRESHOLD" || profile.gst_status === "NOT_REQUIRED_EXEMPT" || profile.gst_status === "NOT_APPLIED";

    if (isGstRegistered && (!profile.gstin || !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i.test(profile.gstin))) {
      missing.push("Valid 15-character statutory GSTIN required for GST-registered activation");
    }

    if (missing.length > 0) {
      return {
        success: false,
        error: "Pre-activation readiness checks failed",
        missingRequirements: missing,
        profile
      };
    }

    // 1. Update Organization record with validated trade details
    const panToUse = profile.business_structure === "PROPRIETORSHIP" ? (profile.founder_pan || profile.entity_pan) : (profile.entity_pan || profile.founder_pan);
    db.prepare(`
      UPDATE organizations SET
        name = COALESCE(?, name),
        pan = COALESCE(?, pan),
        registered_address = COALESCE(?, registered_address),
        state = COALESCE(?, state),
        legal_type = COALESCE(?, legal_type)
      WHERE id = ?
    `).run(
      profile.proposed_business_name,
      panToUse || "PENDING",
      profile.business_address || null,
      profile.business_state,
      profile.business_structure,
      orgId
    );

    // 2. If valid GSTIN is present, link or insert primary GST registration
    let linkedGstinId = null;
    if (profile.gstin && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i.test(profile.gstin)) {
      const cleanGstin = profile.gstin.trim().toUpperCase();
      const existingGstin = db.prepare("SELECT id FROM gst_registrations WHERE gstin = ?").get(cleanGstin);
      if (existingGstin) {
        linkedGstinId = existingGstin.id;
        db.prepare(`
          UPDATE gst_registrations SET
            org_id = ?,
            trade_name = COALESCE(?, trade_name),
            state_code = ?,
            state_name = COALESCE(?, state_name),
            address = COALESCE(?, address),
            is_active = 1,
            is_primary = 1
          WHERE id = ?
        `).run(orgId, profile.proposed_business_name, cleanGstin.slice(0, 2), profile.business_state, profile.business_address, existingGstin.id);
      } else {
        linkedGstinId = `gst-${crypto.randomUUID()}`;
        db.prepare(`
          INSERT INTO gst_registrations (id, org_id, gstin, trade_name, state_code, state_name, address, jurisdiction, is_active, is_primary, filing_frequency)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'MONTHLY')
        `).run(
          linkedGstinId,
          orgId,
          cleanGstin,
          profile.proposed_business_name || "Startup Enterprise",
          cleanGstin.slice(0, 2),
          profile.business_state || "Maharashtra",
          profile.business_address || null,
          "State Ward"
        );
      }

      if (userId) {
        try {
          db.prepare("UPDATE sessions SET active_gstin_id = ?, active_org_id = ? WHERE user_id = ?").run(linkedGstinId, orgId, userId);
        } catch {}
      }
    }

    // 3. Mark activation status
    const finalActivationStatus = linkedGstinId ? "ACTIVATED_GST_REGISTERED" : "ACTIVATED_NON_GST";
    const completedStages = new Set(profile.completed_stages || []);
    completedStages.add(7);
    const updatedStages = Array.from(completedStages).sort((a, b) => a - b);

    const updatedProfile = this.upsert(orgId, userId || profile.user_id, {
      activation_status: finalActivationStatus,
      completed_stages: updatedStages,
      overall_progress: 100,
      current_stage: 7
    });

    // 4. Record audit log
    auditRepo.log({
      orgId,
      gstinId: linkedGstinId,
      userId: userId || profile.user_id,
      action: "STARTUP_WORKSPACE_ACTIVATED",
      entityType: "STARTUP_PROFILE",
      entityId: profile.id,
      details: {
        structure: profile.business_structure,
        tradeName: profile.proposed_business_name,
        activationStatus: finalActivationStatus,
        gstin: profile.gstin || null,
        invoicePrefix: profile.invoice_prefix || "INV/"
      }
    });

    return {
      success: true,
      activationStatus: finalActivationStatus,
      profile: updatedProfile,
      linkedGstinId
    };
  },

  reset(orgId, userId = null) {
    if (!orgId) return null;
    db.prepare("DELETE FROM startup_profiles WHERE org_id = ?").run(orgId);
    return this.upsert(orgId, userId, {});
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

  create(params) {
    return this.log(params);
  },

  list(orgId) {
    const stmt = db.prepare("SELECT * FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 100");
    return stmt.all(orgId);
  }
};

export const TEN_CANONICAL_BRANCHES = [
  {
    gstin: "27AAACA1234A1Z5",
    tradeName: "Apex Retailers - Maharashtra (Mumbai HQ)",
    stateCode: "27",
    stateName: "Maharashtra",
    address: "402 Nariman Point, Mumbai 400021",
    jurisdiction: "Ward 4, Mumbai Central",
    isPrimary: 1,
    filingFrequency: "MONTHLY"
  },
  {
    gstin: "29AAACB1234F1Z5",
    tradeName: "Apex Retailers - Karnataka (Bengaluru Hub)",
    stateCode: "29",
    stateName: "Karnataka",
    address: "12 Koramangala 5th Block, Bangalore 560034",
    jurisdiction: "Range 2, South Bangalore",
    isPrimary: 0,
    filingFrequency: "MONTHLY"
  },
  {
    gstin: "32ABCDE1234F1Z5",
    tradeName: "Apex Retailers - Kerala (Kochi Branch)",
    stateCode: "32",
    stateName: "Kerala",
    address: "Building 4, Spices Market Yard, Mattancherry, Kochi 682002",
    jurisdiction: "Ernakulam Circle 1",
    isPrimary: 0,
    filingFrequency: "MONTHLY"
  },
  {
    gstin: "07AAACA1234A1Z6",
    tradeName: "Apex Retailers - Delhi NCR Gateway",
    stateCode: "07",
    stateName: "Delhi",
    address: "Plot 14, Barakhamba Road, Connaught Place, New Delhi 110001",
    jurisdiction: "Ward 102, New Delhi",
    isPrimary: 0,
    filingFrequency: "MONTHLY"
  },
  {
    gstin: "33AAACA1234A1Z2",
    tradeName: "Apex Retailers - Tamil Nadu (Chennai Branch)",
    stateCode: "33",
    stateName: "Tamil Nadu",
    address: "88 Anna Salai, Guindy, Chennai 600032",
    jurisdiction: "Chennai South Range 5",
    isPrimary: 0,
    filingFrequency: "MONTHLY"
  },
  {
    gstin: "24AAACA1234A1Z9",
    tradeName: "Apex Retailers - Gujarat (Ahmedabad Branch)",
    stateCode: "24",
    stateName: "Gujarat",
    address: "501 SG Highway, Bodakdev, Ahmedabad 380054",
    jurisdiction: "Range 3, Ahmedabad North",
    isPrimary: 0,
    filingFrequency: "MONTHLY"
  },
  {
    gstin: "36AAACA1234A1Z7",
    tradeName: "Apex Retailers - Telangana (Hyderabad Branch)",
    stateCode: "36",
    stateName: "Telangana",
    address: "Level 3, HITEC City, Madhapur, Hyderabad 500081",
    jurisdiction: "Circle 8, Hyderabad Central",
    isPrimary: 0,
    filingFrequency: "MONTHLY"
  },
  {
    gstin: "19AAACA1234A1Z8",
    tradeName: "Apex Retailers - West Bengal (Kolkata Branch)",
    stateCode: "19",
    stateName: "West Bengal",
    address: "22 Camac Street, Park Street Area, Kolkata 700016",
    jurisdiction: "Park Street Division, Kolkata",
    isPrimary: 0,
    filingFrequency: "MONTHLY"
  },
  {
    gstin: "09AAACA1234A1Z3",
    tradeName: "Apex Retailers - Uttar Pradesh (Noida Branch)",
    stateCode: "09",
    stateName: "Uttar Pradesh",
    address: "B-12 Sector 62, Electronic City, Noida 201309",
    jurisdiction: "Gautam Buddha Nagar Sector 4",
    isPrimary: 0,
    filingFrequency: "MONTHLY"
  },
  {
    gstin: "08AAACA1234A1Z4",
    tradeName: "Apex Retailers - Rajasthan (Jaipur Branch)",
    stateCode: "08",
    stateName: "Rajasthan",
    address: "45 MI Road, Ashok Nagar, Jaipur 302001",
    jurisdiction: "Jaipur Circle 2",
    isPrimary: 0,
    filingFrequency: "MONTHLY"
  }
];

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

    // 3. Create Multi-GSTIN State Branches (Exactly 10 canonical branches across 10 distinct states)
    let mhBranch = null;
    for (const b of TEN_CANONICAL_BRANCHES) {
      const created = gstinRepo.create({
        orgId: org.id,
        gstin: b.gstin,
        tradeName: b.tradeName,
        stateCode: b.stateCode,
        stateName: b.stateName,
        address: b.address,
        jurisdiction: b.jurisdiction,
        isPrimary: b.isPrimary,
        filingFrequency: b.filingFrequency
      });
      if (b.isPrimary) mhBranch = created;
    }

    // 4. Initial Cash Ledgers (Statutory opening balances)
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
    console.log("[Seed] Development database initialized with Apex Retailers Pvt Ltd (10 state branches).");
  } catch (err) {
    db.exec("ROLLBACK;");
    console.error("[Seed] Error seeding development database:", err);
  }
}

/**
 * Ensures permanent, ready-to-use admin credentials exist in the database.
 * Credentials:
 *   - Login ID: admin@simplegst.in (or 'admin')
 *   - Secondary ID: sanjay@simplegst.in (or 'sanjay')
 *   - Password: Admin@123
 */
export function ensureDefaultAdminUser() {
  const defaultAccounts = [
    {
      id: "usr-admin-master-account",
      email: "admin@simplegst.in",
      fullName: "Sanjay Administrator",
      mobile: "9876543210"
    },
    {
      id: "usr-sanjay-master-account",
      email: "sanjay@simplegst.in",
      fullName: "Sanjay Ram",
      mobile: "9876543211"
    }
  ];

  const defaultPassword = "Admin@123";

  // Ensure organization exists
  let org = db.prepare("SELECT * FROM organizations WHERE name = 'Apex Retailers Pvt Ltd' LIMIT 1").get();
  if (!org) {
    org = db.prepare("SELECT * FROM organizations LIMIT 1").get();
  }
  if (!org) {
    const orgId = "org-default-apex";
    db.prepare(`
      INSERT INTO organizations (id, name, pan, legal_type, registered_address, state)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(orgId, "Apex Retailers Pvt Ltd", "AAACA1234A", "Private Limited Company", "402 Nariman Point, Mumbai, Maharashtra 400021", "Maharashtra");
    org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId);
  }

  // Ensure exactly the 10 canonical branches exist for Apex Retailers Pvt Ltd
  for (const branch of TEN_CANONICAL_BRANCHES) {
    const existing = db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? AND gstin = ?").get(org.id, branch.gstin);
    if (!existing) {
      db.prepare(`
        INSERT INTO gst_registrations (id, org_id, gstin, trade_name, state_code, state_name, address, jurisdiction, is_primary, is_active, filing_frequency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(`gstin-${crypto.randomUUID()}`, org.id, branch.gstin, branch.tradeName, branch.stateCode, branch.stateName, branch.address, branch.jurisdiction, branch.isPrimary, branch.filingFrequency);
    } else {
      db.prepare(`
        UPDATE gst_registrations 
        SET trade_name = ?, state_code = ?, state_name = ?, address = ?, jurisdiction = ?, is_primary = ?, filing_frequency = ?
        WHERE id = ?
      `).run(branch.tradeName, branch.stateCode, branch.stateName, branch.address, branch.jurisdiction, branch.isPrimary, branch.filingFrequency, existing.id);
    }
  }

  const primaryBranch = db.prepare("SELECT id FROM gst_registrations WHERE org_id = ? AND is_primary = 1 LIMIT 1").get(org.id);
  const canonicalGstins = TEN_CANONICAL_BRANCHES.map(b => b.gstin);
  const placeholders = canonicalGstins.map(() => "?").join(",");

  if (primaryBranch) {
    db.prepare(`
      UPDATE sessions 
      SET active_gstin_id = ? 
      WHERE active_org_id = ? AND active_gstin_id NOT IN (
        SELECT id FROM gst_registrations WHERE org_id = ? AND gstin IN (${placeholders})
      )
    `).run(primaryBranch.id, org.id, org.id, ...canonicalGstins);
  }

  db.prepare(`
    DELETE FROM gst_registrations 
    WHERE org_id = ? AND gstin NOT IN (${placeholders})
  `).run(org.id, ...canonicalGstins);

  for (const acct of defaultAccounts) {
    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(acct.email);
    if (!user) {
      const passwordHash = userRepo.hashPassword(defaultPassword);
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, mobile_number, role, onboarding_status, onboarding_step)
        VALUES (?, ?, ?, ?, ?, 'OWNER', 'COMPLETED', 4)
      `).run(acct.id, acct.email, passwordHash, acct.fullName, acct.mobile);
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(acct.id);
    } else {
      // Ensure password matches Admin@123
      if (!userRepo.verifyPassword(user.password_hash, defaultPassword)) {
        const passwordHash = userRepo.hashPassword(defaultPassword);
        db.prepare("UPDATE users SET password_hash = ?, onboarding_status = 'COMPLETED', onboarding_step = 4 WHERE id = ?")
          .run(passwordHash, user.id);
      }
    }

    // Ensure organization membership
    const membership = db.prepare("SELECT * FROM org_members WHERE org_id = ? AND user_id = ?").get(org.id, user.id);
    if (!membership) {
      db.prepare(`
        INSERT INTO org_members (id, org_id, user_id, role)
        VALUES (?, ?, ?, 'OWNER')
      `).run(`mem-${crypto.randomUUID()}`, org.id, user.id);
    }
  }

  return { email: "admin@simplegst.in", password: defaultPassword };
}

// Auto-run ensureDefaultAdminUser on startup
try {
  ensureDefaultAdminUser();
} catch (err) {
  console.warn("[Admin Account] Notice:", err.message);
}
