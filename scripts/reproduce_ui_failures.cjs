const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reproduceFailures() {
  console.log("=== Reproducing User-Interface Failures as a Fresh User ===");

  const PORT = 3889;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "simplegst-reproduce-"));
  const cdpPort = 9223;

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
          console.log(`[CDP] Connected to target page`);
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
  const networkEvents = [];

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const cb = callbacks.get(data.id);
      callbacks.delete(data.id);
      cb(data);
    }
    if (data.method === "Network.responseReceived") {
      networkEvents.push(data.params);
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

  await sleep(1500);

  try {
    // Action 1: Sales - Open Sales Register, Open Modal, Fill Fields, Click Save
    console.log("\n--- Testing Sales UI Workflow (Without Manual Login) ---");
    const salesResult = await evaluate(`
      (async () => {
        window.switchSuite('sales');
        await new Promise(r => setTimeout(r, 300));
        window.openNewInvoiceModal();
        await new Promise(r => setTimeout(r, 200));

        document.getElementById('newInvNumber').value = 'INV-FAIL-01';
        document.getElementById('newInvDate').value = '2026-10-25';
        document.getElementById('newInvCustomerName').value = 'Zenith Logistics Hub';
        document.getElementById('newInvTaxable').value = '50000';
        document.getElementById('newInvGstRate').value = '18';
        window.calculateNewInvoiceTax();

        let networkResult = null;
        const origApiFetch = window.apiFetch;
        // Hook apiFetch to record response
        window.apiFetch = async function(url, opts) {
          const res = await origApiFetch(url, opts);
          const clone = res.clone();
          let json = null;
          try { json = await clone.json(); } catch(e) {}
          networkResult = { url, status: res.status, ok: res.ok, json };
          return res;
        };

        await window.submitNewInvoice();
        await new Promise(r => setTimeout(r, 500));
        return {
          networkResult,
          isModalClosed: document.getElementById('modalNewInvoice')?.classList.contains('hidden')
        };
      })()
    `);
    console.log("Sales UI Result:", salesResult);

    // Action 2: Purchase - Open Purchase Register, Open Modal, Fill Fields, Click Save
    console.log("\n--- Testing Purchase UI Workflow (Without Manual Login) ---");
    const purchaseResult = await evaluate(`
      (async () => {
        window.switchSuite('purchase');
        await new Promise(r => setTimeout(r, 300));
        window.openNewPurchaseModal();
        await new Promise(r => setTimeout(r, 200));

        document.getElementById('newPurNumber').value = 'BILL-FAIL-01';
        document.getElementById('newPurDate').value = '2026-10-25';
        document.getElementById('newPurSupplierName').value = 'Acme Logistics';
        document.getElementById('newPurSupplierGstin').value = '27AAACA1234A1Z5';
        document.getElementById('newPurTaxable').value = '40000';
        document.getElementById('newPurGstRate').value = '18';
        window.calculateNewPurchaseTax();

        let networkResult = null;
        const origApiFetch = window.apiFetch;
        window.apiFetch = async function(url, opts) {
          const res = await origApiFetch(url, opts);
          const clone = res.clone();
          let json = null;
          try { json = await clone.json(); } catch(e) {}
          networkResult = { url, status: res.status, ok: res.ok, json };
          return res;
        };

        await window.submitNewPurchase();
        await new Promise(r => setTimeout(r, 500));
        return {
          networkResult,
          isModalClosed: document.getElementById('modalNewPurchase')?.classList.contains('hidden')
        };
      })()
    `);
    console.log("Purchase UI Result:", purchaseResult);

    // Action 3: Bills & Docs - Upload a file
    console.log("\n--- Testing Bills & Docs Upload (Without Manual Login) ---");
    const billsResult = await evaluate(`
      (async () => {
        window.switchSuite('bills');
        await new Promise(r => setTimeout(r, 300));

        const mockPdf = "%PDF-1.4 test";
        const file = new File([mockPdf], "test_doc.pdf", { type: "application/pdf" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const fileInput = document.getElementById('billsFileInput');
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));

        let networkResult = null;
        const origApiFetch = window.apiFetch;
        window.apiFetch = async function(url, opts) {
          const res = await origApiFetch(url, opts);
          const clone = res.clone();
          let json = null;
          try { json = await clone.json(); } catch(e) {}
          networkResult = { url, status: res.status, ok: res.ok, json };
          return res;
        };

        await window.confirmBillsUpload();
        await new Promise(r => setTimeout(r, 500));

        return {
          networkResult
        };
      })()
    `);
    console.log("Bills & Docs Result:", billsResult);

  } finally {
    ws.close();
    chromeProcess.kill();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch(e) {}
  }
}

reproduceFailures().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
