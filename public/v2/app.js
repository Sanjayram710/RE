import { state, clearBusinessCache } from "./state.js";
import { apiRequest, abortAllRequests, setCsrfToken } from "./api.js";
import { escapeHtml, formatPaiseINR, rupeesToPaise, getCurrentPeriodMMYYYY, getNextPeriodMMYYYY, formatPeriodLabel } from "./utils.js";
import {
  initReducedMotionPref,
  applyReducedMotionPref,
  isMotionReduced,
  placeNavPill,
  bindNavPillHover,
  sweepPageTransition,
  isCurtainRunning,
  animateCountUps,
  animateProgressRing,
  bindDesktopPointerMotion,
  bindScrollProgress,
  launchCelebrationConfetti,
  MOTION_TOKENS
} from "./motion.js";
import {
  renderAuthView,
  renderHomeView,
  renderFileView,
  renderInvoicesView,
  renderHistoryView,
  renderCopilotView,
  renderExpertsView,
  renderStartupView,
  renderSettingsView
} from "./views.js";

const $ = (sel) => document.querySelector(sel);

const ROUTE_INFO = {
  home: { eyebrow: "(01) Home", title: "Home", subtitle: "Your GST month at a glance", chips: ["Sales", "Purchases", "Filing"] },
  file: { eyebrow: "(02) File GST", title: "File GST Return", subtitle: "Five guided steps from bills to return", chips: ["Sales", "Purchases", "ITC & Tax"] },
  invoices: { eyebrow: "(03) Invoices", title: "My Invoices", subtitle: "Outward sales and supplier bills", chips: ["GSTR-1", "GSTR-2B", "Verified"] },
  history: { eyebrow: "(04) History", title: "History", subtitle: "Saved acknowledgements and archives", chips: ["Simulation", "Receipts", "Audit"] },
  copilot: { eyebrow: "(05) Copilot", title: "GST Copilot", subtitle: "Grounded answers from your backend data", chips: ["Tax to pay", "ITC", "Due dates"] },
  experts: { eyebrow: "(06) Tax Experts", title: "Tax Experts", subtitle: "Chartered accountant assistance", chips: ["Advisory", "Review", "Support"] },
  startup: { eyebrow: "(07) Start", title: "Start a business", subtitle: "Registration and entity setup", chips: ["GSTIN", "Company", "Compliance"] },
  settings: { eyebrow: "(08) Settings", title: "Settings", subtitle: "Branches, preferences, and motion", chips: ["Multi-GSTIN", "Preferences", "Profile"] }
};

let toastTimer = null;
function showToast(message, undoFn = null) {
  const el = $("#toast");
  if (!el) return;
  if (toastTimer) clearTimeout(toastTimer);
  el.innerHTML = undoFn
    ? `<span>${escapeHtml(message)}</span><button type="button" class="toast-undo" id="toast-undo-btn">Undo</button>`
    : `<span>${escapeHtml(message)}</span>`;
  el.classList.add("s");
  if (undoFn) {
    $("#toast-undo-btn")?.addEventListener("click", async () => {
      el.classList.remove("s");
      await undoFn();
    }, { once: true });
  }
  toastTimer = setTimeout(() => el.classList.remove("s"), undoFn ? 4800 : 2800);
}

function handleUnauthorized(reason) {
  abortAllRequests();
  clearBusinessCache();
  state.authenticated = false;
  state.user = null;
  state.sessionExpiredMessage = reason || "Your session expired. Please sign in again.";
  updateHeaderControls();
  render();
}

function updateHeaderControls() {
  const switcher = $("#gstin-switcher");
  const userBtn = $("#user-menu-btn");
  if (!state.authenticated) {
    if (switcher) switcher.hidden = true;
    if (userBtn) userBtn.hidden = true;
    return;
  }

  if (switcher) {
    switcher.hidden = state.allGstins.length === 0;
    switcher.innerHTML = state.allGstins
      .map((g) => `<option value="${escapeHtml(g.id)}" ${state.activeGstin?.id === g.id ? "selected" : ""}>${escapeHtml(g.gstin)} · ${escapeHtml(g.state_name || "")}</option>`)
      .join("");
  }

  if (userBtn) {
    userBtn.hidden = false;
    const name = state.user?.name || state.user?.full_name || "Account";
    $("#hdr-avatar").textContent = name.charAt(0).toUpperCase();
    $("#hdr-name").textContent = name;
    $("#hdr-org").textContent = state.organization?.name || "";
  }

  const copLbl = $("#copilot-gstin-label");
  if (copLbl) {
    copLbl.textContent = state.activeGstin ? `GSTIN: ${state.activeGstin.gstin}` : "Deterministic GST Assistant";
  }
}

