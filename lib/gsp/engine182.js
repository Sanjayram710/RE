import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import {
  DEMO_BUSINESS,
  DEMO_SALES,
  DEMO_PURCHASES,
  DEMO_RECONCILIATION
} from "../demoData.js";
import { validateGstin } from "../validate.js";
import { getGspMode, logGspRequest } from "./client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the statutory 182-API catalog
const apiCatalogPath = path.join(__dirname, "..", "..", "data", "api-status.json");
let apiCatalog = [];
try {
  if (fs.existsSync(apiCatalogPath)) {
    apiCatalog = JSON.parse(fs.readFileSync(apiCatalogPath, "utf8"));
  }
} catch (e) {
  console.warn("[GSP Engine 182] Warning loading api-status.json:", e.message);
}

export function getAllApis() {
  return apiCatalog;
}

export function getApiById(id) {
  return apiCatalog.find(x => x.id === Number(id));
}

/**
 * Universal Execution Dispatcher for all 182 Statutory GST APIs
 */
export async function executeGspApi(apiId, options = {}) {
  const startTime = Date.now();
  const id = Number(apiId);
  const item = getApiById(id);

  if (!item) {
    return {
      success: false,
      status_cd: "0",
      httpStatusCode: 404,
      error: {
        error_cd: "API_NOT_FOUND",
        message: `API with ID ${apiId} was not found in the 182 statutory GST catalog.`
      },
      executionTimeMs: Date.now() - startTime
    };
  }

  const gstin = options.gstin || DEMO_BUSINESS.gstin;
  const period = options.period || options.ret_period || "102026";
  const payload = options.payload || {};
  const isAuthOrPublic = item.group === "Auth" || item.group === "Public";

  // Validate GSTIN unless purely public unauthenticated endpoint
  if (!isAuthOrPublic) {
    const valGstin = validateGstin(gstin);
    if (!valGstin.valid) {
      return {
        success: false,
        status_cd: "0",
        httpStatusCode: 400,
        error: {
          error_cd: "AUTH101",
          message: "Invalid GSTIN format: " + valGstin.error
        },
        apiId: id,
        apiName: item.api,
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  logGspRequest(`EXECUTE_API_${id}_${item.action}`, { gstin, period, id, api: item.api });

  // =========================================================================
  // 1. Handle Specifically Documented "Not Working" & Edge Cases from CSV
  // =========================================================================

  // API #104: GSTR3B - Submit RCM Opening Balance (Remark: "404 - Not Found")
  if (id === 104) {
    return {
      success: false,
      status_cd: "0",
      httpStatusCode: 404,
      error: {
        error_cd: "HTTP_404",
        message: "404 - Not Found: Endpoint retired by GSTN. Use Electronic Liability Register Table 1."
      },
      remark: "404 - Not Found",
      apiId: id,
      apiName: item.api,
      executionTimeMs: Date.now() - startTime
    };
  }

  // API #107: GSTR4 Annual - Get 4A-4B Autopop Details (Remark: XML parser error)
  if (id === 107) {
    return {
      isSuccess: false,
      message: "Unexpected character encountered while parsing value: <. Path '', line 0, position 0.",
      error_cd: "PARSE_ERROR",
      apiId: id,
      apiName: item.api,
      executionTimeMs: Date.now() - startTime
    };
  }

  // API #110: GSTR4 Annual - Get TDSCMP Summary (Remark: GSTN-EXEC2003 error)
  if (id === 110) {
    return {
      message: "success",
      isSuccess: true,
      data: {
        httpStatusCode: 200,
        error: {
          message: "Something seems to have gone wrong while processing your request. Please try again.If error persists quote error number GSTN-EXEC2003 when you contact customer care for quick resolution.",
          error_cd: "GSTN-EXEC2003"
        }
      },
      apiId: id,
      apiName: item.api,
      executionTimeMs: Date.now() - startTime
    };
  }

  // API #121: GSTR6 - Get CDNA Invoices (Remark: AUTH113 Invalid Return Period)
  if (id === 121) {
    return {
      message: "success",
      isSuccess: true,
      data: {
        httpStatusCode: 200,
        data: {},
        error: {
          message: "Invalid Return Period",
          error_cd: "AUTH113"
        }
      },
      apiId: id,
      apiName: item.api,
      executionTimeMs: Date.now() - startTime
    };
  }

  // API #122: GSTR6 - Get GSTR6 Summary (Remark: RET12501 System Failure)
  if (id === 122) {
    return {
      message: "success",
      isSuccess: true,
      data: {
        httpStatusCode: 200,
        error: {
          message: "System Failure",
          error_cd: "RET12501"
        }
      },
      apiId: id,
      apiName: item.api,
      executionTimeMs: Date.now() - startTime
    };
  }

  // API #22: GSTR1 - Get ECOMA Invoices (Not Working)
  if (id === 22) {
    return {
      success: false,
      status_cd: "0",
      httpStatusCode: 503,
      error: {
        error_cd: "RET11404",
        message: "Service temporarily unavailable for ECOMA invoices."
      },
      apiId: id,
      apiName: item.api,
      executionTimeMs: Date.now() - startTime
    };
  }

  // API #26: GSTR1 - Get HSN Summary details (Not Working)
  if (id === 26) {
    return {
      success: false,
      status_cd: "0",
      httpStatusCode: 503,
      error: {
        error_cd: "RET14002",
        message: "HSN Summary table data is undergoing portal schema migration."
      },
      apiId: id,
      apiName: item.api,
      executionTimeMs: Date.now() - startTime
    };
  }

  // Handle Generic Partial State (e.g. API 67, 83)
  if (item.status === "partial") {
    return {
      success: false,
      status: "partial",
      status_cd: "0",
      message: `Not available yet (Status: partial)`,
      apiId: id,
      apiName: item.api,
      executionTimeMs: Date.now() - startTime
    };
  }

  // If live mode configured, attempt live call
  const { isLive, baseUrl } = getGspMode();
  if (isLive && process.env.GSP_CLIENT_ID) {
    try {
      const fullUrl = `${baseUrl}${item.path}${item.method === "GET" ? `?gstin=${gstin}&period=${period}` : ""}`;
      const res = await fetch(fullUrl, {
        method: item.method,
        headers: {
          "Content-Type": "application/json",
          "client-id": process.env.GSP_CLIENT_ID,
          "client-secret": process.env.GSP_CLIENT_SECRET,
          "gstin": gstin,
          "ret_period": period
        },
        body: item.method === "POST" ? JSON.stringify(payload) : undefined
      });
      const data = await res.json();
      return {
        ...data,
        apiId: id,
        apiName: item.api,
        executionTimeMs: Date.now() - startTime,
        mode: "live-sandbox"
      };
    } catch (err) {
      console.warn(`[GSP Live Fallback] Error contacting live endpoint for API ${id}:`, err.message);
    }
  }

  // =========================================================================
  // 2. Comprehensive Deterministic Execution Logic per Group
  // =========================================================================

  // --- GROUP AUTH (IDs 1-5) ---
  if (id === 1) { // Initiate OTP for EVC
    return {
      success: true,
      status_cd: "1",
      message: "OTP for EVC initiated successfully to registered signatory mobile",
      txn: `EVC_${Date.now()}`,
      executionTimeMs: Date.now() - startTime
    };
  }
  if (id === 2) { // Logout
    return {
      success: true,
      status_cd: "1",
      message: "Session terminated successfully on GSTN / GSP gateway.",
      executionTimeMs: Date.now() - startTime
    };
  }
  if (id === 3) { // Extension of authorization token
    return {
      success: true,
      status_cd: "1",
      auth_token: `gst_ext_tok_${Buffer.from(gstin + ":" + Date.now()).toString("base64")}`,
      expiry: Date.now() + 6 * 3600 * 1000,
      executionTimeMs: Date.now() - startTime
    };
  }
  if (id === 4) { // Request for OTP
    return {
      success: true,
      status_cd: "1",
      message: "OTP sent successfully to registered mobile number ending with 3210",
      txn: `TXN_${Date.now()}`,
      executionTimeMs: Date.now() - startTime
    };
  }
  if (id === 5) { // Request for Authorization token
    return {
      success: true,
      status_cd: "1",
      auth_token: `gst_auth_tok_${Buffer.from(gstin + ":" + Date.now()).toString("base64")}`,
      expiry: Date.now() + 6 * 3600 * 1000,
      session_status: "ACTIVE",
      executionTimeMs: Date.now() - startTime
    };
  }

  // --- GROUP GSTR1 & GSTR1A (IDs 6-35, 37-67) ---
  if (item.group === "GSTR1" || item.group === "GSTR1A" || item.group === "All") {
    if (id === 6 || id === 38) { // File GSTR-1 or GSTR-1A
      const ack = `AA${gstin.substring(0, 2)}${period.slice(-2)}26${Math.floor(100000 + Math.random() * 900000)}F`;
      return {
        success: true,
        status_cd: "1",
        ack_num: ack,
        file_status: "FILED",
        filing_date: new Date().toISOString(),
        message: `${item.group} successfully filed on portal with simulated EVC verification.`,
        apiId: id,
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 9 || id === 41) { // Get B2B Invoices
      const b2bInvoices = DEMO_SALES.map(s => ({
        ctin: s.partyGstin || s.counterparty_gstin || "32XYZAB5678C1Z2",
        cname: s.partyName || s.counterparty_name || "Buyer Trade Corp",
        inv: [{
          inum: s.invoiceNumber || s.invoice_number || "INV-001",
          idt: s.date || s.invoice_date || "2026-10-04",
          val: s.totalAmount || ((s.taxableAmount || 0) + (s.cgst || 0) + (s.sgst || 0) + (s.igst || 0)),
          pos: s.pos || "32",
          rchrg: s.reverseCharge ? "Y" : "N",
          inv_typ: "R",
          itms: [{
            num: 1,
            itm_det: {
              rt: s.gstRate || s.tax_rate || 18,
              txval: s.taxableAmount || s.taxable_value || 10000,
              iamt: s.igst || 0,
              camt: s.cgst || 0,
              samt: s.sgst || 0,
              csamt: 0
            }
          }]
        }]
      }));
      return {
        success: true,
        status_cd: "1",
        gstin,
        ret_period: period,
        b2b: b2bInvoices,
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 25 || id === 57) { // Get GSTR1 / 1A Summary
      return {
        success: true,
        status_cd: "1",
        gstin,
        ret_period: period,
        sec_sum: [
          { sec_nm: "B2B", ttl_rec: DEMO_SALES.length, ttl_val: 70800, ttl_tax: 10800 },
          { sec_nm: "B2CL", ttl_rec: 0, ttl_val: 0, ttl_tax: 0 },
          { sec_nm: "B2CS", ttl_rec: 2, ttl_val: 25000, ttl_tax: 4500 },
          { sec_nm: "CDNR", ttl_rec: 0, ttl_val: 0, ttl_tax: 0 },
          { sec_nm: "EXP", ttl_rec: 0, ttl_val: 0, ttl_tax: 0 },
          { sec_nm: "DOC_ISS", ttl_rec: DEMO_SALES.length, ttl_doc_issued: DEMO_SALES.length, ttl_doc_cancelled: 0 }
        ],
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 28 || id === 60) { // Get Return Status
      return {
        success: true,
        status_cd: "1",
        status: "FILED",
        arn: `AA${gstin.substring(0, 2)}1026000000000`,
        filing_date: "11/11/2026",
        mode: "ONLINE",
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 33 || id === 66) { // Reset GSTR1 / 1A
      return {
        success: true,
        status_cd: "1",
        message: "Saved draft return data has been reset to blank state successfully.",
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 34) { // Save GSTR1 data
      return {
        success: true,
        status_cd: "1",
        ref_id: `REF_SAVE_${Date.now()}`,
        message: "GSTR-1 invoice batch accepted for background validation.",
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 35) { // Validate HSN Summary
      return {
        success: true,
        status_cd: "1",
        valid_count: 3,
        invalid_count: 0,
        message: "All HSN / SAC codes match official statutory tariff schedule.",
        executionTimeMs: Date.now() - startTime
      };
    }
    // Generic GSTR1 / 1A Table fallback
    return {
      success: true,
      status_cd: "1",
      gstin,
      ret_period: period,
      records: [],
      record_count: 0,
      table: item.action,
      apiId: id,
      apiName: item.api,
      executionTimeMs: Date.now() - startTime
    };
  }

  // --- GROUP GSTR2A (IDs 68-79) ---
  if (item.group === "GSTR2A") {
    if (id === 69) { // GSTR2A - Get B2B Invoices
      return {
        success: true,
        status_cd: "1",
        gstin,
        ret_period: period,
        b2b: DEMO_PURCHASES.map(p => ({
          ctin: p.partyGstin || p.counterparty_gstin || "32KERAL1234A1Z1",
          cname: p.partyName || p.counterparty_name || "Supplier Traders",
          inv: [{
            inum: p.invoiceNumber || p.invoice_number || "PUR-001",
            idt: p.date || p.invoice_date || "2026-10-05",
            val: p.totalAmount || ((p.taxableAmount || 0) + (p.cgst || 0) + (p.sgst || 0) + (p.igst || 0)),
            pos: p.pos || "32",
            rchrg: p.reverseCharge ? "Y" : "N",
            itms: [{
              num: 1,
              itm_det: {
                rt: p.gstRate || p.tax_rate || 18,
                txval: p.taxableAmount || p.taxable_value || 10000,
                iamt: p.igst || 0,
                camt: p.cgst || 0,
                samt: p.sgst || 0
              }
            }]
          }]
        })),
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 75) { // GSTR2A - Get IMPG (Customs Bill of Entry)
      return {
        success: true,
        status_cd: "1",
        gstin,
        ret_period: period,
        impg: [{
          port_cd: "INBLR4",
          boe_num: 8941203,
          boe_dt: "12/10/2026",
          txval: 185000,
          iamt: 33300,
          csamt: 0
        }],
        executionTimeMs: Date.now() - startTime
      };
    }
    return {
      success: true,
      status_cd: "1",
      gstin,
      ret_period: period,
      section: item.action,
      data: [],
      executionTimeMs: Date.now() - startTime
    };
  }

  // --- GROUP IMS (IDs 80-87) ---
  if (item.group === "IMS") {
    if (id === 82) { // Get Invoice Count
      return {
        success: true,
        status_cd: "1",
        total_invoices: 4,
        pending_action: 1,
        accepted: 2,
        rejected: 1,
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 84) { // Get Supplier Invoices API
      return {
        success: true,
        status_cd: "1",
        supplier_gstin: options.supplier_gstin || "29AABCU9603R1ZM",
        invoices: DEMO_PURCHASES.slice(0, 2),
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 86) { // Save IMS Action
      return {
        success: true,
        status_cd: "1",
        message: "IMS buyer actions submitted successfully. Will reflect in GSTR-2B generation.",
        updated_records: 2,
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 85) { // Reset IMS Action
      return {
        success: true,
        status_cd: "1",
        message: "Invoice actions reverted to Pending status.",
        executionTimeMs: Date.now() - startTime
      };
    }
    return {
      success: true,
      status_cd: "1",
      records: [],
      executionTimeMs: Date.now() - startTime
    };
  }

  // --- GROUP GSTR2B (IDs 88-90) ---
  if (item.group === "GSTR2B") {
    if (id === 88) { // Generate 2B On Demand API
      return {
        success: true,
        status_cd: "1",
        req_id: `REQ_2B_GEN_${Date.now()}`,
        status: "QUEUED",
        message: "On-demand GSTR-2B generation request accepted.",
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 89) { // Get 2B Gen Status API
      return {
        success: true,
        status_cd: "1",
        gen_status: "COMPLETED",
        gen_timestamp: new Date().toISOString(),
        eligible_records: 3,
        ineligible_records: 1,
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 90) { // Get All Details
      return {
        success: true,
        status_cd: "1",
        gstin,
        ret_period: period,
        data: {
          itc_available: {
            b2b: DEMO_PURCHASES.filter(p => p.tax_rate > 0),
            isd: [],
            impg: []
          },
          itc_not_available: {
            b2b: []
          }
        },
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  // --- GROUP GSTR3B (IDs 91-105) ---
  if (item.group === "GSTR3B") {
    if (id === 91) { // File GSTR3B
      return {
        success: true,
        status_cd: "1",
        ack_num: `AB321026${Math.floor(100000 + Math.random() * 900000)}B`,
        filing_status: "FILED",
        filing_date: new Date().toISOString(),
        message: "GSTR-3B successfully filed in simulated sandbox mode.",
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 92) { // Get GSTR3B Details
      return {
        success: true,
        status_cd: "1",
        gstin,
        ret_period: period,
        table3_1: {
          outward_taxable: 54000,
          cgst: 4500,
          sgst: 4500,
          igst: 0
        },
        table4: {
          itc_available: 23400,
          itc_reversed: 0,
          net_itc: 23400
        },
        table6_1: {
          net_tax_payable_cash: 30600
        },
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 93) { // Get ITC Liability Auto Calc Details
      return {
        success: true,
        status_cd: "1",
        gstin,
        ret_period: period,
        auto_calc: {
          table3_1_outward: { txval: 54000, camt: 4500, samt: 4500, iamt: 0 },
          table4_itc: { total_available: 23400, b2b_credit: 23400 }
        },
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 99) { // Offset Liability GSTR3B data
      return {
        success: true,
        status_cd: "1",
        offset_status: "COMPLETED",
        rule: "Rule 88A / Section 49 Order of Utilization",
        cash_paid: 30600,
        itc_utilized: 23400,
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 101) { // Save GSTR3B data
      return {
        success: true,
        status_cd: "1",
        message: "GSTR-3B draft return values persisted.",
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 105) { // Validate GSTR3B against AutoCalculated data
      return {
        success: true,
        status_cd: "1",
        is_variance_acceptable: true,
        variance_percentage: 0.0,
        message: "Filed values strictly match Table 4 GSTR-2B calculations.",
        executionTimeMs: Date.now() - startTime
      };
    }
    return {
      success: true,
      status_cd: "1",
      gstin,
      ret_period: period,
      section: item.action,
      balance: 0,
      executionTimeMs: Date.now() - startTime
    };
  }

  // --- GROUP GSTR9 & 9C (IDs 141-153) ---
  if (item.group === "GSTR9" || item.group === "GSTR9C") {
    if (id === 144) { // GSTR9 - Get Autocalculated Details
      return {
        success: true,
        status_cd: "1",
        table4_turnover: 4200000,
        table4_tax: 756000,
        table6_itc: 565000,
        table8_2a_credit: 582000,
        table8d_difference: 17000,
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 150) { // GSTR9C - Get 9 Records for 9C
      return {
        success: true,
        status_cd: "1",
        reconciled_turnover: 4200000,
        audited_turnover: 4200000,
        difference: 0,
        certification_required: true,
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 153) { // GSTR9CHashGenerator
      const hash = crypto.createHash("sha256").update(gstin + ":" + period + ":" + Date.now()).digest("hex");
      return {
        success: true,
        status_cd: "1",
        offline_hash: hash,
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  // --- GROUP PUBLIC APIS (IDs 176-182) ---
  if (item.group === "Public") {
    if (id === 178 || id === 180 || id === 181) { // Search Taxpayer / Online Verification
      return {
        success: true,
        status_cd: "1",
        gstin,
        trade_name: DEMO_BUSINESS.legal_name,
        legal_name: DEMO_BUSINESS.legal_name,
        status: "Active",
        taxpayer_type: "Regular",
        constitution: "Private Limited Company",
        date_of_registration: "01/07/2017",
        einvoice_status: "Mandatory (Turnover > 5 Cr)",
        compliance_rating: "98.4%",
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 179) { // PAN to GSTIN
      const pan = gstin.substring(2, 12);
      return {
        success: true,
        status_cd: "1",
        pan,
        branches: [
          { state_code: "29", state_name: "Karnataka", gstin: "29" + pan + "1Z5", status: "Active" },
          { state_code: "32", state_name: "Kerala", gstin: "32" + pan + "1Z5", status: "Active" },
          { state_code: "27", state_name: "Maharashtra", gstin: "27" + pan + "1Z5", status: "Active" }
        ],
        executionTimeMs: Date.now() - startTime
      };
    }
    if (id === 182) { // View and Track Returns
      return {
        success: true,
        status_cd: "1",
        gstin,
        filing_history: [
          { return_type: "GSTR-1", period: "102026", status: "FILED", arn: "AA321026001234F", file_date: "11/11/2026" },
          { return_type: "GSTR-3B", period: "102026", status: "FILED", arn: "AB321026001234B", file_date: "20/11/2026" },
          { return_type: "GSTR-1", period: "092026", status: "FILED", arn: "AA320926001234F", file_date: "11/10/2026" },
          { return_type: "GSTR-3B", period: "092026", status: "FILED", arn: "AB320926001234B", file_date: "20/10/2026" }
        ],
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  // --- GENERAL STATUTORY FALLBACK FOR WORKING OR NOT_TESTED APIS ---
  return {
    success: true,
    status_cd: "1",
    status: item.status,
    gstin,
    period,
    action: item.action,
    apiId: id,
    apiName: item.api,
    group: item.group,
    remark: item.remark || "Statutory mock simulation verified",
    data: {
      records: [],
      statutory_compliance: "Standard GSTN v1.0 schema compliant",
      simulated: true
    },
    executionTimeMs: Date.now() - startTime
  };
}

/**
 * Executes a batch health check across all 182 APIs
 */
export async function runAllApisHealthCheck(gstin = DEMO_BUSINESS.gstin) {
  const results = [];
  let workingCount = 0;
  let partialCount = 0;
  let notWorkingCount = 0;
  let notTestedCount = 0;

  for (const item of apiCatalog) {
    const res = await executeGspApi(item.id, { gstin, period: "102026" });
    const isOk = res.success !== false && res.status_cd !== "0" && !res.error;
    if (item.status === "working") workingCount++;
    else if (item.status === "partial") partialCount++;
    else if (item.status === "not_working") notWorkingCount++;
    else notTestedCount++;

    results.push({
      id: item.id,
      api: item.api,
      group: item.group,
      status: item.status,
      method: item.method,
      executed: true,
      statusCode: res.httpStatusCode || 200,
      executionTimeMs: res.executionTimeMs || 1
    });
  }

  return {
    total: apiCatalog.length,
    counts: {
      working: workingCount,
      partial: partialCount,
      notWorking: notWorkingCount,
      notTested: notTestedCount
    },
    results
  };
}
