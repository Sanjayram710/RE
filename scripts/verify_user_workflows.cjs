const http = require("http");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCompleteUserVerification() {
  console.log("===============================================================================");
  console.log("SimpleGST — Real User-Interface End-to-End Verification (Sales, Purchase, Docs)");
  console.log("===============================================================================");

  const PORT = 3890;
  const serverModule = await import("../server.js");
  const createServer = serverModule.default.createServer;
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`[Test Server] Running at http://127.0.0.1:${PORT}`);
      resolve();
    });
  });

  const { db } = await import("../lib/db.js");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "simplegst-user-verify-"));
  const cdpPort = 9224;

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
          console.log(`[CDP] Connected to Chrome page target`);
          break;
        }
      }
    } catch (e) {}
  }

  if (!wsUrl) throw new Error("Could not connect to Chrome CDP");

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const callbacks = new Map();
  const networkRequests = [];
  const networkResponses = [];

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const cb = callbacks.get(data.id);
      callbacks.delete(data.id);
      cb(data);
    }
    if (data.method === "Network.requestWillBeSent") {
      networkRequests.push(data.params);
    }
    if (data.method === "Network.responseReceived") {
      networkResponses.push(data.params);
    }
  };

  function sendCommand(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await sendCommand("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.result && res.result.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.result.exceptionDetails)}`);
    }
    return res.result && res.result.result ? res.result.result.value : null;
  }

  await sendCommand("Network.enable");
  await sendCommand("Page.enable");
  await sleep(2000);

  const timestamp = Date.now().toString().slice(-5);
  const salesInvNumber = `INV-UI-SALES-${timestamp}`;
  const purchaseBillNumber = `BILL-UI-PUR-${timestamp}`;
  const pdfFilename = `Audit_Report_${timestamp}.pdf`;
  const pngFilename = `Receipt_Scan_${timestamp}.png`;

  try {
    // -------------------------------------------------------------------------
    // STEP 0: Verify Initial Unauthenticated State & Perform Form Sign In
    // -------------------------------------------------------------------------
    console.log(`\n[STEP 0] Verifying initial unauthenticated state and performing explicit UI sign-in...`);
    const authCheck = await evaluate(`
      (async () => {
        const initialLogged = !!(appState && appState.auth && appState.auth.isLoggedIn);
        const modalOpen = !document.getElementById('modalAuth')?.classList.contains('hidden');
        
        // Enter credentials into signin form explicitly
        document.getElementById('loginIdentifier').value = 'rajesh.sharma@apexretail.com';
        document.getElementById('loginPassword').value = 'ApexAdmin@2026';
        await window.handleSignInSubmit({ preventDefault: () => {} });
        await new Promise(r => setTimeout(r, 600));

        return {
          initialLogged,
          modalOpen,
          afterLogged: !!(appState && appState.auth && appState.auth.isLoggedIn),
          user: appState?.auth?.user?.name,
          activeGstin: appState?.activeGstin?.gstin,
          csrf: !!appState?.csrfToken
        };
      })()
    `);
    console.log("✔ Auth state transition:", authCheck);
    assert.strictEqual(authCheck.initialLogged, false, "Initial browser state must be unauthenticated");
    assert.strictEqual(authCheck.afterLogged, true, "Explicit sign-in must authenticate user");
    assert.strictEqual(authCheck.activeGstin, "27AAACA1234A1Z5", "Authenticated GSTIN must be restored");

    // -------------------------------------------------------------------------
    // STEP 1: Sales Invoice Creation via UI
    // -------------------------------------------------------------------------
    console.log(`\n[STEP 1] Testing Sales Invoice Creation (${salesInvNumber})...`);
    const salesResult = await evaluate(`
      (async () => {
        window.switchSuite('sales');
        await new Promise(r => setTimeout(r, 400));
        window.openNewInvoiceModal();
        await new Promise(r => setTimeout(r, 300));

        document.getElementById('newInvNumber').value = '${salesInvNumber}';
        document.getElementById('newInvDate').value = '2026-10-26';
        document.getElementById('newInvCustomerName').value = 'Bharat Industrial Supplies';
        document.getElementById('newInvCustomerGstin').value = '27AAACB2222F1Z5';
        document.getElementById('newInvTaxable').value = '75000';
        document.getElementById('newInvGstRate').value = '18';
        window.calculateNewInvoiceTax();

        let reqData = null;
        let resData = null;
        const origApiFetch = window.apiFetch;
        window.apiFetch = async function(url, opts) {
          reqData = { url, method: opts.method, body: opts.body };
          const res = await origApiFetch(url, opts);
          const clone = res.clone();
          try { resData = { status: res.status, json: await clone.json() }; } catch(e) {}
          return res;
        };

        const form = document.querySelector("#modalNewInvoice form");
        const submitEvent = new Event('submit', { cancelable: true, bubbles: true });
        form.dispatchEvent(submitEvent);

        await new Promise(r => setTimeout(r, 800));

        return {
          reqData,
          resData,
          modalHidden: document.getElementById('modalNewInvoice')?.classList.contains('hidden')
        };
      })()
    `);

    console.log("✔ Sales Request sent:", salesResult.reqData);
    console.log("✔ Sales Response received:", salesResult.resData);
    if (!salesResult.resData || salesResult.resData.status !== 201 && salesResult.resData.status !== 200) {
      throw new Error(`Sales creation failed with status ${salesResult.resData?.status}`);
    }
    if (!salesResult.modalHidden) {
      throw new Error("Sales modal did not close on success!");
    }

    // Direct SQLite check for Sales Invoice
    const salesSqlite = db.prepare("SELECT * FROM sales_invoices WHERE invoice_number = ?").all(salesInvNumber);
    console.log(`✔ SQLite sales_invoices record count: ${salesSqlite.length}`);
    if (salesSqlite.length !== 1) {
      throw new Error(`Expected exactly 1 record in SQLite for ${salesInvNumber}, found: ${salesSqlite.length}`);
    }
    console.log("✔ SQLite record verified:", {
      id: salesSqlite[0].id,
      invoice_number: salesSqlite[0].invoice_number,
      taxable_amount: salesSqlite[0].taxable_amount,
      total_amount: salesSqlite[0].total_amount
    });

    // -------------------------------------------------------------------------
    // STEP 2: Purchase Bill Creation via UI
    // -------------------------------------------------------------------------
    console.log(`\n[STEP 2] Testing Purchase Bill Creation (${purchaseBillNumber})...`);
    const purchaseResult = await evaluate(`
      (async () => {
        window.switchSuite('purchase');
        await new Promise(r => setTimeout(r, 400));
        window.openNewPurchaseModal();
        await new Promise(r => setTimeout(r, 300));

        document.getElementById('newPurNumber').value = '${purchaseBillNumber}';
        document.getElementById('newPurDate').value = '2026-10-26';
        document.getElementById('newPurSupplierName').value = 'Tata Consultancy Services';
        document.getElementById('newPurSupplierGstin').value = '27AAACT2727Q1ZW';
        document.getElementById('newPurTaxable').value = '120000';
        document.getElementById('newPurGstRate').value = '18';
        window.calculateNewPurchaseTax();

        let reqData = null;
        let resData = null;
        const origApiFetch = window.apiFetch;
        window.apiFetch = async function(url, opts) {
          reqData = { url, method: opts.method, body: opts.body };
          const res = await origApiFetch(url, opts);
          const clone = res.clone();
          try { resData = { status: res.status, json: await clone.json() }; } catch(e) {}
          return res;
        };

        const form = document.querySelector("#modalNewPurchase form");
        const submitEvent = new Event('submit', { cancelable: true, bubbles: true });
        form.dispatchEvent(submitEvent);

        await new Promise(r => setTimeout(r, 800));

        return {
          reqData,
          resData,
          modalHidden: document.getElementById('modalNewPurchase')?.classList.contains('hidden')
        };
      })()
    `);

    console.log("✔ Purchase Request sent:", purchaseResult.reqData);
    console.log("✔ Purchase Response received:", purchaseResult.resData);
    if (!purchaseResult.resData || purchaseResult.resData.status !== 201 && purchaseResult.resData.status !== 200) {
      throw new Error(`Purchase creation failed with status ${purchaseResult.resData?.status}`);
    }
    if (!purchaseResult.modalHidden) {
      throw new Error("Purchase modal did not close on success!");
    }

    // Direct SQLite check for Purchase Bill
    const purchaseSqlite = db.prepare("SELECT * FROM purchase_invoices WHERE invoice_number = ?").all(purchaseBillNumber);
    console.log(`✔ SQLite purchase_invoices record count: ${purchaseSqlite.length}`);
    if (purchaseSqlite.length !== 1) {
      throw new Error(`Expected exactly 1 record in SQLite for ${purchaseBillNumber}, found: ${purchaseSqlite.length}`);
    }
    console.log("✔ SQLite record verified:", {
      id: purchaseSqlite[0].id,
      invoice_number: purchaseSqlite[0].invoice_number,
      taxable_amount: purchaseSqlite[0].taxable_amount,
      total_amount: purchaseSqlite[0].total_amount
    });

    // -------------------------------------------------------------------------
    // STEP 3: Bills & Docs PDF Upload via File Picker & Action
    // -------------------------------------------------------------------------
    console.log(`\n[STEP 3] Testing Bills & Docs PDF Upload (${pdfFilename})...`);
    const pdfUploadResult = await evaluate(`
      (async () => {
        window.switchSuite('bills');
        await new Promise(r => setTimeout(r, 400));

        // Create a real PDF document
        const pdfContent = "%PDF-1.4\\n%\\xE2\\xE3\\xCF\\xD3\\n1 0 obj\\n<< /Title (Invoice) /Author (SimpleGST) >>\\nendobj\\nxref\\n0 1\\n0000000000 65535 f \\ntrailer\\n<< /Size 1 >>\\nstartxref\\n60\\n%%EOF";
        const file = new File([pdfContent], "${pdfFilename}", { type: "application/pdf" });

        const dt = new DataTransfer();
        dt.items.add(file);
        const fileInput = document.getElementById('billsFileInput');
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 200));

        const infoCard = document.getElementById('billsSelectedFileInfo');
        const isStaged = infoCard && !infoCard.classList.contains('hidden');
        const stagedName = document.getElementById('billsSelectedFileName')?.innerText;

        let reqData = null;
        let resData = null;
        const origApiFetch = window.apiFetch;
        window.apiFetch = async function(url, opts) {
          reqData = { url, method: opts.method, isFormData: opts.body instanceof FormData };
          const res = await origApiFetch(url, opts);
          const clone = res.clone();
          try { resData = { status: res.status, json: await clone.json() }; } catch(e) {}
          return res;
        };

        await window.confirmBillsUpload();
        await new Promise(r => setTimeout(r, 1000));

        return {
          isStaged,
          stagedName,
          reqData,
          resData
        };
      })()
    `);

    console.log("✔ PDF Staging & Upload result:", pdfUploadResult);
    if (!pdfUploadResult.isStaged || pdfUploadResult.stagedName !== pdfFilename) {
      throw new Error("PDF was not properly staged in UI before upload!");
    }
    if (!pdfUploadResult.resData || pdfUploadResult.resData.status !== 201) {
      throw new Error(`PDF upload failed with status ${pdfUploadResult.resData?.status}`);
    }

    // Direct SQLite check for PDF document
    const pdfDocSqlite = db.prepare("SELECT * FROM documents WHERE original_filename = ?").all(pdfFilename);
    console.log(`✔ SQLite documents record count for PDF: ${pdfDocSqlite.length}`);
    if (pdfDocSqlite.length !== 1) {
      throw new Error(`Expected exactly 1 document record for ${pdfFilename}, found: ${pdfDocSqlite.length}`);
    }
    // Verify physical file on disk
    const pdfStoragePath = pdfDocSqlite[0].storage_path;
    console.log(`✔ Physical file exists on disk: ${fs.existsSync(pdfStoragePath)} at ${pdfStoragePath}`);
    if (!fs.existsSync(pdfStoragePath)) {
      throw new Error(`Physical file missing from storage path: ${pdfStoragePath}`);
    }

    // -------------------------------------------------------------------------
    // STEP 4: Bills & Docs Image (PNG) Upload via File Picker & Action
    // -------------------------------------------------------------------------
    console.log(`\n[STEP 4] Testing Bills & Docs PNG Image Upload (${pngFilename})...`);
    const pngUploadResult = await evaluate(`
      (async () => {
        window.switchSuite('bills');
        await new Promise(r => setTimeout(r, 300));

        // Create a real PNG image (8-byte signature + IHDR chunk)
        const pngBytes = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
          0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89
        ]);
        const file = new File([pngBytes], "${pngFilename}", { type: "image/png" });

        const dt = new DataTransfer();
        dt.items.add(file);
        const fileInput = document.getElementById('billsFileInput');
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 200));

        let resData = null;
        const origApiFetch = window.apiFetch;
        window.apiFetch = async function(url, opts) {
          const res = await origApiFetch(url, opts);
          const clone = res.clone();
          try { resData = { status: res.status, json: await clone.json() }; } catch(e) {}
          return res;
        };

        await window.confirmBillsUpload();
        await new Promise(r => setTimeout(r, 1000));

        return {
          resData
        };
      })()
    `);

    console.log("✔ PNG Upload response:", pngUploadResult.resData);
    if (!pngUploadResult.resData || pngUploadResult.resData.status !== 201) {
      throw new Error(`PNG upload failed with status ${pngUploadResult.resData?.status}`);
    }

    // Direct SQLite check for PNG document
    const pngDocSqlite = db.prepare("SELECT * FROM documents WHERE original_filename = ?").all(pngFilename);
    console.log(`✔ SQLite documents record count for PNG: ${pngDocSqlite.length}`);
    if (pngDocSqlite.length !== 1) {
      throw new Error(`Expected exactly 1 document record for ${pngFilename}, found: ${pngDocSqlite.length}`);
    }
    const pngStoragePath = pngDocSqlite[0].storage_path;
    console.log(`✔ Physical file exists on disk: ${fs.existsSync(pngStoragePath)} at ${pngStoragePath}`);
    if (!fs.existsSync(pngStoragePath)) {
      throw new Error(`Physical PNG file missing from storage path: ${pngStoragePath}`);
    }

    // -------------------------------------------------------------------------
    // STEP 5: Browser Reload Persistence Verification in DOM
    // -------------------------------------------------------------------------
    console.log("\n[STEP 5] Refreshing page and verifying DOM presence across all 3 modules...");
    await sendCommand("Page.reload");
    await sleep(2500);

    const domCheck = await evaluate(`
      (async () => {
        await window.initSessionFromBackend();

        // 1. Check Sales Register
        window.switchSuite('sales');
        await window.renderSalesSuite();
        await new Promise(r => setTimeout(r, 400));
        const salesText = document.getElementById('salesTableBody')?.innerText || "";
        const salesFound = salesText.includes('${salesInvNumber}');

        // 2. Check Purchase Register
        window.switchSuite('purchase');
        await window.renderPurchaseSuite();
        await new Promise(r => setTimeout(r, 400));
        const purchaseText = document.getElementById('purchaseTableBody')?.innerText || "";
        const purchaseFound = purchaseText.includes('${purchaseBillNumber}');

        // 3. Check Bills & Docs
        window.switchSuite('bills');
        await window.loadBillsDashboard();
        await new Promise(r => setTimeout(r, 400));
        const billsText = document.getElementById('billsDocsTableBody')?.innerText || "";
        const pdfFound = billsText.includes('${pdfFilename}');
        const pngFound = billsText.includes('${pngFilename}');

        return {
          salesFound,
          purchaseFound,
          pdfFound,
          pngFound
        };
      })()
    `);

    console.log("✔ Browser Reload DOM Verification Results:", domCheck);
    if (!domCheck.salesFound) throw new Error(`Sales Invoice ${salesInvNumber} missing from DOM after reload!`);
    if (!domCheck.purchaseFound) throw new Error(`Purchase Bill ${purchaseBillNumber} missing from DOM after reload!`);
    if (!domCheck.pdfFound) throw new Error(`PDF Document ${pdfFilename} missing from DOM after reload!`);
    if (!domCheck.pngFound) throw new Error(`PNG Document ${pngFilename} missing from DOM after reload!`);

    // -------------------------------------------------------------------------
    // STEP 6: No Duplicate Records Verification in SQLite
    // -------------------------------------------------------------------------
    console.log("\n[STEP 6] Checking SQLite for duplicate records...");
    const dupSales = db.prepare("SELECT COUNT(*) as c FROM sales_invoices WHERE invoice_number = ?").get(salesInvNumber).c;
    const dupPurchase = db.prepare("SELECT COUNT(*) as c FROM purchase_invoices WHERE invoice_number = ?").get(purchaseBillNumber).c;
    const dupPdf = db.prepare("SELECT COUNT(*) as c FROM documents WHERE original_filename = ?").get(pdfFilename).c;
    const dupPng = db.prepare("SELECT COUNT(*) as c FROM documents WHERE original_filename = ?").get(pngFilename).c;

    console.log(`✔ Counts: Sales=${dupSales}, Purchase=${dupPurchase}, PDF=${dupPdf}, PNG=${dupPng}`);
    if (dupSales !== 1 || dupPurchase !== 1 || dupPdf !== 1 || dupPng !== 1) {
      throw new Error(`Duplicate records detected in database!`);
    }

    console.log("\n===============================================================================");
    console.log("ALL REAL USER-INTERFACE WORKFLOWS PASSED WITH 100% SUCCESS!");
    console.log("===============================================================================");

  } finally {
    ws.close();
    chromeProcess.kill();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch(e) {}
  }
}

runCompleteUserVerification().catch(err => {
  console.error("FATAL VERIFICATION ERROR:", err);
  process.exit(1);
});