function syncNavHighlight() {
  document.querySelectorAll(".nv button[data-go]").forEach((btn) => {
    const active = btn.dataset.go === state.view;
    btn.classList.toggle("on", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  document.querySelectorAll(".mob-btn[data-go]").forEach((btn) => {
    if (btn.dataset.go === state.view) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  const fab = $("#copilot-fab");
  if (fab) fab.classList.toggle("x", state.view === "copilot");
  placeNavPill();
}

function renderCopilotMessages() {
  ["#copilot-msgs", "#copilot-page-msgs"].forEach((sel) => {
    const box = $(sel);
    if (!box) return;
    if (state.copilotMessages.length === 0) {
      box.innerHTML = `<div class="m b">Ask me about your tax payable, eligible ITC, or filing deadline.</div>`;
      return;
    }
    box.innerHTML = state.copilotMessages
      .map((m) => {
        if (m.typing) return `<div class="m b"><span class="dots"><i></i><i></i><i></i></span></div>`;
        return `<div class="m ${m.role === "user" ? "u" : "b"}">${escapeHtml(m.text)}</div>`;
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  });
}

export function render() {
  const appEl = $("#app");
  if (!appEl) return;

  if (!state.authenticated) {
    appEl.innerHTML = renderAuthView(state);
    bindViewForms();
    return;
  }

  syncNavHighlight();
  const v = state.view;
  if (v === "home") appEl.innerHTML = renderHomeView(state);
  else if (v === "file") appEl.innerHTML = renderFileView(state);
  else if (v === "invoices") appEl.innerHTML = renderInvoicesView(state);
  else if (v === "history") appEl.innerHTML = renderHistoryView(state);
  else if (v === "copilot") appEl.innerHTML = renderCopilotView(state);
  else if (v === "experts") appEl.innerHTML = renderExpertsView(state);
  else if (v === "startup") appEl.innerHTML = renderStartupView(state);
  else if (v === "settings") appEl.innerHTML = renderSettingsView(state);

  bindViewForms();
  animateCountUps(appEl);
  animateProgressRing(appEl);
}

function bindViewForms() {
  const loginForm = $("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#login-email").value.trim();
      const password = $("#login-password").value;
      if (!email || !password) {
        state.errors.auth = "Please enter both email and password.";
        render();
        return;
      }
      state.errors.auth = "";
      const btn = $("#login-submit-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Signing in…"; }
      try {
        const res = await apiRequest("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });
        applySessionPayload(res);
        try {
          const fullSess = await apiRequest("/api/auth/session");
          if (fullSess.authenticated) applySessionPayload(fullSess);
        } catch {}
        await loadAllBusinessData();
      } catch (err) {
        state.errors.auth = err.message || "Sign in failed.";
        render();
      }
    });
  }

  const regForm = $("#register-form");
  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fullName = ($("#reg-name")?.value || "").trim();
      const mobile = ($("#reg-mobile")?.value || "").trim();
      const email = ($("#reg-email")?.value || "").trim();
      const password = $("#reg-password")?.value || "";
      const confirmPassword = $("#reg-confirm")?.value || "";
      if (!fullName || !mobile || !email || !password) {
        state.errors.auth = "Please fill in all registration fields.";
        render();
        return;
      }
      state.errors.auth = "";
      const btn = $("#register-submit-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Creating account…"; }
      try {
        const res = await apiRequest("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ fullName, mobile, email, password, confirmPassword })
        });
        applySessionPayload(res);
        try {
          const fullSess = await apiRequest("/api/auth/session");
          if (fullSess.authenticated) applySessionPayload(fullSess);
        } catch {}
        await loadAllBusinessData();
      } catch (err) {
        state.errors.auth = err.message || "Registration failed.";
        render();
      }
    });
  }

  const copPageForm = $("#copilot-page-form");
  if (copPageForm) {
    copPageForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const inp = $("#copilot-page-input");
      const q = inp?.value.trim();
      if (!q) return;
      inp.value = "";
      await askCopilot(q);
    });
  }

  const ocrForm = $("#ocr-approve-form");
  if (ocrForm && state.ocrReview) {
    const updatePreviewDom = () => {
      const f = state.ocrReview.fields;
      const activeState = state.activeGstin?.state_code || "27";
      const taxablePaise = rupeesToPaise(f.taxableAmount || 0);
      const gstRate = Number(f.gstRate !== undefined ? f.gstRate : 18);
      const pos = String(f.pos || activeState).slice(0, 2);
      const isInter = pos !== String(activeState).slice(0, 2);
      const totalTax = Math.round((taxablePaise * gstRate) / 100);
      const igst = isInter ? totalTax : 0;
      const cgst = isInter ? 0 : Math.floor(totalTax / 2);
      const sgst = isInter ? 0 : (totalTax - cgst);
      const prevEl = $("#ocr-tax-preview");
      if (prevEl) {
        prevEl.innerHTML = `
          <span>Supply: <b>${isInter ? "Interstate (IGST)" : "Intrastate (CGST + SGST)"}</b></span>
          <span>CGST: <b>${formatPaiseINR(cgst)}</b></span>
          <span>SGST: <b>${formatPaiseINR(sgst)}</b></span>
          <span>IGST: <b>${formatPaiseINR(igst)}</b></span>
          <span>Total Tax: <b>${formatPaiseINR(totalTax)}</b></span>
          <span>Total Bill: <b>${formatPaiseINR(taxablePaise + totalTax)}</b></span>
        `;
      }
    };

    ocrForm.querySelectorAll("[data-ocr-field]").forEach((inp) => {
      const syncField = () => {
        const key = inp.dataset.ocrField;
        let val = inp.value;
        if (key === "gstRate") val = Number(val);
        else if (key === "isRcm") val = val === "true";
        state.ocrReview.fields[key] = val;
        updatePreviewDom();
      };
      inp.addEventListener("input", syncField);
      inp.addEventListener("change", syncField);
    });

    const confirmChk = $("#ocr-confirm-check");
    if (confirmChk) {
      confirmChk.addEventListener("change", () => {
        state.ocrReview.confirmed = confirmChk.checked;
        const btn = $("#ocr-save-btn");
        if (btn) btn.disabled = !confirmChk.checked || state.ocrReview.saving;
      });
    }

    ocrForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await approveOcrReview();
    });
  }

  const simForm = $("#sim-file-form");
  if (simForm) {
    simForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const otp = ($("#sim-otp-input")?.value || "").trim();
      await submitSimulatedReturn(otp);
    });
  }
}

