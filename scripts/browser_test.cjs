const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBrowserTest() {
  console.log("=== SimpleGST Real Browser-Level Verification via Headless Chrome CDP ===");

  // 1. Start Server on port 3888
  const PORT = 3888;
  const serverModule = await import("../server.js");
  const createServer = serverModule.default.createServer;
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`[Test Server] SimpleGST running at http://127.0.0.1:${PORT}`);
      resolve();
    });
  });

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome executable not found at: ${chromePath}`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "simplegst-cdp-"));
  const cdpPort = 9222;

  console.log(`[Chrome] Launching headless Chrome on CDP port ${cdpPort}...`);
  const chromeProcess = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-sandbox",
    "--disable-extensions",
    `http://127.0.0.1:${PORT}`
  ]);

  chromeProcess.on("error", (err) => console.error("[Chrome Error]:", err));

  let wsUrl = null;
  for (let attempt = 1; attempt <= 30; attempt++) {
    await sleep(500);
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        const pageTarget = targets.find((t) => t.type === "page");
        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          wsUrl = pageTarget.webSocketDebuggerUrl;
          console.log(`[CDP] Connected to target page: ${wsUrl}`);
          break;
        }
      }
    } catch (e) {}
  }

  if (!wsUrl) {
    chromeProcess.kill();
    server.close();
    throw new Error("Failed to connect to Chrome CDP WebSocket after 15 seconds.");
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let messageId = 1;
  const pendingRequests = new Map();
  const consoleLogs = [];
  const networkErrors = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve, reject } = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a) => (a.value !== undefined ? a.value : a.description)).join(" ");
      console.log(`[Browser Console ${msg.params.type}] ${text}`);
      consoleLogs.push(`[Browser Console ${msg.params.type}] ${text}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      console.error(`[Browser Exception]`, msg.params.exceptionDetails);
    } else if (msg.method === "Network.responseReceived") {
      const status = msg.params.response.status;
      const url = msg.params.response.url;
      if (status >= 400) {
        networkErrors.push({ url, status, statusText: msg.params.response.statusText });
      }
    }
  };

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = messageId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await sendCommand("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result?.value;
  }

  try {
    await sendCommand("Page.enable");
    await sendCommand("Runtime.enable");
    await sendCommand("Network.enable");

    console.log("[CDP] Waiting for page scripts & app.js to load...");
    let appJsReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const isReady = await evaluate("typeof window.initSessionFromBackend === 'function'");
        if (isReady) {
          appJsReady = true;
          break;
        }
      } catch (e) {}
      await sleep(500);
    }
    console.log(`[CDP] app.js loaded and ready: ${appJsReady}`);

    // Step 1: Verify Initial Page Load
    const title = await evaluate("document.title");
    console.log(`✔ Page Title: "${title}"`);

    // Step 2: Authenticate in browser via POST /api/auth/login and initialize session
    console.log("\n[Step 2] Authenticating as rajesh.sharma@apexretail.com...");
    const loginResult = await evaluate(`
      (async () => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: 'rajesh.sharma@apexretail.com', password: 'ApexAdmin@2026' })
        });
        const data = await res.json();
        if (data.success) {
          await window.initSessionFromBackend();
        }
        return {
          ok: res.ok,
          status: res.status,
          user: appState?.auth?.user?.name,
          activeGstin: appState?.activeGstin?.gstin,
          activeState: appState?.activeGstin?.state_code,
          csrfToken: !!appState?.csrfToken
        };
      })()
    `);
    console.log("✔ Login & Session Init:", loginResult);
    if (!loginResult.ok || !loginResult.csrfToken) {
      throw new Error(`Login failed or CSRF token missing: ${JSON.stringify(loginResult)}`);
    }

    // Step 3: Open New Sales Invoice Modal and verify POS & Tax calculation
    console.log("\n[Step 3] Testing Sales Invoice Modal & POS Tax Calculation...");
    await evaluate(`window.openNewInvoiceModal()`);
    await sleep(500);

    const posOptionsCount = await evaluate(`document.querySelectorAll('#newInvPos option').length`);
    console.log(`✔ POS Dropdown options available: ${posOptionsCount}`);
    if (posOptionsCount < 20) {
      throw new Error(`Expected at least 20 Place of Supply options, found: ${posOptionsCount}`);
    }

    // Enter Sales Invoice with inter-state POS (24-Gujarat for MH 27 business)
    const uniqueInvNum = "INV-REAL-" + Math.floor(Math.random() * 89999 + 10000);
    const posTaxCheck = await evaluate(`
      (() => {
        document.getElementById('newInvNumber').value = '${uniqueInvNum}';
        document.getElementById('newInvDate').value = '2026-10-15';
        document.getElementById('newInvCustomerName').value = 'Gujarat Polymer Ltd';
        document.getElementById('newInvCustomerGstin').value = '24AAACP9999P1Z1';
        
        // Explicitly set Place of Supply to 24 (Gujarat)
        const posEl = document.getElementById('newInvPos');
        posEl.value = '24';
        posEl.dataset.userModified = 'true';
        
        document.getElementById('newInvTaxable').value = '100000';
        document.getElementById('newInvGstRate').value = '18';
        
        // Recalculate
        window.calculateNewInvoiceTax();
        
        return {
          pos: posEl.value,
          cgstText: document.getElementById('newInvCgstAmount')?.innerText,
          sgstText: document.getElementById('newInvSgstAmount')?.innerText,
          igstText: document.getElementById('newInvIgstAmount')?.innerText,
          totalText: document.getElementById('newInvTotalAmount')?.innerText,
          supplyType: document.getElementById('newInvSupplyType')?.innerText
        };
      })()
    `);
    console.log("✔ POS Tax Calculation Result (Inter-state delivery to Gujarat):", posTaxCheck);
    if (!posTaxCheck.igstText.includes("18,000") || !posTaxCheck.cgstText.includes("0.00")) {
      throw new Error(`Inter-state POS failed: Expected IGST ₹18,000, CGST ₹0, got: ${JSON.stringify(posTaxCheck)}`);
    }

    // Step 4: Persist Sales Invoice via submitNewInvoice()
    console.log(`\n[Step 4] Submitting Sales Invoice ${uniqueInvNum} via API...`);
    await evaluate(`
      (async () => {
        await window.submitNewInvoice();
      })()
    `);
    await sleep(1000);

    // Step 5: Test Browser Refresh Persistence & Sales Register
    console.log("\n[Step 5] Refreshing page to verify database persistence...");
    await sendCommand("Page.reload");
    await sleep(2500);

    // Re-verify session is preserved via cookie on reload
    const sessionAfterReload = await evaluate(`
      (async () => {
        await window.initSessionFromBackend();
        return {
          authenticated: !!appState?.activeGstin,
          gstin: appState?.activeGstin?.gstin
        };
      })()
    `);
    console.log("✔ Session restored after browser reload:", sessionAfterReload);

    // Navigate to Sales View
    console.log("[Step 5b] Navigating to Sales Suite and verifying invoice in DOM table...");
    await evaluate(`
      (async () => {
        window.switchSuite('sales');
        if (typeof window.renderSalesSuite === 'function') {
          await window.renderSalesSuite();
        }
      })()
    `);
    await sleep(1000);

    const salesFoundInDom = await evaluate(`
      (() => {
        const table = document.getElementById('salesTableBody');
        const text = table ? table.innerText : '';
        return {
          found: text.includes('${uniqueInvNum}'),
          tableSnippet: text.split('\\n').slice(0, 5).join(' | ')
        };
      })()
    `);
    console.log(`✔ Sales Invoice persisted and rendered in table:`, salesFoundInDom);
    if (!salesFoundInDom.found) {
      throw new Error(`Saved sales invoice ${uniqueInvNum} not found in DOM after browser reload!`);
    }

    // Step 6: Test Purchase Bill Creation with Explicit POS & ITC Eligibility
    console.log("\n[Step 6] Testing Purchase Bill Modal, POS, and ITC Eligibility...");
    await evaluate(`window.openNewPurchaseModal()`);
    await sleep(500);

    const purPosOptionsCount = await evaluate(`document.querySelectorAll('#newPurPos option').length`);
    const itcOptionsCount = await evaluate(`document.querySelectorAll('#newPurItcEligibility option').length`);
    console.log(`✔ Purchase POS options: ${purPosOptionsCount}, ITC Eligibility options: ${itcOptionsCount}`);

    const uniqueBillNum = "BILL-REAL-" + Math.floor(Math.random() * 89999 + 10000);
    const purTaxCheck = await evaluate(`
      (() => {
        document.getElementById('newPurNumber').value = '${uniqueBillNum}';
        document.getElementById('newPurDate').value = '2026-10-16';
        document.getElementById('newPurSupplierName').value = 'Karnataka Tech Components';
        document.getElementById('newPurSupplierGstin').value = '29AAACK7777K1Z3';
        
        const posEl = document.getElementById('newPurPos');
        posEl.value = '29';
        posEl.dataset.userModified = 'true';
        
        const itcEl = document.getElementById('newPurItcEligibility');
        itcEl.value = 'INELIGIBLE_17_5';
        
        document.getElementById('newPurTaxable').value = '50000';
        document.getElementById('newPurGstRate').value = '18';
        
        window.calculateNewPurchaseTax();
        
        return {
          pos: posEl.value,
          itc: itcEl.value,
          supplyType: document.getElementById('newPurSupplyType')?.innerText,
          taxText: document.getElementById('newPurTaxAmount')?.innerText,
          totalText: document.getElementById('newPurTotalAmount')?.innerText
        };
      })()
    `);
    console.log("✔ Purchase POS Tax Calculation Result (Inter-state delivery to Karnataka):", purTaxCheck);
    if (!purTaxCheck.taxText.includes("9,000") || !purTaxCheck.supplyType.includes("Inter-State")) {
      throw new Error(`Inter-state purchase POS failed: Expected IGST ₹9,000, got: ${JSON.stringify(purTaxCheck)}`);
    }

    // Step 7: Persist Purchase Bill via submitNewPurchase()
    console.log(`\n[Step 7] Submitting Purchase Bill ${uniqueBillNum} via API...`);
    await evaluate(`
      (async () => {
        await window.submitNewPurchase();
      })()
    `);
    await sleep(1000);

    // Step 8: Test Browser Refresh Persistence & Purchase Register
    console.log("\n[Step 8] Refreshing page to verify purchase persistence...");
    await sendCommand("Page.reload");
    await sleep(2500);

    await evaluate(`
      (async () => {
        await window.initSessionFromBackend();
        window.switchSuite('purchase');
        if (typeof window.renderPurchaseSuite === 'function') {
          await window.renderPurchaseSuite();
        }
      })()
    `);
    await sleep(1000);

    const purchaseFoundInDom = await evaluate(`
      (() => {
        const table = document.getElementById('purchaseTableBody');
        const text = table ? table.innerText : '';
        return {
          found: text.includes('${uniqueBillNum}'),
          tableSnippet: text.split('\\n').slice(0, 5).join(' | ')
        };
      })()
    `);
    console.log(`✔ Purchase Bill persisted and rendered in table:`, purchaseFoundInDom);
    if (!purchaseFoundInDom.found) {
      throw new Error(`Saved purchase bill ${uniqueBillNum} not found in DOM after browser reload!`);
    }

    // Step 9: View switching stress check
    console.log("\n[Step 9] Switching between Sales and Purchase views...");
    await evaluate(`
      (() => {
        window.switchSuite('sales');
        window.switchSuite('purchase');
        window.switchSuite('sales');
      })()
    `);
    await sleep(500);
    console.log("✔ View switching completed smoothly.");

    // Step 10: Check for any 403 CSRF rejections or unhandled network errors
    console.log("\n[Step 10] Checking network and console health...");
    const csrfFailures = networkErrors.filter((e) => e.status === 403);
    console.log(`✔ CSRF 403 Failures: ${csrfFailures.length}`);
    if (csrfFailures.length > 0) {
      throw new Error(`Encountered 403 CSRF failure during browser session: ${JSON.stringify(csrfFailures)}`);
    }

    // Step 11: Test PDF OCR Review Modal, Line Items Editing, and Database Save
    console.log("\n[Step 11] Testing PDF OCR Review Modal, multi-line item editing and save...");
    const ocrInvNo = "INV-OCR-" + Math.floor(Math.random() * 89999 + 10000);
    const modalCheck = await evaluate(`
      (async () => {
        const sampleExtraction = {
          documentId: "doc-test-cdp-01",
          documentType: "sales_invoice",
          confidenceScore: 0.94,
          isScanned: false,
          warnings: [],
          invoiceInfo: {
            invoiceNumber: "${ocrInvNo}",
            invoiceDate: "2026-10-25",
            dueDate: "2026-11-25",
            pos: "27",
            posStateName: "Maharashtra",
            isInterstate: false,
            isRcm: false,
            period: "102026",
            supplyType: "INTRA_STATE"
          },
          seller: {
            name: "Apex Retail Private Limited",
            gstin: "27AABCU9603R1ZX",
            state: "27"
          },
          buyer: {
            name: "Alpha Logistics Corp",
            gstin: "27AABCA1234F1Z9",
            state: "27"
          },
          lineItems: [
            {
              id: "item-1",
              description: "High Performance Cloud Server",
              hsn: "998315",
              quantity: 2,
              unit: "NOS",
              rate: 25000,
              discount: 0,
              taxableAmount: 50000,
              gstRate: 18,
              cgst: 4500,
              sgst: 4500,
              igst: 0,
              taxAmount: 9000,
              totalAmount: 59000
            }
          ],
          totals: {
            taxableAmount: 50000,
            gstRate: 18,
            cgst: 4500,
            sgst: 4500,
            igst: 0,
            cess: 0,
            roundOff: 0,
            totalTax: 9000,
            totalAmount: 59000
          }
        };

        window.openOcrReviewModal(sampleExtraction);
        await new Promise(r => setTimeout(r, 200));

        // Add a second line item
        window.addOcrLineItem();
        
        // Populate newly added item (index 1)
        window.updateOcrLineItem(1, 'description', "Maintenance & Support SLA");
        window.updateOcrLineItem(1, 'hsnCode', "998316");
        window.updateOcrLineItem(1, 'quantity', 1);
        window.updateOcrLineItem(1, 'rate', 10000);
        window.updateOcrLineItem(1, 'gstRate', 18);

        window.recalculateOcrTotals();

        const invNoVal = document.getElementById('ocrReviewInvoiceNumber')?.value;
        const buyerVal = document.getElementById('ocrReviewBuyerName')?.value;
        const taxableVal = parseFloat(document.getElementById('ocrReviewTaxable')?.value) || 0;
        const totalVal = parseFloat(document.getElementById('ocrReviewGrandTotal')?.value) || 0;
        const rowsCount = document.querySelectorAll('#ocrReviewLineItemsTbody tr').length;

        // Now trigger save
        await window.saveExtractedInvoice();

        return {
          invNoVal,
          buyerVal,
          taxableVal,
          totalVal,
          rowsCount
        };
      })()
    `);
    console.log("✔ OCR Review Modal & Line Item Recalculation Result:", modalCheck);
    if (modalCheck.rowsCount !== 2 || modalCheck.taxableVal !== 60000 || modalCheck.totalVal !== 70800) {
      throw new Error(`OCR Line item calculation mismatch: expected 2 rows, 60000 taxable, 70800 total, got: ${JSON.stringify(modalCheck)}`);
    }

    await sleep(1000);

    // Verify persisted in DOM sales register
    const ocrSavedFoundInDom = await evaluate(`
      (() => {
        const table = document.getElementById('salesTableBody');
        const text = table ? table.innerText : '';
        return {
          found: text.includes('${ocrInvNo}'),
          tableSnippet: text.split('\\n').slice(0, 5).join(' | ')
        };
      })()
    `);
    console.log("✔ OCR Extracted & Edited Invoice persisted into Sales Register DOM:", ocrSavedFoundInDom);
    if (!ocrSavedFoundInDom.found) {
      throw new Error(`OCR Invoice ${ocrInvNo} not found in Sales Register after save!`);
    }

    // Step 12: Test Bills & Docs Dashboard, Category Filtering & Preview Modal
    console.log("\n[Step 12] Testing Bills & Docs Dashboard, category filters & document preview...");
    const billsCheck = await evaluate(`
      (async () => {
        window.switchSuite('bills');
        await new Promise(r => setTimeout(r, 400));

        const totalDocsText = document.getElementById('statBillsTotal')?.innerText || "0";
        const salesDocsText = document.getElementById('statBillsSales')?.innerText || "0";
        const purDocsText = document.getElementById('statBillsPurchases')?.innerText || "0";
        const rowsCount = document.querySelectorAll('#billsDocsTableBody tr').length;

        // Filter category to sales_invoice
        window.filterBillsCategory('sales_invoice');
        await new Promise(r => setTimeout(r, 300));
        const salesFilterRows = document.querySelectorAll('#billsDocsTableBody tr').length;

        // Reset filter
        window.filterBillsCategory('');
        await new Promise(r => setTimeout(r, 300));

        // Open Document Preview Modal
        window.openDocumentPreviewModal('doc-test-cdp-01', 'Cloud_Server_Invoice.pdf');
        await new Promise(r => setTimeout(r, 200));

        const previewModal = document.getElementById('modalDocumentPreview');
        const isPreviewVisible = previewModal && !previewModal.classList.contains('hidden');
        const previewTitle = document.getElementById('docPreviewTitle')?.innerText;

        // Close Preview Modal
        window.closeDocumentPreviewModal();

        return {
          totalDocsText,
          salesDocsText,
          purDocsText,
          rowsCount,
          salesFilterRows,
          isPreviewVisible,
          previewTitle
        };
      })()
    `);
    console.log("✔ Bills & Docs Dashboard DOM verification:", billsCheck);
    if (!billsCheck.isPreviewVisible || billsCheck.previewTitle !== 'Cloud_Server_Invoice.pdf') {
      throw new Error(`Document Preview modal failed to render: ${JSON.stringify(billsCheck)}`);
    }

    console.log(`✔ Console log messages captured: ${consoleLogs.length}`);
    console.log("\n=======================================================");
    console.log("ALL REAL BROWSER CDP CHECKS PASSED WITH 100% SUCCESS!");
    console.log("=======================================================");

  } finally {
    ws.close();
    chromeProcess.kill();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

runBrowserTest().catch((err) => {
  console.error("FATAL BROWSER TEST ERROR:", err);
  process.exit(1);
});
