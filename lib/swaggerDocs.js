/**
 * SimpleGST Backend OpenAPI 3.0 Specification and Swagger UI Generator
 */

export function getOpenApiSpec(host = "localhost:3000") {
  return {
    openapi: "3.0.3",
    info: {
      title: "SimpleGST Platform Functional Backend API",
      version: "2.0.0",
      description: "Interactive API documentation for SimpleGST — Multi-GSTIN, Sales & Purchase Registers, AI OCR Invoice Extraction, GSTR Reconciliation, Rule 88A Tax Calculation, and Public GSTIN Scraper.",
      contact: {
        name: "SimpleGST Team",
        url: "http://localhost:3000"
      }
    },
    servers: [
      {
        url: `http://${host}`,
        description: "Local Development Server"
      }
    ],
    tags: [
      { name: "Public Scraper & Taxpayer Lookup", description: "Real-time GSTIN lookup, PAN-to-GSTIN search & filing history" },
      { name: "Authentication & Context", description: "Session management, active entity switching, and statutory period control" },
      { name: "Sales Invoices", description: "Outward supplies, B2B/B2C classification, and GSTR-1 persistence" },
      { name: "Purchase Bills", description: "Inward supplies, ITC eligibility, RCM, and 180-day Rule 37 tracking" },
      { name: "Bills & Documents", description: "Document vault, binary storage, and AI OCR review & approval" },
      { name: "Tax Calculation & Reconciliation", description: "Rule 88A tax offset, GSTR-2B reconciliation, and live dashboard" },
      { name: "Electronic Ledgers", description: "Cash (PMT-05), PMT-06 challans, and PMT-09 head transfers" },
      { name: "GSP 182 APIs", description: "Universal GSTN statutory API dispatcher and health check" },
      { name: "Exports & Reports", description: "Download returns and ledgers in Excel or CSV format" }
    ],
    paths: {
      "/api/gstin/lookup": {
        get: {
          tags: ["Public Scraper & Taxpayer Lookup"],
          summary: "Lookup GSTIN details, taxpayer status & linked branches",
          description: "Scrapes and queries taxpayer registration details, business constitution, filing records, and all state branches under the PAN.",
          parameters: [
            {
              name: "gstin",
              in: "query",
              required: false,
              schema: { type: "string", example: "27AAACA1234A1Z5" },
              description: "15-digit GSTIN to query"
            },
            {
              name: "pan",
              in: "query",
              required: false,
              schema: { type: "string", example: "AAACA1234A" },
              description: "10-digit PAN to discover linked state GSTIN branches"
            }
          ],
          responses: {
            "200": {
              description: "Taxpayer profile and linked branches found",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      gstin: { type: "string" },
                      pan: { type: "string" },
                      taxpayer: {
                        type: "object",
                        properties: {
                          legalName: { type: "string" },
                          tradeName: { type: "string" },
                          status: { type: "string" },
                          taxpayerType: { type: "string" },
                          constitution: { type: "string" },
                          complianceRating: { type: "string" }
                        }
                      },
                      branches: {
                        type: "array",
                        items: { type: "object" }
                      },
                      filingHistory: {
                        type: "array",
                        items: { type: "object" }
                      }
                    }
                  }
                }
              }
            },
            "400": { description: "Missing required gstin or pan parameter" }
          }
        }
      },
      "/api/auth/dev-session": {
        post: {
          tags: ["Authentication & Context"],
          summary: "Create development session (Demo / Local Mode)",
          description: "Creates an active development tenant session with session token and CSRF cookie.",
          responses: {
            "200": {
              description: "Session successfully established",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      sessionToken: { type: "string" },
                      csrfToken: { type: "string" },
                      activeGstin: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/auth/session": {
        get: {
          tags: ["Authentication & Context"],
          summary: "Get current session context",
          description: "Returns the authenticated user, current organization, and active GSTIN branch.",
          responses: {
            "200": { description: "Session state returned" }
          }
        }
      },
      "/api/context/period": {
        get: {
          tags: ["Authentication & Context"],
          summary: "Get active statutory filing period",
          responses: {
            "200": {
              description: "Active return filing period details",
              content: {
                "application/json": {
                  example: { activePeriod: "102026", details: { full: "October 2026", gstr1Deadline: "November 11, 2026", gstr3bDeadline: "November 20, 2026" } }
                }
              }
            }
          }
        },
        post: {
          tags: ["Authentication & Context"],
          summary: "Switch active filing period",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    period: { type: "string", example: "112026" }
                  },
                  required: ["period"]
                }
              }
            }
          },
          responses: {
            "200": { description: "Period updated successfully" }
          }
        }
      },
      "/api/sales": {
        get: {
          tags: ["Sales Invoices"],
          summary: "List outward sales invoices",
          parameters: [
            { name: "period", in: "query", schema: { type: "string", example: "102026" } }
          ],
          responses: {
            "200": { description: "List of sales invoices from SQLite" }
          }
        },
        post: {
          tags: ["Sales Invoices"],
          summary: "Create and persist new sales invoice",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["invoiceNumber", "invoiceDate", "customerName", "taxableAmount", "gstRate"],
                  properties: {
                    invoiceNumber: { type: "string", example: "INV-2026-001" },
                    invoiceDate: { type: "string", example: "2026-11-06" },
                    customerName: { type: "string", example: "Zenith Enterprises" },
                    customerGstin: { type: "string", example: "27AAACB2222F1Z5" },
                    pos: { type: "string", example: "27" },
                    taxableAmount: { type: "number", example: 10000 },
                    gstRate: { type: "number", example: 18 },
                    supplyType: { type: "string", enum: ["B2B", "B2CS", "B2CL", "EXPORT_WPAY", "EXPORT_WOPAY"], example: "B2B" }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Invoice saved in SQLite database" },
            "400": { description: "Validation error" }
          }
        }
      },
      "/api/purchases": {
        get: {
          tags: ["Purchase Bills"],
          summary: "List inward purchase bills",
          parameters: [
            { name: "period", in: "query", schema: { type: "string", example: "102026" } }
          ],
          responses: {
            "200": { description: "List of purchase bills from SQLite" }
          }
        },
        post: {
          tags: ["Purchase Bills"],
          summary: "Record inward purchase bill",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["invoiceNumber", "invoiceDate", "supplierName", "taxableAmount", "gstRate"],
                  properties: {
                    invoiceNumber: { type: "string", example: "PUR-2026-99" },
                    invoiceDate: { type: "string", example: "2026-11-06" },
                    supplierName: { type: "string", example: "Tata Consultancy Services" },
                    supplierGstin: { type: "string", example: "27AAACT2727Q1ZW" },
                    pos: { type: "string", example: "27" },
                    taxableAmount: { type: "number", example: 50000 },
                    gstRate: { type: "number", example: 18 },
                    itcEligibility: { type: "string", enum: ["ELIGIBLE", "INELIGIBLE_17_5", "INELIGIBLE_OTHER"], example: "ELIGIBLE" },
                    isRcm: { type: "boolean", example: false }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Purchase bill saved in SQLite database" }
          }
        }
      },
      "/api/documents": {
        get: {
          tags: ["Bills & Documents"],
          summary: "List uploaded documents in vault",
          responses: {
            "200": { description: "Indexed document list" }
          }
        }
      },
      "/api/documents/upload": {
        post: {
          tags: ["Bills & Documents"],
          summary: "Upload invoice PDF/image with AI OCR extraction",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary" },
                    category: { type: "string", enum: ["sales_invoice", "purchase_bill"], example: "sales_invoice" }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Document stored on disk and parsed via OCR" }
          }
        }
      },
      "/api/ocr/approve": {
        post: {
          tags: ["Bills & Documents"],
          summary: "Approve extracted OCR document into Sales/Purchase register",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["invoiceType", "fields"],
                  properties: {
                    documentId: { type: "string" },
                    invoiceType: { type: "string", enum: ["sales_invoice", "purchase_bill"] },
                    fields: {
                      type: "object",
                      required: ["invoiceNumber", "invoiceDate", "taxableAmount"],
                      properties: {
                        invoiceNumber: { type: "string", example: "ABC/2026-27/001" },
                        invoiceDate: { type: "string", example: "2026-11-06" },
                        customerName: { type: "string" },
                        supplierName: { type: "string" },
                        taxableAmount: { type: "number", example: 22000 },
                        gstRate: { type: "number", example: 18 }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Approved and saved directly into register" }
          }
        }
      },
      "/api/dashboard": {
        get: {
          tags: ["Tax Calculation & Reconciliation"],
          summary: "Get return filing dashboard summary",
          parameters: [
            { name: "period", in: "query", schema: { type: "string", example: "102026" } }
          ],
          responses: {
            "200": { description: "Live return metrics and tax liability summary" }
          }
        }
      },
      "/api/reconciliation": {
        get: {
          tags: ["Tax Calculation & Reconciliation"],
          summary: "Run GSTR-2B vs Books automated ITC reconciliation",
          parameters: [
            { name: "period", in: "query", schema: { type: "string", example: "102026" } }
          ],
          responses: {
            "200": { description: "Matched, unmatched, and at-risk ITC breakdown" }
          }
        }
      },
      "/api/tax-calculation": {
        get: {
          tags: ["Tax Calculation & Reconciliation"],
          summary: "Compute statutory Rule 88A tax liability & net cash payable",
          parameters: [
            { name: "period", in: "query", schema: { type: "string", example: "102026" } }
          ],
          responses: {
            "200": { description: "Rule 88A credit offset and net cash payable" }
          }
        }
      },
      "/api/ledgers": {
        get: {
          tags: ["Electronic Ledgers"],
          summary: "Get Electronic Cash (PMT-05) & Credit Ledgers",
          responses: {
            "200": { description: "Live ledger balances by major and minor heads" }
          }
        }
      },
      "/api/gsp/apis": {
        get: {
          tags: ["GSP 182 APIs"],
          summary: "List all 182 statutory GST portal APIs",
          responses: {
            "200": { description: "Catalog of 182 GSTN APIs" }
          }
        }
      },
      "/api/gsp/invoke": {
        post: {
          tags: ["GSP 182 APIs"],
          summary: "Execute statutory GST API by ID",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id", "gstin"],
                  properties: {
                    id: { type: "integer", example: 180, description: "API ID (1-182)" },
                    gstin: { type: "string", example: "27AAACA1234A1Z5" },
                    period: { type: "string", example: "102026" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "GSP response payload" }
          }
        }
      },
      "/api/export/{report}": {
        get: {
          tags: ["Exports & Reports"],
          summary: "Export GST report to Excel or CSV",
          parameters: [
            { name: "report", in: "path", required: true, schema: { type: "string", enum: ["gstr1", "gstr3b", "sales", "purchase"] } },
            { name: "format", in: "query", schema: { type: "string", enum: ["excel", "csv"], default: "excel" } },
            { name: "period", in: "query", schema: { type: "string", example: "102026" } }
          ],
          responses: {
            "200": { description: "Binary Excel spreadsheet or CSV document" }
          }
        }
      }
    }
  };
}