function applySessionPayload(data) {
  state.authenticated = true;
  state.sessionExpiredMessage = "";
  state.errors.auth = "";
  if (data.csrfToken) setCsrfToken(data.csrfToken);
  state.user = data.user || null;
  state.organization = data.organization || null;
  state.activeGstin = data.activeGstin || null;
  state.allGstins = data.allGstins || [];
  state.period = data.activePeriod || getCurrentPeriodMMYYYY();
  updateHeaderControls();
}

async function loadDashboard() {
  state.loading.dashboard = "loading";
  state.errors.dashboard = "";
  render();
  try {
    const q = state.period ? `?period=${encodeURIComponent(state.period)}` : "";
    const data = await apiRequest(`/api/dashboard/summary${q}`, {}, { onUnauthorized: handleUnauthorized });
    state.dashboard = data;
    if (data.period) state.period = data.period;
    state.loading.dashboard = "ready";
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    state.errors.dashboard = err.message;
    state.loading.dashboard = "error";
  }
  render();
}

async function loadDraft() {
  try {
    const q = state.period ? `?period=${encodeURIComponent(state.period)}` : "";
    const data = await apiRequest(`/api/filing/draft${q}`, {}, { onUnauthorized: handleUnauthorized });
    state.draft = data.draft || {};
    state.filingStep = data.currentStep || 1;
  } catch {}
  render();
}

async function loadInvoices() {
  const q = state.period ? `?period=${encodeURIComponent(state.period)}` : "";
  state.loading.sales = "loading";
  state.loading.purchases = "loading";
  try {
    const [sRes, pRes] = await Promise.all([
      apiRequest(`/api/sales${q}`, {}, { onUnauthorized: handleUnauthorized }),
      apiRequest(`/api/purchases${q}`, {}, { onUnauthorized: handleUnauthorized })
    ]);
    state.sales = sRes.invoices || [];
    state.purchases = pRes.purchases || [];
    state.loading.sales = "ready";
    state.loading.purchases = "ready";
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    state.errors.sales = err.message;
    state.errors.purchases = err.message;
    state.loading.sales = "error";
    state.loading.purchases = "error";
  }
  render();
}

async function loadHistory() {
  state.loading.history = "loading";
  try {
    const [res, monthsRes] = await Promise.all([
      apiRequest("/api/returns/history", {}, { onUnauthorized: handleUnauthorized }),
      apiRequest("/api/returns/months-history?months=3", {}, { onUnauthorized: handleUnauthorized }).catch(() => ({ months: [] }))
    ]);
    state.filings = res.filings || [];
    state.monthlyHistory = monthsRes.months || [];
    state.loading.history = "ready";
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    state.errors.history = err.message;
    state.loading.history = "error";
  }
  render();
}

