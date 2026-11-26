import { state, clearBusinessCache } from "./state.js";
import { apiRequest, abortAllRequests, setCsrfToken } from "./api.js";
import { escapeHtml } from "./utils.js";
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

function showToast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
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
  document.querySelectorAll("[data-go]").forEach((btn) => {
    if (btn.dataset.go === state.view) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
}

function renderCopilotDrawerMessages() {
  const box = $("#copilot-msgs");
  if (!box) return;
  if (state.copilotMessages.length === 0) {
    box.innerHTML = `<div class="msg bot">Ask me about your tax payable, eligible ITC, or filing deadline.</div>`;
    return;
  }
  box.innerHTML = state.copilotMessages
    .map((m) => `<div class="msg ${m.role === "user" ? "user" : "bot"}">${escapeHtml(m.text)}</div>`)
    .join("");
  box.scrollTop = box.scrollHeight;
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
  state.period = data.activePeriod || "102026";
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
    const res = await apiRequest("/api/returns/history", {}, { onUnauthorized: handleUnauthorized });
    state.filings = res.filings || [];
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
    const [ep, st] = await Promise.all([
      apiRequest("/api/expert/plans", {}, { onUnauthorized: handleUnauthorized }),
      apiRequest("/api/startup-express/profile", {}, { onUnauthorized: handleUnauthorized })
    ]);
    state.expertPlans = ep.plans || [];
    state.startupProfile = st.profile || null;
  } catch {}
}

export async function loadAllBusinessData() {
  await Promise.all([loadDashboard(), loadDraft(), loadInvoices(), loadHistory(), loadSecondary()]);
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
  try {
    await apiRequest("/api/filing/draft", {
      method: "PUT",
      body: JSON.stringify({ period: state.period, currentStep: step, draft: state.draft || {} })
    }, { onUnauthorized: handleUnauthorized });
  } catch (err) {
    if (err.status !== 401) showToast("Could not save draft progress");
  }
}

async function askCopilot(question) {
  state.copilotMessages.push({ role: "user", text: question });
  renderCopilotDrawerMessages();
  if (state.view === "copilot") render();
  try {
    const res = await apiRequest("/api/copilot/ask", {
      method: "POST",
      body: JSON.stringify({ question, period: state.period })
    }, { onUnauthorized: handleUnauthorized });
    const answer = res.answer || res.result?.answer || "No answer returned.";
    state.copilotMessages.push({ role: "bot", text: answer });
  } catch (err) {
    state.copilotMessages.push({ role: "bot", text: err.message || "Could not reach Copilot." });
  }
  renderCopilotDrawerMessages();
  if (state.view === "copilot") render();
}

function toggleCopilotDrawer(forceState) {
  state.copilotOpen = typeof forceState === "boolean" ? forceState : !state.copilotOpen;
  $("#copilot-drawer")?.classList.toggle("open", state.copilotOpen);
  $("#copilot-drawer")?.setAttribute("aria-hidden", String(!state.copilotOpen));
  $("#copilot-backdrop")?.classList.toggle("open", state.copilotOpen);
  if (state.copilotOpen) {
    renderCopilotDrawerMessages();
    $("#copilot-input")?.focus();
  }
}

async function init() {
  try {
    const sess = await apiRequest("/api/auth/session");
    if (sess.authenticated) {
      applySessionPayload(sess);
      await loadAllBusinessData();
    } else {
      state.authenticated = false;
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
  const goBtn = e.target.closest("[data-go]");
  if (goBtn) {
    state.view = goBtn.dataset.go;
    $("#user-menu")?.classList.remove("open");
    if (goBtn.dataset.step) {
      await saveFilingStep(Number(goBtn.dataset.step));
    } else {
      render();
    }
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

  const swBtn = e.target.closest("[data-switch-gstin]");
  if (swBtn) {
    await switchGstin(swBtn.dataset.switchGstin);
    return;
  }

  const actBtn = e.target.closest("[data-act]");
  if (actBtn) {
    const act = actBtn.dataset.act;
    if (act === "toggle-copilot") toggleCopilotDrawer();
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

$("#gstin-switcher")?.addEventListener("change", (e) => switchGstin(e.target.value));
$("#user-menu-btn")?.addEventListener("click", () => {
  const menu = $("#user-menu");
  const isOpen = menu?.classList.toggle("open");
  $("#user-menu-btn")?.setAttribute("aria-expanded", String(Boolean(isOpen)));
});
$("#copilot-close-btn")?.addEventListener("click", () => toggleCopilotDrawer(false));
$("#copilot-backdrop")?.addEventListener("click", () => toggleCopilotDrawer(false));
$("#copilot-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const inp = $("#copilot-input");
  const q = inp?.value.trim();
  if (!q) return;
  inp.value = "";
  await askCopilot(q);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    toggleCopilotDrawer(false);
    $("#user-menu")?.classList.remove("open");
  }
});

if (typeof window !== "undefined" && !window.__SIMPLEGST_TEST_MODE__) {
  init();
}

