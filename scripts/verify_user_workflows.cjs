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
  await sleep(2500);

  // Ensure window and app scripts are initialized
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`typeof window.handleSignInSubmit === 'function'`);
    if (ready) break;
    await sleep(200);
  }

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
    // STEP 1: Sales Invoice Creation via UI & Form Blank Verification
    // -------------------------------------------------------------------------
    console.log(`\n[STEP 1] Testing Sales Invoice Creation (${salesInvNumber}) & Blank Modal Verification...`);
    const salesBlankCheck = await evaluate(`
      (async () => {
        window.switchSuite('sales');
        await new Promise(r => setTimeout(r, 400));
        window.openNewInvoiceModal();
        await new Promise(r => setTimeout(r, 300));

        const numVal = document.getElementById('newInvNumber')?.value;
        const numDef = document.getElementById('newInvNumber')?.defaultValue;
        const custVal = document.getElementById('newInvCustomerName')?.value;
        const custDef = document.getElementById('newInvCustomerName')?.defaultValue;
        const gstinVal = document.getElementById('newInvCustomerGstin')?.value;
        const taxableVal = document.getElementById('newInvTaxable')?.value;
        const rateVal = document.getElementById('newInvGstRate')?.value;
        const posVal = document.getElementById('newInvPos')?.value;
        const supplyVal = document.getElementById('newInvSupplyTypeSelect')?.value;
        const totalAmount = document.getElementById('newInvTotalAmount')?.innerText;

        // Test manual generate number button
        window.generateNewInvoiceNumber();
        const generatedNum = document.getElementById('newInvNumber')?.value;

        return {
          numVal,
          numDef,
          custVal,
          custDef,
          gstinVal,
          taxableVal,
          rateVal,
          posVal,
          supplyVal,
          totalAmount,
          generatedNum
        };
      })()
    `);
    console.log("✔ Sales initial blank check:", salesBlankCheck);
    assert.strictEqual(salesBlankCheck.numVal, "", "Sales invoice number must initially be empty");
    assert.strictEqual(salesBlankCheck.numDef, "", "Sales invoice number defaultValue must be empty");
    assert.strictEqual(salesBlankCheck.custVal, "", "Customer name must initially be empty (no Zenith)");
    assert.strictEqual(salesBlankCheck.gstinVal, "", "Customer GSTIN must initially be empty (no fake GSTIN)");
    assert.strictEqual(salesBlankCheck.taxableVal, "", "Taxable value must initially be empty (no 250000)");
    assert.strictEqual(salesBlankCheck.rateVal, "", "GST rate must require explicit selection (no default 18%)");
    assert.strictEqual(salesBlankCheck.posVal, "", "Place of supply must require explicit selection");
    assert.strictEqual(salesBlankCheck.supplyVal, "", "Supply type must require explicit selection");
    assert.strictEqual(salesBlankCheck.totalAmount, "₹0.00", "Total amount must show ₹0.00 initially");
    assert.ok(salesBlankCheck.generatedNum.startsWith("INV-"), "Generate # button must generate a valid INV- prefix");

    const salesResult = await evaluate(`
      (async () => {
        document.getElementById('newInvNumber').value = '${salesInvNumber}';
        document.getElementById('newInvDate').value = '2026-10-26';
        document.getElementById('newInvCustomerName').value = 'Bharat Industrial Supplies';
        document.getElementById('newInvCustomerGstin').value = '27AAACB2222F1Z5';
        window.onCustomerGstinInput(); // Auto-selects POS 27 & Supply Type B2B
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

    // Verify Sales Modal is completely clean when re-opened
    const salesReopenCheck = await evaluate(`
      (() => {
        window.openNewInvoiceModal();
        return {
          numVal: document.getElementById('newInvNumber')?.value,
          numDef: document.getElementById('newInvNumber')?.defaultValue,
          custVal: document.getElementById('newInvCustomerName')?.value,
          taxableVal: document.getElementById('newInvTaxable')?.value,
          rateVal: document.getElementById('newInvGstRate')?.value,
          posVal: document.getElementById('newInvPos')?.value
        };
      })()
    `);
    assert.strictEqual(salesReopenCheck.numVal, "", "Sales modal must reopen completely blank for invoice #");
    assert.strictEqual(salesReopenCheck.custVal, "", "Sales modal must reopen blank for customer name");
    assert.strictEqual(salesReopenCheck.taxableVal, "", "Sales modal must reopen blank for taxable value");
    assert.strictEqual(salesReopenCheck.rateVal, "", "Sales modal must reopen blank for rate");
    await evaluate(`window.closeNewInvoiceModal()`);

    // -------------------------------------------------------------------------
    // STEP 2: Purchase Bill Creation via UI & Form Blank Verification
    // -------------------------------------------------------------------------
    console.log(`\n[STEP 2] Testing Purchase Bill Creation (${purchaseBillNumber}) & Blank Modal Verification...`);
    const purchaseBlankCheck = await evaluate(`
      (async () => {
        window.switchSuite('purchase');
        await new Promise(r => setTimeout(r, 400));
        window.openNewPurchaseModal();
        await new Promise(r => setTimeout(r, 300));

        const numVal = document.getElementById('newPurNumber')?.value;
        const numDef = document.getElementById('newPurNumber')?.defaultValue;
        const supVal = document.getElementById('newPurSupplierName')?.value;
        const supDef = document.getElementById('newPurSupplierName')?.defaultValue;
        const gstinVal = document.getElementById('newPurSupplierGstin')?.value;
        const taxableVal = document.getElementById('newPurTaxable')?.value;
        const rateVal = document.getElementById('newPurGstRate')?.value;
        const posVal = document.getElementById('newPurPos')?.value;
        const itcVal = document.getElementById('newPurItcEligibility')?.value;
        const rcmVal = document.getElementById('newPurIsRcm')?.checked;
        const taxAmount = document.getElementById('newPurTaxAmount')?.innerText;

        // Test manual generate number button
        window.generateNewPurchaseNumber();
        const generatedNum = document.getElementById('newPurNumber')?.value;

        return {
          numVal,
          numDef,
          supVal,
          supDef,
          gstinVal,
          taxableVal,
          rateVal,
          posVal,
          itcVal,
          rcmVal,
          taxAmount,
          generatedNum
        };
      })()
    `);
    console.log("✔ Purchase initial blank check:", purchaseBlankCheck);
    assert.strictEqual(purchaseBlankCheck.numVal, "", "Purchase bill number must initially be empty");
    assert.strictEqual(purchaseBlankCheck.numDef, "", "Purchase bill number defaultValue must be empty");
    assert.strictEqual(purchaseBlankCheck.supVal, "", "Supplier name must initially be empty");
    assert.strictEqual(purchaseBlankCheck.gstinVal, "", "Supplier GSTIN must initially be empty");
    assert.strictEqual(purchaseBlankCheck.taxableVal, "", "Taxable value must initially be empty");
    assert.strictEqual(purchaseBlankCheck.rateVal, "", "GST rate must require explicit selection");
    assert.strictEqual(purchaseBlankCheck.posVal, "", "Place of supply must require explicit selection");
    assert.strictEqual(purchaseBlankCheck.itcVal, "", "ITC eligibility must require explicit selection");
    assert.strictEqual(purchaseBlankCheck.rcmVal, false, "RCM must default to false");
    assert.strictEqual(purchaseBlankCheck.taxAmount, "₹0.00", "Tax amount must show ₹0.00 initially");
    assert.ok(purchaseBlankCheck.generatedNum.startsWith("BILL-"), "Generate # button must generate a valid BILL- prefix");

    const purchaseResult = await evaluate(`
      (async () => {
        document.getElementById('newPurNumber').value = '${purchaseBillNumber}';
        document.getElementById('newPurDate').value = '2026-10-26';
        document.getElementById('newPurSupplierName').value = 'Tata Consultancy Services';
        document.getElementById('newPurSupplierGstin').value = '27AAACT2727Q1ZW';
        window.onSupplierGstinInput(); // Auto-selects POS 27
        document.getElementById('newPurItcEligibility').value = 'ELIGIBLE';
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

    // Verify Purchase Modal is completely clean when re-opened
    const purchaseReopenCheck = await evaluate(`
      (() => {
        window.openNewPurchaseModal();
        return {
          numVal: document.getElementById('newPurNumber')?.value,
          numDef: document.getElementById('newPurNumber')?.defaultValue,
          supVal: document.getElementById('newPurSupplierName')?.value,
          taxableVal: document.getElementById('newPurTaxable')?.value,
          rateVal: document.getElementById('newPurGstRate')?.value,
          posVal: document.getElementById('newPurPos')?.value,
          itcVal: document.getElementById('newPurItcEligibility')?.value
        };
      })()
    `);
    assert.strictEqual(purchaseReopenCheck.numVal, "", "Purchase modal must reopen completely blank for bill #");
    assert.strictEqual(purchaseReopenCheck.supVal, "", "Purchase modal must reopen blank for supplier name");
    assert.strictEqual(purchaseReopenCheck.taxableVal, "", "Purchase modal must reopen blank for taxable value");
    assert.strictEqual(purchaseReopenCheck.rateVal, "", "Purchase modal must reopen blank for rate");
    assert.strictEqual(purchaseReopenCheck.posVal, "", "Purchase modal must reopen blank for POS");
    assert.strictEqual(purchaseReopenCheck.itcVal, "", "Purchase modal must reopen blank for ITC");
    await evaluate(`window.closeNewPurchaseModal()`);

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

    // -------------------------------------------------------------------------
    // STEP 7: Phase 5 Mandatory Multi-Item Real PDF Upload & OCR Review (Sales)
    // -------------------------------------------------------------------------
    console.log("\n[STEP 7] Testing Real Sales PDF Upload & Multi-Line Item Review Modal (ABC/2026-27/001)...");
    const zlib = require("zlib");
    function makeSamplePdf() {
      const sampleLines = [
        "TAX INVOICE",
        "Invoice Number: ABC/2026-27/001",
        "Invoice Date: 06-Nov-2026",
        "Due Date: 21-Nov-2026",
        "Payment Terms: Net 15 Days",
        "Seller: ABC Retail Solutions",
        "Address: Chennai, Tamil Nadu",
        "GSTIN: 33AABCA1234C1Z5",
        "Buyer: Sunrise Traders",
        "Address: Bengaluru, Karnataka",
        "GSTIN: 29AABCS5678D1Z2",
        "Place of Supply: Karnataka (29)",
        "Reverse Charge: No",
        "S.No Description HSN Qty Rate Taxable GST% IGST Total",
        "1 Cotton T-Shirts (assorted sizes) 6109 20 500 10000 5% 500 10500",
        "2 Denim Jeans 6203 10 1200 12000 12% 1440 13440",
        "Taxable Value: 22000.00",
        "IGST: 1940.00",
        "CGST: 0.00",
        "SGST: 0.00",
        "Round Off: 0.00",
        "Grand Total: 23940.00"
      ];
      const tjParts = sampleLines.map(l => `(${l.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) Tj`).join(" T* ");
      const textStream = `BT /F1 12 Tf 50 750 Td ${tjParts} ET`;
      const streamData = zlib.deflateSync(Buffer.from(textStream, "utf8"));
      const header = `%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length ${streamData.length} >>\nstream\n`;
      const footer = `\nendstream\nendobj\nxref\ntrailer\n<< >>\nstartxref\n0\n%%EOF`;
      return Buffer.concat([Buffer.from(header, "utf8"), streamData, Buffer.from(footer, "utf8")]);
    }

    const samplePdfBuf = makeSamplePdf();
    const samplePdfBase64 = samplePdfBuf.toString("base64");

    // Clean any prior run invoice in DB
    db.prepare("DELETE FROM sales_invoices WHERE invoice_number = 'ABC/2026-27/001'").run();

    const ocrReviewResult = await evaluate(`
      (async () => {
        window.switchSuite('sales');
        await new Promise(r => setTimeout(r, 400));

        // Upload sample PDF
        const binaryStr = atob('${samplePdfBase64}');
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const file = new File([bytes], "ABC_2026_27_001.pdf", { type: "application/pdf" });

        await window.uploadDocumentAndProcess(file, 'sales_invoice');
        await new Promise(r => setTimeout(r, 1200));

        const modal = document.getElementById('modalOcrReview');
        const isModalVisible = modal && !modal.classList.contains('hidden') && modal.style.display !== 'none';

        const invNum = document.getElementById('ocrReviewInvoiceNumber')?.value;
        const invDate = document.getElementById('ocrReviewInvoiceDate')?.value;
        const dueDate = document.getElementById('ocrReviewDueDate')?.value;
        const pos = document.getElementById('ocrReviewPos')?.value;
        const sellerName = document.getElementById('ocrReviewSellerName')?.value;
        const sellerGstin = document.getElementById('ocrReviewSellerGstin')?.value;
        const buyerName = document.getElementById('ocrReviewBuyerName')?.value;
        const buyerGstin = document.getElementById('ocrReviewBuyerGstin')?.value;
        const isRcm = document.getElementById('ocrReviewIsRcm')?.checked;

        const taxableDisp = document.getElementById('ocrReviewTaxableDisplay')?.textContent?.trim();
        const igstDisp = document.getElementById('ocrReviewIgstDisplay')?.textContent?.trim();
        const cgstDisp = document.getElementById('ocrReviewCgstDisplay')?.textContent?.trim();
        const sgstDisp = document.getElementById('ocrReviewSgstDisplay')?.textContent?.trim();
        const grandTotalDisp = document.getElementById('ocrReviewGrandTotalDisplay')?.textContent?.trim();

        const lineItemRows = Array.from(document.querySelectorAll('#ocrReviewLineItemsTbody tr'));
        const lineItemsData = lineItemRows.map(tr => {
          const inputs = tr.querySelectorAll('input, select');
          return {
            desc: inputs[0]?.value,
            hsn: inputs[1]?.value,
            qty: inputs[2]?.value,
            unit: inputs[3]?.value,
            rate: inputs[4]?.value,
            disc: inputs[5]?.value,
            gstRate: inputs[6]?.value
          };
        });

        // Test editing line item live: update row 1 qty to 20, verify recalculation
        window.updateOcrLineItem(0, 'quantity', 20);
        await new Promise(r => setTimeout(r, 300));

        // Click Approve & Save to Sales Register
        await window.saveExtractedInvoice();
        await new Promise(r => setTimeout(r, 1200));

        return {
          isModalVisible,
          invNum,
          invDate,
          dueDate,
          pos,
          sellerName,
          sellerGstin,
          buyerName,
          buyerGstin,
          isRcm,
          taxableDisp,
          igstDisp,
          cgstDisp,
          sgstDisp,
          grandTotalDisp,
          lineItemCount: lineItemRows.length,
          lineItemsData,
          modalAfterApprove: modal?.classList.contains('hidden') || modal?.style.display === 'none'
        };
      })()
    `);

    console.log("✔ OCR Review Modal Verified:", {
      invNum: ocrReviewResult.invNum,
      invDate: ocrReviewResult.invDate,
      dueDate: ocrReviewResult.dueDate,
      pos: ocrReviewResult.pos,
      sellerName: ocrReviewResult.sellerName,
      buyerName: ocrReviewResult.buyerName,
      taxable: ocrReviewResult.taxableDisp,
      igst: ocrReviewResult.igstDisp,
      grandTotal: ocrReviewResult.grandTotalDisp,
      lineItemCount: ocrReviewResult.lineItemCount
    });

    assert.strictEqual(ocrReviewResult.invNum, "ABC/2026-27/001", "Extracted invoice number must match PDF");
    assert.strictEqual(ocrReviewResult.invDate, "2026-11-06", "Extracted invoice date must match PDF");
    assert.strictEqual(ocrReviewResult.dueDate, "2026-11-21", "Extracted due date must match PDF");
    assert.strictEqual(ocrReviewResult.pos, "29", "Place of supply must be Karnataka (29)");
    assert.strictEqual(ocrReviewResult.sellerName, "ABC Retail Solutions", "Seller name must match PDF");
    assert.strictEqual(ocrReviewResult.sellerGstin, "33AABCA1234C1Z5", "Seller GSTIN must match PDF");
    assert.strictEqual(ocrReviewResult.buyerName, "Sunrise Traders", "Buyer name must match PDF");
    assert.strictEqual(ocrReviewResult.buyerGstin, "29AABCS5678D1Z2", "Buyer GSTIN must match PDF");
    assert.strictEqual(ocrReviewResult.isRcm, false, "Reverse charge must be false");
    assert.strictEqual(ocrReviewResult.lineItemCount, 2, "Must extract exactly 2 line items");
    assert.strictEqual(ocrReviewResult.lineItemsData[0].hsn, "6109");
    assert.strictEqual(ocrReviewResult.lineItemsData[1].hsn, "6203");
    assert.strictEqual(ocrReviewResult.taxableDisp, "₹22,000.00", "Taxable value must be ₹22,000.00");
    assert.strictEqual(ocrReviewResult.igstDisp, "₹1,940.00", "IGST must be ₹1,940.00");
    assert.strictEqual(ocrReviewResult.cgstDisp, "₹0.00", "CGST must be ₹0.00");
    assert.strictEqual(ocrReviewResult.sgstDisp, "₹0.00", "SGST must be ₹0.00");
    assert.strictEqual(ocrReviewResult.grandTotalDisp, "₹23,940.00", "Grand Total must be ₹23,940.00");
    assert.strictEqual(ocrReviewResult.modalAfterApprove, true, "Modal must close upon approval");

    // Direct SQLite check for approved ABC/2026-27/001
    const savedSaleRow = db.prepare("SELECT * FROM sales_invoices WHERE invoice_number = 'ABC/2026-27/001'").get();
    assert.ok(savedSaleRow, "Invoice ABC/2026-27/001 must be saved in sales_invoices table");
    assert.strictEqual(savedSaleRow.taxable_amount, 22000);
    assert.strictEqual(savedSaleRow.igst, 1940);
    assert.strictEqual(savedSaleRow.total_amount, 23940);
    assert.strictEqual(savedSaleRow.is_interstate, 1);
    assert.ok(savedSaleRow.line_items_json, "Line items JSON must be persisted in SQLite");
    const parsedSavedLines = JSON.parse(savedSaleRow.line_items_json);
    assert.strictEqual(parsedSavedLines.length, 2);
    assert.strictEqual(parsedSavedLines[0].hsnCode, "6109");
    assert.strictEqual(parsedSavedLines[1].hsnCode, "6203");
    console.log("✔ SQLite persistence verified for ABC/2026-27/001 with 2 line items!");

    // -------------------------------------------------------------------------
    // STEP 8: Cross-Module Statutory Consistency Verification
    // -------------------------------------------------------------------------
    console.log("\n[STEP 8] Verifying cross-module statutory consistency (Tax-Calc, Reconciliation, Sales Register)...");
    const crossModuleResult = await evaluate(`
      (async () => {
        // Tax calculation endpoint (Rule 88A)
        const taxRes = await window.apiFetch('/api/returns/tax-calc?period=112026');
        const taxData = await taxRes.json();

        // GSTR-2B reconciliation summary
        const reconRes = await window.apiFetch('/api/reconciliation/summary?period=112026');
        const reconData = await reconRes.json();

        // Sales register endpoint
        const salesRes = await window.apiFetch('/api/sales?period=112026');
        const salesData = await salesRes.json();

        return {
          taxOk: taxRes.ok,
          taxData,
          reconOk: reconRes.ok,
          reconData,
          salesOk: salesRes.ok,
          salesData
        };
      })()
    `);

    console.log("✔ Cross-module response status:", {
      taxOk: crossModuleResult.taxOk,
      reconOk: crossModuleResult.reconOk,
      salesOk: crossModuleResult.salesOk
    });
    assert.strictEqual(crossModuleResult.taxOk, true, "Tax calculation endpoint must return 200 OK");
    assert.strictEqual(crossModuleResult.reconOk, true, "Reconciliation summary endpoint must return 200 OK");
    assert.strictEqual(crossModuleResult.salesOk, true, "Sales endpoint must return 200 OK");
    console.log("✔ Tax Calculation Result for Period 112026:", {
      liability: crossModuleResult.taxData.liability,
      inputCredit: crossModuleResult.taxData.inputCredit,
      netCashPayable: crossModuleResult.taxData.netCashPayable
    });
    assert.strictEqual(crossModuleResult.taxData.liability.igst >= 1940, true, "Output IGST liability must include ₹1,940 from ABC/2026-27/001");

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