async function loadSecondary() {
  try {
    const [ep, st, pc] = await Promise.all([
      apiRequest("/api/expert/plans", {}, { onUnauthorized: handleUnauthorized }),
      apiRequest("/api/startup-express/profile", {}, { onUnauthorized: handleUnauthorized }),
      apiRequest("/api/customer/partner-consents", {}, { onUnauthorized: handleUnauthorized }).catch(() => ({ consents: [] }))
    ]);
    state.expertPlans = ep.plans || [];
    state.startupProfile = st.profile || null;
    state.partnerConsents = pc.consents || [];
  } catch {}
}

async function loadReconciliation() {
  state.reconciliation.loading = "loading";
  state.reconciliation.error = "";
  render();
  try {
    const q = state.period ? `?period=${encodeURIComponent(state.period)}` : "";
    const [sumRes, itemsRes] = await Promise.all([
      apiRequest(`/api/reconciliation/summary${q}`, {}, { onUnauthorized: handleUnauthorized }),
      apiRequest(`/api/reconciliation/items${q}`, {}, { onUnauthorized: handleUnauthorized })
    ]);
    state.reconciliation.summary = sumRes.summary || sumRes;
    state.reconciliation.items = itemsRes.items || [];
    state.reconciliation.loading = "ready";
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    state.reconciliation.error = err.message;
    state.reconciliation.loading = "error";
  }
  render();
}

async function runReconciliationMatch() {
  state.reconciliation.loading = "loading";
  state.reconciliation.error = "";
  render();
  try {
    await apiRequest("/api/reconciliation/run", {
      method: "POST",
      body: JSON.stringify({ period: state.period })
    }, { onUnauthorized: handleUnauthorized });
    await loadReconciliation();
    await loadDashboard();
    showToast("GSTR-2B reconciliation updated");
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    state.reconciliation.error = err.message;
    state.reconciliation.loading = "error";
    render();
  }
}

async function uploadDocumentFile(file, category) {
  if (!file) return;
  state.uploadingCategory = category;
  state.ocrReview = null;
  render();

  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("category", category);
    const res = await apiRequest("/api/documents/upload", {
      method: "POST",
      body: fd
    }, { onUnauthorized: handleUnauthorized });

    const ef = res.extractedFields || {};
    const activeState = state.activeGstin?.state_code || "27";
    const isSales = category === "sales_invoice";
    const partyGstin = isSales
      ? (ef.buyerGstin || ef.gstin || "")
      : (ef.sellerGstin || ef.gstin || "");

    state.ocrReview = {
      category,
      documentId: res.document?.id || null,
      filename: res.document?.original_name || file.name,
      confidenceScore: Number(res.ocr?.confidenceScore ?? ef.confidenceScore ?? 0.5),
      isScanned: Boolean(res.ocr?.isScanned || ef.isScanned),
      warnings: res.warnings || ef.warnings || [],
      confirmed: false,
      saving: false,
      error: "",
      fields: {
        invoiceNumber: ef.invoiceNumber || "",
        invoiceDate: ef.invoiceDate || new Date().toISOString().slice(0, 10),
        partyName: ef.partyName || "",
        gstin: partyGstin,
        pos: ef.pos || activeState,
        taxableAmount: ef.taxableAmount !== undefined ? ef.taxableAmount : "",
        gstRate: ef.gstRate !== undefined ? Number(ef.gstRate) : 18,
        itcEligibility: "ELIGIBLE",
        isRcm: Boolean(ef.isRcm)
      }
    };
    showToast(`Extracted details from ${file.name}`);
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    showToast(err.message || "File upload failed");
  } finally {
    state.uploadingCategory = null;
    render();
  }
}