export function getSwaggerHtml(specUrl = "/api/openapi.json") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SimpleGST Backend API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230d5f4e'><path d='M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14h-2v-4H8v-2h2V9h2v2h2v2h-2v4z'/></svg>" />
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .topbar { display: none !important; }
    .simplegst-header {
      background: #0d5f4e;
      color: #ffffff;
      padding: 14px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .simplegst-header .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .simplegst-header .brand-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .simplegst-header .brand-badge {
      background: rgba(255,255,255,0.2);
      color: #e6fffa;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .simplegst-header .nav-links {
      display: flex;
      gap: 18px;
      align-items: center;
    }
    .simplegst-header a {
      color: #a7f3d0;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: color 0.15s ease;
    }
    .simplegst-header a:hover {
      color: #ffffff;
      text-decoration: underline;
    }
    .swagger-ui .info {
      margin: 28px 0 20px 0;
    }
    .swagger-ui .info .title {
      color: #0d5f4e;
      font-weight: 700;
    }
    .swagger-ui .scheme-container {
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      border-radius: 8px;
      margin-bottom: 20px;
      padding: 15px 20px;
    }
    .swagger-ui .opblock.opblock-post {
      border-color: #0d5f4e;
      background: rgba(13, 95, 78, 0.04);
    }
    .swagger-ui .opblock.opblock-post .opblock-summary-method {
      background: #0d5f4e;
    }
    .swagger-ui .btn.execute {
      background-color: #0d5f4e;
      border-color: #0d5f4e;
    }
    .swagger-ui .btn.execute:hover {
      background-color: #094337;
    }
  </style>
</head>
<body>
  <div class="simplegst-header">
    <div class="brand">
      <span class="brand-title">SimpleGST</span>
      <span class="brand-badge">OpenAPI 3.0 • Swagger UI</span>
    </div>
    <div class="nav-links">
      <a href="/" target="_blank">← Open Web App UI</a>
      <a href="/api" target="_blank">API Catalog JSON</a>
      <a href="/api/openapi.json" target="_blank">OpenAPI Spec (JSON)</a>
    </div>
  </div>

  <div id="swagger-ui"></div>

  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        docExpansion: "list"
      });
    };
  </script>
</body>
</html>`;
}