async function approveOcrReview() {
  const ocr = state.ocrReview;
  if (!ocr) return;
  const f = ocr.fields;
  const isSales = ocr.category === "sales_invoice";
  if (!f.invoiceNumber || !f.taxableAmount) {
    ocr.error = "Invoice number and taxable value are required.";
    render();
    return;
  }

  ocr.saving = true;
  ocr.error = "";
  render();

  const payloadFields = {
    invoiceNumber: String(f.invoiceNumber).trim(),
    invoiceDate: f.invoiceDate,
    pos: String(f.pos || state.activeGstin?.state_code || "27").slice(0, 2),
    taxableAmount: Number(f.taxableAmount),
    gstRate: Number(f.gstRate ?? 18),
    period: state.period
  };

  if (isSales) {
    payloadFields.customerName = f.partyName || "Customer";
    if (f.gstin) payloadFields.customerGstin = String(f.gstin).trim().toUpperCase();
  } else {
    payloadFields.supplierName = f.partyName || "Supplier";
    payloadFields.supplierGstin = String(f.gstin || "27AAACM1234B1Z2").trim().toUpperCase();
    payloadFields.itcEligibility = f.itcEligibility || "ELIGIBLE";
    payloadFields.isRcm = Boolean(f.isRcm);
  }

  try {
    const res = await apiRequest("/api/ocr/approve", {
      method: "POST",
      body: JSON.stringify({
        documentId: ocr.documentId,
        invoiceType: ocr.category,
        fields: payloadFields
      })
    }, { onUnauthorized: handleUnauthorized });

    state.ocrReview = null;
    state.startFreshFiling = false;
    state.recentAddedId = res.invoice?.id || res.purchase?.id || null;
    if (res.period && res.period !== state.period) {
      state.period = res.period;
      await apiRequest("/api/context/period", {
        method: "POST",
        body: JSON.stringify({ period: res.period })
      }, { onUnauthorized: handleUnauthorized }).catch(() => {});
    }
    await Promise.all([loadDashboard(), loadInvoices()]);
    showToast(res.message || "Bill saved to register");
    setTimeout(() => { state.recentAddedId = null; }, 1600);
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    ocr.saving = false;
    ocr.error = err.message || "Could not save extracted bill.";
    render();
  }
}

async function deleteInvoiceRow(kind, id, invNum) {
  const isSales = kind === "sales";
  const existing = (isSales ? state.sales : state.purchases).find((r) => r.id === id);
  const tr = document.querySelector(`tr[data-row-id="${CSS.escape(id)}"]`);
  if (tr && !isMotionReduced()) {
    tr.classList.add("rm");
    await new Promise((r) => setTimeout(r, MOTION_TOKENS.rowDeleteMs || 340));
  }

  try {
    await apiRequest(`/api/${isSales ? "sales" : "purchases"}/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }, { onUnauthorized: handleUnauthorized });
    await Promise.all([loadDashboard(), loadInvoices()]);

    showToast(`Deleted ${invNum || "bill"}`, existing ? async () => {
      const restoreBody = isSales ? {
        invoiceNumber: existing.invoice_number,
        invoiceDate: existing.invoice_date,
        customerName: existing.customer_name,
        customerGstin: existing.customer_gstin,
        pos: existing.pos,
        taxableAmount: existing.taxable_amount,
        gstRate: existing.gst_rate,
        supplyType: existing.supply_type,
        period: existing.period
      } : {
        invoiceNumber: existing.invoice_number,
        invoiceDate: existing.invoice_date,
        supplierName: existing.supplier_name,
        supplierGstin: existing.supplier_gstin,
        pos: existing.pos,
        taxableAmount: existing.taxable_amount,
        gstRate: existing.gst_rate,
        itcEligibility: existing.itc_eligibility,
        isRcm: Boolean(existing.is_rcm),
        period: existing.period
      };
      await apiRequest(`/api/${isSales ? "sales" : "purchases"}`, {
        method: "POST",
        body: JSON.stringify(restoreBody)
      }, { onUnauthorized: handleUnauthorized });
      await Promise.all([loadDashboard(), loadInvoices()]);
      showToast(`Restored ${invNum || "bill"}`);
    } : null);
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    tr?.classList.remove("rm");
    showToast(err.message || "Could not delete bill");
  }
}

async function submitSimulatedReturn(otp) {
  if (!otp || otp.length !== 6) {
    state.filingError = "Enter a 6-digit Simulation EVC OTP (for example 123456).";
    render();
    return;
  }
  state.submittingReturn = true;
  state.filingError = "";
  render();
  try {
    const res = await apiRequest("/api/returns/gstr3b/file", {
      method: "POST",
      body: JSON.stringify({ period: state.period, otp, paymentDone: true })
    }, { onUnauthorized: handleUnauthorized });
    state.filingReceipt = res;
    state.startFreshFiling = false;
    state.submittingReturn = false;
    await Promise.all([loadDashboard(), loadHistory()]);
    launchCelebrationConfetti();
    showToast(`Filed (simulation) · ${res.arn}`);
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    state.submittingReturn = false;
    state.filingError = err.message || "Filing failed.";
    render();
  }
}

export async function loadAllBusinessData() {
  await Promise.all([loadDashboard(), loadDraft(), loadInvoices(), loadHistory(), loadSecondary()]);
  if (state.filingStep === 3) await loadReconciliation();
}

export async function switchGstin(gstinId) {
  if (!gstinId || gstinId === state.activeGstin?.id) return;
  abortAllRequests();
  clearBusinessCache();
  state.loading.dashboard = "loading";
  render();

  try {
    const res = await apiRequest(`/api/gstins/${encodeURIComponent(gstinId)}/activate`, {
      method: "POST",
      body: JSON.stringify({})
    }, { onUnauthorized: handleUnauthorized });

    if (res.activeGstin) state.activeGstin = res.activeGstin;
    updateHeaderControls();
    await loadAllBusinessData();
    showToast(`Switched to ${state.activeGstin?.gstin || "branch"}`);
  } catch (err) {
    if (err.name === "AbortError" || err.status === 401) return;
    state.errors.dashboard = err.message;
    state.loading.dashboard = "error";
    render();
  }
}

async function saveFilingStep(step) {
  state.filingStep = step;
  render();
  if (step === 3) loadReconciliation();
  try {
    await apiRequest("/api/filing/draft", {
      method: "PUT",
      body: JSON.stringify({ period: state.period, currentStep: step, draft: state.draft || {} })
    }, { onUnauthorized: handleUnauthorized });
  } catch (err) {
    if (err.status !== 401) showToast("Could not save draft progress");
  }
}

function navigateTo(view, step = null) {
  if (isCurtainRunning()) return;
  if (view === state.view && !step) return;
  $("#user-menu")?.classList.remove("open");

  const applyView = () => {
    state.view = view;
    if (step) state.filingStep = Number(step);
    window.scrollTo(0, 0);
    render();
    if (step) saveFilingStep(Number(step));
  };

  if (state.authenticated && ROUTE_INFO[view]) {
    sweepPageTransition(ROUTE_INFO[view], applyView);
  } else {
    applyView();
  }
}

async function askCopilot(question) {
  if (state.view !== "copilot") openCopilotPanel();
  state.copilotMessages.push({ role: "user", text: question });
  const pendingMsg = { role: "bot", text: "", typing: true };
  state.copilotMessages.push(pendingMsg);
  renderCopilotMessages();

  try {
    const res = await apiRequest("/api/copilot/ask", {
      method: "POST",
      body: JSON.stringify({ question, period: state.period })
    }, { onUnauthorized: handleUnauthorized });
    const fullText = res.answer || res.result?.answer || "No answer returned.";
    pendingMsg.typing = false;
    if (isMotionReduced()) {
      pendingMsg.text = fullText;
      renderCopilotMessages();
    } else {
      let idx = 0;
      const typeTick = () => {
        idx += 4;
        pendingMsg.text = fullText.slice(0, idx);
        renderCopilotMessages();
        if (idx < fullText.length) setTimeout(typeTick, 16);
      };
      typeTick();
    }
  } catch (err) {
    pendingMsg.typing = false;
    pendingMsg.text = err.message || "Could not reach Copilot.";
    renderCopilotMessages();
  }
}

function openCopilotPanel() {
  const pn = $("#copilot-panel");
  const fb = $("#copilot-fab");
  pn?.classList.add("o");
  pn?.setAttribute("aria-hidden", "false");
  fb?.classList.add("x");
  renderCopilotMessages();
  $("#copilot-input")?.focus();
}

function closeCopilotPanel() {
  const pn = $("#copilot-panel");
  const fb = $("#copilot-fab");
  pn?.classList.remove("o");
  pn?.setAttribute("aria-hidden", "true");
  if (state.view !== "copilot") fb?.classList.remove("x");
}

/* Ctrl/Cmd+K Quick-Search Palette */
const PALETTE_ITEMS = [
  { label: "Home", type: "go", val: "home", tag: "Go" },
  { label: "File GST Return", type: "go", val: "file", tag: "Go" },
  { label: "My Invoices", type: "go", val: "invoices", tag: "Go" },
  { label: "Filing History", type: "go", val: "history", tag: "Go" },
  { label: "GST Copilot", type: "go", val: "copilot", tag: "Go" },
  { label: "Tax Experts", type: "go", val: "experts", tag: "Go" },
  { label: "Start a business", type: "go", val: "startup", tag: "Go" },
  { label: "Settings & Branches", type: "go", val: "settings", tag: "Go" },
  { label: "Ask: How much tax do I owe?", type: "ask", val: "How much tax do I owe?", tag: "Copilot" },
  { label: "Ask: How much ITC can I claim?", type: "ask", val: "How much ITC can I claim?", tag: "Copilot" }
];
let palFiltered = PALETTE_ITEMS;
let palIdx = 0;

function renderPalette() {
  const q = ($("#pal-input")?.value || "").toLowerCase();
  palFiltered = PALETTE_ITEMS.filter((x) => x.label.toLowerCase().includes(q));
  palIdx = Math.max(0, Math.min(palIdx, palFiltered.length - 1));
  const listEl = $("#pal-list");
  if (!listEl) return;
  listEl.innerHTML = palFiltered.length
    ? palFiltered.map((x, i) => `<div class="pi ${i === palIdx ? "s" : ""}" data-pal-idx="${i}">${escapeHtml(x.label)} <kbd>${escapeHtml(x.tag)}</kbd></div>`).join("")
    : `<div class="pi">No match</div>`;
}

function openPalette() {
  const pal = $("#pal");
  if (!pal) return;
  pal.classList.add("o");
  pal.setAttribute("aria-hidden", "false");
  $("#pal-input").value = "";
  palIdx = 0;
  renderPalette();
  $("#pal-input")?.focus();
}

function closePalette() {
  const pal = $("#pal");
  if (!pal) return;
  pal.classList.remove("o");
  pal.setAttribute("aria-hidden", "true");
}

function runPaletteItem(item) {
  closePalette();
  if (!item) return;
  if (item.type === "go") navigateTo(item.val);
  else if (item.type === "ask") askCopilot(item.val);
}

async function init() {
  initReducedMotionPref();
  bindNavPillHover();
  bindDesktopPointerMotion();
  bindScrollProgress();

  try {
    const sess = await apiRequest("/api/auth/session");
    if (sess.authenticated) {
      applySessionPayload(sess);
      await loadAllBusinessData();
    } else {
      state.authenticated = false;
      state.demoCredentials = sess.demoLoginAvailable ? sess.demoCredentials : null;
      updateHeaderControls();
      render();
    }
  } catch {
    state.authenticated = false;
    updateHeaderControls();
    render();
  }
}

document.addEventListener("click", async (e) => {
  if (isCurtainRunning()) return;

  const palItem = e.target.closest("[data-pal-idx]");
  if (palItem) {
    runPaletteItem(palFiltered[Number(palItem.dataset.palIdx)]);
    return;
  }

  const goBtn = e.target.closest("[data-go]");
  if (goBtn) {
    navigateTo(goBtn.dataset.go, goBtn.dataset.step || null);
    return;
  }

  const stepBtn = e.target.closest("[data-step]");
  if (stepBtn) {
    await saveFilingStep(Number(stepBtn.dataset.step));
    return;
  }

  const invTabBtn = e.target.closest("[data-inv-tab]");
  if (invTabBtn) {
    state.invoiceTab = invTabBtn.dataset.invTab;
    render();
    return;
  }

  const delBtn = e.target.closest("[data-del-id]");
  if (delBtn) {
    await deleteInvoiceRow(delBtn.dataset.delKind, delBtn.dataset.delId, delBtn.dataset.delNum);
    return;
  }

  const swPeriodBtn = e.target.closest("[data-switch-period]");
  if (swPeriodBtn) {
    const p = swPeriodBtn.dataset.switchPeriod;
    state.period = p;
    await apiRequest("/api/context/period", { method: "POST", body: JSON.stringify({ period: p }) }).catch(() => {});
    await loadAllBusinessData();
    navigateTo("home");
    return;
  }

  const consentBtn = e.target.closest("[data-consent-id]");
  if (consentBtn) {
    try {
      await apiRequest(`/api/customer/partner-consents/${encodeURIComponent(consentBtn.dataset.consentId)}/respond`, {
        method: "POST",
        body: JSON.stringify({ action: consentBtn.dataset.consentAct })
      }, { onUnauthorized: handleUnauthorized });
      await loadSecondary();
      render();
      showToast(consentBtn.dataset.consentAct === "APPROVE" ? "Partner access approved" : "Partner access revoked");
    } catch (err) {
      showToast(err.message || "Action failed");
    }
    return;
  }

  const swBtn = e.target.closest("[data-switch-gstin]");
  if (swBtn) {
    await switchGstin(swBtn.dataset.switchGstin);
    return;
  }

  const actBtn = e.target.closest("[data-act]");
  if (actBtn) {
    const act = actBtn.dataset.act;
    if (act === "open-copilot-panel") openCopilotPanel();
    else if (act === "ask-chip") await askCopilot(actBtn.dataset.q || "");
    else if (act === "discard-ocr") {
      state.ocrReview = null;
      render();
    }
    else if (act === "toggle-auth-mode") {
      state.authMode = state.authMode === "register" ? "login" : "register";
      state.errors.auth = "";
      render();
    }
    else if (act === "fill-demo-login") {
      if (state.demoCredentials) {
        const em = $("#login-email");
        const pw = $("#login-password");
        if (em) em.value = state.demoCredentials.email || "";
        if (pw) pw.value = state.demoCredentials.password || "";
        showToast("Demo credentials filled");
      }
    }
    else if (act === "run-recon") await runReconciliationMatch();
    else if (act === "start-new-filing") {
      const currentPeriod = getCurrentPeriodMMYYYY();
      state.filingReceipt = null;
      state.startFreshFiling = true;
      state.filingError = "";
      state.filingStep = 1;
      state.ocrReview = null;
      state.recentAddedId = null;
      state.period = currentPeriod;
      await apiRequest("/api/context/period", {
        method: "POST",
        body: JSON.stringify({ period: currentPeriod })
      }, { onUnauthorized: handleUnauthorized }).catch(() => {});
      await apiRequest("/api/filing/draft", {
        method: "PUT",
        body: JSON.stringify({ period: currentPeriod, currentStep: 1, draft: {} })
      }, { onUnauthorized: handleUnauthorized }).catch(() => {});
      await loadAllBusinessData();
      navigateTo("home");
      showToast(`Started new filing for ${formatPeriodLabel(currentPeriod)}`);
    }
    else if (act === "export-ca-csv") {
      const q = state.period ? `period=${encodeURIComponent(state.period)}&` : "";
      window.open(`/api/ca-review/export?${q}format=csv`, "_blank", "noopener");
    }
    else if (act === "toggle-reduce-motion") {
      const next = !isMotionReduced();
      applyReducedMotionPref(next);
      actBtn.setAttribute("aria-checked", String(next));
      showToast(next ? "Animations reduced" : "Animations enabled");
    }
    else if (act === "reload-dashboard") await loadDashboard();
    else if (act === "reload-sales" || act === "reload-purchases") await loadInvoices();
    else if (act === "reload-history") await loadHistory();
    else if (act === "logout") {
      await apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
      handleUnauthorized("You have signed out.");
      state.sessionExpiredMessage = "";
      render();
    }
  }
});

document.addEventListener("change", async (e) => {
  const inp = e.target.closest("[data-upload-cat]");
  if (inp && inp.files && inp.files[0]) {
    const file = inp.files[0];
    const cat = inp.dataset.uploadCat;
    inp.value = "";
    await uploadDocumentFile(file, cat);
  }
});

document.addEventListener("dragover", (e) => {
  const dz = e.target.closest("[data-drop-cat]");
  if (dz) {
    e.preventDefault();
    dz.classList.add("on");
  }
});

document.addEventListener("dragleave", (e) => {
  const dz = e.target.closest("[data-drop-cat]");
  if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove("on");
});

document.addEventListener("drop", async (e) => {
  const dz = e.target.closest("[data-drop-cat]");
  if (!dz) return;
  e.preventDefault();
  dz.classList.remove("on");
  const file = e.dataTransfer?.files?.[0];
  if (file) await uploadDocumentFile(file, dz.dataset.dropCat);
});

$("#gstin-switcher")?.addEventListener("change", (e) => switchGstin(e.target.value));
$("#user-menu-btn")?.addEventListener("click", () => {
  const menu = $("#user-menu");
  const isOpen = menu?.classList.toggle("open");
  $("#user-menu-btn")?.setAttribute("aria-expanded", String(Boolean(isOpen)));
});
$("#copilot-close-btn")?.addEventListener("click", closeCopilotPanel);
$("#copilot-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const inp = $("#copilot-input");
  const q = inp?.value.trim();
  if (!q) return;
  inp.value = "";
  await askCopilot(q);
});
$("#pal-input")?.addEventListener("input", () => { palIdx = 0; renderPalette(); });
$("#pal")?.addEventListener("click", (e) => { if (e.target.id === "pal") closePalette(); });

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    const isOpen = $("#pal")?.classList.contains("o");
    if (isOpen) closePalette();
    else openPalette();
    return;
  }
  const palOpen = $("#pal")?.classList.contains("o");
  if (palOpen) {
    if (e.key === "Escape") closePalette();
    else if (e.key === "ArrowDown") { palIdx = Math.min(palFiltered.length - 1, palIdx + 1); renderPalette(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { palIdx = Math.max(0, palIdx - 1); renderPalette(); e.preventDefault(); }
    else if (e.key === "Enter" && palFiltered[palIdx]) runPaletteItem(palFiltered[palIdx]);
    return;
  }
  if (e.key === "Escape") {
    closeCopilotPanel();
    $("#user-menu")?.classList.remove("open");
  }
});

if (typeof window !== "undefined" && !window.__SIMPLEGST_TEST_MODE__) {
  init();
}
