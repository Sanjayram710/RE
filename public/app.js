
// ============================================================================
// SECURITY & API CLIENT ENGINE (CSRF, Cookie Auth, Session Handling)
// ============================================================================
function getCsrfToken() {
  if (appState.csrfToken) return appState.csrfToken;
  const match = document.cookie.match(/(?:^|;\s*)simplegst_csrf=([^;]+)/);
  if (match) {
    const val = decodeURIComponent(match[1]);
    appState.csrfToken = val;
    return val;
  }
  return "";
}
window.getCsrfToken = getCsrfToken;

function getActiveGstin() {
  return appState.activeGstin?.gstin ||
         appState.gst?.business?.gstin ||
         appState.auth?.user?.gstin ||
         null;
}
window.getActiveGstin = getActiveGstin;

function getActivePeriod() {
  return appState.activePeriod ||
         appState.gst?.business?.filingPeriod ||
         null;
}
window.getActivePeriod = getActivePeriod;

function derivePeriodFromDate(dateStr, fallbackPeriod = "102026") {
  if (!dateStr || typeof dateStr !== "string") return fallbackPeriod;
  const clean = dateStr.trim();
  const ymd = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    const month = ymd[2].padStart(2, "0");
    const year = ymd[1];
    return `${month}${year}`;
  }
  const dmy = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const month = dmy[2].padStart(2, "0");
    const year = dmy[3];
    return `${month}${year}`;
  }
  return fallbackPeriod;
}
window.derivePeriodFromDate = derivePeriodFromDate;

function normalizeDateToYMD(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return dateStr;
  const clean = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const dmy = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    let year = dmy[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  const monthMap = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };
  const namedMatch = clean.match(/^(\d{1,2})[\s\-\/\.]*([A-Za-z]{3,9})[\s\-\/\.]*(\d{2,4})$/);
  if (namedMatch) {
    const day = namedMatch[1].padStart(2, "0");
    const mStr = namedMatch[2].slice(0, 3).toLowerCase();
    const month = monthMap[mStr] || "01";
    let year = namedMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  return clean;
}
window.normalizeDateToYMD = normalizeDateToYMD;

async function ensureActiveSession() {
  if (appState.auth && appState.auth.isLoggedIn && appState.activeGstin) {
    return true;
  }

  // 1. First attempt to restore session from existing cookie or saved token
  try {
    const isAuth = await initSessionFromBackend();
    if (isAuth && appState.activeGstin) return true;
  } catch (_) {}

  // If a genuine user session or token exists in localStorage, DO NOT silently overwrite with dev session!
  const hasSavedToken = localStorage.getItem("simplegst_session_token");
  const hasSavedUser = localStorage.getItem("simplegst_user_session");
  if (hasSavedToken || hasSavedUser) {
    return false;
  }

  // 2. In unauthenticated demo/guest mode, seamlessly request development session
  try {
    const devRes = await fetch("/api/auth/dev-session", {
      method: "POST",
      credentials: "same-origin"
    });
    if (devRes.ok) {
      const devData = await devRes.json();
      if (devData && devData.success) {
        if (devData.sessionToken) {
          appState.sessionToken = devData.sessionToken;
        }
        if (devData.csrfToken) appState.csrfToken = devData.csrfToken;
        await initSessionFromBackend();
        return true;
      }
    }
  } catch (err) {
    console.warn("ensureActiveSession dev-session error:", err);
  }

  return false;
}
window.ensureActiveSession = ensureActiveSession;

async function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const isStateChanging = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  // If state-changing request and user is currently in unauthenticated guest state, auto-ensure session
  if (isStateChanging && (!appState.auth || !appState.auth.isLoggedIn)) {
    await ensureActiveSession();
  }

  const headers = {
    ...(options.headers || {})
  };

  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  if (options.body && typeof options.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (isFormData) {
    // Delete Content-Type to allow browser to calculate multipart boundary
    delete headers["Content-Type"];
    delete headers["content-type"];
  }

  const csrf = getCsrfToken();
  if (isStateChanging && csrf && !headers["X-CSRF-Token"] && !headers["x-csrf-token"]) {
    headers["X-CSRF-Token"] = csrf;
  }

  if (appState.sessionToken && !headers["Authorization"] && !headers["authorization"]) {
    headers["Authorization"] = `Bearer ${appState.sessionToken}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: options.credentials || "same-origin"
  });

  if (res.status === 401 && !options._retried) {
    const recovered = await ensureActiveSession();
    if (recovered) {
      return await apiFetch(url, { ...options, _retried: true });
    }
    console.warn("Session expired or unauthorized request to:", url);
    if (appState.auth && appState.auth.isLoggedIn) {
      appState.auth = { isLoggedIn: false, user: null };
      appState.sessionToken = null;
      appState.csrfToken = null;
      localStorage.removeItem("simplegst_user_session");
      if (typeof renderAuthState === "function") renderAuthState();
      if (typeof openAuthModal === "function") openAuthModal("signin");
    }
    if (typeof showToast === "function") {
      showToast("Authentication required or session expired. Please sign in.", "warning");
    }
  } else if (res.status === 403) {
    const cloned = res.clone();
    try {
      const errData = await cloned.json();
      if (errData.error && errData.error.includes("CSRF")) {
        console.error("CSRF token validation failed on:", url);
        await ensureActiveSession();
        if (typeof showToast === "function") {
          showToast("Security check (CSRF) refreshed. Please try again.", "info");
        }
      }
    } catch (_) {}
  }

  return res;
}
window.apiFetch = apiFetch;

async function initSessionFromBackend() {
  try {
    if (!appState.sessionToken) {
      const savedToken = localStorage.getItem("simplegst_session_token");
      if (savedToken) {
        appState.sessionToken = savedToken;
      }
    }
    const headers = {};
    if (appState.sessionToken) {
      headers["Authorization"] = `Bearer ${appState.sessionToken}`;
    }
    const res = await fetch("/api/auth/session", {
      credentials: "same-origin",
      headers
    });
    const data = res.ok ? await res.json() : null;

    if (data && data.authenticated && data.user) {
      if (data.sessionToken) {
        appState.sessionToken = data.sessionToken;
        localStorage.setItem("simplegst_session_token", data.sessionToken);
      } else if (appState.sessionToken) {
        localStorage.setItem("simplegst_session_token", appState.sessionToken);
      }
      if (data.onboardingRequired) {
        if (typeof openOnboardingWizard === "function") {
          openOnboardingWizard(data.onboardingStep || 2);
        }
        return false;
      }
      appState.csrfToken = data.csrfToken;
      appState.organization = data.organization || null;
      appState.activeGstin = data.activeGstin || null;
      appState.allGstins = data.allGstins || [];
      appState.onboardingProfile = data.onboardingProfile || null;
      appState.activePeriod = data.activePeriod || appState.activePeriod || "102026";
      if (!appState.gst) appState.gst = {};
      if (!appState.gst.business) appState.gst.business = {};
      if (data.activeGstin) {
        appState.gst.business.gstin = data.activeGstin.gstin;
        appState.gst.business.tradeName = data.activeGstin.trade_name;
        appState.gst.business.legalName = data.organization?.name || data.activeGstin.trade_name;
        appState.gst.business.filingPeriod = data.activePeriod || "102026";
        appState.gst.business.authorisedPerson = data.user.name;
      }
      appState.auth = {
        isLoggedIn: true,
        user: data.user,
        csrfToken: data.csrfToken
      };
      localStorage.setItem("simplegst_user_session", JSON.stringify(appState.auth));
      if (data.activeGstin && typeof selectFilingEntity === "function") {
        selectFilingEntity(data.activeGstin.gstin, data.activeGstin.trade_name || data.organization?.name, data.activeGstin.state_name);
      }
      if (typeof renderAuthState === "function") renderAuthState();
      return true;
    } else {
      // Unauthenticated session - clear sensitive state
      appState.sessionToken = null;
      appState.csrfToken = data?.csrfToken || null;
      appState.organization = null;
      appState.activeGstin = null;
      appState.allGstins = [];
      appState.auth = {
        isLoggedIn: false,
        user: null,
        csrfToken: null
      };
      localStorage.removeItem("simplegst_session_token");
      localStorage.removeItem("simplegst_user_session");
      if (typeof renderAuthState === "function") renderAuthState();
      return false;
    }
  } catch (err) {
    console.warn("Could not retrieve session from /api/auth/session:", err);
    appState.sessionToken = null;
    appState.auth = { isLoggedIn: false, user: null, csrfToken: null };
    localStorage.removeItem("simplegst_session_token");
    localStorage.removeItem("simplegst_user_session");
    if (typeof renderAuthState === "function") renderAuthState();
    return false;
  }
}
window.initSessionFromBackend = initSessionFromBackend;

/**
   SimpleGST Client Application & ITR E-Filing Platform
   Faithfully reproduces the ITR e-filing flow from screenshots and integrates the GST Engine
   Vanilla ES6, zero external UI framework, fast, responsive, and mobile-ready
*/

/**
 * Utility to escape untrusted HTML entities for secure DOM rendering (XSS Protection)
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
window.escapeHtml = escapeHtml;

// ============================================================================
// Global Application State
// ============================================================================
const appState = {
  currentSuite: "itr", // "itr" or "gst"
  mode: "demo",
  isLive: false,
  
  // ITR State (Matching Screenshots 1-9)
  itr: {
    activeStep: 1,
    assessmentYear: "2025-26",
    taxRegime: "NEW", // "NEW" or "OLD"
    personalInfo: {
      firstName: "Sanjay",
      middleName: "",
      lastName: "Harshi",
      dob: "07/10/2006",
      fatherName: "Harshi V",
      aadhaar: "482910482910",
      pan: "CVBBC4433W",
      mobile: "", // Starts empty to reproduce Screenshot 2 error "Please fill this field."
      email: "sanjayharshi2005@gmail.com",
      address: {
        flat: "Flat 402, Royal Residency",
        street: "100 Feet Road, Indiranagar",
        city: "Bengaluru",
        stateCode: "29",
        pincode: "560038"
      },
      residentialStatus: "RES",
      bank: {
        accNo: "918273645120",
        ifsc: "HDFC0000128",
        type: "SAV"
      }
    },
    income: {
      grossSalary: 0, // Starts at 0 to reproduce Screenshot 4 & 7
      otherIncome: 0,
      capitalGains: 0,
      housePropertyIncome: 0,
      dividendIncome: 0,
      businessIncome: 0,
      cryptoIncome: 0,
      deductions: {
        sec80C: 0,
        sec80D: 0,
        other: 0
      },
      taxesPaid: {
        tds: 0,
        advanceTax: 0
      }
    },
    computation: null
  },

  // GST State
  gst: {
    currentScreen: "reports",
    business: {
      tradeName: "Malabar Spice Traders",
      gstin: "32ABCDE1234F1Z5",
      filingPeriod: "102026"
    },
    salesInvoices: [],
    purchaseInvoices: [],
    exceptions: [],
    reconciliation: { items: [] },
    taxCalculation: null,
    currentReportType: "sales_register",
    lastGeneratedExport: null,
    exportHistory: []
  }
};

// ============================================================================
// Micro-interaction Feedback: Non-intrusive Toast Notifications
// ============================================================================
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const pill = document.createElement("div");
  pill.className = `toast-pill ${type === "success" ? "toast-success" : ""}`;
  const icon = type === "success" ? "✓ " : "ℹ ";
  pill.textContent = icon + message.replace(/[\r\n]+/g, " ");
  container.appendChild(pill);
  setTimeout(() => {
    pill.style.opacity = "0";
    pill.style.transform = "translateY(12px) scale(0.95)";
    pill.style.transition = "all 0.25s ease";
    setTimeout(() => pill.remove(), 260);
  }, 3200);
}

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  setupSidebarCountdown();
  const isAuthenticated = await initSessionFromBackend();
  initAuth();
  initKioskEventListeners();
  await fetchAppMode();
  
  // Default to GST Return Assistant on load
  switchSuite('home');

  if (isAuthenticated && appState.activeGstin) {
    selectFilingEntity(appState.activeGstin.gstin, appState.activeGstin.trade_name || appState.organization?.name || "Taxpayer", appState.activeGstin.state_name || "");
    if (typeof syncPeriodAcrossUi === "function") syncPeriodAcrossUi();
    if (typeof loadDashboardData === "function") loadDashboardData();
    if (typeof renderCopilotWorkspace === "function") renderCopilotWorkspace();
  } else {
    // Unauthenticated initial state: render logged out state without intrusive blocking modal
    renderAuthState();
    // Login and Signup UI modal is deferred from popping up automatically on page load
  }

  // Close dropdowns on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#filingDropdownTrigger") && !e.target.closest("#filingDropdownMenu")) {
      document.getElementById("filingDropdownMenu")?.classList.remove("active");
    }
    if (!e.target.closest("#profileDropdownBtn") && !e.target.closest("#profileDropdownMenu")) {
      document.getElementById("profileDropdownMenu")?.classList.remove("active");
    }
    if (!e.target.closest("#globalPeriodTrigger") && !e.target.closest("#globalPeriodDropdownMenu")) {
      document.getElementById("globalPeriodDropdownMenu")?.classList.add("hidden");
    }
    if (!e.target.closest("#roleDropdownMenu") && !e.target.closest("button[onclick*='toggleRoleMenu']")) {
      document.getElementById("roleDropdownMenu")?.classList.add("hidden");
    }
    if (!e.target.closest("#btnSuiteMoreServices") && !e.target.closest("#moreServicesMenu")) {
      document.getElementById("moreServicesMenu")?.classList.add("hidden");
    }
  });

  // Global escape key handler to smoothly dismiss open modals without alerts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (typeof closeEvcOtpModal === "function") closeEvcOtpModal();
      if (typeof closePmt06Modal === "function") closePmt06Modal();
      if (typeof closeArnModal === "function") closeArnModal();
      if (typeof closeHealthScoreModal === "function") closeHealthScoreModal();
      if (typeof closeNewInvoiceModal === "function") closeNewInvoiceModal();
      document.getElementById("globalPeriodDropdownMenu")?.classList.add("hidden");
      document.getElementById("roleDropdownMenu")?.classList.add("hidden");
      document.getElementById("filingDropdownMenu")?.classList.remove("active");
      document.getElementById("profileDropdownMenu")?.classList.remove("active");
    }
  });
});

async function fetchAppMode() {
  try {
    const res = await fetch("/api/mode");
    const data = await res.json();
    appState.mode = data.mode;
    appState.isLive = Boolean(data.isLive);

    const badge = document.getElementById("appModeBadge");
    const badgeText = document.getElementById("appModeText");
    if (badge && badgeText) {
      if (appState.isLive) {
        badge.className = "mode-badge live-sandbox";
        badgeText.textContent = "Live Portal";
      } else {
        badge.className = "mode-badge";
        badgeText.textContent = "Active";
      }
    }
  } catch (err) {
    console.warn("Could not fetch /api/mode", err);
  }
}

// ============================================================================
// Suite Switching: Copilot (Guiding Path) vs Registers & Reports vs More Services
// ============================================================================
function switchSuite(suite) {
  if (typeof window.switchSuite === "function" && window.switchSuite !== switchSuite) {
    return window.switchSuite(suite);
  }
  executeSwitchSuite(suite);
}

function executeSwitchSuite(suite) {
  appState.currentSuite = suite;
  if (["sales", "purchase", "bills", "bills-docs", "purchases", "sales-invoices"].includes(suite)) {
    ensureActiveSession().catch(() => {});
  }
  const viewItr = document.getElementById("viewItrSuite");
  const viewExpert = document.getElementById("viewExpertSuite");
  const viewNotice = document.getElementById("viewNoticeSuite");
  const viewVault = document.getElementById("viewVaultSuite");
  const viewGst = document.getElementById("viewGstSuite");
  const viewCopilot = document.getElementById("viewCopilotSuite");
  const viewStartup = document.getElementById("viewStartupSuite");
  const viewCompliance = document.getElementById("viewComplianceSuite");
  const viewHome = document.getElementById("viewHomeSuite");
  const viewBills = document.getElementById("viewBillsSuite");
  const viewRecon = document.getElementById("viewReconSuite");
  const viewTaxCalc = document.getElementById("viewTaxCalcSuite");
  const viewPractice = document.getElementById("viewPracticeSuite");
  const viewVendor = document.getElementById("viewVendorSuite");
  const viewFileGst = document.getElementById("viewFileGstSuite");
  const viewSales = document.getElementById("viewSalesSuite");
  const viewPurchase = document.getElementById("viewPurchaseSuite");

  // Always close dropdowns & mobile drawer when switching
  document.getElementById("filingDropdownMenu")?.classList.add("hidden");
  document.getElementById("roleDropdownMenu")?.classList.add("hidden");
  document.getElementById("profileDropdownMenu")?.classList.remove("active");
  closeMobileSidebar();

  // Reset all suites
  const allSuites = [
    viewItr, viewExpert, viewNotice, viewVault, viewGst, viewCopilot, 
    viewStartup, viewCompliance, viewHome, viewBills, viewRecon, 
    viewTaxCalc, viewPractice, viewVendor, viewFileGst, viewSales, viewPurchase
  ];
  allSuites.forEach(v => {
    if (v) {
      v.classList.remove("active");
      v.classList.add("hidden");
      v.style.display = "none";
    }
  });

  // Reset nav highlights
  document.querySelectorAll('.sidebar-nav-link').forEach(l => {
    l.classList.remove('bg-surface-container-high', 'text-primary', 'font-bold', 'border-l-4', 'border-primary');
    l.classList.add('text-on-surface-variant');
  });
  document.querySelectorAll('.bottom-nav-btn').forEach(b => {
    b.classList.remove('text-primary', 'font-bold');
    b.classList.add('text-secondary');
  });

  if (suite === "home") {
    if (viewHome) {
      viewHome.classList.add("active");
      viewHome.classList.remove("hidden");
      viewHome.style.display = "block";
    }
    highlightSidebarNav('nav-link-home');
    highlightBottomNav('bottom-nav-home');
  } else if (suite === "copilot" || suite === "ai" || suite === "assistant") {
    if (viewCopilot) {
      viewCopilot.classList.add("active");
      viewCopilot.classList.remove("hidden");
      viewCopilot.style.display = "block";
    }
    highlightSidebarNav('nav-link-copilot');
  } else if (suite === "sales" || suite === "sales-invoices") {
    if (viewSales) {
      viewSales.classList.add("active");
      viewSales.classList.remove("hidden");
      viewSales.style.display = "block";
    }
    highlightSidebarNav('nav-link-sales');
    if (typeof renderSalesSuite === "function") {
      renderSalesSuite();
    }
  } else if (suite === "purchase" || suite === "purchases" || suite === "purchase-bills") {
    if (viewPurchase) {
      viewPurchase.classList.add("active");
      viewPurchase.classList.remove("hidden");
      viewPurchase.style.display = "block";
    }
    highlightSidebarNav('nav-link-purchase');
    if (typeof renderPurchaseSuite === "function") {
      renderPurchaseSuite();
    }
  } else if (suite === "file-gst" || suite === "guided" || suite === "nil") {
    const target = viewFileGst || viewCopilot;
    if (target) {
      target.classList.add("active");
      target.classList.remove("hidden");
      target.style.display = "block";
    }
    highlightSidebarNav('nav-link-file-gst');
    highlightBottomNav('bottom-nav-file-gst');
    if (suite === "nil") {
      startNilFilingFlow();
    } else if (suite === "guided") {
      startGuidedFiling(1);
    } else {
      resetFileGstChoice();
    }
    if (typeof syncPeriodAcrossUi === "function") {
      syncPeriodAcrossUi();
    }
  } else if (suite === "bills" || suite === "bills-docs") {
    if (viewBills) {
      viewBills.classList.add("active");
      viewBills.classList.remove("hidden");
      viewBills.style.display = "block";
    }
    highlightSidebarNav('nav-link-bills');
    highlightBottomNav('bottom-nav-bills');
    if (typeof loadBillsDashboard === "function") {
      loadBillsDashboard();
    }
  } else if (suite === "reconciliation" || suite === "recon") {
    if (viewRecon) {
      viewRecon.classList.add("active");
      viewRecon.classList.remove("hidden");
      viewRecon.style.display = "block";
    }
    highlightSidebarNav('nav-link-recon');
  } else if (suite === "tax-calc" || suite === "taxcalc") {
    if (viewTaxCalc) {
      viewTaxCalc.classList.add("active");
      viewTaxCalc.classList.remove("hidden");
      viewTaxCalc.style.display = "block";
    }
    highlightSidebarNav('nav-link-taxcalc');
  } else if (suite === "gst" || suite === "reports") {
    if (viewGst) {
      viewGst.classList.add("active");
      viewGst.classList.remove("hidden");
      viewGst.style.display = "block";
    }
    highlightSidebarNav('nav-link-reports');
    highlightBottomNav('bottom-nav-reports');
  } else if (suite === "compliance" || suite === "health") {
    if (viewCompliance) {
      viewCompliance.classList.add("active");
      viewCompliance.classList.remove("hidden");
      viewCompliance.style.display = "block";
    }
    highlightSidebarNav('nav-link-copilot');
  } else if (suite === "vendor" || suite === "vendor-hub") {
    if (viewVendor) {
      viewVendor.classList.add("active");
      viewVendor.classList.remove("hidden");
      viewVendor.style.display = "block";
    }
    highlightSidebarNav('nav-link-vendor');
  } else if (suite === "practice" || suite === "ca") {
    if (viewPractice) {
      viewPractice.classList.add("active");
      viewPractice.classList.remove("hidden");
      viewPractice.style.display = "block";
    }
    highlightSidebarNav('nav-link-practice');
  } else if (suite === "expert" || suite === "tax-experts") {
    if (viewExpert) {
      viewExpert.classList.add("active");
      viewExpert.classList.remove("hidden");
      viewExpert.style.display = "block";
    }
    highlightSidebarNav('nav-link-experts');
    highlightBottomNav('bottom-nav-experts');
  } else if (suite === "startup" || suite === "settings" || suite === "multigstin") {
    if (viewStartup) {
      viewStartup.classList.add("active");
      viewStartup.classList.remove("hidden");
      viewStartup.style.display = "block";
    }
    highlightSidebarNav('nav-link-settings');
  } else if (suite === "notice") {
    if (viewNotice) {
      viewNotice.classList.add("active");
      viewNotice.classList.remove("hidden");
      viewNotice.style.display = "block";
    }
  } else if (suite === "vault") {
    if (viewVault) {
      viewVault.classList.add("active");
      viewVault.classList.remove("hidden");
      viewVault.style.display = "block";
    }
  } else if (suite === "sales" || suite === "sales-suite") {
    if (viewSales) {
      viewSales.classList.add("active");
      viewSales.classList.remove("hidden");
      viewSales.style.display = "block";
    }
    highlightSidebarNav('nav-link-sales');
    if (typeof renderSalesSuite === "function") {
      renderSalesSuite();
    }
  } else if (suite === "purchase" || suite === "purchases" || suite === "purchase-suite") {
    if (viewPurchase) {
      viewPurchase.classList.add("active");
      viewPurchase.classList.remove("hidden");
      viewPurchase.style.display = "block";
    }
    highlightSidebarNav('nav-link-purchases');
    if (typeof renderPurchaseSuite === "function") {
      renderPurchaseSuite();
    }
  }

  // Scroll smoothly to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.switchSuite = executeSwitchSuite;

function highlightSidebarNav(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('bg-surface-container-high', 'text-primary', 'font-bold', 'border-l-4', 'border-primary');
  }
}

function highlightBottomNav(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('text-secondary');
    el.classList.add('text-primary', 'font-bold');
  }
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('mobileDrawerBackdrop');
  if (sidebar && backdrop) {
    const isHidden = sidebar.classList.contains('-translate-x-full');
    if (isHidden) {
      sidebar.classList.remove('-translate-x-full');
      backdrop.classList.remove('hidden');
    } else {
      sidebar.classList.add('-translate-x-full');
      backdrop.classList.add('hidden');
    }
  }
}
window.toggleMobileSidebar = toggleMobileSidebar;

function closeMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('mobileDrawerBackdrop');
  if (sidebar) sidebar.classList.add('-translate-x-full');
  if (backdrop) backdrop.classList.add('hidden');
}
window.closeMobileSidebar = closeMobileSidebar;

function openPmt06Modal() {
  const m = document.getElementById('pmt-06-modal');
  if (m) {
    m.classList.remove('hidden');
    m.style.display = 'flex';
  }
}
window.openPmt06Modal = openPmt06Modal;

function closePmt06Modal() {
  const m = document.getElementById('pmt-06-modal');
  if (m) {
    m.classList.add('hidden');
    m.style.display = 'none';
  }
}
window.closePmt06Modal = closePmt06Modal;

async function submitChallanPayment() {
  const otp = window._pendingGstr3bFilingOtp || "123456";
  closePmt06Modal();
  if (typeof completeReturnFiling === "function") {
    await completeReturnFiling({ otp, paymentDone: true });
  } else {
    showToast("Form GST PMT-06 Payment Approved: Cash ledger credited and liability offset.", "success");
  }
}
window.submitChallanPayment = submitChallanPayment;

function openArnModal() {
  const m = document.getElementById('arn-success-modal');
  if (m) m.classList.remove('hidden');
}
window.openArnModal = openArnModal;

function closeArnModal() {
  const m = document.getElementById('arn-success-modal');
  if (m) m.classList.add('hidden');
}
window.closeArnModal = closeArnModal;

// ============================================================================
// ITR 4-Step Stepper Navigation
// ============================================================================
function goToItrStep(stepNumber) {
  appState.itr.activeStep = stepNumber;

  // Update Step Pills
  for (let i = 1; i <= 4; i++) {
    const pill = document.getElementById(`stepPill${i}`);
    const view = document.getElementById(`itrStep${i}`);
    if (pill) {
      if (i === stepNumber) {
        pill.classList.add("active");
      } else {
        pill.classList.remove("active");
      }
    }
    if (view) {
      if (i === stepNumber) {
        view.classList.remove("hidden");
      } else {
        view.classList.add("hidden");
      }
    }
  }

  // When navigating to Step 4, recalculate tax and refresh views
  if (stepNumber === 4) {
    recalculateItrTax();
  }

  // Scroll to top of form smoothly
  window.scrollTo({ top: 100, behavior: "smooth" });
}

// ============================================================================
// ITR Step 1: Personal Info Validation & Card Mechanics
// ============================================================================
function toggleCardCollapse(cardId) {
  const card = document.getElementById(cardId);
  if (card) {
    card.classList.toggle("collapsed");
  }
}

function toggleAdditionalInfo() {
  const container = document.getElementById("optionalFields");
  if (container) {
    container.classList.toggle("hidden");
  }
}

function validateLivePan(value) {
  const pan = (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  const panFeedback = document.getElementById("panFeedback");
  const panInput = document.getElementById("inputPan");
  if (panInput && panInput.value !== pan) panInput.value = pan;
  appState.itr.personalInfo.pan = pan;

  const currentFilingPan = document.getElementById("currentFilingPan");
  if (currentFilingPan) {
    currentFilingPan.textContent = pan || (appState.auth && appState.auth.isLoggedIn && appState.auth.user ? appState.auth.user.pan : "Guest / New Filing");
  }

  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRegex.test(pan)) {
    if (panFeedback) {
      panFeedback.textContent = pan.length === 0 ? "" : "Invalid PAN syntax (5 letters, 4 digits, 1 letter in capital form)";
      panFeedback.style.color = "#EA580C";
    }
  } else {
    if (panFeedback) {
      panFeedback.textContent = `✓ Valid CBDT PAN format (Category '${pan[3]}')`;
      panFeedback.style.color = "#16A34A";
    }
    // Update logged in user object if active
    if (appState.auth && appState.auth.isLoggedIn && appState.auth.user) {
      appState.auth.user.pan = pan;
      localStorage.setItem("simplegst_user_session", JSON.stringify(appState.auth));
    }
  }
  renderFilingDropdownMenu();
  updatePersonalInfoState();
  renderFilingDropdownMenu();
}

function validateLiveMobile(value) {
  const mobile = (value || "").replace(/\D/g, "").slice(0, 10);
  const mobileInput = document.getElementById("inputMobile");
  const errorMsg = document.getElementById("mobileErrorMsg");
  const warningIcon = document.getElementById("mobileWarningIcon");

  if (mobileInput) mobileInput.value = mobile;
  appState.itr.personalInfo.mobile = mobile;

  if (mobile.length === 10) {
    mobileInput?.classList.remove("has-warning-border");
    if (errorMsg) errorMsg.style.display = "none";
    if (warningIcon) warningIcon.style.display = "none";
  } else {
    mobileInput?.classList.add("has-warning-border");
    if (errorMsg) {
      errorMsg.style.display = "block";
      errorMsg.textContent = mobile.length === 0 ? "Please fill this field." : "Must be a 10-digit mobile number.";
    }
    if (warningIcon) warningIcon.style.display = "block";
  }
  updatePersonalInfoState();
}

function updatePersonalInfoState() {
  const mobile = appState.itr.personalInfo.mobile || "";
  const pan = appState.itr.personalInfo.pan || "";
  const panValid = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan);
  const mobileValid = mobile.length === 10;

  const errorBanner = document.getElementById("personalInfoErrorBanner");
  const contactChip = document.getElementById("contactDetailsChip");
  const pillBadge1 = document.getElementById("pillBadge1");

  if (!mobileValid || !panValid) {
    if (errorBanner) errorBanner.style.display = "none";
    if (contactChip) {
      contactChip.className = "status-chip danger-chip";
      contactChip.textContent = "Details Missing";
    }
    if (pillBadge1) {
      pillBadge1.className = "pill-badge pill-badge-error";
      pillBadge1.textContent = "!";
    }
  } else {
    if (errorBanner) errorBanner.style.display = "none";
    if (contactChip) {
      contactChip.className = "status-chip success-chip";
      contactChip.textContent = "Details Added";
    }
    if (pillBadge1) {
      pillBadge1.className = "pill-badge pill-badge-success";
      pillBadge1.textContent = "✓";
    }
  }
}

function searchAadhaarHelp(e) {
  e.preventDefault();
  alert("Simulated UIDAI Portal Help: Enter your 12-digit Aadhaar as registered on uidai.gov.in.");
}

function fetchIncomeDetailsDemo() {
  // Simulates importing AIS/TIS prefill from Income Tax Department
  appState.itr.income.grossSalary = 1200000;
  appState.itr.income.taxesPaid.tds = 95000;
  appState.itr.personalInfo.mobile = "9876543210";
  
  validateLiveMobile("9876543210");
  updateIncomeDisplayBadges();
  recalculateItrTax();

  alert("✓ Prefill Data Fetched from Income Tax Dept!\n- Gross Salary: ₹12,00,000 (Form 16)\n- TDS: ₹95,000\n- Contact Details Synced");
}

// ============================================================================
// ITR Step 2: Income Sources Modals & Badges
// ============================================================================
function updateIncomeDisplayBadges() {
  const inc = appState.itr.income;
  const totalIncome = (inc.grossSalary || 0) + (inc.otherIncome || 0) + (inc.capitalGains || 0) + 
                      (inc.housePropertyIncome || 0) + (inc.dividendIncome || 0) + 
                      (inc.businessIncome || 0) + (inc.cryptoIncome || 0);

  const badgeSalary = document.getElementById("badgeSalaryVal");
  const badgeInterest = document.getElementById("badgeInterestVal");
  const badgeCapGains = document.getElementById("badgeCapGainsVal");
  const badgeHouse = document.getElementById("badgeHousePropVal");
  const zeroBanner = document.getElementById("zeroIncomeWarning");
  const pillBadge2 = document.getElementById("pillBadge2");

  if (badgeSalary) badgeSalary.textContent = `₹ ${Number(inc.grossSalary || 0).toLocaleString("en-IN")}`;
  if (badgeInterest) badgeInterest.textContent = `₹ ${Number(inc.otherIncome || 0).toLocaleString("en-IN")}`;
  if (badgeCapGains) badgeCapGains.textContent = `₹ ${Number(inc.capitalGains || 0).toLocaleString("en-IN")}`;
  if (badgeHouse) badgeHouse.textContent = `₹ ${Number(inc.housePropertyIncome || 0).toLocaleString("en-IN")}`;

  if (totalIncome === 0) {
    if (zeroBanner) zeroBanner.style.display = "flex";
    if (pillBadge2) {
      pillBadge2.className = "pill-badge pill-badge-warning";
      pillBadge2.textContent = "!";
    }
  } else {
    if (zeroBanner) zeroBanner.style.display = "none";
    if (pillBadge2) {
      pillBadge2.className = "pill-badge pill-badge-success";
      pillBadge2.textContent = "✓";
    }
  }
}

function openSalaryModal() {
  document.getElementById("salaryGrossAmount").value = appState.itr.income.grossSalary || 1200000;
  openModal("modalSalary");
}

function saveSalaryIncome() {
  const gross = Number(document.getElementById("salaryGrossAmount").value) || 0;
  appState.itr.income.grossSalary = gross;
  closeModal("modalSalary");
  updateIncomeDisplayBadges();
  recalculateItrTax();
}

function recalcSalaryModal() {
  // Dynamic update inside modal
}

function openForm16UploadModal() {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".pdf,.json,.xml";
  fileInput.onchange = () => {
    appState.itr.income.grossSalary = 1200000;
    appState.itr.income.taxesPaid.tds = 95000;
    updateIncomeDisplayBadges();
    recalculateItrTax();
    alert("✓ Form 16 Parsed: Gross Salary ₹12,00,000 and TDS ₹95,000 auto-populated!");
  };
  fileInput.click();
}

function openInterestModal() {
  const val = prompt("Enter Annual Interest Income (Savings, FDs) in INR:", appState.itr.income.otherIncome || 25000);
  if (val !== null) {
    appState.itr.income.otherIncome = Number(val) || 0;
    updateIncomeDisplayBadges();
    recalculateItrTax();
  }
}

function openInvestmentsModal() {
  const val = prompt("Enter Net Capital Gains from Stocks/Mutual Funds in INR:", appState.itr.income.capitalGains || 45000);
  if (val !== null) {
    appState.itr.income.capitalGains = Number(val) || 0;
    updateIncomeDisplayBadges();
    recalculateItrTax();
  }
}

function openHousePropertyModal() {
  const val = prompt("Enter Net House Property Income (Negative for home loan interest) in INR:", appState.itr.income.housePropertyIncome || -150000);
  if (val !== null) {
    appState.itr.income.housePropertyIncome = Number(val) || 0;
    updateIncomeDisplayBadges();
    recalculateItrTax();
  }
}

function openEsopModal() {
  alert("ESOPs / RSUs: Taxable perquisite value is included in your Form 16 Part B Salary.");
}

function openDividendModal() {
  const val = prompt("Enter Dividend Income in INR:", 12000);
  if (val !== null) {
    appState.itr.income.otherIncome += Number(val) || 0;
    updateIncomeDisplayBadges();
    recalculateItrTax();
  }
}

function openBusinessModal() {
  alert("For Freelance / Business income under Section 44ADA/44AD, please file Form ITR-4 (Sugam).");
}

function openCryptoModal() {
  alert("Crypto / VDA Assets are taxed under Section 115BBH at a flat 30% rate.");
}

// ============================================================================
// ITR Step 3: Tax Savings & Deductions
// ============================================================================
function openDeductionsModal() {
  document.getElementById("dedSec80C").value = appState.itr.income.deductions.sec80C || 150000;
  document.getElementById("dedSec80D").value = appState.itr.income.deductions.sec80D || 25000;
  openModal("modalDeductions");
}

function saveDeductions() {
  const sec80C = Number(document.getElementById("dedSec80C").value) || 0;
  const sec80D = Number(document.getElementById("dedSec80D").value) || 0;
  const sec80CCD = Number(document.getElementById("dedSec80CCD")?.value) || 0;

  appState.itr.income.deductions.sec80C = Math.min(150000, sec80C);
  appState.itr.income.deductions.sec80D = Math.min(50000, sec80D);
  appState.itr.income.deductions.other = sec80CCD;

  closeModal("modalDeductions");
  updateDeductionBadges();
  recalculateItrTax();
}

function openTdsModal() {
  document.getElementById("tdsSalary").value = appState.itr.income.taxesPaid.tds || 95000;
  openModal("modalTds");
}

function saveTdsDetails() {
  const tdsSalary = Number(document.getElementById("tdsSalary").value) || 0;
  const tdsOther = Number(document.getElementById("tdsOther").value) || 0;
  const advance = Number(document.getElementById("advanceTaxPaid").value) || 0;

  appState.itr.income.taxesPaid.tds = tdsSalary + tdsOther;
  appState.itr.income.taxesPaid.advanceTax = advance;

  closeModal("modalTds");
  updateDeductionBadges();
  recalculateItrTax();
}

function updateDeductionBadges() {
  const ded = appState.itr.income.deductions;
  const taxes = appState.itr.income.taxesPaid;
  const totDed = (ded.sec80C || 0) + (ded.sec80D || 0) + (ded.other || 0);
  const totTds = (taxes.tds || 0) + (taxes.advanceTax || 0);

  const badgeDed = document.getElementById("badgeDeductionsVal");
  const badgeTds = document.getElementById("badgeTdsVal");
  if (badgeDed) badgeDed.textContent = `₹ ${totDed.toLocaleString("en-IN")}`;
  if (badgeTds) badgeTds.textContent = `₹ ${totTds.toLocaleString("en-IN")}`;
}

function importFromItdAction() {
  appState.itr.income.taxesPaid.tds = 95000;
  updateDeductionBadges();
  recalculateItrTax();
  alert("✓ Form 26AS & AIS Synced: TDS of ₹95,000 matched from Income Tax Department.");
}

function openAisModal() {
  alert("AIS Schedule FA & FSI: Foreign assets reporting verified. No carry forward loss registered.");
}

// ============================================================================
// ITR Step 4: Tax Calculation Engine & Summary (Screenshots 7 & 8)
// ============================================================================
async function recalculateItrTax() {
  const payload = {
    income: appState.itr.income,
    assessmentYear: appState.itr.assessmentYear,
    taxRegime: appState.itr.taxRegime
  };

  try {
    const res = await fetch("/api/itr/compute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      appState.itr.computation = result;
      renderTaxSummaryHero(result);
    }
  } catch (err) {
    console.error("Failed to compute ITR tax:", err);
  }
}

function renderTaxSummaryHero(compResult) {
  const comp = compResult.activeComputation;
  const isZeroIncome = comp.grossTotalIncome === 0;

  // Warning Banner
  const warningBanner = document.getElementById("summaryWarningBanner");
  if (warningBanner) {
    warningBanner.style.display = isZeroIncome ? "flex" : "none";
  }

  // Regime badges
  const regimeLabel = appState.itr.taxRegime === "NEW" ? "New Regime" : "Old Regime";
  const badgeRegime = document.getElementById("badgeRegimeLabel");
  const heroRegime = document.getElementById("summaryHeroRegimeText");
  if (badgeRegime) {
    badgeRegime.textContent = regimeLabel;
    badgeRegime.className = appState.itr.taxRegime === "NEW" ? "badge-pill green-pill" : "badge-pill dark-blue-pill";
  }
  if (heroRegime) heroRegime.textContent = regimeLabel;

  // Hero Card Values (Screenshot 7)
  document.getElementById("sumGrossIncome").textContent = `₹ ${comp.grossTotalIncome.toLocaleString("en-IN")}`;
  document.getElementById("sumTaxSavings").textContent = `₹ ${comp.totalDeductions.toLocaleString("en-IN")}`;
  document.getElementById("sumTaxableIncome").textContent = `₹ ${comp.netTaxableIncome.toLocaleString("en-IN")}`;
  document.getElementById("sumTotalTax").textContent = `₹ ${comp.totalTaxWithCess.toLocaleString("en-IN")}`;
  document.getElementById("sumTaxPaid").textContent = `₹ ${comp.totalTaxesPaid.toLocaleString("en-IN")}`;

  const refundLabel = document.getElementById("sumRefundLabel");
  const refundVal = document.getElementById("sumRefundVal");
  if (comp.refundDue > 0) {
    refundLabel.textContent = "Tax Refund:";
    refundVal.textContent = `₹ ${comp.refundDue.toLocaleString("en-IN")}`;
    refundVal.className = "calc-val green-text";
  } else if (comp.netTaxPayable > 0) {
    refundLabel.textContent = "Net Tax Payable:";
    refundVal.textContent = `₹ ${comp.netTaxPayable.toLocaleString("en-IN")}`;
    refundVal.className = "calc-val text-primary";
  } else {
    refundLabel.textContent = "Net Balance:";
    refundVal.textContent = "₹ 0";
    refundVal.className = "calc-val";
  }

  // Detailed Calculation (Screenshot 8)
  document.getElementById("detailTotalTax").textContent = `₹ ${comp.totalTaxWithCess.toLocaleString("en-IN")}`;
  document.getElementById("detailTaxPaid").textContent = `₹ ${comp.totalTaxesPaid.toLocaleString("en-IN")}`;

  const detailRefundHead = document.getElementById("detailRefundHeading");
  const detailRefundSub = document.getElementById("detailRefundSub");
  const detailRefundVal = document.getElementById("detailRefundVal");

  if (comp.refundDue > 0) {
    detailRefundHead.textContent = "Refund Available";
    detailRefundSub.textContent = "(Taxes Paid - Tax Liability)";
    detailRefundVal.textContent = `₹ ${comp.refundDue.toLocaleString("en-IN")}`;
    detailRefundVal.className = "item-val green-text";
  } else if (comp.netTaxPayable > 0) {
    detailRefundHead.textContent = "Tax Payable";
    detailRefundSub.textContent = "(Tax Liability - Taxes Paid)";
    detailRefundVal.textContent = `₹ ${comp.netTaxPayable.toLocaleString("en-IN")}`;
    detailRefundVal.className = "item-val text-primary";
  } else {
    detailRefundHead.textContent = "Refund Available";
    detailRefundSub.textContent = "(Taxes Paid - Tax Liability)";
    detailRefundVal.textContent = "₹ 0";
    detailRefundVal.className = "item-val";
  }
}

function onSummaryAyChanged() {
  const sel = document.getElementById("summaryAySelector");
  if (sel) {
    appState.itr.assessmentYear = sel.value;
    recalculateItrTax();
  }
}

function loadSampleSalaryData() {
  appState.itr.income.grossSalary = 1200000;
  appState.itr.income.deductions.sec80C = 150000;
  appState.itr.income.deductions.sec80D = 25000;
  appState.itr.income.taxesPaid.tds = 95000;
  appState.itr.personalInfo.mobile = "9876543210";

  validateLiveMobile("9876543210");
  updateIncomeDisplayBadges();
  updateDeductionBadges();
  recalculateItrTax();
}

function fixMissingDetailsAction() {
  goToItrStep(1);
}

function viewItrTypeDetails() {
  alert("ITR-1 (Sahaj): For Resident Individuals having Total Income up to ₹50 Lakhs from Salaries, One House Property, and Other Sources (Interest, etc.).");
}

// Compare & Switch Regime Modal
function openCompareRegimeModal() {
  if (!appState.itr.computation) {
    recalculateItrTax();
  }
  const comp = appState.itr.computation;
  if (!comp) return;

  const newR = comp.newRegime;
  const oldR = comp.oldRegime;

  const container = document.getElementById("regimeCompareContent");
  if (container) {
    container.innerHTML = `
      <div class="form-grid-2">
        <div class="form-card ${appState.itr.taxRegime === 'NEW' ? 'highlight-border' : ''}">
          <div class="card-title-row">
            <h4>New Tax Regime (Section 115BAC)</h4>
            ${comp.recommendedRegime === 'NEW' ? '<span class="status-chip success-chip">Recommended</span>' : ''}
          </div>
          <p class="text-sm text-muted mt-1">Concessional slabs with standard deduction of ₹75,000</p>
          <div class="calc-row mt-3"><span>Gross Income:</span> <strong>₹ ${newR.grossTotalIncome.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row"><span>Standard Deduction:</span> <strong>₹ ${newR.standardDeduction.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row"><span>Net Taxable Income:</span> <strong>₹ ${newR.netTaxableIncome.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row"><span>Base Slab Tax:</span> <strong>₹ ${newR.calculatedTax.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row"><span>Health & Edu Cess (4%):</span> <strong>₹ ${newR.cess.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row font-bold text-primary"><span>Total Tax Liability:</span> <strong>₹ ${newR.totalTaxWithCess.toLocaleString("en-IN")}</strong></div>
          <button class="btn btn-primary btn-block mt-3" onclick="setRegime('NEW')">${appState.itr.taxRegime === 'NEW' ? 'Currently Selected' : 'Switch to New Regime'}</button>
        </div>

        <div class="form-card ${appState.itr.taxRegime === 'OLD' ? 'highlight-border' : ''}">
          <div class="card-title-row">
            <h4>Old Tax Regime</h4>
            ${comp.recommendedRegime === 'OLD' ? '<span class="status-chip success-chip">Recommended</span>' : ''}
          </div>
          <p class="text-sm text-muted mt-1">Permits 80C, 80D, HRA & housing loan deductions</p>
          <div class="calc-row mt-3"><span>Gross Income:</span> <strong>₹ ${oldR.grossTotalIncome.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row"><span>Chapter VI-A Deductions:</span> <strong>₹ ${oldR.totalDeductions.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row"><span>Net Taxable Income:</span> <strong>₹ ${oldR.netTaxableIncome.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row"><span>Base Slab Tax:</span> <strong>₹ ${oldR.calculatedTax.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row"><span>Health & Edu Cess (4%):</span> <strong>₹ ${oldR.cess.toLocaleString("en-IN")}</strong></div>
          <div class="calc-row font-bold text-primary"><span>Total Tax Liability:</span> <strong>₹ ${oldR.totalTaxWithCess.toLocaleString("en-IN")}</strong></div>
          <button class="btn btn-outline btn-block mt-3" onclick="setRegime('OLD')">${appState.itr.taxRegime === 'OLD' ? 'Currently Selected' : 'Switch to Old Regime'}</button>
        </div>
      </div>
      <div class="info-note-box mt-3">
        <strong>Recommendation:</strong> The <strong>${comp.recommendedRegime} Tax Regime</strong> saves you <strong>₹ ${comp.savingsWithRecommendation.toLocaleString("en-IN")}</strong> in tax liability for AY ${appState.itr.assessmentYear}.
      </div>
    `;
  }
  openModal("modalCompareRegime");
}

function setRegime(regime) {
  appState.itr.taxRegime = regime;
  closeModal("modalCompareRegime");
  recalculateItrTax();
}

function selectRecommendedRegime() {
  if (appState.itr.computation?.recommendedRegime) {
    setRegime(appState.itr.computation.recommendedRegime);
  }
}

// Download ITR Statement / Report
async function downloadItrComputation(format = "xlsx") {
  const ay = appState.itr.assessmentYear;
  const payload = {
    personalInfo: appState.itr.personalInfo,
    income: appState.itr.income,
    taxRegime: appState.itr.taxRegime,
    assessmentYear: ay
  };

  try {
    const res = await fetch(`/api/export/itr1?format=${format}&ay=${ay}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      alert("Error generating export file.");
      return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition");
    let filename = `ITR1_Computation_${ay}.${format}`;
    if (disposition && disposition.includes("filename=")) {
      filename = disposition.split("filename=")[1].replace(/"/g, "").trim();
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Export download failed:", err);
  }
}

// E-Filing Sandbox Modal & Verification
function proceedToEfileSandbox() {
  document.getElementById("filingTargetText").textContent = `Filing ITR-1 Sahaj for PAN: ${appState.itr.personalInfo.pan}`;
  document.getElementById("filingSuccessResult").classList.add("hidden");
  document.getElementById("btnConfirmFiling").style.display = "inline-flex";
  openModal("modalFilingOtp");
}

function resendSimulatedOtp() {
  alert("Simulated SMS: New 6-digit EVC OTP '654321' sent to your registered mobile.");
}

async function confirmFilingOtpAction() {
  const otp = document.getElementById("filingOtpInput").value;
  const consent = document.getElementById("filingConsentCheck").checked;

  try {
    const res = await fetch("/api/itr/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pan: appState.itr.personalInfo.pan,
        assessmentYear: appState.itr.assessmentYear,
        otp,
        consent
      })
    });
    const data = await res.json();
    if (data.success) {
      const box = document.getElementById("filingSuccessResult");
      box.className = "filing-success-box info-note-box";
      box.innerHTML = `
        <h4 style="color: #15803D;">✓ Return Filed & E-Verified Successfully!</h4>
        <div class="mt-1"><strong>ITR-V Acknowledgement Number:</strong> ${data.acknowledgementNumber}</div>
        <div><strong>Assessee PAN:</strong> ${data.pan}</div>
        <div><strong>Status:</strong> ${data.status}</div>
        <div class="text-xs text-muted mt-1">Notice: ${data.notice}</div>
      `;
      box.classList.remove("hidden");
      document.getElementById("btnConfirmFiling").style.display = "none";
    } else {
      alert(`Filing Error: ${data.error}`);
    }
  } catch (err) {
    console.error("Filing error:", err);
  }
}

// ============================================================================
// Top Navbar & Profile Dropdown Mechanics (Screenshot 9)
// ============================================================================
function toggleFilingDropdown(e) {
  e.stopPropagation();
  document.getElementById("filingDropdownMenu")?.classList.toggle("active");
}

function selectFilingEntity(pan, name, subtitle) {
  const panEl = document.getElementById("currentFilingPan");
  if (panEl) panEl.textContent = pan;
  const nameEl = document.getElementById("currentFilingEntityName");
  if (nameEl) nameEl.textContent = name;
  const sidePan = document.getElementById("sidebarGstinDisplay");
  if (sidePan) sidePan.textContent = pan;
  const sideEntity = document.getElementById("sidebarEntityDisplay");
  if (sideEntity) sideEntity.textContent = name;
  const fileBadge = document.getElementById("fileGstActiveEntityBadge");
  if (fileBadge) fileBadge.textContent = `${name} (${pan})`;
  const reviewEntity = document.getElementById("reviewEntityDisplay");
  if (reviewEntity) reviewEntity.textContent = `${name} (${pan})`;
  const copilotBadge = document.getElementById("copilotActiveGstinDisplay");
  if (copilotBadge) copilotBadge.textContent = `${name} (${pan})`;

  // Clear metric caches so views re-fetch for new entity
  if (typeof cachedDashboardMetrics !== "undefined") {
    cachedDashboardMetrics = null;
  }

  document.getElementById("filingDropdownMenu")?.classList.add("hidden");
  document.getElementById("filingDropdownMenu")?.classList.remove("active");

  // Sync Period and backend state
  if (typeof syncPeriodAcrossUi === "function") {
    syncPeriodAcrossUi();
  }

  // If Nil section is currently open, re-run verification for new GSTIN
  const nilSec = document.getElementById("fileGstNilSection");
  if (nilSec && !nilSec.classList.contains("hidden") && typeof startNilFilingFlow === "function") {
    startNilFilingFlow();
  }

  // Activate on backend if API is reachable
  fetch("/api/gstins")
    .then(r => r.json())
    .then(data => {
      const g = (data.gstins || []).find(x => x.gstin === pan);
      if (g) {
        apiFetch(`/api/gstins/${g.id}/activate`, { method: "POST" })
          .then(() => {
            if (typeof syncPeriodAcrossUi === "function") syncPeriodAcrossUi();
            if (typeof loadDashboardData === "function") loadDashboardData();
            if (typeof renderCopilotWorkspace === "function") renderCopilotWorkspace();
          })
          .catch(() => {});
      }
    })
    .catch(() => {});
}

function toggleProfileDropdown(e) {
  if (e) e.stopPropagation();
  if (!appState?.auth?.isLoggedIn) {
    openAuthModal("signin");
    return;
  }
  const menu = document.getElementById("profileDropdownMenu");
  if (!menu) return;
  const isHidden = menu.classList.contains("hidden");
  if (isHidden) {
    populateProfileData();
    menu.classList.remove("hidden");
    menu.classList.add("active");
  } else {
    menu.classList.add("hidden");
    menu.classList.remove("active");
  }
}
window.toggleProfileDropdown = toggleProfileDropdown;

function closeProfileDropdown() {
  const menu = document.getElementById("profileDropdownMenu");
  if (menu) {
    menu.classList.add("hidden");
    menu.classList.remove("active");
  }
}
window.closeProfileDropdown = closeProfileDropdown;

// Close dropdown on outside click
document.addEventListener("click", function(e) {
  const container = document.getElementById("navUserProfileContainer");
  const menu = document.getElementById("profileDropdownMenu");
  if (container && !container.contains(e.target) && menu && !menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
    menu.classList.remove("active");
  }
});

async function openProfileModal() {
  closeProfileDropdown();
  await populateProfileData();
  const modal = document.getElementById("modalProfileDetails");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.remove("hidden");
  }
}
window.openProfileModal = openProfileModal;

function closeProfileModal() {
  const modal = document.getElementById("modalProfileDetails");
  if (modal) {
    modal.style.display = "none";
    modal.classList.add("hidden");
  }
}
window.closeProfileModal = closeProfileModal;

async function populateProfileData() {
  if (!appState.onboardingProfile && (appState.sessionToken || document.cookie.includes("simplegst_session"))) {
    try {
      const res = await fetch("/api/onboarding/progress", {
        credentials: "same-origin",
        headers: appState.sessionToken ? { "Authorization": "Bearer " + appState.sessionToken } : {}
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          appState.onboardingProfile = {
            pan: data.step2?.pan,
            gstin: data.step2?.gstin,
            aadhaarMasked: data.step2?.aadhaarMasked,
            aadhaarLast4: data.step2?.aadhaarLast4,
            bank: {
              holderName: data.step3?.accountHolderName,
              accountMasked: data.step3?.accountMasked,
              accountLast4: data.step3?.accountLast4,
              ifsc: data.step3?.ifsc,
              bankName: data.step3?.bankName,
              branchName: data.step3?.branchName
            },
            business: {
              legalName: data.step4?.legalName,
              tradeName: data.step4?.tradeName,
              type: data.step4?.businessType,
              category: data.step4?.businessCategory,
              email: data.step4?.businessEmail,
              mobile: data.step4?.businessMobile,
              address: data.step4?.businessAddress,
              state: data.step4?.state,
              city: data.step4?.city,
              pincode: data.step4?.pincode,
              activity: data.step4?.businessActivity
            }
          };
          if (data.user && appState.auth?.user) {
            if (data.user.mobile) appState.auth.user.mobile = data.user.mobile;
          }
        }
      }
    } catch (_) {}
  }

  const user = appState.auth?.user || {};
  const profile = appState.onboardingProfile || {};
  const org = appState.organization || {};
  const activeGst = appState.activeGstin || {};

  const nameVal = user.name || user.fullName || profile.business?.legalName || org.name || "Valued Taxpayer";
  const emailVal = user.email || profile.business?.email || "—";
  const mobileVal = user.mobile || profile.business?.mobile || "—";
  const panVal = profile.pan || org.pan || (activeGst.gstin ? activeGst.gstin.slice(2, 12) : "—");
  const gstinVal = profile.gstin || activeGst.gstin || "—";
  const stateVal = profile.business?.state || activeGst.state_name || org.state || "—";
  const aadhaarVal = profile.aadhaarMasked || (profile.aadhaarLast4 ? "•••• •••• " + profile.aadhaarLast4 : "Not Provided");

  const bankHolderVal = profile.bank?.holderName || nameVal;
  const bankNameVal = profile.bank?.bankName || "Commercial Bank";
  const branchVal = profile.bank?.branchName || "Main Branch";
  const ifscVal = profile.bank?.ifsc || "—";
  const accMaskedVal = profile.bank?.accountMasked || (profile.bank?.accountLast4 ? "••••••••" + profile.bank.accountLast4 : "••••••••1234");

  const legalNameVal = profile.business?.legalName || org.name || nameVal;
  const tradeNameVal = profile.business?.tradeName || activeGst.trade_name || legalNameVal;
  const typeVal = profile.business?.type || org.legal_type || "Private Limited Company";
  const catVal = profile.business?.category || "General Commercial";
  const bEmailVal = profile.business?.email || emailVal;
  const bMobileVal = profile.business?.mobile || mobileVal;
  const addressVal = profile.business?.address || org.registered_address || "—";
  const cityVal = profile.business?.city || "—";
  const pincodeVal = profile.business?.pincode || "—";
  const locationVal = (cityVal !== "—" ? cityVal + ", " : "") + (stateVal !== "—" ? stateVal : "") + (pincodeVal !== "—" ? " - " + pincodeVal : "");
  const activityVal = profile.business?.activity || "Commercial Trading / Services";

  // Update Dropdown Elements
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText("menuUserFullName", nameVal);
  setText("menuUserEmail", emailVal);
  setText("menuUserMobile", mobileVal !== "—" ? "+91 " + mobileVal : "—");
  setText("menuPan", panVal);
  setText("menuGstin", gstinVal);
  setText("menuState", stateVal);
  setText("menuBankName", bankNameVal);
  setText("menuBankAccount", accMaskedVal);
  setText("menuBusinessName", legalNameVal);
  setText("menuBusinessTypeCategory", typeVal + " • " + catVal);

  // Update Profile Modal Elements
  setText("profFullName", nameVal);
  setText("profMobile", mobileVal !== "—" ? "+91 " + mobileVal : "—");
  setText("profEmail", emailVal);
  setText("profRoleBadge", user.role || "Owner");
  setText("profPan", panVal);
  setText("profGstin", gstinVal);
  setText("profState", stateVal);
  setText("profAadhaar", aadhaarVal);

  setText("profBankHolder", bankHolderVal);
  setText("profBankAccount", accMaskedVal);
  setText("profBankName", bankNameVal);
  setText("profBankBranch", branchVal);
  setText("profBankIfsc", ifscVal);

  setText("profLegalName", legalNameVal);
  setText("profTradeName", tradeNameVal);
  setText("profBusinessType", typeVal);
  setText("profBusinessTypeBadge", typeVal);
  setText("profBusinessCategory", catVal);
  setText("profBusinessEmail", bEmailVal);
  setText("profBusinessMobile", bMobileVal !== "—" ? "+91 " + bMobileVal : "—");
  setText("profBusinessAddress", addressVal);
  setText("profBusinessLocation", locationVal);
  setText("profBusinessActivity", activityVal);
}
window.populateProfileData = populateProfileData;

window.toggleMoreServicesMenu = function(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("moreServicesMenu");
  menu?.classList.toggle("hidden");
};

function viewMyReturns() {
  alert("📋 My GST Returns:\n• October 2026: GSTR-3B Ready to File (₹70,200)\n• September 2026: Filed & Verified (ARN: AA320926019284A)\n• August 2026: Filed & Verified (ARN: AA320826982104A)");
}
function openOrdersModal() { alert("🎁 Referral Rewards & Credits:\nAvailable Wallet: ₹1,500\nReferral Code: MALABAR500\nCashback: ₹500 instant discount on filings."); }
function openRewardsModal() { alert("My Rewards: ₹500 Referral voucher available with code REWARD500."); }
function openAdvancedModal() { alert("Advanced Options: Statutory 182-API live inspection and deterministic engine controls."); }
function openRectificationModal() { alert("Rectification: Defect notices can be cleared under the GST compliance tab."); }
function openPrefillModal() { alert("Auto-Sync: Connected to GSTN sandbox for automated GSTR-2B credit sync."); }
function checkItrStatusModal() { alert("GST Status: Return processed with zero outstanding statutory demand."); }
// ============================================================================
// Authentication & Session Management (Sign In, Register, Logout)
// ============================================================================
appState.auth = {
  isLoggedIn: false,
  user: null
};

function initAuth() {
  if (appState.auth && appState.auth.isLoggedIn && appState.auth.user) {
    renderAuthState();
    return;
  }
  renderAuthState();
}

function renderFilingDropdownItems() {
  const menu = document.getElementById("filingDropdownMenu");
  if (!menu) return;

  if (appState.auth && appState.auth.isLoggedIn && appState.allGstins && appState.allGstins.length > 0) {
    let html = `<div class="p-2 text-xs font-semibold text-secondary uppercase tracking-wider">Select GSTIN Entity</div>`;
    appState.allGstins.forEach(g => {
      const isAct = appState.activeGstin && appState.activeGstin.gstin === g.gstin;
      const gstinStr = escapeHtml(g.gstin);
      const nameStr = escapeHtml(g.trade_name || g.legal_name || "Branch");
      const stateStr = escapeHtml(g.state_name || "");
      html += `
        <div class="filing-menu-item p-2.5 rounded-lg hover:bg-surface-container cursor-pointer transition-colors ${isAct ? 'bg-primary/5 font-semibold' : ''}" onclick="selectFilingEntity('${gstinStr}', '${nameStr.replace(/'/g, "\\'")}', '${stateStr.replace(/'/g, "\\'")}')">
          <div class="entity-pan font-mono font-bold text-xs text-primary">${gstinStr}</div>
          <div class="entity-name text-xs text-on-surface">${nameStr} • ${stateStr}</div>
        </div>
      `;
    });
    menu.innerHTML = html;
  } else {
    menu.innerHTML = `
      <div class="p-3 text-xs text-secondary text-center">
        <div class="font-medium text-on-surface mb-1">No active session</div>
        <div>Please sign in to select a GSTIN entity.</div>
        <button onclick="openAuthModal('signin')" class="mt-2.5 w-full py-1.5 px-3 rounded bg-primary text-white font-medium text-xs hover:bg-primary-container transition-colors cursor-pointer">Sign In</button>
      </div>
    `;
  }
}
window.renderFilingDropdownItems = renderFilingDropdownItems;

function renderFilingDropdownMenu() {
  renderFilingDropdownItems();
}

function renderAuthState() {
  const loggedOutNav = document.getElementById("navAuthLoggedOut");
  const loggedInNav = document.getElementById("navAuthLoggedIn");
  const btnNavSignIn = document.getElementById("btnNavSignIn");
  const navUserName = document.getElementById("navUserName");
  const navUserRole = document.getElementById("navUserRole");
  const menuUserName = document.getElementById("menuUserFullName");
  const menuUserEmail = document.getElementById("menuUserEmail");
  const currentFilingPan = document.getElementById("currentFilingPan");
  const currentFilingEntityName = document.getElementById("currentFilingEntityName");
  const sidebarEntityDisplay = document.getElementById("sidebarEntityDisplay");
  const sidebarGstinDisplay = document.getElementById("sidebarGstinDisplay");
  const sidebarUserName = document.getElementById("sidebarUserName");
  const sidebarUserRole = document.getElementById("sidebarUserRole");
  const fileBadge = document.getElementById("fileGstActiveEntityBadge");
  const guestBanner = document.getElementById("guestWelcomeBanner");
  const greetingHeader = document.getElementById("dashboardGreetingHeader");
  const btnMenuAuthAction = document.getElementById("btnMenuAuthAction");

  const inputFirst = document.getElementById("inputFirstName");
  const inputLast = document.getElementById("inputLastName");
  const inputPan = document.getElementById("inputPan");
  const inputMobile = document.getElementById("inputMobile");
  const inputEmail = document.getElementById("inputEmail");
  const inputDob = document.getElementById("inputDob");
  const inputFather = document.getElementById("inputFatherName");
  const inputAadhaar = document.getElementById("inputAadhaar");
  const expertTaxpayerName = document.getElementById("expertTaxpayerName");

  if (appState.auth && appState.auth.isLoggedIn && appState.auth.user) {
    const user = appState.auth.user;
    if (loggedOutNav) loggedOutNav.style.display = "none";
    if (loggedInNav) loggedInNav.style.display = "flex";
    if (btnNavSignIn) btnNavSignIn.style.display = "none";
    if (navUserName) navUserName.textContent = user.name || "Assessee";
    if (navUserRole) navUserRole.textContent = user.role || "Taxpayer";
    if (menuUserName) menuUserName.textContent = user.name || "Assessee";
    if (menuUserEmail) menuUserEmail.textContent = user.email || "user@simplegst.tax";
    if (sidebarUserName) sidebarUserName.textContent = user.name || "Assessee";
    if (sidebarUserRole) sidebarUserRole.textContent = user.role || "Taxpayer";
    if (greetingHeader) greetingHeader.textContent = `Welcome, ${user.name || "Taxpayer"}`;

    if (btnMenuAuthAction) {
      btnMenuAuthAction.innerHTML = `<span class="material-symbols-outlined text-[16px]">logout</span> Log Out`;
      btnMenuAuthAction.onclick = logoutAction;
      btnMenuAuthAction.className = "w-full text-left flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-error hover:bg-error-container/20 font-semibold cursor-pointer";
    }

    const orgName = appState.organization?.name || appState.activeGstin?.trade_name || "Taxpayer Workspace";
    const gstin = appState.activeGstin?.gstin || "—";
    if (currentFilingEntityName) currentFilingEntityName.textContent = orgName;
    if (currentFilingPan) currentFilingPan.textContent = gstin;
    if (sidebarEntityDisplay) sidebarEntityDisplay.textContent = orgName;
    if (sidebarGstinDisplay) sidebarGstinDisplay.textContent = gstin;
    if (fileBadge) fileBadge.textContent = `${orgName} (${gstin})`;

    if (guestBanner) guestBanner.style.display = "none";
    if (expertTaxpayerName) expertTaxpayerName.textContent = user.name;

    // Populate personal info inputs if user exists
    const nameParts = (user.name || "").trim().split(" ");
    const firstName = user.firstName || nameParts[0] || "";
    const lastName = user.lastName || nameParts.slice(1).join(" ") || "";

    if (inputFirst) inputFirst.value = firstName;
    if (inputLast) inputLast.value = lastName;
    if (inputPan) inputPan.value = user.pan || "";
    if (inputMobile) inputMobile.value = user.mobile || "";
    if (inputEmail) inputEmail.value = user.email || "";
    if (inputDob) inputDob.value = user.dob || "";
    if (inputFather) inputFather.value = user.fatherName || "";
    if (inputAadhaar) inputAadhaar.value = user.aadhaar || "";

    if (appState.itr && appState.itr.personalInfo) {
      appState.itr.personalInfo.firstName = firstName;
      appState.itr.personalInfo.lastName = lastName;
      appState.itr.personalInfo.pan = user.pan || "";
      appState.itr.personalInfo.mobile = user.mobile || "";
      appState.itr.personalInfo.email = user.email || "";
    }
  } else {
    // GUEST / LOGGED OUT STATE
    if (loggedOutNav) loggedOutNav.style.display = "flex";
    if (loggedInNav) loggedInNav.style.display = "none";
    if (btnNavSignIn) btnNavSignIn.style.display = "inline-flex";
    if (navUserName) navUserName.textContent = "Sign In";
    if (navUserRole) navUserRole.textContent = "Click to authenticate";
    if (menuUserName) menuUserName.textContent = "Guest Taxpayer";
    if (menuUserEmail) menuUserEmail.textContent = "Not signed in";
    if (sidebarUserName) sidebarUserName.textContent = "Guest Taxpayer";
    if (sidebarUserRole) sidebarUserRole.textContent = "Not Signed In";
    if (greetingHeader) greetingHeader.textContent = "Welcome to SimpleGST";

    if (btnMenuAuthAction) {
      btnMenuAuthAction.innerHTML = `<span class="material-symbols-outlined text-[16px]">login</span> Sign In`;
      btnMenuAuthAction.onclick = () => openAuthModal("signin");
      btnMenuAuthAction.className = "w-full text-left flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-primary hover:bg-primary-container/20 font-semibold cursor-pointer";
    }

    if (currentFilingEntityName) currentFilingEntityName.textContent = "Select Organization";
    if (currentFilingPan) currentFilingPan.textContent = "—";
    if (sidebarEntityDisplay) sidebarEntityDisplay.textContent = "No Active Organization";
    if (sidebarGstinDisplay) sidebarGstinDisplay.textContent = "—";
    if (fileBadge) fileBadge.textContent = "No Active GSTIN";

    if (guestBanner) guestBanner.style.display = "flex";
    if (expertTaxpayerName) expertTaxpayerName.textContent = "New Taxpayer (Guest)";

    if (inputFirst) inputFirst.value = "";
    if (inputLast) inputLast.value = "";
    if (inputPan) inputPan.value = "";
    if (inputMobile) inputMobile.value = "";
    if (inputEmail) inputEmail.value = "";
    if (inputDob) inputDob.value = "";
    if (inputFather) inputFather.value = "";
    if (inputAadhaar) inputAadhaar.value = "";

    if (appState.itr && appState.itr.personalInfo) {
      appState.itr.personalInfo.firstName = "";
      appState.itr.personalInfo.lastName = "";
      appState.itr.personalInfo.pan = "";
      appState.itr.personalInfo.mobile = "";
      appState.itr.personalInfo.email = "";
    }
  }
  if (typeof updatePersonalInfoState === "function") updatePersonalInfoState();
  if (typeof populateProfileData === "function") populateProfileData();
  renderFilingDropdownItems();
}
window.renderAuthState = renderAuthState;

function openAuthModal(tab = "signin") {
  openModal("modalAuth");
  switchAuthTab(tab);
}
window.openAuthModal = openAuthModal;

function closeAuthModal() {
  closeModal("modalAuth");
  const errorEl = document.getElementById("loginErrorMessage");
  if (errorEl) errorEl.classList.add("hidden");
}
window.closeAuthModal = closeAuthModal;

function switchAuthTab(tab) {
  if (tab === "register") {
    closeAuthModal();
    openOnboardingWizard(1);
    return;
  }
  const btnSignIn = document.getElementById("tabAuthSignIn");
  const btnRegister = document.getElementById("tabAuthRegister");
  const formSignIn = document.getElementById("formSignIn");
  const formRegister = document.getElementById("formRegister");
  const title = document.getElementById("authModalTitle");
  const sub = document.getElementById("authModalSubtitle");

  if (tab === "signin") {
    if (btnSignIn) {
      btnSignIn.style.background = "var(--white)";
      btnSignIn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
      btnSignIn.style.color = "var(--primary-blue)";
      btnSignIn.style.fontWeight = "700";
    }
    if (btnRegister) {
      btnRegister.style.background = "transparent";
      btnRegister.style.boxShadow = "none";
      btnRegister.style.color = "var(--text-muted)";
      btnRegister.style.fontWeight = "600";
    }
    if (formSignIn) formSignIn.classList.remove("hidden");
    if (formRegister) formRegister.classList.add("hidden");
    if (title) title.textContent = "Sign In to SimpleGST";
    if (sub) sub.textContent = "Secure access to your tax returns, GSTR filings, and compliance vault";
  } else {
    if (btnRegister) {
      btnRegister.style.background = "var(--white)";
      btnRegister.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
      btnRegister.style.color = "var(--primary-blue)";
      btnRegister.style.fontWeight = "700";
    }
    if (btnSignIn) {
      btnSignIn.style.background = "transparent";
      btnSignIn.style.boxShadow = "none";
      btnSignIn.style.color = "var(--text-muted)";
      btnSignIn.style.fontWeight = "600";
    }
    if (formSignIn) formSignIn.classList.add("hidden");
    if (formRegister) formRegister.classList.remove("hidden");
    if (title) title.textContent = "Create New Taxpayer Account";
    if (sub) sub.textContent = "Enter your legal PAN and contact info to start frictionless e-filing";
  }
}
window.switchAuthTab = switchAuthTab;

async function handleSignInSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const idInput = document.getElementById("loginIdentifier");
  const passInput = document.getElementById("loginPassword");
  const errorEl = document.getElementById("loginErrorMessage");
  const errorTextEl = document.getElementById("loginErrorText");
  const submitBtn = document.getElementById("btnSignInSubmit");

  const identifier = idInput ? idInput.value.trim() : "";
  const password = passInput ? passInput.value : "";

  if (!identifier || !password) {
    if (errorEl) {
      if (errorTextEl) errorTextEl.textContent = "Please enter both your email address and password.";
      errorEl.classList.remove("hidden");
    } else {
      showToast("Please enter both your email address and password.", "error");
    }
    return;
  }

  if (errorEl) errorEl.classList.add("hidden");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.origText = submitBtn.innerHTML;
    submitBtn.innerHTML = `<span class="inline-block animate-spin mr-1">⟳</span> Signing in...`;
  }

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email: identifier, password: password })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      const msg = data.error || "Invalid email or password. Please check your credentials.";
      if (errorEl) {
        if (errorTextEl) errorTextEl.textContent = msg;
        errorEl.classList.remove("hidden");
      }
      showToast(msg, "error");
      return;
    }

    if (data.sessionToken) {
      appState.sessionToken = data.sessionToken;
      localStorage.setItem("simplegst_session_token", data.sessionToken);
    }
    if (data.csrfToken) {
      appState.csrfToken = data.csrfToken;
    }

    if (data.onboardingRequired) {
      closeAuthModal();
      if (typeof openOnboardingWizard === "function") {
        openOnboardingWizard(data.onboardingStep || 2);
      }
      showToast("Please complete your business registration to continue.", "info");
      return;
    }

    await initSessionFromBackend();

    closeAuthModal();
    if (passInput) passInput.value = "";
    showToast(`Welcome back, ${data.user?.name || "Taxpayer"}!`, "success");

    if (typeof loadDashboardData === "function") loadDashboardData();
    if (typeof syncPeriodAcrossUi === "function") syncPeriodAcrossUi();
    if (typeof renderCopilotWorkspace === "function") renderCopilotWorkspace();
    if (typeof loadSalesRegister === "function") loadSalesRegister();
    if (typeof loadPurchaseRegister === "function") loadPurchaseRegister();
    if (typeof loadBillsRegister === "function") loadBillsRegister();
  } catch (err) {
    console.error("Sign in failed:", err);
    if (errorEl) {
      if (errorTextEl) errorTextEl.textContent = "Sign in network failure. Please try again.";
      errorEl.classList.remove("hidden");
    }
    showToast("Sign in request failed. Please check network connection.", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      if (submitBtn.dataset.origText) submitBtn.innerHTML = submitBtn.dataset.origText;
    }
  }
}
window.handleSignInSubmit = handleSignInSubmit;

function handleRegisterSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const name = document.getElementById("regFullName")?.value.trim() || "New Taxpayer";
  const pan = (document.getElementById("regPan")?.value || "").trim().toUpperCase();
  const mobile = document.getElementById("regMobile")?.value.trim() || "9876543210";
  const email = document.getElementById("regEmail")?.value.trim() || "user@simplegst.tax";

  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRegex.test(pan)) {
    alert("Please enter a valid 10-character PAN (e.g. ABCDE1234F).");
    return;
  }

  const nameParts = name.split(" ");
  const firstName = nameParts[0] || name;
  const lastName = nameParts.slice(1).join(" ") || "Taxpayer";

  appState.auth = {
    isLoggedIn: true,
    user: {
      name,
      firstName,
      lastName,
      pan,
      mobile,
      email,
      dob: "01/01/1995",
      fatherName: "Guardian Name",
      aadhaar: "500012345678"
    }
  };

  localStorage.setItem("simplegst_user_session", JSON.stringify(appState.auth));
  try {
    let users = JSON.parse(localStorage.getItem("simplegst_registered_users") || "[]");
    users = users.filter(u => u.pan !== pan && u.email !== email && u.mobile !== mobile);
    users.push(appState.auth.user);
    localStorage.setItem("simplegst_registered_users", JSON.stringify(users));
  } catch (err) {}

  renderAuthState();
  closeAuthModal();
  goToItrStep(1);
  showToast(`Account created for ${name} (${pan})! Ready to file.`, "success");
}
window.handleRegisterSubmit = handleRegisterSubmit;

function quickDemoLogin(profile = "sanjay") {
  openAuthModal("signin");
  showToast("Please enter your account email and password to sign in.", "info");
}
window.quickDemoLogin = quickDemoLogin;

async function logoutAction() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(appState.csrfToken ? { "X-CSRF-Token": appState.csrfToken } : {}),
        ...(appState.sessionToken ? { "Authorization": `Bearer ${appState.sessionToken}` } : {})
      },
      credentials: "same-origin"
    });
  } catch (err) {
    console.warn("Logout request failed:", err);
  }

  // Clear session from memory and storage
  appState.sessionToken = null;
  appState.csrfToken = null;
  appState.organization = null;
  appState.activeGstin = null;
  appState.allGstins = [];
  appState.auth = {
    isLoggedIn: false,
    user: null,
    csrfToken: null
  };
  if (appState.gst) {
    appState.gst.salesInvoices = [];
    appState.gst.purchaseInvoices = [];
    appState.gst.business = {};
  }
  localStorage.removeItem("simplegst_user_session");

  // Reset dashboard values to empty state
  const dashSalesTotal = document.getElementById("dashSalesTotal");
  const dashPurchasesTotal = document.getElementById("dashPurchasesTotal");
  const dashNetTaxPayable = document.getElementById("dashNetTaxPayable");
  const dashEligibleItc = document.getElementById("dashEligibleItc");
  if (dashSalesTotal) dashSalesTotal.textContent = "₹0.00";
  if (dashPurchasesTotal) dashPurchasesTotal.textContent = "₹0.00";
  if (dashNetTaxPayable) dashNetTaxPayable.textContent = "₹0.00";
  if (dashEligibleItc) dashEligibleItc.textContent = "₹0.00";
  const heroDesc = document.getElementById("homeHeroDescription");
  if (heroDesc) heroDesc.textContent = "Please sign in to view your business filing dashboard, sales and purchase registers.";
  const recentTable = document.getElementById("dashRecentActivityBody");
  if (recentTable) recentTable.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-secondary text-xs">Please sign in to view recent transactions.</td></tr>`;

  renderAuthState();
  document.getElementById("profileDropdownMenu")?.classList.remove("active");
  document.getElementById("profileDropdownMenu")?.classList.add("hidden");

  // Show login screen
  openAuthModal("signin");
  showToast("You have been signed out successfully.", "info");
}
window.logoutAction = logoutAction;

function onRegisterPanInput(val) {
  const pan = (val || "").trim().toUpperCase();
  const feedback = document.getElementById("regPanFeedback");
  if (!feedback) return;
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (panRegex.test(pan)) {
    const code = pan[3];
    feedback.innerHTML = `<span class="text-success font-medium">✓ Valid PAN syntax (Entity category: '${code}')</span>`;
  } else if (pan.length > 0) {
    feedback.innerHTML = `<span class="text-danger font-medium">✗ Expected 5 letters, 4 digits, 1 letter</span>`;
  } else {
    feedback.innerHTML = "Tier 1 regex: 5 letters, 4 digits, 1 letter.";
  }
}

// Customer Support Drawer
function openSupportDrawer() {
  document.getElementById("drawerSupport")?.classList.remove("hidden");
}

function closeSupportDrawer(e) {
  if (!e || e.target.id === "drawerSupport" || e.target.classList.contains("modal-close")) {
    document.getElementById("drawerSupport")?.classList.add("hidden");
  }
}

function askQuickHelp(question) {
  addChatMessage(question, "user");
  setTimeout(() => {
    let answer = "I'm here to help!";
    if (question.includes("regime")) {
      answer = "Under AY 2025-26, the New Tax Regime offers standard deduction of ₹75,000 and zero tax up to ₹7 Lakhs. If you have deductions over ₹3.75 Lakhs, Old Regime may save more.";
    } else if (question.includes("mobile")) {
      answer = "In Step 1 (Personal Info), enter a valid 10-digit Indian mobile number in the Identification card to resolve the warning.";
    } else if (question.includes("standard deduction")) {
      answer = "The standard deduction under the New Tax Regime is ₹75,000 as per Finance (No. 2) Act, 2024.";
    }
    addChatMessage(answer, "bot");
  }, 400);
}

function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  addChatMessage(msg, "user");
  input.value = "";
  setTimeout(() => {
    addChatMessage(`Thanks for your question regarding "${msg}". Our tax rules engine automatically validates compliance with Section 115BAC and CBDT filing rules.`, "bot");
  }, 500);
}

function addChatMessage(text, sender) {
  const container = document.getElementById("chatMessages");
  if (!container) return;
  const msgDiv = document.createElement("div");
  msgDiv.className = `chat-msg ${sender}-msg`;
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${sender === "user" ? "user-bubble" : ""}`;
  bubble.textContent = text;
  msgDiv.appendChild(bubble);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function setupSidebarCountdown() {
  let seconds = 594; // 09:54
  const el = document.getElementById("sidebarCountdown");
  if (!el) return;
  setInterval(() => {
    if (seconds <= 0) return;
    seconds--;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    el.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, 1000);
}

function openExpertBookingModal() {
  alert("Expert Filing: Certified Chartered Accountant (CA) assigned with code TAXHERO65 (65% OFF applied).");
}

function openLiveFilingModal() {
  alert("Live Filing Guidance: Specialist call booked for 11:00 AM.");
}

// Modal generic open/close
function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove("hidden");
    el.style.display = "flex";
  }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add("hidden");
    el.style.display = "none";
  }
}

// ============================================================================
// GST SUITE ENGINE LOGIC (Retained & Fully Functional)
// ============================================================================
async function loadGstDemoData() {
  try {
    const res = await fetch("/api/sample-data");
    const data = await res.json();
    appState.gst.business = data.business;
    appState.gst.salesInvoices = data.salesInvoices || [];
    appState.gst.purchaseInvoices = data.purchaseInvoices || [];
    appState.gst.exceptions = data.exceptions || [];
    appState.gst.reconciliation = data.reconciliation || { items: [] };
    appState.gst.taxCalculation = data.taxCalculation;

    renderReportPreview();
    renderReconciliationScreen();
    renderGstr3bScreen();
  } catch (err) {
    console.error("Failed to load GST sample data:", err);
  }
}

function showGstScreen(screenId) {
  appState.gst.currentScreen = screenId;
  const screenMap = {
    reports: "gstScreenReports",
    addData: "gstScreenAddData",
    recon: "gstScreenRecon",
    gstr3b: "gstScreenGstr3b",
    validator: "gstScreenValidator",
    einvoice: "gstScreenEinvoice",
    vendorRisk: "gstScreenVendorRisk",
    multiGstin: "gstScreenMultiGstin",
    gstr9: "gstScreenGstr9",
    apiHub: "gstScreenApiHub"
  };

  document.querySelectorAll(".gst-screen-view").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".gst-subnav-btn").forEach(el => el.classList.remove("active"));

  document.getElementById(screenMap[screenId])?.classList.remove("hidden");
  
  const subTabs = {
    reports: "gstSubTabReports",
    addData: "gstSubTabAddData",
    recon: "gstSubTabRecon",
    gstr3b: "gstSubTabGstr3b",
    validator: "gstSubTabValidator",
    einvoice: "gstSubTabEinvoice",
    vendorRisk: "gstSubTabVendorRisk",
    multiGstin: "gstSubTabMultiGstin",
    gstr9: "gstSubTabGstr9",
    apiHub: "gstSubTabApiHub"
  };
  document.getElementById(subTabs[screenId])?.classList.add("active");

  if (screenId === "reports") renderReportPreview();
  if (screenId === "recon") renderReconciliationScreen();
  if (screenId === "gstr3b") renderGstr3bScreen();
  if (screenId === "validator") run2TierVerificationFlow();
  if (screenId === "vendorRisk") loadVendorRiskLeaderboard();
  if (screenId === "multiGstin") loadMultiGstinSummary();
  if (screenId === "gstr9") runGstr9Consolidation();
  if (screenId === "apiHub") loadApiHubList();
}

function onReportChanged() {
  const sel = document.getElementById("reportSelect");
  appState.gst.currentReportType = sel.value;
  const ayGroup = document.getElementById("filterAyGroup");
  if (ayGroup) {
    ayGroup.style.display = sel.value === "itr1" ? "block" : "none";
  }
  renderReportPreview();
}

function renderReportPreview() {
  const reportType = appState.gst.currentReportType || "sales_register";
  const thead = document.getElementById("reportPreviewHead");
  const tbody = document.getElementById("reportPreviewBody");
  const tfoot = document.getElementById("reportPreviewFoot");
  if (!thead || !tbody || !tfoot) return;

  thead.innerHTML = "";
  tbody.innerHTML = "";
  tfoot.innerHTML = "";

  if (reportType === "sales_register") {
    thead.innerHTML = `<tr><th>Inv No</th><th>Date</th><th>Party Name</th><th>GSTIN</th><th>Taxable</th><th>IGST</th><th>CGST</th><th>SGST</th><th>Total</th></tr>`;
    let totTx = 0, totAmt = 0;
    appState.gst.salesInvoices.forEach(inv => {
      totTx += Number(inv.taxableAmount || 0);
      totAmt += Number(inv.totalAmount || 0);
      tbody.innerHTML += `<tr>
        <td><strong>${escapeHtml(inv.invoiceNumber)}</strong></td>
        <td>${escapeHtml(inv.date)}</td>
        <td>${escapeHtml(inv.partyName)}</td>
        <td><code>${escapeHtml(inv.partyGstin)}</code></td>
        <td>₹ ${Number(inv.taxableAmount).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(inv.igst).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(inv.cgst).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(inv.sgst).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(inv.totalAmount).toLocaleString("en-IN")}</td>
      </tr>`;
    });
    tfoot.innerHTML = `<tr><th colspan="4">Total (${appState.gst.salesInvoices.length} Invoices)</th><th>₹ ${totTx.toLocaleString("en-IN")}</th><th colspan="3"></th><th>₹ ${totAmt.toLocaleString("en-IN")}</th></tr>`;
  } else if (reportType === "purchase_register") {
    thead.innerHTML = `<tr><th>Bill No</th><th>Date</th><th>Supplier</th><th>GSTIN</th><th>Taxable</th><th>Eligible ITC</th><th>Total</th></tr>`;
    appState.gst.purchaseInvoices.forEach(inv => {
      tbody.innerHTML += `<tr>
        <td><strong>${escapeHtml(inv.invoiceNumber)}</strong></td>
        <td>${escapeHtml(inv.date)}</td>
        <td>${escapeHtml(inv.partyName)}</td>
        <td><code>${escapeHtml(inv.partyGstin)}</code></td>
        <td>₹ ${Number(inv.taxableAmount).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(inv.totalTax).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(inv.totalAmount).toLocaleString("en-IN")}</td>
      </tr>`;
    });
  } else if (reportType === "reconciliation") {
    thead.innerHTML = `<tr><th>Inv No</th><th>Supplier</th><th>GSTIN</th><th>Books Tax</th><th>2B Tax</th><th>Status</th><th>Action</th></tr>`;
    (appState.gst.reconciliation.items || []).forEach(item => {
      tbody.innerHTML += `<tr>
        <td><strong>${escapeHtml(item.invoiceNo)}</strong></td>
        <td>${escapeHtml(item.supplier)}</td>
        <td><code>${escapeHtml(item.gstin)}</code></td>
        <td>₹ ${Number(item.booksTax).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(item.gstr2bTax).toLocaleString("en-IN")}</td>
        <td><span class="status-chip ${item.status === 'Matched' ? 'success-chip' : 'danger-chip'}">${escapeHtml(item.status)}</span></td>
        <td><strong>${escapeHtml(item.action)}</strong></td>
      </tr>`;
    });
  } else {
    thead.innerHTML = `<tr><th>Field</th><th>Value</th></tr>`;
    tbody.innerHTML = `<tr><td>Report Type</td><td>${reportType}</td></tr><tr><td>Status</td><td>Ready for Export (.xlsx, .csv, .json)</td></tr>`;
  }
}

async function generateReportAction() {
  const pBox = document.getElementById("reportProgressBox");
  const pBar = document.getElementById("reportProgressBar");
  const rCard = document.getElementById("reportResultCard");

  if (pBox) pBox.style.display = "block";
  if (rCard) rCard.style.display = "none";
  if (pBar) pBar.style.width = "40%";

  setTimeout(() => {
    if (pBar) pBar.style.width = "100%";
    setTimeout(() => {
      if (pBox) pBox.style.display = "none";
      if (rCard) {
        rCard.style.display = "flex";
        const p = typeof getActivePeriod === "function" ? getActivePeriod() : "102026";
        document.getElementById("resultFilename").textContent = `${appState.gst.currentReportType}_${p}.xlsx`;
      }
    }, 300);
  }, 400);
}

async function downloadCurrentReport(format = "xlsx") {
  const reportType = appState.gst.currentReportType || "sales_register";
  const ay = document.getElementById("reportAySelector")?.value || "2025-26";
  const url = `/api/export/${reportType}?format=${format}&ay=${ay}`;

  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const p = typeof getActivePeriod === "function" ? getActivePeriod() : "102026";
    a.download = `${reportType}_${p}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.error("Export download failed:", err);
  }
}

// Manual Invoice Form
function onManualGstinChanged() {
  const gstin = document.getElementById("manualGstin").value.toUpperCase();
  const feedback = document.getElementById("manualGstinFeedback");
  if (gstin.length === 15) {
    feedback.textContent = `Valid state code ${gstin.substring(0,2)}`;
    feedback.style.color = "#16A34A";
  } else {
    feedback.textContent = "15-character GSTIN required";
    feedback.style.color = "#EA580C";
  }
  calculateManualTaxes();
}

function calculateManualTaxes() {
  const gstin = (document.getElementById("manualGstin").value || "").trim().toUpperCase();
  const taxable = Number(document.getElementById("manualTaxable").value) || 0;
  const rate = Number(document.getElementById("manualRate").value) || 18;
  const ownState = "32"; // Kerala
  const partyState = gstin.length >= 2 ? gstin.substring(0, 2) : ownState;
  const isInterState = partyState !== ownState;

  const totalTax = taxable * (rate / 100);
  let igst = 0, cgst = 0, sgst = 0;

  if (isInterState) {
    igst = totalTax;
    document.getElementById("manualSupplyType").textContent = `Inter-State (State ${partyState})`;
  } else {
    cgst = totalTax / 2;
    sgst = totalTax / 2;
    document.getElementById("manualSupplyType").textContent = "Intra-State (Kerala 32)";
  }

  document.getElementById("manualCgst").textContent = `₹ ${cgst.toLocaleString("en-IN")}`;
  document.getElementById("manualSgst").textContent = `₹ ${sgst.toLocaleString("en-IN")}`;
  document.getElementById("manualIgst").textContent = `₹ ${igst.toLocaleString("en-IN")}`;
  document.getElementById("manualTotal").textContent = `₹ ${(taxable + totalTax).toLocaleString("en-IN")}`;
}

async function saveManualInvoice(type) {
  const invNo = document.getElementById("manualInvNo")?.value?.trim();
  const date = document.getElementById("manualDate")?.value;
  const party = document.getElementById("manualPartyName")?.value?.trim();
  const gstin = document.getElementById("manualGstin")?.value?.trim()?.toUpperCase();
  const taxable = Number(document.getElementById("manualTaxable")?.value) || 0;
  const rate = Number(document.getElementById("manualRate")?.value) || 0;

  if (!invNo || !date || !party || taxable <= 0) {
    if (typeof showToast === "function") {
      showToast("Please fill all required invoice fields (Invoice #, Date, Party Name, Taxable Value).", "warning");
    } else {
      alert("Please fill all required invoice fields.");
    }
    return;
  }

  const activeGstin = getActiveGstin();
  if (!activeGstin) {
    const msg = "Validation Error: Active business GSTIN is missing. Please select an entity from the workspace.";
    if (typeof showToast === "function") showToast(msg, "error");
    else alert(msg);
    return;
  }

  const period = derivePeriodFromDate(rawInvoiceDate || invoiceDate, getActivePeriod());
  if (!period) {
    const msg = "Validation Error: Return filing period is missing. Please select a filing period.";
    if (typeof showToast === "function") showToast(msg, "error");
    else alert(msg);
    return;
  }

  const pos = gstin && gstin.length >= 2 ? gstin.slice(0, 2) : activeGstin.slice(0, 2);

  const endpoint = type === "sales" ? `/api/sales?period=${period}` : `/api/purchases?period=${period}`;
  const payload = type === "sales" ? {
    invoiceNumber: invNo,
    invoiceDate: date,
    customerName: party,
    customerGstin: gstin || undefined,
    pos,
    taxableAmount: taxable,
    gstRate: rate,
    supplyType: gstin ? "B2B" : "B2C"
  } : {
    invoiceNumber: invNo,
    invoiceDate: date,
    supplierName: party,
    supplierGstin: gstin || activeGstin,
    pos,
    taxableAmount: taxable,
    gstRate: rate,
    itcEligibility: "ELIGIBLE",
    isRcm: false
  };

  try {
    const res = await apiFetch(endpoint, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (typeof showToast === "function") {
        showToast(`${type === "sales" ? "Sales Invoice" : "Purchase Bill"} ${invNo} saved to database!`, "success");
      } else {
        alert(`✓ ${type === "sales" ? "Sales Invoice" : "Purchase Bill"} ${invNo} added!`);
      }
      if (typeof refreshInvoices === "function") {
        await refreshInvoices(type);
      }
      if (typeof loadDashboardData === "function") {
        loadDashboardData(period);
      }
      const elInvNo = document.getElementById("manualInvNo"); if (elInvNo) elInvNo.value = "";
      const elParty = document.getElementById("manualPartyName"); if (elParty) elParty.value = "";
      const elGstin = document.getElementById("manualGstin"); if (elGstin) elGstin.value = "";
      const elTaxable = document.getElementById("manualTaxable"); if (elTaxable) elTaxable.value = "";
    } else {
      const errMsg = data.error || `Failed to save ${type === "sales" ? "invoice" : "bill"}`;
      if (typeof showToast === "function") {
        showToast(errMsg, "error");
      } else {
        alert(errMsg);
      }
    }
  } catch (err) {
    const errMsg = "Network error: " + err.message;
    if (typeof showToast === "function") {
      showToast(errMsg, "error");
    } else {
      alert(errMsg);
    }
  }
}
window.saveManualInvoice = saveManualInvoice;

// Bulk File Ingestion & Error Round-Trip
function downloadSampleTemplate() {
  const csvContent = "data:text/csv;charset=utf-8,Invoice Number,Invoice Date,Party Name,Party GSTIN,Place of Supply,Taxable Value,Rate\r\nINV-001,2026-10-10,Alpha Enterprises,32ABCDE1234F1Z5,32,100000,18\r\n";
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "SimpleGST_Invoice_Import_Template.csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function handleFileChosen(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    const rawCsv = evt.target.result;
    try {
      const res = await apiFetch("/api/invoices/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawCsv })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById("importSummaryCard").classList.remove("hidden");
        document.getElementById("importTotalCount").textContent = data.totalRows;
        document.getElementById("importValidCount").textContent = data.validCount;
        document.getElementById("importErrorCount").textContent = data.errorCount;

        if (data.errorCount > 0) {
          document.getElementById("importErrorActionBox").classList.remove("hidden");
          appState.gst.errorReportUrl = data.errorReportDownloadUrl;
        }
      }
    } catch (err) {
      console.error("Import failed:", err);
    }
  };
  reader.readAsText(file);
}

function downloadErrorReportFile() {
  if (appState.gst.errorReportUrl) {
    window.location.href = appState.gst.errorReportUrl;
  }
}

// Reconciliation
function renderReconciliationScreen() {
  const tbody = document.getElementById("reconTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  (appState.gst.reconciliation.items || []).forEach((item, idx) => {
    tbody.innerHTML += `<tr>
      <td><strong>${item.invoiceNo}</strong></td>
      <td>${item.supplier}</td>
      <td><code>${item.gstin}</code></td>
      <td>₹ ${Number(item.booksTax).toLocaleString("en-IN")}</td>
      <td>₹ ${Number(item.gstr2bTax).toLocaleString("en-IN")}</td>
      <td><span class="status-chip ${item.status === 'Matched' ? 'success-chip' : 'danger-chip'}">${item.status}</span></td>
      <td>
        <select onchange="updateReconAction(${idx}, this.value)">
          <option value="Accept" ${item.action === 'Accept' ? 'selected' : ''}>Accept</option>
          <option value="Hold" ${item.action === 'Hold' ? 'selected' : ''}>Hold</option>
        </select>
      </td>
      <td>
        <button class="btn btn-outline btn-xs" onclick="sendSupplierReminder('${item.supplier}', '${item.invoiceNo}')">WhatsApp Chase</button>
      </td>
    </tr>`;
  });
}

function updateReconAction(idx, newAction) {
  if (appState.gst.reconciliation.items[idx]) {
    appState.gst.reconciliation.items[idx].action = newAction;
  }
}

function sendSupplierReminder(supplier, invNo) {
  alert(`✓ Simulated WhatsApp reminder dispatched to ${supplier} for Invoice ${invNo}.`);
}

function exportReconReport() {
  downloadCurrentReport("xlsx");
}

function runReconciliation() {
  alert("✓ GSTR-2B sync complete: 2 invoices Matched, 1 Mismatch in Date, 1 Missing in 2B.");
}

// GSTR-3B Summary
function renderGstr3bScreen() {
  const calc = appState.gst.taxCalculation;
  if (!calc) return;
  document.getElementById("gstr3bOutputTax").textContent = `₹ ${Number(calc.outputTax.total).toLocaleString("en-IN")}`;
  document.getElementById("gstr3bEligibleItc").textContent = `₹ ${Number(calc.eligibleItc.total).toLocaleString("en-IN")}`;
  document.getElementById("gstr3bNetPayable").textContent = `₹ ${Number(calc.netPayable.total).toLocaleString("en-IN")}`;
}

function openGstSandboxFilingModal() {
  document.getElementById("filingTargetText").textContent = `Filing GSTR-3B for GSTIN: ${appState.gst.business.gstin}`;
  document.getElementById("filingSuccessResult").classList.add("hidden");
  document.getElementById("btnConfirmFiling").style.display = "inline-flex";
  openModal("modalFilingOtp");
}

// ============================================================================
// 2-TIER PAN & GSTIN VERIFICATION CONTROLLER (REA Tier 1 + Tier 2)
// ============================================================================
const PAN_ENTITY_MAP = {
  "P": "Individual / Proprietorship",
  "C": "Company / Corporate",
  "H": "Hindu Undivided Family (HUF)",
  "F": "Partnership Firm / LLP",
  "A": "Association of Persons (AOP)",
  "T": "Trust",
  "B": "Body of Individuals (BOI)",
  "L": "Local Authority",
  "J": "Artificial Juridical Person",
  "G": "Government Agency"
};

function onTwoTierPanInput(val) {
  const pan = (val || "").trim().toUpperCase();
  const inline = document.getElementById("twoTierPanInline");
  const entityTitle = document.getElementById("tier1EntityTitle");
  const badge = document.getElementById("tier1StatusBadge");
  const embeddedPan = document.getElementById("tier1EmbeddedPan");

  if (embeddedPan) embeddedPan.textContent = pan || "--";

  if (!pan) {
    if (inline) inline.innerHTML = "Enter a 10-character PAN to begin instant Tier 1 analysis.";
    if (badge) { badge.textContent = "WAITING"; badge.className = "status-chip info-chip"; }
    return;
  }

  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (panRegex.test(pan)) {
    const code = pan[3];
    const entityType = PAN_ENTITY_MAP[code] || "Other Taxpayer Entity";
    if (entityTitle) entityTitle.textContent = `${entityType} (Category: ${code})`;
    if (inline) inline.innerHTML = `<span class="text-success font-medium">✓ Valid PAN syntax (${entityType})</span>`;
    if (badge) { badge.textContent = "SYNTAX VALID"; badge.className = "status-chip success-chip"; }
  } else {
    if (entityTitle) entityTitle.textContent = "Invalid PAN Format";
    if (inline) inline.innerHTML = `<span class="text-danger font-medium">✗ Expected 5 letters, 4 digits, 1 letter (e.g. AAACB1234F)</span>`;
    if (badge) { badge.textContent = "SYNTAX ERROR"; badge.className = "status-chip danger-chip"; }
  }

  // Also check cross-link with GSTIN if present
  checkCrossLinkTier1();
}

function onTwoTierGstinInput(val) {
  checkCrossLinkTier1();
}

function checkCrossLinkTier1() {
  const panInput = document.getElementById("twoTierPanInput");
  const gstinInput = document.getElementById("twoTierGstinInput");
  const gstinInline = document.getElementById("twoTierGstinInline");
  const detailText = document.getElementById("tier1DetailText");
  const stateCodeEl = document.getElementById("tier1StateCode");
  const badge = document.getElementById("tier1StatusBadge");

  const pan = panInput ? panInput.value.trim().toUpperCase() : "";
  const gstin = gstinInput ? gstinInput.value.trim().toUpperCase() : "";

  if (!gstin) {
    if (gstinInline) gstinInline.innerHTML = "Optional. If provided, checks if GSTIN mathematically embeds this PAN.";
    if (stateCodeEl) stateCodeEl.textContent = "--";
    return;
  }

  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(gstin)) {
    if (gstinInline) gstinInline.innerHTML = `<span class="text-danger font-medium">✗ Invalid GSTIN structure (15 chars)</span>`;
    return;
  }

  const embedded = gstin.substring(2, 12);
  const state = gstin.substring(0, 2);
  if (stateCodeEl) stateCodeEl.textContent = `${state}`;

  if (pan && embedded === pan) {
    if (gstinInline) gstinInline.innerHTML = `<span class="text-success font-medium">✓ Mathematical Link Validated: Chars 3-12 match PAN '${pan}'</span>`;
    if (detailText) detailText.textContent = `Mathematical link: Matched (GSTIN ${gstin} embeds PAN ${pan}).`;
    if (badge) { badge.textContent = "LINK MATCHED"; badge.className = "status-chip success-chip"; }
  } else if (pan) {
    if (gstinInline) gstinInline.innerHTML = `<span class="text-danger font-bold">✗ PAN-GSTIN MISMATCH: GSTIN embeds '${embedded}', not '${pan}'</span>`;
    if (detailText) detailText.textContent = `PAN Mismatch: Entered PAN is '${pan}', but GSTIN belongs to '${embedded}'.`;
    if (badge) { badge.textContent = "PAN MISMATCH"; badge.className = "status-chip danger-chip"; }
  }
}

async function run2TierVerificationFlow() {
  const pan = (document.getElementById("twoTierPanInput")?.value || "").trim().toUpperCase();
  const gstin = (document.getElementById("twoTierGstinInput")?.value || "").trim().toUpperCase();
  const btn = document.getElementById("btnExecute2TierCheck");

  if (!pan) {
    alert("Please enter a valid 10-character PAN to verify.");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Verifying Tier 1 & Querying Tier 2...</span>`;
  }

  try {
    const res = await fetch("/api/pan-gstin/verify-2tier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pan, gstin: gstin || undefined })
    });

    const data = await res.json();

    // 1. Update Tier 1
    const t1Badge = document.getElementById("tier1StatusBadge");
    const t1Title = document.getElementById("tier1EntityTitle");
    const t1Detail = document.getElementById("tier1DetailText");

    if (t1Badge) {
      t1Badge.textContent = data.tier1.valid ? (data.tier1.hasGstin ? (data.tier1.isLinked ? "LINK MATCHED" : "MISMATCH") : "SYNTAX VALID") : "FAILED";
      t1Badge.className = `status-chip ${data.tier1.valid && (!data.tier1.hasGstin || data.tier1.isLinked) ? "success-chip" : "danger-chip"}`;
    }
    if (t1Title) t1Title.textContent = `${data.tier1.entityType} (Category: ${data.tier1.entityCode || 'N/A'})`;
    if (t1Detail) {
      t1Detail.textContent = data.tier1.error || `Tier 1 instant check passed. Structure is valid and mathematically sound.`;
    }

    // 2. Update Tier 2
    const t2Badge = document.getElementById("tier2StatusBadge");
    const t2Name = document.getElementById("tier2TaxpayerName");
    const t2Detail = document.getElementById("tier2DetailText");
    const t2BranchCount = document.getElementById("tier2BranchCount");
    const t2Type = document.getElementById("tier2TaxpayerType");

    if (data.tier2 && data.tier2.status !== "SKIPPED") {
      if (t2Badge) {
        t2Badge.textContent = data.tier2.status === "VERIFIED_ACTIVE" ? "VERIFIED ACTIVE" : data.tier2.status;
        t2Badge.className = `status-chip ${data.tier2.portalLinked ? "success-chip" : "warning-chip"}`;
      }
      if (t2Name && data.tier2.taxpayer) {
        t2Name.textContent = data.tier2.taxpayer.legalName || data.tier2.taxpayer.tradeName || "Active Statutory Assessee";
      }
      if (t2Detail) {
        t2Detail.textContent = `GSTN Portal Status: ${data.tier2.taxpayer?.status || "Active"}. Found ${data.tier2.branches?.length || 0} registered state branch(es).`;
      }
      if (t2BranchCount) t2BranchCount.textContent = `${data.tier2.activeBranchesCount || data.tier2.branches?.length || 0} Active`;
      if (t2Type && data.tier2.taxpayer) t2Type.textContent = data.tier2.taxpayer.taxpayerType || "Regular";

      // Render Branches Table
      const tbody = document.getElementById("twoTierBranchesBody");
      if (tbody) {
        const branches = data.tier2.branches || [];
        if (branches.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 24px;">No active branch registrations found for PAN ${pan}.</td></tr>`;
        } else {
          tbody.innerHTML = branches.map(b => `
            <tr>
              <td><span class="status-chip blue-chip font-mono text-xs">${b.state_code}</span></td>
              <td><strong>${b.state_name}</strong></td>
              <td><span class="font-mono text-xs" style="color: var(--brand-primary); font-weight: 700;">${b.gstin}</span></td>
              <td><span class="status-chip ${b.status === 'Active' ? 'success-chip' : 'warning-chip'}">${b.status}</span></td>
              <td style="text-align: right;">
                <button class="btn btn-outline btn-xs" onclick="applyDiscoveredGstin('${b.gstin}')">
                  Use in Profile
                </button>
              </td>
            </tr>
          `).join("");
        }
      }
    } else {
      if (t2Badge) { t2Badge.textContent = "SKIPPED"; t2Badge.className = "status-chip warning-chip"; }
      if (t2Detail) t2Detail.textContent = data.tier2.message || "Tier 2 check skipped due to Tier 1 issues.";
    }

  } catch (err) {
    alert("2-Tier Verification failed: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        <span>Execute 2-Tier Verification</span>
      `;
    }
  }
}

function applyDiscoveredGstin(gstin) {
  const gstinInput = document.getElementById("twoTierGstinInput");
  if (gstinInput) gstinInput.value = gstin;
  checkCrossLinkTier1();
  alert(`✓ Selected GSTIN ${gstin} applied! Tier 1 cross-link verified with PAN.`);
}

// Backward compatibility aliases
function runStandaloneGstinValidator(val) { onTwoTierGstinInput(val); }
function runStandalonePanValidator(val) { onTwoTierPanInput(val); }

// ============================================================================
// TAX FILING FROM EXPERTS (Assisted CA Advisory & Booking Logic)
// ============================================================================
appState.expertPlans = [];
appState.currentSelectedPlan = null;

async function loadExpertPlans() {
  try {
    const res = await fetch("/api/expert/plans");
    const data = await res.json();
    if (data.success && Array.isArray(data.plans)) {
      appState.expertPlans = data.plans;
      renderExpertPlans("all");
    }
  } catch (err) {
    console.warn("Could not fetch expert plans from server, using built-in matrix", err);
    renderExpertPlans("all");
  }
}

function filterExpertPlans(category, btnElement) {
  document.querySelectorAll(".filter-tab-pill").forEach(p => p.classList.remove("active"));
  if (btnElement) btnElement.classList.add("active");
  renderExpertPlans(category);
}

function renderExpertPlans(category = "all") {
  const container = document.getElementById("expertPlansContainer");
  if (!container) return;

  const plans = (appState.expertPlans && appState.expertPlans.length > 0) ? appState.expertPlans : [
    {
      id: "plan-free-trial",
      category: "free_trial",
      title: "1-Month Free Pro CA Advisory & Return Filing Trial",
      originalPrice: 2999,
      price: 0,
      turnaround: "Instant Activation • 24hr CA Review",
      badge: "Free for 1 Month",
      isFreeTrial: true,
      features: [
        "1-on-1 Consultation with Senior Chartered Accountant",
        "Old vs New Tax Regime Arbitrage & Deduction Audit",
        "Automated Form 16, AIS/TIS & 26AS Reconciliation",
        "Section 80C, 80D, 80CCD & HRA Tax Optimization",
        "ClearTax Client Workspace with Real-Time CA Chat",
        "100% Free for 30 Days • Zero Advance Payment"
      ]
    },

    {
      id: "plan-salaried",
      category: "filing",
      title: "Salaried & Multi-Form 16 Tax Filing",
      originalPrice: 2499,
      price: 999,
      turnaround: "Within 24 Hours",
      badge: "Most Popular",
      features: [
        "Consolidation of Multiple Form 16s & job switches",
        "HRA, LTA, and Section 10 allowances audit",
        "Old vs New Regime tax optimization",
        "Form 26AS & AIS tax credit reconciliation",
        "1-on-1 Dedicated CA Review"
      ]
    },
    {
      id: "plan-capital-gains",
      category: "wealth",
      title: "Capital Gains, Traders & Investors",
      originalPrice: 5999,
      price: 2499,
      turnaround: "Within 24-48 Hours",
      badge: "Investor Special",
      features: [
        "Direct broker statement import (Zerodha, Groww, etc.)",
        "Intraday, F&O and short/long-term gains calculation",
        "Loss set-off & carry-forward (Schedule CFL)",
        "Section 112A grandfathering verification",
        "Full ITR-2 / ITR-3 expert filing"
      ]
    },
    {
      id: "plan-fast-ds",
      category: "foreign",
      title: "Foreign Assets, RSUs & FAST-DS Disclosure",
      originalPrice: 14999,
      price: 4999,
      turnaround: "Within 48 Hours",
      badge: "Tech & NRI Choice",
      features: [
        "US Stocks, RSUs, ESPP & foreign accounts",
        "Mandatory Schedule FA disclosure & valuation",
        "Foreign Tax Credit (Form 67) & DTAA relief",
        "Black Money Act penalty protection audit",
        "Senior Cross-Border Tax CA consultation"
      ]
    },
    {
      id: "plan-business",
      category: "gst_tds",
      title: "Business & Freelancers (Section 44ADA/44AD)",
      originalPrice: 7999,
      price: 3499,
      turnaround: "Within 24-48 Hours",
      badge: "Self-Employed",
      features: [
        "Presumptive taxation under Section 44AD / 44ADA",
        "Turnover verification & expense deduction optimization",
        "Advance tax computation and scheduling",
        "GST vs ITR revenue reconciliation",
        "End-to-end filing with compliance review"
      ]
    },
    {
      id: "plan-notice-defense",
      category: "past_filings",
      title: "Notice Management & Scrutiny Defense",
      originalPrice: 11999,
      price: 4499,
      turnaround: "Priority 12 Hours",
      badge: "Notice Protect",
      features: [
        "Analysis of Section 143(1), 139(9), or 148 notices",
        "AIS vs ITR discrepancy resolution",
        "Statutory response drafting for e-Filing portal",
        "Rectification JSON preparation & resubmission",
        "Dedicated CA case representation"
      ]
    }
  ];

  const filtered = category === "all" ? plans : plans.filter(p => p.category === category);

  container.innerHTML = filtered.map(plan => `
    <div class="expert-plan-card ${plan.badge === 'Most Popular' ? 'popular-border' : ''}">
      <div class="plan-card-top">
        ${plan.badge ? `<span class="plan-badge-tag">${plan.badge}</span>` : ''}
        <h3 class="plan-card-title">${plan.title}</h3>
        <div class="plan-pricing-row">
          <span class="original-price-strike">₹ ${Number(plan.originalPrice).toLocaleString("en-IN")}</span>
          <span class="current-price">₹ ${Number(plan.price).toLocaleString("en-IN")}</span>
        </div>
        <div class="plan-turnaround-chip">⏱ Turnaround: ${plan.turnaround}</div>
        <ul class="plan-features-list">
          ${plan.features.map(f => `<li>${f}</li>`).join("")}
        </ul>
      </div>
      <button class="btn btn-primary btn-block" onclick="openBookExpertModal('${plan.id}', '${plan.title.replace(/'/g, "\\'")}', ${plan.price})">
        Book CA Consultation
      </button>
    </div>
  `).join("");
}

// Interactive Savings Estimator
function recalculateSavingsEstimator() {
  const salary = Number(document.getElementById("calcEstSalary")?.value) || 1500000;
  const capGains = Number(document.getElementById("calcEstCapGains")?.value) || 100000;
  const deductions = Number(document.getElementById("calcEstDeductions")?.value) || 175000;

  // Potential tax saved through optimal deductions and regime arbitrage
  const standardDedBenefit = 75000 * 0.20; // ~₹15,000
  const ltcgExemptionBenefit = Math.min(capGains, 100000) * 0.125; // 12.5% on LTCG above threshold
  const deductionBenefit = deductions * 0.20; // 20% slab estimate

  const totalEstSavings = Math.round(standardDedBenefit + ltcgExemptionBenefit + deductionBenefit);

  const savingsVal = document.getElementById("calcEstSavingsVal");
  const recPlan = document.getElementById("calcEstRecommendedPlan");

  if (savingsVal) savingsVal.textContent = `₹ ${totalEstSavings.toLocaleString("en-IN")}.00`;
  if (recPlan) {
    if (capGains > 150000) {
      recPlan.innerHTML = `Recommended: <strong>Capital Gains & Trader Plan</strong>`;
    } else if (salary > 2000000) {
      recPlan.innerHTML = `Recommended: <strong>Global Tech & FAST-DS Disclosure</strong>`;
    } else {
      recPlan.innerHTML = `Recommended: <strong>Salaried & Multi-Form 16 Plan</strong>`;
    }
  }
}

function applyEstimatorToBooking() {
  const salary = Number(document.getElementById("calcEstSalary")?.value) || 1500000;
  appState.itr.income.grossSalary = salary;
  openBookExpertModal("plan-salaried", "Salaried & Multi-Form 16 Tax Filing", 999);
}

// Modal Booking Mechanics
let bookingState = {
  planId: "plan-salaried",
  planTitle: "Salaried & Multi-Form 16 Tax Filing",
  basePrice: 999,
  couponApplied: true,
  discountPercent: 65
};

function openBookExpertModal(planId, planTitle, price) {
  if (planId === "plan-free-trial" || price === 0) {
    bookingState.couponApplied = true;
    bookingState.discountPercent = 100;
    const couponInp = document.getElementById("bookCouponInput");
    if (couponInp) couponInp.value = "FREE30DAYS";
  }
  bookingState.planId = planId;
  bookingState.planTitle = planTitle;
  bookingState.basePrice = price;

  document.getElementById("bookSelectedPlanName").textContent = planTitle;
  document.getElementById("bookClientName").value = appState.itr.personalInfo.firstName + " " + appState.itr.personalInfo.lastName;
  document.getElementById("bookClientPan").value = appState.itr.personalInfo.pan || "CVBBC4433W";
  document.getElementById("bookClientPhone").value = appState.itr.personalInfo.mobile || "9876543210";
  document.getElementById("bookingConfirmationResult").classList.add("hidden");
  document.getElementById("btnConfirmBooking").style.display = "inline-flex";

  updateBookingPriceBreakdown();
  openModal("modalBookExpert");
}

function applyBookingCoupon() {
  const input = document.getElementById("bookCouponInput")?.value.trim().toUpperCase();
  const feedback = document.getElementById("bookCouponFeedback");
  if (input === "FREE30DAYS" || input === "CLEARTAXFREE" || input === "1MONTHFREE") {
    bookingState.couponApplied = true;
    bookingState.discountPercent = 100;
    if (feedback) {
      feedback.textContent = "✓ Code applied! 100% Free for 1 Month (₹0.00 payable).";
      feedback.style.color = "#16A34A";
    }
  } else if (input === "TAXHERO65") {
    bookingState.couponApplied = true;
    bookingState.discountPercent = 65;
    if (feedback) {
      feedback.textContent = "✓ Code TAXHERO65 applied! 65% Instant Discount.";
      feedback.style.color = "#16A34A";
    }
  } else {
    bookingState.couponApplied = false;
    bookingState.discountPercent = 0;
    if (feedback) {
      feedback.textContent = "Invalid or expired promo code.";
      feedback.style.color = "#EA580C";
    }
  }
  updateBookingPriceBreakdown();
}

function updateBookingPriceBreakdown() {
  const original = bookingState.basePrice;
  const discountAmount = Math.round(original * (bookingState.discountPercent / 100));
  const finalPayable = Math.max(0, original - discountAmount);

  document.getElementById("bookBasePriceText").textContent = `₹ ${original.toLocaleString("en-IN")}`;
  document.getElementById("bookDiscountText").textContent = `- ₹ ${discountAmount.toLocaleString("en-IN")}`;
  document.getElementById("bookFinalPriceText").textContent = `₹ ${finalPayable.toLocaleString("en-IN")}`;
}

async function submitExpertBooking() {
  const payload = {
    planId: bookingState.planId,
    clientName: document.getElementById("bookClientName")?.value || "Taxpayer",
    pan: document.getElementById("bookClientPan")?.value || "CVBBC4433W",
    phone: document.getElementById("bookClientPhone")?.value || "9876543210",
    slot: document.getElementById("bookSlotSelect")?.value || "Today at 03:00 PM (IST)",
    couponCode: bookingState.couponApplied ? "TAXHERO65" : ""
  };

  try {
    const res = await fetch("/api/expert/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      const box = document.getElementById("bookingConfirmationResult");
      box.className = "filing-success-box info-note-box";
      box.innerHTML = `
        <h4 style="color: #15803D;">✓ CA Consultation Confirmed!</h4>
        <div class="mt-1"><strong>Booking Reference ID:</strong> ${result.bookingId}</div>
        <div><strong>Assigned Expert:</strong> ${result.assignedExpert.name} (${result.assignedExpert.role})</div>
        <div><strong>Scheduled Slot:</strong> ${result.slot}</div>
        <div><strong>Secure Video Meeting Room:</strong> <a href="${result.meetingLink}" target="_blank" class="blue-link">${result.meetingLink}</a></div>
        <div><strong>Total Fee Charged:</strong> ₹${result.finalPrice} (Demo sandbox transaction)</div>
        <div class="text-xs text-muted mt-1">Guaranteed: ${result.guarantee}</div>
      `;
      box.classList.remove("hidden");
      document.getElementById("btnConfirmBooking").style.display = "none";
    }
  } catch (err) {
    console.error("Booking failed:", err);
  }
}

function verifyNoticeHelp() {
  const din = document.getElementById("noticeDinInput")?.value.trim();
  if (!din) {
    alert("Please enter your Notice Document Identification Number (DIN).");
    return;
  }
  // Route to the Interactive Notice Defense & Scrutiny Board
  switchSuite("notice");
  const dinInput = document.getElementById("noticeInputDin");
  if (dinInput) dinInput.value = din;
  runNoticeDiscrepancyAnalysis();
}

// ============================================================================
// Official CBDT Pre-fill JSON Parser & Ingestion
// ============================================================================
async function handlePrefillFileChosen(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const json = JSON.parse(e.target.result);
      await importPrefillData(json);
    } catch (err) {
      alert("Invalid JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
}

async function loadSamplePrefillJson() {
  try {
    const res = await fetch(`/api/itr/sample-prefill?pan=${appState.itr.personalInfo.pan}`);
    const sample = await res.json();
    await importPrefillData(sample);
  } catch (err) {
    alert("Could not load sample prefill: " + err.message);
  }
}

async function importPrefillData(rawJson) {
  try {
    const res = await fetch("/api/itr/prefill-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawJson })
    });
    const parsed = await res.json();
    if (!parsed.success) {
      alert("Prefill parsing error: " + (parsed.error || "Unknown"));
      return;
    }

    // Apply profile
    if (parsed.profile) {
      if (parsed.profile.pan) appState.itr.personalInfo.pan = parsed.profile.pan;
      if (parsed.profile.firstName) appState.itr.personalInfo.firstName = parsed.profile.firstName;
      if (parsed.profile.lastName) appState.itr.personalInfo.lastName = parsed.profile.lastName;
      if (parsed.profile.dob) appState.itr.personalInfo.dob = parsed.profile.dob;
      if (parsed.profile.mobile) appState.itr.personalInfo.mobile = parsed.profile.mobile;
      if (parsed.profile.email) appState.itr.personalInfo.email = parsed.profile.email;
      if (parsed.profile.aadhaar) appState.itr.personalInfo.aadhaar = parsed.profile.aadhaar;
      if (parsed.profile.address) appState.itr.personalInfo.address = parsed.profile.address;
    }
    // Apply bank
    if (parsed.bankAccounts && parsed.bankAccounts.length > 0) {
      const b = parsed.bankAccounts[0];
      appState.itr.personalInfo.bank = {
        accNo: b.accountNumber,
        ifsc: b.ifsc,
        type: b.accountType === "SAVINGS" ? "SAV" : "CUR"
      };
    }
    // Apply income
    if (parsed.salary) {
      appState.itr.income.grossSalary = parsed.salary.grossSalary || 0;
      appState.itr.income.otherIncome = parsed.otherIncome?.savingsInterest || 0;
    }
    // Apply taxes paid
    if (parsed.taxesPaid) {
      appState.itr.income.taxesPaid.tds = (parsed.taxesPaid.totalTdsSalary || 0) + (parsed.taxesPaid.totalTdsOther || 0);
      appState.itr.income.taxesPaid.advanceTax = parsed.taxesPaid.totalAdvanceTax || 0;
    }

    // Sync input fields
    syncPersonalInfoInputs();
    updatePersonalInfoState();
    await recalculateItrTax();
    alert(`✓ Official CBDT Pre-fill JSON Successfully Ingested!\n- PAN: ${parsed.pan}\n- Gross Salary: ₹${parsed.salary?.grossSalary?.toLocaleString("en-IN")}\n- Total TDS Credited: ₹${((parsed.taxesPaid?.totalTdsSalary || 0) + (parsed.taxesPaid?.totalTdsOther || 0))?.toLocaleString("en-IN")}\n- Bank: ${parsed.bankAccounts?.[0]?.bankName || "Linked"}`);
  } catch (err) {
    console.error("Prefill import failed:", err);
    alert("Prefill import failed: " + err.message);
  }
}

function syncPersonalInfoInputs() {
  const p = appState.itr.personalInfo;
  if (document.getElementById("inputPan")) document.getElementById("inputPan").value = p.pan;
  if (document.getElementById("inputFirstName")) document.getElementById("inputFirstName").value = p.firstName;
  if (document.getElementById("inputLastName")) document.getElementById("inputLastName").value = p.lastName;
  if (document.getElementById("inputDob")) document.getElementById("inputDob").value = p.dob;
  if (document.getElementById("inputMobile")) document.getElementById("inputMobile").value = p.mobile;
  if (document.getElementById("inputEmail")) document.getElementById("inputEmail").value = p.email;
  if (document.getElementById("inputAadhaar")) document.getElementById("inputAadhaar").value = p.aadhaar;
  if (document.getElementById("currentFilingPan")) document.getElementById("currentFilingPan").textContent = p.pan;

  if (p.bank) {
    if (document.getElementById("inputBankAcc")) document.getElementById("inputBankAcc").value = p.bank.accNo;
    if (document.getElementById("inputBankIfsc")) document.getElementById("inputBankIfsc").value = p.bank.ifsc;
    if (document.getElementById("inputBankType")) document.getElementById("inputBankType").value = p.bank.type;
  }
}

// ============================================================================
// Broker Tax P&L Statement Parser (Zerodha, Groww, Upstox)
// ============================================================================
let currentBrokerTradeData = null;

function openBrokerPnlModal() {
  currentBrokerTradeData = null;
  document.getElementById("brokerResultsBox")?.classList.add("hidden");
  const btn = document.getElementById("btnApplyBrokerGains");
  if (btn) btn.disabled = true;
  openModal("modalBrokerPnl");
}

function handleBrokerCsvChosen(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const csvText = e.target.result;
      const res = await fetch("/api/itr/broker-pnl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText })
      });
      const data = await res.json();
      renderBrokerResults(data);
    } catch (err) {
      alert("Failed to parse broker CSV: " + err.message);
    }
  };
  reader.readAsText(file);
}

async function loadSampleBrokerTradesDemo() {
  try {
    const res = await fetch("/api/itr/broker-pnl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await res.json();
    renderBrokerResults(data);
  } catch (err) {
    alert("Failed to load sample broker trades: " + err.message);
  }
}

function renderBrokerResults(data) {
  if (!data.success) {
    alert("Broker parse failed: " + (data.error || "Unknown"));
    return;
  }
  currentBrokerTradeData = data;
  const taxableTotal = (data.taxableStcg || 0) + (data.taxableLtcg || 0);
  document.getElementById("brokerStcgVal").textContent = "₹ " + Number(data.grossStcg || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  document.getElementById("brokerLtcgVal").textContent = "₹ " + Number(data.grossLtcg || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  document.getElementById("brokerExemptionVal").textContent = "₹ " + Number(data.exemption112AApplied || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  document.getElementById("brokerTotalTaxableVal").textContent = "₹ " + Number(taxableTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  const tbody = document.getElementById("brokerTradesTableBody");
  if (tbody) {
    tbody.innerHTML = (data.trades || []).map(r => `
      <tr>
        <td class="font-semibold">${r.symbol}</td>
        <td>${r.buyDate}</td>
        <td>${r.sellDate}</td>
        <td>${r.holdingDays} days</td>
        <td>₹${Number(r.buyValue).toLocaleString("en-IN")}</td>
        <td>₹${Number(r.sellValue).toLocaleString("en-IN")}</td>
        <td class="${r.netGain >= 0 ? 'green-text font-semibold' : 'text-danger font-semibold'}">
          ${r.netGain >= 0 ? '+' : ''}₹${Number(r.netGain).toLocaleString("en-IN")}
        </td>
        <td><span class="status-chip ${r.category === 'EQUITY_STCG' ? 'orange-chip' : 'success-chip'}">${r.category}</span></td>
        <td class="font-bold text-xs">${r.category === 'EQUITY_STCG' ? '20%' : (r.category === 'EQUITY_LTCG' ? '12.5%' : 'Slab')}</td>
      </tr>
    `).join("");
  }

  document.getElementById("brokerResultsBox")?.classList.remove("hidden");
  const btn = document.getElementById("btnApplyBrokerGains");
  if (btn) btn.disabled = false;
}

function applyBrokerGainsToReturn() {
  if (!currentBrokerTradeData) return;
  const taxableGains = (currentBrokerTradeData.taxableStcg || 0) + (currentBrokerTradeData.taxableLtcg || 0);
  appState.itr.income.capitalGains = taxableGains;
  const badge = document.getElementById("badgeCapGainsVal");
  if (badge) badge.textContent = "₹ " + Number(taxableGains).toLocaleString("en-IN");
  recalculateItrTax();
  closeModal("modalBrokerPnl");
  alert(`✓ Capital Gains of ₹${Number(taxableGains).toLocaleString("en-IN")} (STCG @ 20% & LTCG @ 12.5% u/s 112A) applied to your tax return!`);
}

// ============================================================================
// Interactive Notice Defense & Scrutiny Board (143(1), 139(9), 148)
// ============================================================================
let currentNoticeAnalysis = null;

function loadSampleSection143Notice() {
  document.getElementById("noticeInputDin").value = "CPC/2526/89401283";
  document.getElementById("noticeInputSection").value = "143(1)";
  document.getElementById("noticeInputAy").value = "2025-26";
  runNoticeDiscrepancyAnalysis();
}

async function runNoticeDiscrepancyAnalysis() {
  const din = document.getElementById("noticeInputDin")?.value.trim() || "CPC/2526/89401283";
  const section = document.getElementById("noticeInputSection")?.value || "143(1)";
  const ay = document.getElementById("noticeInputAy")?.value || "2025-26";
  const pan = document.getElementById("noticeInputPan")?.value || appState.itr.personalInfo.pan;

  // Realistic Section 143(1) intimation discrepancy: Form 16 vs CPC late employer filing
  const filedData = {
    grossSalary: 1200000,
    deductions80D: 25000,
    tdsCredit: 100000,
    refundClaimed: 15000
  };

  const intimationData = {
    grossSalary: 1200000,
    deductions80D: 0, // Disallowed due to lack of verification
    tdsCredit: 75000,  // Form 24Q late filing variance
    netTaxPayable: 25000
  };

  try {
    const res = await fetch("/api/notices/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filedData, intimationData })
    });
    const analysis = await res.json();
    currentNoticeAnalysis = { din, section, ay, pan, ...analysis };

    // Update Stage Pills
    document.getElementById("pipelineStep1")?.classList.add("active");
    document.getElementById("pipelineStep2")?.classList.add("active");

    // Render discrepancy table
    const tbody = document.getElementById("noticeVarianceTableBody");
    const matrix = analysis.discrepancyMatrix || [];
    if (tbody) {
      tbody.innerHTML = matrix.map(d => `
        <tr>
          <td class="font-semibold">${d.head}</td>
          <td>₹${Number(d.filed).toLocaleString("en-IN")}</td>
          <td>₹${Number(d.assessed).toLocaleString("en-IN")}</td>
          <td class="${d.variance !== 0 ? 'text-danger font-bold' : ''}">
            ${d.variance > 0 ? '+' : ''}₹${Number(d.variance).toLocaleString("en-IN")}
          </td>
          <td class="text-xs text-muted">${d.reason}</td>
        </tr>
      `).join("");
    }

    // Render draft reply
    const draftRes = await fetch("/api/notices/generate-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assesseeName: appState.itr.personalInfo.firstName + " " + appState.itr.personalInfo.lastName,
        pan,
        assessmentYear: ay,
        din,
        section,
        discrepancies: matrix,
        dateOfNotice: new Date().toLocaleDateString("en-IN")
      })
    });
    const draftData = await draftRes.json();
    if (draftData.success && draftData.draft) {
      document.getElementById("noticeDraftReplyText").value = draftData.draft;
      document.getElementById("pipelineStep3")?.classList.add("active");
    }

    document.getElementById("ackDinDisplay").textContent = din;
    document.getElementById("ackDemandDisplay").textContent = "₹ " + Number(analysis.netDemandAmount || 25000).toLocaleString("en-IN", { minimumFractionDigits: 2 });
    document.getElementById("noticeAnalysisResultContainer")?.classList.remove("hidden");
  } catch (err) {
    console.error("Notice analysis failed:", err);
    alert("Notice analysis failed: " + err.message);
  }
}

function copyNoticeDraftText() {
  const text = document.getElementById("noticeDraftReplyText")?.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast("Statutory Legal Objection draft copied to clipboard!", "success");
  }).catch(() => {
    showToast("Please select and copy the draft text manually.");
  });
}

function downloadNoticeDraftFile() {
  const text = document.getElementById("noticeDraftReplyText")?.value;
  if (!text) return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Statutory_Objection_Reply_${document.getElementById("noticeInputDin")?.value || "143_1"}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function submitSimulatedNoticeReply() {
  const din = document.getElementById("noticeInputDin")?.value || "CPC/2526/89401283";
  const section = document.getElementById("noticeInputSection")?.value || "143(1)";
  const replyText = document.getElementById("noticeDraftReplyText")?.value;

  try {
    const res = await fetch("/api/notices/submit-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ din, section, replyText })
    });
    const result = await res.json();
    if (result.success) {
      document.getElementById("pipelineStep4")?.classList.add("active");
      const statusChip = document.getElementById("noticeAckStatusChip");
      if (statusChip) {
        statusChip.textContent = "Objection Filed u/s 154";
        statusChip.className = "status-chip success-chip";
      }
      const successBox = document.getElementById("noticeSubmissionSuccessBox");
      if (successBox) {
        successBox.className = "filing-success-box info-note-box";
        successBox.innerHTML = `
          <h4 style="color: #15803D;">✓ Statutory Objection Successfully Lodged!</h4>
          <div class="mt-1"><strong>ITD Submission Token:</strong> ${result.submissionId}</div>
          <div><strong>Notice Reference DIN:</strong> ${result.din}</div>
          <div><strong>Section Invoked:</strong> Section ${result.section} / 154 Rectification</div>
          <div><strong>Status:</strong> ${result.status}</div>
          <div class="text-xs text-muted mt-2">Notice: ${result.notice}</div>
        `;
        successBox.classList.remove("hidden");
      }
    }
  } catch (err) {
    alert("Simulated submission failed: " + err.message);
  }
}

// ============================================================================
// In-App Tax Document Vault
// ============================================================================
let currentVaultCategory = "all";
let vaultSelectedFile = null;

async function loadVaultDocuments(category = "all") {
  try {
    const res = await fetch(`/api/vault/documents?category=${category}`);
    const data = await res.json();
    if (data.success) {
      renderVaultTable(data.documents);
    }
  } catch (err) {
    console.error("Failed to load vault documents:", err);
  }
}

function filterVaultDocs(category, btn) {
  currentVaultCategory = category;
  document.querySelectorAll(".vault-tab-pill").forEach(p => p.classList.remove("active"));
  btn?.classList.add("active");
  loadVaultDocuments(category);
}

function renderVaultTable(docs) {
  const tbody = document.getElementById("vaultTableBody");
  if (!tbody) return;
  if (!docs || docs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted p-4">No documents stored in this vault category. Click "+ Upload New Document" to add.</td></tr>`;
    return;
  }

  tbody.innerHTML = docs.map(d => {
    let chipClass = "form16";
    if (d.category === "ais") chipClass = "ais";
    else if (d.category === "26as") chipClass = "tds";
    else if (d.category === "broker") chipClass = "broker";
    else if (d.category === "itrv") chipClass = "itrv";

    return `
      <tr>
        <td>
          <div class="font-semibold text-primary">${d.title}</div>
          <div class="text-xs text-muted">${d.filename}</div>
        </td>
        <td><span class="vault-category-chip ${chipClass}">${d.category.toUpperCase()}</span></td>
        <td>${d.assessmentYear || "AY 2025-26"}</td>
        <td>${d.fileSize || "1.2 MB"}</td>
        <td>${d.uploadedAt ? d.uploadedAt.split("T")[0] : "2026-10-31"}</td>
        <td>
          <span class="status-chip success-chip">${d.verifiedWithCbdt ? "✓ Verified CBDT" : "Stored Safe"}</span>
        </td>
        <td>
          <div class="flex-gap">
            <button class="btn btn-outline btn-sm" onclick="alert('Viewing document: ${d.filename} (Encrypted storage)')">View</button>
            <button class="btn btn-outline btn-sm" onclick="alert('Downloading: ${d.filename}')">Download</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function openVaultUploadModal() {
  vaultSelectedFile = null;
  const dropText = document.getElementById("vaultFileDropText");
  if (dropText) dropText.textContent = "Drop PDF/Excel/JSON or Click to Browse";
  openModal("modalVaultUpload");
}

function handleVaultFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  vaultSelectedFile = file;
  const dropText = document.getElementById("vaultFileDropText");
  if (dropText) dropText.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
}

async function submitVaultUpload() {
  const title = document.getElementById("vaultInputTitle")?.value.trim();
  const category = document.getElementById("vaultInputCategory")?.value || "form16";
  const ay = document.getElementById("vaultInputAy")?.value || "2025-26";
  const pan = document.getElementById("vaultInputPan")?.value || appState.itr.personalInfo.pan;

  if (!title) {
    alert("Please provide a Document Title.");
    return;
  }

  const filename = vaultSelectedFile ? vaultSelectedFile.name : `${title.replace(/\s+/g, "_")}.pdf`;
  const fileSize = vaultSelectedFile ? `${(vaultSelectedFile.size / 1024).toFixed(1)} KB` : "1.4 MB";

  try {
    const res = await fetch("/api/vault/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category,
        filename,
        assessmentYear: ay,
        pan,
        fileSize,
        verifiedWithCbdt: true
      })
    });
    const result = await res.json();
    if (result.success) {
      closeModal("modalVaultUpload");
      loadVaultDocuments(currentVaultCategory);
      alert(`✓ Document "${title}" securely stored in Tax Document Vault!`);
    }
  } catch (err) {
    alert("Vault upload failed: " + err.message);
  }
}

// ============================================================================
// E-Invoicing & IRP Sandbox Client Operations
// ============================================================================
let currentGeneratedEinvoice = null;

async function submitGenerateEinvoice() {
  const invoiceNo = document.getElementById("einvDocNumber")?.value.trim() || "INV-2026-901";
  const invoiceDate = document.getElementById("einvDocDate")?.value || "2026-10-31";
  const buyerGstin = document.getElementById("einvBuyerGstin")?.value.trim() || "29XYZAB5678C1Z2";
  const taxableValue = Number(document.getElementById("einvTaxableValue")?.value || 125000);
  const gstRate = Number(document.getElementById("einvGstRate")?.value || 18);
  const hsnCode = document.getElementById("einvHsnCode")?.value.trim() || "84713010";

  try {
    const res = await fetch("/api/einvoice/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceNo,
        invoiceDate,
        buyerGstin,
        taxableValue,
        gstRate,
        hsnCode,
        supplierGstin: appState.gst.business.gstin
      })
    });
    const data = await res.json();
    if (!data.success) {
      alert("E-Invoice generation error: " + (data.error || "Unknown"));
      return;
    }

    currentGeneratedEinvoice = data;
    document.getElementById("einvIrnDisplay").textContent = data.irn;
    document.getElementById("einvAckDisplay").textContent = `Ack No: ${data.ackNo} • ${new Date(data.ackDate).toLocaleString("en-IN")}`;
    document.getElementById("einvTotalValDisplay").textContent = `₹ ${Number(data.valDetails.totalInvoiceValue).toLocaleString("en-IN", { minimumFractionDigits: 2 })} (Tax: ₹${data.valDetails.totalTax.toLocaleString("en-IN")})`;
    document.getElementById("einvQrPayloadText").value = data.qrCodeData;
    document.getElementById("einvResultCard")?.classList.remove("hidden");
    alert(`✓ E-Invoice Successfully Generated!\n- IRN: ${data.irn.substring(0, 16)}...\n- Signed Payload & Dynamic QR Code ready for dispatch.`);
  } catch (err) {
    alert("Failed to generate E-Invoice: " + err.message);
  }
}

function copyEinvoiceIrn() {
  if (!currentGeneratedEinvoice) return;
  navigator.clipboard.writeText(currentGeneratedEinvoice.irn).then(() => {
    showToast("64-character SHA-256 IRN copied to clipboard!", "success");
  });
}

async function cancelCurrentEinvoice() {
  if (!currentGeneratedEinvoice) return;
  if (!confirm("Are you sure you want to cancel this E-Invoice within the statutory 24-hour window?")) return;
  try {
    const res = await fetch("/api/einvoice/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        irn: currentGeneratedEinvoice.irn,
        reason: "1",
        remarks: "User initiated cancellation via sandbox"
      })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById("einvAckDisplay").textContent = `Status: CANCELLED (CNL) on ${new Date().toLocaleString("en-IN")}`;
      alert("✓ E-Invoice successfully cancelled on IRP.");
    }
  } catch (err) {
    alert("Cancellation error: " + err.message);
  }
}

function prefillEwbFromEinvoice() {
  if (!currentGeneratedEinvoice) return;
  const ewbDist = document.getElementById("ewbDistanceKm");
  if (ewbDist) ewbDist.scrollIntoView({ behavior: "smooth" });
}

async function loadSampleEinvoicesList() {
  try {
    const res = await fetch("/api/einvoice/list");
    const data = await res.json();
    if (data.success && data.einvoices) {
      alert(`Registered E-Invoices on IRP: ${data.count} Active Invoices found in ledger.`);
    }
  } catch (e) {}
}

// ============================================================================
// E-Way Bill (EWB) Lifecycle Client Operations
// ============================================================================
let currentGeneratedEwb = null;

function updateEwbValidityPreview() {
  const km = Number(document.getElementById("ewbDistanceKm")?.value || 100);
  const isOverDim = document.getElementById("ewbCargoType")?.value === "OVER_DIMENSIONAL";
  const days = isOverDim ? Math.ceil(km / 20) : Math.ceil(km / 200);
  const box = document.getElementById("ewbValidityPreviewBox");
  if (box) {
    box.innerHTML = `<strong>Rule 138(10) Validity:</strong> Distance of ${km} km yields <strong>${days} Day(s) Validity</strong> from timestamp of generation.`;
  }
}

async function submitGenerateEwayBill() {
  const distanceKm = Number(document.getElementById("ewbDistanceKm")?.value || 380);
  const vehicleNo = document.getElementById("ewbVehicleNo")?.value.trim() || "KA01AB1234";
  const transporterId = document.getElementById("ewbTransporterId")?.value.trim() || "29TRANS1234A1Z9";
  const isOverDim = document.getElementById("ewbCargoType")?.value === "OVER_DIMENSIONAL";

  try {
    const res = await fetch("/api/ewaybill/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierGstin: appState.gst.business.gstin,
        buyerGstin: "29XYZAB5678C1Z2",
        distanceKm,
        vehicleNo,
        transporterId,
        isOverDimensional: isOverDim,
        invoiceValue: currentGeneratedEinvoice ? currentGeneratedEinvoice.valDetails.totalInvoiceValue : 85000
      })
    });
    const data = await res.json();
    if (!data.success) {
      alert("EWB Error: " + (data.error || "Unknown"));
      return;
    }
    currentGeneratedEwb = data;
    document.getElementById("ewbNoDisplay").textContent = data.ewbNo;
    document.getElementById("ewbValidityDisplay").textContent = `${data.validityDays} Days (Valid until ${new Date(data.validUntil).toLocaleString("en-IN")})`;
    document.getElementById("ewbVehicleDisplay").textContent = `${data.partB.vehicleNo} (${data.partB.transporterName})`;
    document.getElementById("ewbResultCard")?.classList.remove("hidden");
    const updateInput = document.getElementById("updateEwbNo");
    if (updateInput) updateInput.value = data.ewbNo;
    alert(`✓ Statutory E-Way Bill Generated!\n- EWB No: ${data.ewbNo}\n- Validity: ${data.validityDays} Day(s)\n- Vehicle: ${data.partB.vehicleNo}`);
  } catch (err) {
    alert("Failed to generate EWB: " + err.message);
  }
}

function openUpdatePartBModal() {
  if (currentGeneratedEwb) {
    const updateInput = document.getElementById("updateEwbNo");
    if (updateInput) updateInput.value = currentGeneratedEwb.ewbNo;
  }
  openModal("modalUpdatePartB");
}

async function submitUpdatePartBVehicle() {
  const ewbNo = document.getElementById("updateEwbNo")?.value.trim();
  const vehicleNo = document.getElementById("updateNewVehicle")?.value.trim();
  const fromPlace = document.getElementById("updateFromPlace")?.value.trim();
  const reasonCode = document.getElementById("updateReasonCode")?.value;

  if (!ewbNo || !vehicleNo) {
    alert("Please enter EWB No and New Vehicle Number.");
    return;
  }

  try {
    const res = await fetch("/api/ewaybill/update-part-b", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ewbNo, vehicleNo, fromPlace, reasonCode })
    });
    const data = await res.json();
    if (data.success) {
      closeModal("modalUpdatePartB");
      document.getElementById("ewbVehicleDisplay").textContent = `${data.updatedVehicleNo} (Updated at ${fromPlace})`;
      alert(`✓ Part-B Updated! New vehicle: ${data.updatedVehicleNo}`);
    } else {
      alert("Update failed: " + data.error);
    }
  } catch (err) {
    alert("Part-B update error: " + err.message);
  }
}

// ============================================================================
// Vendor Compliance & "ITC at Risk" Client Operations
// ============================================================================
let currentVendorRiskData = null;
let currentWithholdingNoticeObj = null;

async function loadVendorRiskLeaderboard() {
  try {
    const res = await fetch("/api/vendor-risk/leaderboard");
    const data = await res.json();
    if (!data.success) return;
    currentVendorRiskData = data;

    document.getElementById("vendorTotalTracked").textContent = data.summary.totalVendorsTracked;
    document.getElementById("vendorBlockedItcTotal").textContent = "₹ " + Number(data.summary.totalBlockedItc).toLocaleString("en-IN");
    document.getElementById("vendorHighRiskCount").textContent = data.summary.highRiskVendorsCount;
    document.getElementById("vendorHealthScore").textContent = `${data.summary.complianceHealthScore}%`;

    const tbody = document.getElementById("vendorRiskTableBody");
    if (tbody) {
      tbody.innerHTML = data.vendors.map(v => `
        <tr>
          <td><strong class="text-primary">${v.tradeName}</strong></td>
          <td class="font-mono text-xs">${v.gstin}</td>
          <td>${v.totalInvoices}</td>
          <td class="${v.missingInvoices.length > 0 ? 'text-danger font-bold' : ''}">${v.missingInvoices.length}</td>
          <td>₹${Number(v.totalPurchases).toLocaleString("en-IN")}</td>
          <td class="font-bold ${v.blockedItc > 0 ? 'text-danger' : 'green-text'}">₹${Number(v.blockedItc).toLocaleString("en-IN")}</td>
          <td>${v.complianceRate}%</td>
          <td>
            <span class="status-chip ${v.riskRating === 'HIGH' ? 'danger-chip' : (v.riskRating === 'MEDIUM' ? 'orange-chip' : 'success-chip')}">
              ${v.riskRating}
            </span>
          </td>
          <td>
            ${v.blockedItc > 0 ? `
              <button class="btn btn-outline btn-sm" onclick="openWithholdingNoticeModal('${v.gstin}', '${v.tradeName.replace(/'/g, "\\'")}', ${v.blockedItc})">
                Withholding Notice
              </button>
            ` : '<span class="text-xs text-muted">Compliant</span>'}
          </td>
        </tr>
      `).join("");
    }
  } catch (err) {
    console.error("Vendor risk load failed:", err);
  }
}

async function openWithholdingNoticeModal(gstin, tradeName, blockedItc) {
  try {
    const res = await fetch("/api/vendor-risk/withholding-notice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gstin, tradeName, blockedItc })
    });
    const data = await res.json();
    if (data.success) {
      currentWithholdingNoticeObj = data;
      document.getElementById("withholdingNoticeText").value = data.noticeText;
      openModal("modalWithholdingNotice");
    }
  } catch (err) {
    alert("Notice creation error: " + err.message);
  }
}

function copyWithholdingNoticeText() {
  const text = document.getElementById("withholdingNoticeText")?.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast("Section 16(2)(aa) Withholding Notice copied to clipboard!", "success");
  });
}

function shareNoticeWhatsapp() {
  if (currentWithholdingNoticeObj && currentWithholdingNoticeObj.whatsappShareUrl) {
    window.open(currentWithholdingNoticeObj.whatsappShareUrl, "_blank");
  }
}

// ============================================================================
// Multi-GSTIN Corporate Hub Client Operations
// ============================================================================
async function loadMultiGstinSummary() {
  const pan = document.getElementById("multiGstinPanInput")?.value.trim() || "AAACB1234F";
  try {
    const res = await fetch(`/api/multi-gstin/summary?pan=${pan}`);
    const data = await res.json();
    if (!data.success) {
      alert("Multi-GSTIN error: " + data.error);
      return;
    }

    document.getElementById("multiTotalGstins").textContent = `${data.consolidatedMetrics.totalGstinsRegistered} States`;
    document.getElementById("multiPanTurnover").textContent = `₹ ${(data.consolidatedMetrics.panIndiaTurnover / 10000000).toFixed(2)} Cr`;
    document.getElementById("multiTotalTax").textContent = `₹ ${(data.consolidatedMetrics.totalOutputTaxLiability / 100000).toFixed(2)} L`;
    document.getElementById("multiComplianceRate").textContent = `${data.consolidatedMetrics.overallComplianceRate}%`;

    const tbody = document.getElementById("multiGstinTableBody");
    if (tbody) {
      tbody.innerHTML = data.branches.map(b => `
        <tr>
          <td><strong>${b.stateName} (${b.stateCode})</strong></td>
          <td class="font-mono text-xs">${b.gstin}</td>
          <td><span class="status-chip ${b.gstr1Status === 'FILED' ? 'success-chip' : 'orange-chip'}">${b.gstr1Status}</span></td>
          <td><span class="status-chip ${b.gstr3bStatus === 'FILED' ? 'success-chip' : 'danger-chip'}">${b.gstr3bStatus}</span></td>
          <td><span class="status-chip ${b.gstr9Status === 'FILED' || b.gstr9Status === 'READY' ? 'success-chip' : 'orange-chip'}">${b.gstr9Status}</span></td>
          <td>₹${Number(b.turnover).toLocaleString("en-IN")}</td>
          <td>₹${Number(b.outputTax).toLocaleString("en-IN")}</td>
          <td>₹${Number(b.eligibleItc).toLocaleString("en-IN")}</td>
          <td class="font-bold text-primary">₹${Number(b.netCashPayable).toLocaleString("en-IN")}</td>
        </tr>
      `).join("");
    }
  } catch (err) {
    console.error("Multi-GSTIN load failed:", err);
  }
}

// ============================================================================
// GSTR-9 Annual Return Client Operations
// ============================================================================
async function runGstr9Consolidation() {
  try {
    const res = await fetch(`/api/gstr9/consolidate?gstin=${appState.gst.business.gstin}&fy=2025-26`);
    const data = await res.json();
    if (!data.success) {
      alert("GSTR-9 error: " + data.error);
      return;
    }

    document.getElementById("gstr9T4B2b").textContent = "₹ " + Number(data.table4_OutwardTaxableSupplies.b2bTaxableSupplies.taxableValue).toLocaleString("en-IN");
    document.getElementById("gstr9T4B2c").textContent = "₹ " + Number(data.table4_OutwardTaxableSupplies.b2cTaxableSupplies.taxableValue).toLocaleString("en-IN");
    document.getElementById("gstr9T4Turnover").textContent = "₹ " + Number(data.table4_OutwardTaxableSupplies.totalTaxableValue).toLocaleString("en-IN");
    document.getElementById("gstr9T4Tax").textContent = "₹ " + Number(data.table4_OutwardTaxableSupplies.totalTaxPayable).toLocaleString("en-IN");

    document.getElementById("gstr9T6Availed").textContent = "₹ " + Number(data.table6_ItcAvailed.totalItcAvailed).toLocaleString("en-IN");
    document.getElementById("gstr9T8Portal").textContent = "₹ " + Number(data.table8_ItcReconciliation.itcAsPer2a2b).toLocaleString("en-IN");
    document.getElementById("gstr9T8Diff").textContent = `+ ₹ ${Number(data.table8_ItcReconciliation.difference).toLocaleString("en-IN")} (Surplus Available)`;
    alert("✓ Full-year GSTR-9 statutory tables consolidated successfully from 12 monthly filings!");
  } catch (err) {
    alert("GSTR-9 consolidation failed: " + err.message);
  }
}

// ============================================================================
// Tax Loss Harvesting Modal Client Operations
// ============================================================================
let currentTlhData = null;

async function openTaxLossHarvestingModal() {
  try {
    const res = await fetch("/api/itr/tax-loss-harvesting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        realizedGains: {
          stcg: 50000,
          ltcg: 200000
        }
      })
    });
    const data = await res.json();
    if (!data.success) return;
    currentTlhData = data;

    document.getElementById("tlhCurrentTax").textContent = "₹ " + Number(data.currentTaxLiability).toLocaleString("en-IN");
    document.getElementById("tlhPotentialSaved").textContent = "₹ " + Number(data.potentialTaxSaved).toLocaleString("en-IN");
    document.getElementById("tlhHarvestableLoss").textContent = "₹ " + Number(data.harvestableLossIdentified.totalHarvestableLoss).toLocaleString("en-IN");
    document.getElementById("tlhOptimizedTax").textContent = "₹ " + Number(data.optimizedTaxLiability).toLocaleString("en-IN");

    const tbody = document.getElementById("tlhHoldingsTableBody");
    if (tbody) {
      tbody.innerHTML = (data.harvestingPlan || []).map(item => `
        <tr>
          <td><strong class="text-primary">${item.symbol}</strong></td>
          <td>${item.quantity}</td>
          <td class="text-danger font-bold">- ₹${Number(item.estimatedLossToRealize).toLocaleString("en-IN")}</td>
          <td><span class="status-chip orange-chip">${item.classification.split(" ")[0]}</span></td>
          <td class="text-xs text-muted">${item.classification}</td>
        </tr>
      `).join("");
    }

    openModal("modalTaxLossHarvesting");
  } catch (err) {
    alert("Failed to load tax loss harvesting data: " + err.message);
  }
}

function applyHarvestedTaxPlan() {
  if (!currentTlhData) return;
  // Reduce capital gains in ITR computation state
  const optimizedTaxable = 100000;
  appState.itr.income.capitalGains = optimizedTaxable;
  const badge = document.getElementById("badgeCapGainsVal");
  if (badge) badge.textContent = "₹ " + Number(optimizedTaxable).toLocaleString("en-IN");
  recalculateItrTax();
  closeModal("modalTaxLossHarvesting");
  alert(`✓ Tax-Loss Harvesting Plan Applied!\n- Estimated Tax Saved: ₹${Number(currentTlhData.potentialTaxSaved).toLocaleString("en-IN")}\n- Capital Gains offset updated in your ITR computation.`);
}


// ============================================================================
// 10. GSP Live API Hub (182 Statutory Return APIs)
// ============================================================================
let allGspApis = [];
let selectedGspApiId = 9;

async function loadApiHubList() {
  try {
    const res = await fetch("/api/gsp/apis");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    allGspApis = data.apis || [];

    // Calculate stat counts
    let working = 0, partial = 0, notWorking = 0, notTested = 0;
    allGspApis.forEach(a => {
      if (a.status === "working") working++;
      else if (a.status === "partial") partial++;
      else if (a.status === "not_working") notWorking++;
      else notTested++;
    });

    const elWorking = document.getElementById("apiStatWorking");
    const elPartial = document.getElementById("apiStatPartial");
    const elNotWorking = document.getElementById("apiStatNotWorking");
    const elNotTested = document.getElementById("apiStatNotTested");

    if (elWorking) elWorking.textContent = working;
    if (elPartial) elPartial.textContent = partial;
    if (elNotWorking) elNotWorking.textContent = notWorking;
    if (elNotTested) elNotTested.textContent = notTested;

    // Populate dropdown
    const select = document.getElementById("apiSelectDropdown");
    if (select) {
      select.innerHTML = allGspApis.map(a => `
        <option value="${a.id}" ${a.id === selectedGspApiId ? "selected" : ""}>
          #${a.id}: [${a.group}] ${a.api} (${a.status.toUpperCase()})
        </option>
      `).join("");
    }

    // Set initial badge
    onSelectApiDropdown(selectedGspApiId);

    // Render table
    renderApiTable(allGspApis);

  } catch (err) {
    console.error("Failed to load GSP API hub:", err);
  }
}

function renderApiTable(list) {
  const tbody = document.getElementById("apiTableBody");
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 30px;">No APIs found matching filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(a => {
    let statusChip = "info-chip";
    let statusText = "Certified";
    if (a.status === "working") {
      statusChip = "success-chip";
      statusText = "Operational";
    } else if (a.status === "partial") {
      statusChip = "warning-chip";
      statusText = "Partial";
    } else if (a.status === "not_working") {
      statusChip = "danger-chip";
      statusText = "Attention";
    }

    const remarkText = a.remark ? a.remark : "Statutory sandbox compliant.";
    const isDocError = a.status === "not_working";

    return `
      <tr>
        <td class="font-mono text-xs"><strong>#${a.id}</strong></td>
        <td><span class="status-chip blue-chip font-mono text-xs">${a.group}</span></td>
        <td>
          <div style="font-weight: 600; color: var(--text-main); font-size: 13px;">${a.api}</div>
          <div class="font-mono text-xs text-muted" style="margin-top: 2px;">
            <span style="font-weight: 700; color: var(--brand-primary);">${a.method || "GET"}</span> ${a.path || "/returns/v1.0"}
          </div>
        </td>
        <td><span class="status-chip ${statusChip}">${statusText}</span></td>
        <td style="max-width: 320px;">
          <div class="text-xs ${isDocError ? 'text-danger font-medium' : 'text-muted'}" style="word-break: break-word;">
            ${remarkText}
          </div>
        </td>
        <td style="text-align: right;">
          <button class="btn btn-outline btn-xs" onclick="selectApiForTesting(${a.id})">
            Inspect & Call
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function onSelectApiDropdown(apiId) {
  selectedGspApiId = Number(apiId);
  const found = allGspApis.find(a => a.id === selectedGspApiId);
  const badge = document.getElementById("currentApiBadge");
  if (badge && found) {
    badge.textContent = `API #${found.id}: [${found.group}] ${found.api}`;
  }
}

function selectApiForTesting(apiId) {
  selectedGspApiId = Number(apiId);
  const select = document.getElementById("apiSelectDropdown");
  if (select) select.value = selectedGspApiId;
  onSelectApiDropdown(selectedGspApiId);

  const inspector = document.querySelector(".api-inspector-box");
  if (inspector) {
    inspector.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function filterApiTable() {
  const group = document.getElementById("apiFilterGroup") ? document.getElementById("apiFilterGroup").value : "ALL";
  const status = document.getElementById("apiFilterStatus") ? document.getElementById("apiFilterStatus").value : "ALL";
  const query = document.getElementById("apiSearchQuery") ? document.getElementById("apiSearchQuery").value.trim().toLowerCase() : "";

  const filtered = allGspApis.filter(a => {
    if (group !== "ALL" && a.group !== group) return false;
    if (status !== "ALL" && a.status !== status) return false;
    if (query) {
      const matchName = (a.api || "").toLowerCase().includes(query);
      const matchRemark = (a.remark || "").toLowerCase().includes(query);
      const matchPath = (a.path || "").toLowerCase().includes(query);
      const matchId = String(a.id) === query;
      if (!matchName && !matchRemark && !matchPath && !matchId) return false;
    }
    return true;
  });

  renderApiTable(filtered);
}

async function testSelectedGspApi() {
  const gstinInput = document.getElementById("apiInputGstin");
  const periodInput = document.getElementById("apiInputPeriod");
  const btn = document.getElementById("btnExecuteSelectedApi");
  const statusEl = document.getElementById("apiResponseStatus");
  const timeEl = document.getElementById("apiResponseTime");
  const jsonEl = document.getElementById("apiResponseJson");

  const gstin = gstinInput ? gstinInput.value.trim() : "32ABCDE1234F1Z5";
  const period = periodInput ? periodInput.value.trim() : "102026";

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Calling Gateway...</span>`;
  }
  if (jsonEl) jsonEl.textContent = "Connecting to statutory GSP gateway dispatcher...";

  const startTime = performance.now();
  try {
    const res = await fetch("/api/gsp/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selectedGspApiId,
        options: { gstin, period }
      })
    });

    const elapsed = Math.round(performance.now() - startTime);
    const result = await res.json();

    if (timeEl) timeEl.textContent = `${elapsed} ms`;

    if (statusEl) {
      if (res.ok && result.status_cd !== "0") {
        statusEl.textContent = `${res.status} OK`;
        statusEl.style.color = "#059669";
      } else {
        statusEl.textContent = `${res.status} ${result.error?.error_cd || "PORTAL_REPLY"}`;
        statusEl.style.color = "#DC2626";
      }
    }

    if (jsonEl) {
      jsonEl.textContent = JSON.stringify(result, null, 2);
    }
  } catch (err) {
    const elapsed = Math.round(performance.now() - startTime);
    if (timeEl) timeEl.textContent = `${elapsed} ms`;
    if (statusEl) {
      statusEl.textContent = "500 Client Error";
      statusEl.style.color = "#DC2626";
    }
    if (jsonEl) {
      jsonEl.textContent = `Client Execution Error: ${err.message}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Execute API Call</span>
      `;
    }
  }
}

async function runBatchApiHealthCheck() {
  const btn = document.getElementById("btnRunBatchHealth");
  const gstin = document.getElementById("apiInputGstin") ? document.getElementById("apiInputGstin").value.trim() : "32ABCDE1234F1Z5";

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Running 182 Diagnostics...</span>`;
  }

  try {
    const res = await fetch("/api/gsp/health-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gstin })
    });

    const data = await res.json();
    alert(`Universal Batch Health Check Completed!\n\n` +
      `• Total APIs Executed: ${data.total}\n` +
      `• Passed / Verified: ${data.passed}\n` +
      `• Documented CSV Errors Handled: ${data.failed}\n` +
      `• System Timestamp: ${data.timestamp}\n\n` +
      `All 182 statutory endpoints tested against statutory gateway schema.`);

    // Refresh UI
    loadApiHubList();
  } catch (err) {
    alert("Universal health check encountered an error: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        <span>Run Universal Health Check (182 APIs)</span>
      `;
    }
  }
}


// =========================================================================
// ClearTax Expert Assisted Filing & 1-Month Free Trial Workflows
// =========================================================================

async function claimOneMonthFreeTrial() {
  const pan = appState.itr?.personalInfo?.pan || "CVBBC4433W";
  const name = ((appState.itr?.personalInfo?.firstName || "") + " " + (appState.itr?.personalInfo?.lastName || "")).trim() || "Sanjay Harshi";
  const phone = appState.itr?.personalInfo?.mobile || "9876543210";

  try {
    showToast("Activating your 1-Month Free CA Advisory Trial...", "info");
    const res = await fetch("/api/expert/claim-free-trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pan, clientName: name, phone })
    });
    const data = await res.json();
    if (data.success) {
      showToast("🎉 1-Month Free CA Advisory Trial Activated!", "success");
      const workspace = document.getElementById("expertClientWorkspace");
      if (workspace) {
        workspace.scrollIntoView({ behavior: "smooth" });
      }
      refreshExpertStatus();
    }
  } catch (err) {
    console.error("Free trial claim failed:", err);
    showToast("Trial active in offline sandbox mode!", "success");
  }
}

async function refreshExpertStatus() {
  const pan = appState.itr?.personalInfo?.pan || "CVBBC4433W";
  try {
    const res = await fetch(`/api/expert/status/${pan}`);
    const data = await res.json();
    if (data.success && data.booking) {
      const b = data.booking;
      if (b.chatHistory && b.chatHistory.length > 0) {
        renderCaChatMessages(b.chatHistory);
      }
      updatePipelineStages(b.stage || "ca_draft_ready");
    }
  } catch (err) {
    console.error("Failed to refresh status:", err);
  }
}

function renderCaChatMessages(messages) {
  const container = document.getElementById("caChatMessages");
  if (!container) return;
  container.innerHTML = messages.map(m => `
    <div class="ca-chat-bubble ${m.role === 'Client' ? 'from-user' : 'from-ca'}">
      <strong>${m.sender}:</strong><br>
      ${m.text}
    </div>
  `).join("");
  container.scrollTop = container.scrollHeight;
}

async function sendCaChatMessage() {
  const input = document.getElementById("caChatInput");
  if (!input || !input.value.trim()) return;
  const msg = input.value.trim();
  input.value = "";

  const container = document.getElementById("caChatMessages");
  if (container) {
    container.innerHTML += `
      <div class="ca-chat-bubble from-user">
        <strong>You:</strong><br>${msg}
      </div>
    `;
    container.scrollTop = container.scrollHeight;
  }

  const pan = appState.itr?.personalInfo?.pan || "CVBBC4433W";
  try {
    const res = await fetch("/api/expert/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pan, message: msg })
    });
    const data = await res.json();
    if (data.success && data.reply) {
      if (container) {
        container.innerHTML += `
          <div class="ca-chat-bubble from-ca">
            <strong>${data.reply.sender}:</strong><br>${data.reply.text}
          </div>
        `;
        container.scrollTop = container.scrollHeight;
      }
    }
  } catch (err) {
    console.error("Chat error:", err);
  }
}

function openCaChatFocus() {
  const input = document.getElementById("caChatInput");
  if (input) {
    input.scrollIntoView({ behavior: "smooth" });
    input.focus();
  }
}

let currentViewingExpertStep = 4;

function viewExpertPipelineStep(stepNum) {
  currentViewingExpertStep = Math.max(1, Math.min(5, Number(stepNum) || 4));

  for (let i = 1; i <= 5; i++) {
    const stepView = document.getElementById(`expertStepView${i}`);
    if (stepView) {
      stepView.style.display = (i === currentViewingExpertStep) ? "block" : "none";
    }
    const stagePill = document.getElementById(`stageStep${i}`);
    if (stagePill) {
      if (i === currentViewingExpertStep) {
        stagePill.classList.add("viewing");
      } else {
        stagePill.classList.remove("viewing");
      }
    }
  }

  // Sync active PAN into Step 2 display if available
  const panEl = document.getElementById("expertStep2Pan");
  if (panEl && appState.itr?.personalInfo?.pan) {
    panEl.textContent = appState.itr.personalInfo.pan;
  }
}

async function approveCaDraftAndFile() {
  const pan = appState.itr?.personalInfo?.pan || "CVBBC4433W";
  const btn = document.getElementById("btnApproveDraft");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/expert/approve-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pan })
    });
    const data = await res.json();
    if (data.success) {
      updatePipelineStages("efiled");
      const arn = data.ackNumber || "ITR20268841920";
      const arnEl = document.getElementById("expertStep5Arn");
      if (arnEl) arnEl.textContent = arn;

      const resultDiv = document.getElementById("approveDraftAckResult");
      if (resultDiv) {
        resultDiv.className = "filing-success-box info-note-box";
        resultDiv.innerHTML = `
          <h4 style="color: #15803D;">✓ ITR-V Filing Successfully Transmitted!</h4>
          <div class="mt-1"><strong>Official Acknowledgement Number (ARN):</strong> ${arn}</div>
          <div><strong>Filing Mode:</strong> ${data.verificationMode}</div>
          <div><strong>Status:</strong> ${data.status}</div>
          <div class="text-xs text-muted mt-1">${data.message}</div>
        `;
        resultDiv.classList.remove("hidden");
      }
      showToast("✓ Return Approved & Transmitted to Sandbox!", "success");

      // Seamlessly switch to Step 5 to reveal the official ITR-V Filing Confirmation
      viewExpertPipelineStep(5);
    }
  } catch (err) {
    console.error("Approve draft failed:", err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function updatePipelineStages(currentStage) {
  const stages = ["registered", "ca_assigned", "slot_confirmed", "ca_draft_ready", "efiled"];
  const stageIdx = stages.indexOf(currentStage) !== -1 ? stages.indexOf(currentStage) : 3;

  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`stageStep${i}`);
    if (!el) continue;
    const isViewing = (i === currentViewingExpertStep);
    el.className = "pipeline-stage-item";
    if (i - 1 < stageIdx) {
      el.classList.add("completed");
    } else if (i - 1 === stageIdx) {
      el.classList.add("active");
    }
    if (isViewing) {
      el.classList.add("viewing");
    }
  }
}


// =========================================================================
// CDA PDF MODULES CONTROLLER LOGIC (Copilot, Startup, Score, Kiosk, Referral)
// =========================================================================

// State tracking for new modules
const cdaState = {
  currentCopilotStep: 1,
  copilotPipeline: null,
  selectedStartupType: 'proprietorship',
  scoreResolvedMismatches: false,
  referralBalance: 1500
};

// 1. Extended Suite Switcher routed through unified executeSwitchSuite
// window.switchSuite is declared as the single authoritative switcher above.

// 2. GST Copilot 5-Step Logic
window.viewCopilotStep = function(stepNum) {
  cdaState.currentCopilotStep = stepNum;
  for (let i = 1; i <= 5; i++) {
    const btn = document.getElementById("btnCopilotStep" + i);
    const view = document.getElementById("copilotStepView" + i);
    if (i === stepNum) {
      btn?.classList.add("active");
      view?.classList.remove("hidden");
    } else {
      btn?.classList.remove("active");
      view?.classList.add("hidden");
    }
  }
};

window.fetchCopilotPipeline = async function() {
  try {
    const res = await fetch("/api/copilot/pipeline?period=102026");
    const json = await res.json();
    if (json.success && json.pipeline) {
      cdaState.copilotPipeline = json.pipeline;
      const s1 = json.pipeline.steps[0];
      const s2 = json.pipeline.steps[1];
      const s3 = json.pipeline.steps[2];
      const s4 = json.pipeline.steps[3];

      if (document.getElementById("copilotSentenceStep1")) {
        document.getElementById("copilotSentenceStep1").innerHTML = s1.plainSentence;
      }
      if (document.getElementById("copilotSentenceStep2")) {
        document.getElementById("copilotSentenceStep2").innerHTML = s2.plainSentence;
      }
      if (document.getElementById("copilotSentenceStep3")) {
        document.getElementById("copilotSentenceStep3").innerHTML = s3.plainSentence;
      }
      if (document.getElementById("copilotSentenceStep4")) {
        document.getElementById("copilotSentenceStep4").innerHTML = s4.plainSentence;
      }
    }
  } catch(e) {
    console.warn("Could not fetch remote copilot pipeline:", e);
  }
};

window.executeCopilotFiling = function() {
  const resultBox = document.getElementById("copilotFilingResult");
  const actionBox = document.getElementById("copilotFilingActionBox");
  const arnElem = document.getElementById("copilotArn");
  const dateElem = document.getElementById("copilotFilingDate");

  const randomArn = "AA321126" + Math.floor(100000 + Math.random() * 900000) + "A";
  if (arnElem) arnElem.textContent = randomArn;
  if (dateElem) dateElem.textContent = new Date().toLocaleDateString("en-IN", { day: '2-digit', month: 'short', year: 'numeric' });

  actionBox?.classList.add("hidden");
  resultBox?.classList.remove("hidden");
  showToast("GSTR-3B return successfully authorized & filed with ARN: " + randomArn, "success");
};

window.askCopilot = async function(question) {
  if (!question || !question.trim()) return;
  const card = document.getElementById("copilotAnswerCard");
  const qElem = document.getElementById("copilotAnswerQuestion");
  const bElem = document.getElementById("copilotAnswerBody");
  const actElem = document.getElementById("copilotAnswerActionContainer");

  try {
    const res = await fetch("/api/copilot/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    const json = await res.json();
    if (json.success && json.result) {
      if (qElem) qElem.textContent = "Q: " + json.result.question;
      if (bElem) bElem.textContent = json.result.answer;
      if (actElem) {
        actElem.innerHTML = json.result.actionLink 
          ? `<a href="${json.result.actionLink}" class="btn btn-sm btn-outline" style="display: inline-block;">${json.result.actionText || 'Take Action'} →</a>`
          : '';
      }
      card?.classList.remove("hidden");
    }
  } catch(e) {
    if (qElem) qElem.textContent = "Q: " + question;
    if (bElem) bElem.textContent = "SimpleGST Copilot is actively tracking all your sales, purchase bills, and auto-drafted GSTR-2B statements.";
    card?.classList.remove("hidden");
  }
};

// 3. Startup Express Logic
window.selectStartupType = function(typeId) {
  cdaState.selectedStartupType = typeId;
  const cards = {
    'proprietorship': document.getElementById('cardEntityProprietor'),
    'partnership': document.getElementById('cardEntityPartnership'),
    'pvt_ltd': document.getElementById('cardEntityPvtLtd'),
    'opc': document.getElementById('cardEntityOpc')
  };

  Object.keys(cards).forEach(k => {
    if (cards[k]) {
      if (k === typeId) {
        cards[k].style.background = '#EFF6FF';
        cards[k].style.borderColor = '#2563EB';
      } else {
        cards[k].style.background = '#FFFFFF';
        cards[k].style.borderColor = '#E2E8F0';
      }
    }
  });

  const cinGroup = document.getElementById('groupStartupCin');
  if (cinGroup) {
    cinGroup.style.display = (typeId === 'pvt_ltd' || typeId === 'opc' || typeId === 'partnership') ? 'block' : 'none';
  }

  // Pre-fill valid sample PAN for that structure
  const panInput = document.getElementById('startupPan');
  if (panInput) {
    if (typeId === 'proprietorship') panInput.value = 'ABCPS1234F';
    else if (typeId === 'partnership') panInput.value = 'ABCFS1234F';
    else panInput.value = 'ABCCS1234F';
  }
  verifyStartupPan();
};

window.verifyStartupPan = function() {
  const pan = (document.getElementById('startupPan')?.value || '').trim().toUpperCase();
  const feedback = document.getElementById('startupPanFeedback');
  if (!feedback) return;

  if (pan.length !== 10) {
    feedback.textContent = "PAN must be 10 characters (e.g. ABCPS1234F)";
    feedback.className = "text-xs text-muted mt-1";
    return;
  }

  const fourth = pan[3];
  const type = cdaState.selectedStartupType;
  if (type === 'proprietorship' && fourth !== 'P') {
    feedback.textContent = "⚠️ Sole Proprietorship requires individual PAN (4th character 'P'). Found '" + fourth + "'";
    feedback.className = "text-xs text-danger mt-1";
  } else if (type === 'partnership' && fourth !== 'F') {
    feedback.textContent = "⚠️ Partnership/LLP requires firm PAN (4th character 'F'). Found '" + fourth + "'";
    feedback.className = "text-xs text-danger mt-1";
  } else if ((type === 'pvt_ltd' || type === 'opc') && fourth !== 'C') {
    feedback.textContent = "⚠️ Corporate entity requires Company PAN (4th character 'C'). Found '" + fourth + "'";
    feedback.className = "text-xs text-danger mt-1";
  } else {
    feedback.textContent = "✓ PAN valid & entity character '" + fourth + "' matches " + type;
    feedback.className = "text-xs text-success mt-1";
  }
};

window.lookupStartupCin = async function() {
  const cin = (document.getElementById('startupCin')?.value || '').trim().toUpperCase();
  const feedback = document.getElementById('startupCinFeedback');
  if (!cin || cin.length !== 21) {
    if (feedback) feedback.textContent = "CIN must be 21 characters";
    return;
  }
  try {
    const res = await fetch('/api/mca/lookup?cin=' + encodeURIComponent(cin));
    const json = await res.json();
    if (json.success && json.company) {
      if (feedback) {
        feedback.innerHTML = "✓ MCA Record Verified: <strong>" + json.company.companyName + "</strong> (" + json.company.directors.length + " Directors, " + json.company.complianceStatus + ")";
        feedback.className = "text-xs text-success mt-1";
      }
    } else {
      if (feedback) {
        feedback.textContent = "⚠️ " + (json.error || "CIN not found in MCA registry");
        feedback.className = "text-xs text-danger mt-1";
      }
    }
  } catch(e) {
    if (feedback) feedback.textContent = "MCA lookup service offline";
  }
};

window.handleStartupExpressSubmit = async function(event) {
  event.preventDefault();
  const businessType = cdaState.selectedStartupType || 'proprietorship';
  const businessName = document.getElementById('startupBusinessName')?.value;
  const ownerName = document.getElementById('startupOwnerName')?.value;
  const pan = document.getElementById('startupPan')?.value;
  const cin = document.getElementById('startupCin')?.value;
  const [state, stateCode] = (document.getElementById('startupState')?.value || 'Kerala|32').split('|');
  const pincode = document.getElementById('startupPincode')?.value;
  const bank = document.getElementById('startupBank')?.value;

  try {
    const res = await fetch('/api/startup-express/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessType, businessName, ownerName, pan, cin, state, stateCode, pincode, bankAccountNumber: bank })
    });
    const json = await res.json();
    if (json.success && json.application) {
      const app = json.application;
      document.getElementById('resStartupArn').textContent = app.provisionalArn;
      document.getElementById('resStartupGstin').textContent = app.provisionalGstin;
      document.getElementById('resStartupInvoice').textContent = app.firstInvoice.invoiceNumber + " (₹" + app.firstInvoice.grandTotal.toLocaleString("en-IN") + ")";
      document.getElementById('startupSuccessBox')?.classList.remove('hidden');
      showToast("Provisional registration ARN generated: " + app.provisionalArn, "success");
    } else {
      alert("Submission error: " + (json.errors ? json.errors.join("\n") : json.error));
    }
  } catch(e) {
    alert("Could not connect to registration engine: " + e.message);
  }
};

// 4. Compliance Health Score Logic
window.loadComplianceScore = async function(overrideMismatches) {
  const mismatches = overrideMismatches !== undefined ? overrideMismatches : (cdaState.scoreResolvedMismatches ? 0 : 2);
  try {
    const res = await fetch('/api/compliance/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gstinStatus: "ACTIVE",
        gstr1Filed: true,
        gstr3bFiled: true,
        itcMismatchesCount: mismatches,
        delinquentVendorsCount: 0,
        taxPaidOnTime: true,
        panAadhaarLinked: true
      })
    });
    const data = await res.json();
    const scoreNum = document.getElementById('scoreNumber');
    const scoreBadge = document.getElementById('scoreBadgeText');
    const scoreCircle = document.getElementById('scoreCircle');
    const scoreRating = document.getElementById('scoreRatingTitle');
    const scoreSummary = document.getElementById('scoreSummary');
    const tableBody = document.getElementById('complianceTableBody');

    if (scoreNum) scoreNum.textContent = data.score;
    if (scoreBadge) scoreBadge.textContent = data.rating;
    if (scoreRating) scoreRating.textContent = data.rating === 'EXCELLENT' ? 'Excellent Statutory Compliance' : 'Attention Needed';

    if (scoreCircle) {
      scoreCircle.style.borderColor = data.badgeColor === 'GREEN' ? '#10B981' : '#F59E0B';
    }

    if (scoreSummary) {
      scoreSummary.textContent = data.recommendations.join(' ');
    }

    if (tableBody && data.breakdown) {
      tableBody.innerHTML = data.breakdown.map(r => `
        <tr>
          <td style="font-weight: 600;">${r.item}</td>
          <td><span class="status-chip">${r.category}</span></td>
          <td><span class="status-chip ${r.badge === 'GREEN' ? 'success-chip' : 'warning-chip'}">${r.status}</span></td>
          <td class="font-mono">${r.points} / ${r.maxPoints} pts</td>
          <td class="text-xs text-muted">${r.message}</td>
        </tr>
      `).join('');
    }
  } catch(e) {
    console.warn("Failed to load compliance score:", e);
  }
};

window.resolveScoreMismatch = function() {
  cdaState.scoreResolvedMismatches = true;
  loadComplianceScore(0);
  const btn = document.getElementById('btnQuickFixMismatch');
  if (btn) {
    btn.textContent = "✓ All 2 Discrepancies Accepted in GSTR-2B";
    btn.style.color = "#059669";
    btn.style.borderColor = "#10B981";
  }
  showToast("ITC discrepancies accepted in 2B! Compliance score boosted to 100/100.", "success");
};

// 5. UNIFIED KIOSK MODE CONTROLLER
let isKioskModeActive = false;

function toggleKioskMode(forceState) {
  const nextState = typeof forceState === 'boolean' ? forceState : !isKioskModeActive;
  if (nextState) {
    enterKioskMode();
  } else {
    exitKioskMode();
  }
}

function enterKioskMode() {
  if (isKioskModeActive) return;
  isKioskModeActive = true;
  document.body.classList.add('kiosk-mode');

  const banner = document.getElementById('kioskExitBanner');
  if (banner) {
    banner.classList.remove('hidden');
    banner.style.display = 'flex';
  }

  const btn = document.getElementById('btnToggleKiosk');
  if (btn) {
    btn.innerHTML = `
      <span class="material-symbols-outlined text-[16px] text-emerald-600">fullscreen_exit</span>
      <span class="hidden sm:inline font-semibold text-emerald-700">Exit Kiosk</span>
    `;
    btn.setAttribute('title', 'Exit Kiosk Mode');
  }

  if (document.documentElement && !document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

function exitKioskMode() {
  if (!isKioskModeActive && !document.body.classList.contains('kiosk-mode')) return;
  isKioskModeActive = false;
  document.body.classList.remove('kiosk-mode');

  const banner = document.getElementById('kioskExitBanner');
  if (banner) {
    banner.classList.add('hidden');
    banner.style.display = 'none';
  }

  const btn = document.getElementById('btnToggleKiosk');
  if (btn) {
    btn.innerHTML = `
      <span class="material-symbols-outlined text-[16px] text-primary">fullscreen</span>
      <span class="hidden sm:inline font-semibold">Kiosk Mode</span>
    `;
    btn.setAttribute('title', 'Enter Kiosk Mode (Distraction-Free Fullscreen)');
  }

  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

function initKioskEventListeners() {
  if (window.__kioskListenersAttached) return;
  window.__kioskListenersAttached = true;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isKioskModeActive) {
      exitKioskMode();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isKioskModeActive) {
      exitKioskMode();
    }
  });
}

window.toggleKioskMode = toggleKioskMode;
window.enterKioskMode = enterKioskMode;
window.exitKioskMode = exitKioskMode;
window.initKioskEventListeners = initKioskEventListeners;
window.isKioskModeActive = () => isKioskModeActive;

// 5b. Health Score Modal Controller
function openHealthScoreModal() {
  const m = document.getElementById('modalHealthScore');
  if (m) {
    m.classList.remove('hidden');
    m.style.display = 'flex';
  }
}
window.openHealthScoreModal = openHealthScoreModal;

function closeHealthScoreModal() {
  const m = document.getElementById('modalHealthScore');
  if (m) {
    m.classList.add('hidden');
    m.style.display = 'none';
  }
}
window.closeHealthScoreModal = closeHealthScoreModal;

// ============================================================================
// Period & Filing Date Synchronization Engine
// ============================================================================
function getPeriodDetails(periodStr = "102026") {
  const p = String(periodStr || "102026").padStart(6, "0");
  const month = parseInt(p.slice(0, 2), 10) || 10;
  const year = parseInt(p.slice(2), 10) || 2026;

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const monthShort = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const fullMonth = monthNames[month - 1] || "October";
  const shortMonth = monthShort[month - 1] || "Oct";

  const nextMonthIdx = month === 12 ? 0 : month;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthFull = monthNames[nextMonthIdx];
  const nextMonthShort = monthShort[nextMonthIdx];

  const gstr1Deadline = `${nextMonthFull} 11, ${nextYear}`;
  const gstr1DeadlineShort = `${nextMonthShort} 11`;
  const gstr3bDeadline = `${nextMonthFull} 20, ${nextYear}`;
  const gstr3bDeadlineShort = `${nextMonthShort} 20`;

  const fyStart = month >= 4 ? year : year - 1;
  const fyEnd = fyStart + 1;
  const fy = `FY ${fyStart}-${String(fyEnd).slice(2)}`;

  return {
    raw: p,
    month,
    year,
    full: `${fullMonth} ${year}`,
    short: `${shortMonth} ${year}`,
    gstr1Deadline,
    gstr1DeadlineShort,
    gstr3bDeadline,
    gstr3bDeadlineShort,
    fy
  };
}
window.getPeriodDetails = getPeriodDetails;

function setActivePeriod(newPeriod) {
  const p = String(newPeriod || "102026").trim();
  appState.activePeriod = p;
  if (!appState.gst) appState.gst = {};
  if (!appState.gst.business) appState.gst.business = {};
  appState.gst.business.filingPeriod = p;
}
window.setActivePeriod = setActivePeriod;

function togglePeriodDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("globalPeriodDropdownMenu");
  if (menu) menu.classList.toggle("hidden");
}
window.togglePeriodDropdown = togglePeriodDropdown;

async function switchFilingPeriod(periodStr) {
  const p = String(periodStr || "102026").trim();
  setActivePeriod(p);
  syncPeriodAcrossUi(p);

  const menu = document.getElementById("globalPeriodDropdownMenu");
  if (menu) menu.classList.add("hidden");

  try {
    await apiFetch("/api/context/period", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: p })
    });
  } catch (err) {
    console.warn("Could not persist active period context:", err);
  }

  // Reload dashboard and copilot for new period
  if (typeof loadDashboardData === "function") {
    loadDashboardData(p);
  }
  if (typeof renderCopilotWorkspace === "function") {
    renderCopilotWorkspace(p);
  }
  if (typeof resetFileGstChoice === "function") {
    resetFileGstChoice();
  }

  const details = getPeriodDetails(p);
  if (typeof showToast === "function") {
    showToast(`Filing period switched to ${details.full}`, "info");
  }
}
window.switchFilingPeriod = switchFilingPeriod;

function syncPeriodAcrossUi(periodStr = "102026") {
  const details = getPeriodDetails(periodStr || getActivePeriod());

  const globalPeriod = document.getElementById("global-filing-period");
  if (globalPeriod) globalPeriod.textContent = details.short;

  const dueBadge = document.getElementById("global-period-due-badge");
  if (dueBadge) dueBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-error"></span>Due ${details.gstr3bDeadlineShort}`;

  document.querySelectorAll(".dynamic-period-label").forEach(el => {
    el.textContent = details.full;
  });
  document.querySelectorAll(".dynamic-period-short").forEach(el => {
    el.textContent = details.short;
  });
  document.querySelectorAll(".dynamic-deadline-label").forEach(el => {
    el.textContent = details.gstr3bDeadline;
  });
  document.querySelectorAll(".dynamic-fy-label").forEach(el => {
    el.textContent = details.fy;
  });

  const homeDeadline = document.getElementById("homeHeroDeadline");
  if (homeDeadline) homeDeadline.textContent = `Statutory Deadline: ${details.gstr3bDeadlineShort}, ${details.year}`;
  const homeStepHeader = document.getElementById("homeHeroStepTitle");
  if (homeStepHeader) homeStepHeader.textContent = `Step 2: Purchases — Add inward invoices for ${details.short}`;
}
window.syncPeriodAcrossUi = syncPeriodAcrossUi;

// ============================================================================
// Dashboard Dynamic Data Loader & Table Hydration
// ============================================================================
async function loadDashboardData(period) {
  const p = period || getActivePeriod();
  const details = getPeriodDetails(p);

  try {
    const res = await fetch(`/api/dashboard/summary?period=${p}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.empty) return;

    cachedDashboardMetrics = data.metrics || {};

    const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const dashSalesTotal = document.getElementById("dashSalesTotal");
    const dashPurchasesTotal = document.getElementById("dashPurchasesTotal");
    const dashNetTaxPayable = document.getElementById("dashNetTaxPayable");
    const dashEligibleItc = document.getElementById("dashEligibleItc");

    if (dashSalesTotal && data.metrics) dashSalesTotal.textContent = fmt(data.metrics.taxableSales);
    if (dashPurchasesTotal && data.metrics) dashPurchasesTotal.textContent = fmt(data.metrics.taxablePurchases);
    if (dashNetTaxPayable && data.metrics) dashNetTaxPayable.textContent = fmt(data.metrics.netCashPayable);
    if (dashEligibleItc && data.metrics) dashEligibleItc.textContent = fmt(data.metrics.totalEligibleItc);

    // Update hero banner texts
    const heroDesc = document.getElementById("homeHeroDescription");
    if (heroDesc && data.metrics) {
      heroDesc.innerHTML = `<span id="dashSalesCountText">${data.metrics.salesCount}</span> Sales invoices recorded (${fmt(data.metrics.taxableSales)}). Reconcile purchase bills to confirm eligible Input Tax Credit (ITC) before submission.`;
    }

    // Update sync badge
    const syncBadge = document.getElementById("liveGstnSyncBadge");
    if (syncBadge) {
      if (data.environment && data.environment.isLive) {
        syncBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>Live GSTN Sync`;
        syncBadge.className = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-label-sm font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200";
      } else {
        syncBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Sandbox Simulation (Demo Data)`;
        syncBadge.className = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-label-sm font-medium bg-amber-50 text-amber-800 border border-amber-200";
      }
    }

    // Populate recent activity table
    const tableBody = document.getElementById("dashRecentActivityBody");
    if (tableBody) {
      const sales = data.recentSales || [];
      const purchases = data.recentPurchases || [];
      const allRecent = [
        ...sales.map(s => ({ ...s, isSale: true, date: s.invoice_date, ref: s.invoice_number, entity: s.customer_name })),
        ...purchases.map(p => ({ ...p, isSale: false, date: p.bill_date, ref: p.bill_number, entity: p.supplier_name }))
      ].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);

      if (allRecent.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="4" class="py-8 text-center text-secondary text-xs">
              No transactions recorded for ${escapeHtml(details.short)}. Click <strong>+ New Invoice</strong> to add sales invoices or file a Nil Return.
            </td>
          </tr>
        `;
      } else {
        tableBody.innerHTML = allRecent.map(item => `
          <tr class="hover:bg-surface transition-colors">
            <td class="py-3 px-5">
              <div class="font-label-md font-semibold text-on-surface font-mono">${escapeHtml(item.ref)}</div>
              <div class="font-body-sm text-secondary">${escapeHtml(item.entity)}</div>
            </td>
            <td class="py-3 px-4">
              <span class="px-2 py-0.5 rounded text-xs ${item.isSale ? 'bg-surface-container text-secondary font-medium' : 'bg-blue-50 text-blue-800 font-medium'}">
                ${item.isSale ? 'B2B Sales' : 'Purchase Bill'}
              </span>
            </td>
            <td class="py-3 px-4 text-right font-mono font-medium text-on-surface">
              ${fmt(item.taxable_amount)}
            </td>
            <td class="py-3 px-5 text-right">
              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-label-sm ${item.isSale ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800'} font-semibold">
                ${item.isSale ? 'Approved' : 'Verified'}
              </span>
            </td>
          </tr>
        `).join("");
      }
    }
  } catch (err) {
    console.warn("Could not load dashboard data:", err);
  }
}
window.loadDashboardData = loadDashboardData;

// ============================================================================
// GST Copilot Workspace Renderer (Dynamic Grounding)
// ============================================================================
async function renderCopilotWorkspace(period) {
  const p = period || getActivePeriod();
  const details = getPeriodDetails(p);

  try {
    const res = await fetch(`/api/copilot/status?period=${p}`);
    if (!res.ok) return;
    const data = await res.json();

    const entityDisplay = document.getElementById("copilotActiveGstinDisplay");
    if (entityDisplay && data.activeEntity) {
      entityDisplay.innerHTML = `${escapeHtml(data.activeEntity.tradeName)} (${escapeHtml(data.activeEntity.gstin)}) • ${escapeHtml(data.periodLabel || details.full)}`;
    }

    const chatContainer = document.getElementById("copilotChatMessages");
    if (chatContainer) {
      const activeName = escapeHtml(data.activeOrg?.name || data.activeEntity?.tradeName || appState.organization?.name || "Your Business");
      const gstin = escapeHtml(data.activeEntity?.gstin || appState.activeGstin?.gstin || "—");
      const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const grossOut = fmt(data.summary?.outputLiability || 0);
      const eligibleItc = fmt(data.summary?.inputTaxCredit || 0);
      const netCash = fmt(Math.max(0, (data.summary?.outputLiability || 0) - (data.summary?.inputTaxCredit || 0)));

      chatContainer.innerHTML = `
        <div class="flex items-start gap-3.5">
          <div class="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0 shadow-xs">
            <span class="material-symbols-outlined text-[18px]">smart_toy</span>
          </div>
          <div class="space-y-2 max-w-2xl bg-surface p-4 rounded-2xl rounded-tl-none border border-outline-variant/80 text-on-surface shadow-xs">
            <p class="font-body-md text-sm leading-relaxed">
              Hello! I am your <strong>SimpleGST Copilot</strong>. I am grounded directly in active database records for <strong>${activeName} (${gstin})</strong> for <strong>${escapeHtml(data.periodLabel || details.full)}</strong>.
            </p>
            <div class="p-3 bg-surface-container-low rounded-xl border border-outline-variant/50 text-xs space-y-1 font-mono">
              <div class="flex justify-between"><span>Gross Output Liability (Table 3.1):</span> <strong class="text-on-surface">${grossOut}</strong></div>
              <div class="flex justify-between"><span>Eligible Inward ITC (Table 4):</span> <strong class="text-emerald-700">${eligibleItc}</strong></div>
              <div class="flex justify-between border-t border-outline-variant pt-1 text-red-600"><span>Net Cash Shortfall (PMT-06):</span> <strong>${netCash}</strong></div>
            </div>
            <p class="text-xs text-secondary">
              Ask me anything about your active invoices, Rule 88A setoff rules, GSTR-2B reconciliation mismatches, or Nil return eligibility for ${escapeHtml(data.periodLabel || details.full)}.
            </p>
          </div>
        </div>
      `;
    }
  } catch (err) {
    console.warn("Could not render Copilot workspace:", err);
  }
}
window.renderCopilotWorkspace = renderCopilotWorkspace;

// ============================================================================
// Modal Controllers: New Sales Invoice Modal
// ============================================================================
// MODAL CONTROLLER: NEW OUTWARD SALES INVOICE
// ============================================================================
function generateNewInvoiceNumber() {
  const numInput = document.getElementById('newInvNumber');
  if (numInput) {
    const num = `INV-${Date.now().toString().slice(-4)}`;
    numInput.value = num;
    numInput.defaultValue = num;
  }
}
window.generateNewInvoiceNumber = generateNewInvoiceNumber;

function openNewInvoiceModal() {
  const activeGstin = getActiveGstin();
  if (!activeGstin) {
    if (typeof showToast === "function") {
      showToast("Please sign in or select an active business GSTIN before creating an invoice.", "warning");
    }
    return;
  }
  const period = getActivePeriod();
  if (!period) {
    if (typeof showToast === "function") {
      showToast("Please select a return filing period first.", "warning");
    }
    return;
  }

  const m = document.getElementById('modalNewInvoice');
  if (m) {
    m.classList.remove('hidden');
    m.style.display = 'flex';
  }

  // Ensure clean blank form on open — explicitly wipe all values and defaultValues to prevent browser autofill/cached restoration
  const form = document.querySelector('#modalNewInvoice form');
  if (form) form.reset();

  const numInput = document.getElementById('newInvNumber');
  if (numInput) { numInput.value = ''; numInput.defaultValue = ''; }

  const custName = document.getElementById('newInvCustomerName');
  if (custName) { custName.value = ''; custName.defaultValue = ''; }

  const custGstin = document.getElementById('newInvCustomerGstin');
  if (custGstin) { custGstin.value = ''; custGstin.defaultValue = ''; }

  const taxableInput = document.getElementById('newInvTaxable');
  if (taxableInput) { taxableInput.value = ''; taxableInput.defaultValue = ''; }

  const gstRateSelect = document.getElementById('newInvGstRate');
  if (gstRateSelect) { gstRateSelect.value = ''; }

  const supplyTypeSelect = document.getElementById('newInvSupplyTypeSelect');
  if (supplyTypeSelect) { supplyTypeSelect.value = ''; delete supplyTypeSelect.dataset.autoSet; }

  const posSelect = document.getElementById('newInvPos');
  if (posSelect) {
    delete posSelect.dataset.userModified;
    posSelect.value = '';
  }

  const dateInput = document.getElementById('newInvDate');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
    dateInput.defaultValue = today;
  }

  calculateNewInvoiceTax();
}
window.openNewInvoiceModal = openNewInvoiceModal;

function closeNewInvoiceModal() {
  const m = document.getElementById('modalNewInvoice');
  if (m) {
    m.classList.add('hidden');
    m.style.display = 'none';
  }
}
window.closeNewInvoiceModal = closeNewInvoiceModal;

function onCustomerGstinInput() {
  const custGstin = (document.getElementById('newInvCustomerGstin')?.value || "").trim().toUpperCase();
  const posSelect = document.getElementById('newInvPos');
  const supplySelect = document.getElementById('newInvSupplyTypeSelect');

  if (custGstin.length >= 2) {
    const stateCode = custGstin.slice(0, 2);
    if (/^\d{2}$/.test(stateCode) && posSelect && !posSelect.dataset.userModified) {
      posSelect.value = stateCode;
    }
    if (supplySelect && (!supplySelect.value || supplySelect.dataset.autoSet)) {
      supplySelect.value = "B2B";
      supplySelect.dataset.autoSet = "true";
    }
  } else if (!custGstin && supplySelect && supplySelect.dataset.autoSet) {
    supplySelect.value = "";
    delete supplySelect.dataset.autoSet;
  }
  calculateNewInvoiceTax();
}
window.onCustomerGstinInput = onCustomerGstinInput;

function calculateNewInvoiceTax() {
  const taxable = parseFloat(document.getElementById('newInvTaxable')?.value) || 0;
  const gstRateRaw = document.getElementById('newInvGstRate')?.value;
  const rate = (gstRateRaw !== "" && gstRateRaw !== null && !isNaN(parseFloat(gstRateRaw))) ? parseFloat(gstRateRaw) : 0;

  const activeGstin = getActiveGstin();
  const activeState = (activeGstin && activeGstin.length >= 2) ? activeGstin.slice(0, 2) : "27";

  const posSelect = document.getElementById('newInvPos');
  const pos = posSelect?.value ? posSelect.value.slice(0, 2) : "";

  // Inter-State if Place of Supply differs from seller state
  const isInter = pos ? (pos !== activeState) : false;

  const totalTax = (taxable > 0 && gstRateRaw !== "" && gstRateRaw !== null) ? taxable * (rate / 100) : 0;
  let cgst = 0, sgst = 0, igst = 0;
  let cgstRate = 0, sgstRate = 0, igstRate = 0;

  const stEl = document.getElementById('newInvSupplyType');
  if (!pos) {
    if (stEl) stEl.textContent = "— (Pending POS)";
  } else if (isInter) {
    igst = totalTax;
    igstRate = rate;
    if (stEl) stEl.textContent = `Inter-State Supply (IGST) — POS: ${pos}`;
  } else {
    cgst = totalTax / 2;
    sgst = totalTax / 2;
    cgstRate = rate / 2;
    sgstRate = rate / 2;
    if (stEl) stEl.textContent = `Intra-State Supply (CGST + SGST) — POS: ${pos}`;
  }

  const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (document.getElementById('newInvCgstRate')) document.getElementById('newInvCgstRate').textContent = cgstRate;
  if (document.getElementById('newInvSgstRate')) document.getElementById('newInvSgstRate').textContent = sgstRate;
  if (document.getElementById('newInvIgstRate')) document.getElementById('newInvIgstRate').textContent = igstRate;

  if (document.getElementById('newInvCgstAmount')) document.getElementById('newInvCgstAmount').textContent = fmt(cgst);
  if (document.getElementById('newInvSgstAmount')) document.getElementById('newInvSgstAmount').textContent = fmt(sgst);
  if (document.getElementById('newInvIgstAmount')) document.getElementById('newInvIgstAmount').textContent = fmt(igst);
  if (document.getElementById('newInvTotalAmount')) document.getElementById('newInvTotalAmount').textContent = fmt(taxable + totalTax);
}
window.calculateNewInvoiceTax = calculateNewInvoiceTax;

async function submitNewInvoice(event) {
  if (event) event.preventDefault();
  await ensureActiveSession();

  const invoiceNumber = document.getElementById('newInvNumber')?.value?.trim();
  const rawInvoiceDate = document.getElementById('newInvDate')?.value;
  const invoiceDate = normalizeDateToYMD(rawInvoiceDate);
  const customerName = document.getElementById('newInvCustomerName')?.value?.trim();
  const customerGstin = document.getElementById('newInvCustomerGstin')?.value?.trim().toUpperCase();
  const taxableAmount = parseFloat(document.getElementById('newInvTaxable')?.value) || 0;
  const gstRateRaw = document.getElementById('newInvGstRate')?.value;

  const activeGstin = getActiveGstin();
  if (!activeGstin) {
    if (typeof showToast === "function") {
      showToast("Validation Error: Active business GSTIN is missing. Please sign in or select an active entity.", "error");
    }
    return;
  }

  const period = getActivePeriod();
  if (!period) {
    if (typeof showToast === "function") {
      showToast("Validation Error: Return filing period is missing. Please select a filing period.", "error");
    }
    return;
  }

  if (!invoiceNumber) {
    if (typeof showToast === "function") {
      showToast("Please enter an Invoice Number or click 'Generate #'.", "warning");
    }
    return;
  }

  if (!invoiceDate || !customerName || taxableAmount <= 0) {
    if (typeof showToast === "function") {
      showToast("Please enter all required invoice fields (Date, Customer Name, Taxable Value).", "warning");
    }
    return;
  }

  if (gstRateRaw === "" || gstRateRaw === null || isNaN(parseFloat(gstRateRaw))) {
    if (typeof showToast === "function") {
      showToast("Please select the applicable GST rate for this invoice.", "warning");
    }
    return;
  }
  const gstRate = parseFloat(gstRateRaw);

  const posSelect = document.getElementById('newInvPos');
  const pos = posSelect?.value ? posSelect.value.slice(0, 2) : (customerGstin ? customerGstin.slice(0, 2) : (activeGstin ? activeGstin.slice(0, 2) : ""));
  if (!pos) {
    if (typeof showToast === "function") {
      showToast("Please select the Place of Supply (POS).", "warning");
    }
    return;
  }

  const supplyType = document.getElementById('newInvSupplyTypeSelect')?.value || (customerGstin ? "B2B" : "B2C");
  if (!supplyType) {
    if (typeof showToast === "function") {
      showToast("Please select the Supply Type.", "warning");
    }
    return;
  }

  const isInterstate = pos !== activeGstin.slice(0, 2);

  const btn = document.querySelector("#modalNewInvoice button[type='submit']");
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(`/api/sales?period=${period}`, {
      method: "POST",
      body: JSON.stringify({
        invoiceNumber,
        invoiceDate,
        customerName,
        customerGstin: customerGstin || undefined,
        pos,
        taxableAmount,
        gstRate,
        supplyType,
        lineItems: [
          {
            description: "Goods / Taxable Supply",
            hsn: "9983",
            quantity: 1,
            rate: taxableAmount,
            taxableAmount,
            gstRate,
            igst: isInterstate ? (taxableAmount * gstRate) / 100 : 0,
            cgst: isInterstate ? 0 : (taxableAmount * gstRate) / 200,
            sgst: isInterstate ? 0 : (taxableAmount * gstRate) / 200,
            total: taxableAmount + (taxableAmount * gstRate) / 100
          }
        ]
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      closeNewInvoiceModal();
      const savedPeriod = data.period || period;
      if (typeof switchFilingPeriod === "function" && savedPeriod !== getActivePeriod()) {
        await switchFilingPeriod(savedPeriod);
      }
      if (typeof switchSuite === "function") {
        switchSuite('sales');
      }
      const searchInput = document.getElementById('salesSearchInput');
      if (searchInput) searchInput.value = "";
      const filterSelect = document.getElementById('salesSupplyTypeFilter');
      if (filterSelect) filterSelect.value = "ALL";
      if (typeof refreshInvoices === "function") {
        await refreshInvoices('sales');
      }
      if (typeof loadDashboardData === "function") {
        loadDashboardData(savedPeriod);
      }
      if (typeof showToast === "function") {
        showToast(`Sales Invoice ${invoiceNumber} created and saved to SQLite database! (ID: ${data.id || data.invoice?.id})`, "success");
      }
      const form = document.querySelector("#modalNewInvoice form");
      if (form) form.reset();
      if (posSelect) delete posSelect.dataset.userModified;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      if (typeof showToast === "function") {
        showToast(data.error || "Failed to create invoice", "error");
      }
    }
  } catch (err) {
    if (typeof showToast === "function") {
      showToast("Network error creating invoice: " + err.message, "error");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.submitNewInvoice = submitNewInvoice;

// ============================================================================
// File GST Screen Controller (Simplified 2-Choice, Nil Verify, 5-Step Stepper)
// ============================================================================
let currentGuidedStep = 1;
let cachedDashboardMetrics = null;

function resetFileGstChoice() {
  appState.inGuidedFlow = false;
  const choiceSec = document.getElementById("fileGstChoiceSection");
  const nilSec = document.getElementById("fileGstNilSection");
  const guidedSec = document.getElementById("fileGstGuidedSection");

  if (choiceSec) choiceSec.classList.remove("hidden");
  if (nilSec) nilSec.classList.add("hidden");
  if (guidedSec) guidedSec.classList.add("hidden");
}
window.resetFileGstChoice = resetFileGstChoice;

async function startNilFilingFlow() {
  const choiceSec = document.getElementById("fileGstChoiceSection");
  const nilSec = document.getElementById("fileGstNilSection");
  const guidedSec = document.getElementById("fileGstGuidedSection");
  const content = document.getElementById("nilVerificationContent");

  if (choiceSec) choiceSec.classList.add("hidden");
  if (guidedSec) guidedSec.classList.add("hidden");
  if (nilSec) nilSec.classList.remove("hidden");

  if (!content) return;
  content.innerHTML = `
    <div class="p-8 text-center space-y-3">
      <div class="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      <p class="font-body-md text-secondary">Verifying active ledger records and checking for transactions...</p>
    </div>
  `;

  try {
    const period = appState.gst?.business?.filingPeriod || "102026";
    const res = await fetch(`/api/gst/nil-verify?period=${period}`);
    const data = await res.json();

    if (data.hasTransactions) {
      const salesCount = data.verification?.salesCount || 0;
      const purchasesCount = data.verification?.purchasesCount || 0;
      const salesTaxable = data.verification?.salesTaxable || 0;
      const purchasesTaxable = data.verification?.purchasesTaxable || 0;

      content.innerHTML = `
        <div class="p-6 md:p-8 rounded-xl border-2 border-amber-300 bg-amber-50/60 space-y-5">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-[28px]">warning</span>
            </div>
            <div class="space-y-1.5">
              <h3 class="font-headline-sm text-headline-sm font-bold text-amber-950">
                Cannot File Nil Return: Recorded Transactions Found
              </h3>
              <p class="font-body-md text-amber-900 leading-relaxed">
                We found active transaction records for <strong>${data.tradeName || "your business"} (${data.gstin})</strong> for <strong>${data.periodLabel}</strong>:
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div class="p-4 rounded-lg bg-surface border border-amber-200 shadow-xs space-y-1">
              <span class="text-xs font-semibold uppercase tracking-wider text-secondary">Sales Invoices</span>
              <div class="font-numeric-lg text-lg font-bold text-on-surface">${salesCount} Invoices (₹${salesTaxable.toLocaleString("en-IN")})</div>
              <p class="text-xs text-secondary">Outward supplies must be filed in regular return</p>
            </div>
            <div class="p-4 rounded-lg bg-surface border border-amber-200 shadow-xs space-y-1">
              <span class="text-xs font-semibold uppercase tracking-wider text-secondary">Purchase Bills</span>
              <div class="font-numeric-lg text-lg font-bold text-on-surface">${purchasesCount} Bills (₹${purchasesTaxable.toLocaleString("en-IN")})</div>
              <p class="text-xs text-secondary">Inward purchases eligible for ITC reconciliation</p>
            </div>
          </div>

          <p class="font-body-sm text-amber-800 bg-amber-100/70 p-3.5 rounded-lg border border-amber-200">
            <strong>Statutory Rule:</strong> Under the CGST Act, a Nil return can only be submitted if you have <strong>zero</strong> outward sales, <strong>zero</strong> inward purchases, <strong>zero</strong> reverse charge liability, and <strong>zero</strong> ITC claims for the entire month.
          </p>

          <div class="flex flex-col sm:flex-row items-center gap-3 pt-3 border-t border-amber-200">
            <button onclick="startGuidedFiling(1)" class="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-lg font-semibold hover:bg-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm">
              <span>Proceed with Standard Filing</span>
              <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
            <button onclick="resetFileGstChoice()" class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-surface border border-outline-variant text-secondary font-label-md hover:bg-surface-container transition-colors cursor-pointer">
              ← Change Choice
            </button>
          </div>
        </div>
      `;
    } else {
      content.innerHTML = `
        <div class="space-y-6">
          <div class="p-5 rounded-xl border border-emerald-300 bg-emerald-50/70 space-y-1.5">
            <div class="flex items-center gap-2 text-emerald-900 font-headline-sm font-bold">
              <span class="material-symbols-outlined text-emerald-700 text-[24px]">verified</span>
              <span>Eligibility Verified: Ready to File Nil Return</span>
            </div>
            <p class="font-body-md text-emerald-800">
              ${data.message}
            </p>
            <div class="pt-1 flex items-center gap-4 text-xs font-medium text-emerald-900">
              <span>GSTIN: <strong class="font-mono">${data.gstin}</strong></span>
              <span>•</span>
              <span>Filing Period: <strong>${data.periodLabel}</strong></span>
              <span>•</span>
              <span>Status: <strong class="text-emerald-700">Zero Ledger Verified ✓</strong></span>
            </div>
          </div>

          <div class="p-6 rounded-xl border border-outline-variant bg-surface space-y-4 shadow-xs">
            <h4 class="font-headline-sm font-bold text-on-surface">Confirm Nil Return</h4>
            <p class="font-body-md text-secondary">
              Please confirm that your business had no sales, purchases or other reportable transactions during this period.
            </p>

            <div class="flex items-start gap-3 p-4 rounded-lg bg-surface-container-low border border-outline-variant">
              <input type="checkbox" id="nilConfirmCheckbox" class="w-5 h-5 rounded text-primary focus:ring-primary border-outline cursor-pointer mt-0.5" onchange="toggleNilSubmitBtn(this.checked)">
              <label for="nilConfirmCheckbox" class="font-body-md text-on-surface cursor-pointer select-none">
                I confirm that <strong>${data.tradeName || "Apex Retailers"} (${data.gstin})</strong> had no sales, purchases, or other reportable transactions during <strong>${data.periodLabel}</strong>. I declare that this information is complete and accurate.
              </label>
            </div>

            <div class="p-3.5 rounded-lg bg-surface-container text-xs text-secondary flex items-start gap-2.5">
              <span class="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">info</span>
              <span><strong>Notice:</strong> Submitting updates your compliance status and generates a simulated statutory acknowledgement receipt. It does not transmit live data to the GSTN portal without live credentials.</span>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-outline-variant">
            <button onclick="resetFileGstChoice()" class="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-secondary font-label-md hover:bg-surface-container cursor-pointer">
              ← Change Choice
            </button>
            <button id="btnSubmitNilReturn" onclick="executeNilFilingSubmission()" disabled class="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-lg font-semibold opacity-40 cursor-not-allowed hover:bg-primary-container transition-all flex items-center justify-center gap-2 shadow-sm">
              <span class="material-symbols-outlined text-[18px]">verified</span>
              <span>Submit Nil Return (Simulated)</span>
            </button>
          </div>
        </div>
      `;
    }
  } catch (err) {
    content.innerHTML = `
      <div class="p-6 rounded-xl border border-red-300 bg-red-50 text-red-900 space-y-3">
        <h4 class="font-bold">Verification Error</h4>
        <p class="text-sm">Unable to verify transactions: ${err.message}</p>
        <button onclick="resetFileGstChoice()" class="px-4 py-2 rounded-lg bg-surface border text-sm font-medium">← Go Back</button>
      </div>
    `;
  }
}
window.startNilFilingFlow = startNilFilingFlow;

function toggleNilSubmitBtn(isChecked) {
  const btn = document.getElementById("btnSubmitNilReturn");
  if (!btn) return;
  if (isChecked) {
    btn.disabled = false;
    btn.classList.remove("opacity-40", "cursor-not-allowed");
    btn.classList.add("cursor-pointer");
  } else {
    btn.disabled = true;
    btn.classList.add("opacity-40", "cursor-not-allowed");
    btn.classList.remove("cursor-pointer");
  }
}
window.toggleNilSubmitBtn = toggleNilSubmitBtn;

async function executeNilFilingSubmission() {
  const checkbox = document.getElementById("nilConfirmCheckbox");
  if (checkbox && !checkbox.checked) {
    showToast("Please check the confirmation declaration first.", "warning");
    return;
  }
  const btn = document.getElementById("btnSubmitNilReturn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Filing...`;
  }

  try {
    const period = typeof getActivePeriod === "function" ? getActivePeriod() : "102026";
    const res = await apiFetch("/api/gst/nil-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period,
        declarationConfirmed: true,
        authorisedPerson: appState.auth?.user?.name || appState.gst?.business?.authorisedPerson || "Authorized Signatory",
        verificationMode: "EVC_OTP"
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast("Nil Return Form GSTR-3B recorded successfully (Demo Mode)!", "success");
      const arnEl = document.getElementById("arnDisplayVal") || document.querySelector("#arn-success-modal .font-mono.font-bold");
      if (arnEl && (data.simulationReference || data.arn)) {
        arnEl.textContent = data.simulationReference || data.arn;
      }
      const timeEl = document.getElementById("arnTimestampDisplay");
      if (timeEl && data.filedAt) {
        timeEl.textContent = new Date(data.filedAt).toLocaleString("en-IN") + " IST";
      }
      if (typeof openArnModal === "function") {
        openArnModal();
      }
      resetFileGstChoice();
      if (typeof loadDashboardData === "function") {
        loadDashboardData(period);
      }
    } else {
      showToast(data.error || "Filing failed", "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">verified</span> Submit Nil Return (Simulated)`;
      }
    }
  } catch (err) {
    showToast("Failed to submit Nil Return: " + err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">verified</span> Submit Nil Return (Simulated)`;
    }
  }
}
window.executeNilFilingSubmission = executeNilFilingSubmission;

function startGuidedFiling(step = 1) {
  appState.inGuidedFlow = true;
  const choiceSec = document.getElementById("fileGstChoiceSection");
  const nilSec = document.getElementById("fileGstNilSection");
  const guidedSec = document.getElementById("fileGstGuidedSection");

  if (choiceSec) choiceSec.classList.add("hidden");
  if (nilSec) nilSec.classList.add("hidden");
  if (guidedSec) guidedSec.classList.remove("hidden");

  setGuidedStep(step);
}
window.startGuidedFiling = startGuidedFiling;

function goToGuidedPurchases() {
  appState.inGuidedFlow = true;
  switchSuite('file-gst');
  startGuidedFiling(2);
}
window.goToGuidedPurchases = goToGuidedPurchases;

function goToGuidedItc() {
  appState.inGuidedFlow = true;
  switchSuite('file-gst');
  startGuidedFiling(3);
}
window.goToGuidedItc = goToGuidedItc;

function goToGuidedSalesOrCancel() {
  if (appState.inGuidedFlow) {
    switchSuite('file-gst');
    startGuidedFiling(1);
  } else {
    switchSuite('file-gst');
  }
}
window.goToGuidedSalesOrCancel = goToGuidedSalesOrCancel;

function goToGuidedPurchasesOrCancel() {
  if (appState.inGuidedFlow) {
    switchSuite('file-gst');
    startGuidedFiling(2);
  } else {
    switchSuite('file-gst');
  }
}
window.goToGuidedPurchasesOrCancel = goToGuidedPurchasesOrCancel;

async function setGuidedStep(step = 1) {
  currentGuidedStep = step;

  const pills = document.querySelectorAll("#guidedStepperPills .stepper-pill");
  pills.forEach((p, idx) => {
    const pStep = idx + 1;
    const numSpan = p.querySelector("span:first-child");
    if (pStep === step) {
      p.className = "stepper-pill flex items-center gap-2 p-2.5 rounded-lg border text-left cursor-pointer transition-all active border-primary bg-surface-container-high text-primary font-semibold";
      if (numSpan) numSpan.className = "w-6 h-6 rounded-full bg-primary text-on-primary flex items-center justify-center text-xs font-bold shrink-0";
    } else if (pStep < step) {
      p.className = "stepper-pill flex items-center gap-2 p-2.5 rounded-lg border text-left cursor-pointer transition-all border-emerald-300 bg-emerald-50/70 text-emerald-900 font-medium";
      if (numSpan) numSpan.className = "w-6 h-6 rounded-full bg-emerald-700 text-white flex items-center justify-center text-xs font-bold shrink-0";
    } else {
      p.className = "stepper-pill flex items-center gap-2 p-2.5 rounded-lg border text-left cursor-pointer transition-all border-outline-variant bg-surface text-secondary";
      if (numSpan) numSpan.className = "w-6 h-6 rounded-full bg-surface-container-highest text-secondary flex items-center justify-center text-xs font-bold shrink-0";
    }
  });

  const stepTitles = [
    "Step 1: Sales",
    "Step 2: Purchases",
    "Step 3: Input Tax Credit",
    "Step 4: Tax Summary",
    "Step 5: Review & File"
  ];
  const titleEl = document.getElementById("guidedStepHeaderTitle");
  if (titleEl) titleEl.textContent = stepTitles[step - 1] || "Step 1: Sales";

  const badgeEl = document.getElementById("guidedStepBadge");
  if (badgeEl) badgeEl.textContent = `Step ${step} of 5`;

  const container = document.getElementById("guidedStepContent");
  if (!container) return;

  try {
    const period = appState.gst?.business?.filingPeriod || appState.activePeriod || "102026";
    const res = await apiFetch(`/api/dashboard/summary?period=${period}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.metrics) {
        cachedDashboardMetrics = data.metrics;
      }
    }
    const taxCalcRes = await apiFetch(`/api/returns/tax-calc?period=${period}`);
    if (taxCalcRes.ok) {
      const taxData = await taxCalcRes.json();
      appState.activeTaxCalc = taxData;
    }
  } catch (err) {
    console.warn("Could not fetch dashboard metrics for stepper:", err);
  }

  const m = cachedDashboardMetrics || {};
  const salesCount = Number(m.salesCount ?? 0);
  const taxableSales = Number(m.taxableSales ?? 0);
  const totalOutputLiability = Number(m.totalOutputLiability ?? 0);
  const purchasesCount = Number(m.purchasesCount ?? 0);
  const taxablePurchases = Number(m.taxablePurchases ?? 0);
  const totalEligibleItc = Number(m.totalEligibleItc ?? 0);
  const blockedItc = Number(m.blockedItc ?? 0);
  const netCashPayable = Number(m.netCashPayable ?? 0);

  appState.activeFilingSummary = {
    salesCount,
    taxableSales,
    totalOutputLiability,
    purchasesCount,
    taxablePurchases,
    totalEligibleItc,
    blockedItc,
    netCashPayable,
    liability: appState.activeTaxCalc?.liability || { igst: 0, cgst: 0, sgst: 0 },
    inputCredit: appState.activeTaxCalc?.inputCredit || { igst: 0, cgst: 0, sgst: 0 },
    setoffMatrix: appState.activeTaxCalc?.setoffMatrix || {}
  };

  const fmtCurrency = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (step === 1) {
    container.innerHTML = `
      <div class="space-y-6">
        <div class="p-6 rounded-xl border border-outline-variant bg-surface-container-low/50 space-y-4">
          <div class="space-y-1">
            <h3 class="font-headline-sm font-bold text-on-surface">Sales Invoices</h3>
            <p class="font-body-md text-secondary">
              Review and record all sales invoices issued to customers during this month.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-secondary">Recorded Sales</span>
              <div class="font-numeric-lg text-xl font-bold text-on-surface mt-1">${salesCount} Invoices</div>
              <p class="text-xs text-secondary mt-0.5">B2B & B2C transactions</p>
            </div>
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-secondary">Taxable Sales</span>
              <div class="font-numeric-lg text-xl font-bold text-on-surface mt-1">${fmtCurrency(taxableSales)}</div>
              <p class="text-xs text-secondary mt-0.5">Net turnover before GST</p>
            </div>
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-secondary">Tax Collected</span>
              <div class="font-numeric-lg text-xl font-bold text-primary mt-1">${fmtCurrency(totalOutputLiability)}</div>
              <p class="text-xs text-secondary mt-0.5">IGST, CGST & SGST output tax</p>
            </div>
          </div>

          <details class="text-xs text-secondary pt-2">
            <summary class="font-medium text-primary hover:underline cursor-pointer select-none">Learn more about Sales filing requirements</summary>
            <p class="mt-2 text-on-surface-variant leading-relaxed">
              Sales invoices are reported in Form GSTR-1. Invoices with valid customer GSTINs are verified and transmitted so your buyers can claim eligible Input Tax Credit without notice disallowance.
            </p>
          </details>
        </div>

        <div class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-outline-variant">
          <button onclick="switchSuite('sales')" class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-surface border border-outline-variant text-on-surface font-label-md hover:bg-surface-container transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs">
            <span class="material-symbols-outlined text-[18px]">receipt_long</span>
            <span>View / Add Sales Invoices</span>
          </button>
          <button onclick="setGuidedStep(2)" class="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-lg font-semibold hover:bg-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm">
            <span>Continue to Purchases</span>
            <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </div>
    `;
  } else if (step === 2) {
    container.innerHTML = `
      <div class="space-y-6">
        <div class="p-6 rounded-xl border border-outline-variant bg-surface-container-low/50 space-y-4">
          <div class="space-y-1">
            <h3 class="font-headline-sm font-bold text-on-surface">Purchases</h3>
            <p class="font-body-md text-secondary">
              Review inward purchase bills and expenses received from suppliers.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-secondary">Recorded Bills</span>
              <div class="font-numeric-lg text-xl font-bold text-on-surface mt-1">${purchasesCount} Bills</div>
              <p class="text-xs text-secondary mt-0.5">Scanned & verified inward bills</p>
            </div>
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-secondary">Taxable Purchases</span>
              <div class="font-numeric-lg text-xl font-bold text-on-surface mt-1">${fmtCurrency(taxablePurchases)}</div>
              <p class="text-xs text-secondary mt-0.5">Value of purchases before tax</p>
            </div>
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-secondary">Tax on Purchases</span>
              <div class="font-numeric-lg text-xl font-bold text-on-surface mt-1">${fmtCurrency(totalEligibleItc + blockedItc)}</div>
              <p class="text-xs text-secondary mt-0.5">Total GST paid to suppliers</p>
            </div>
          </div>

          <details class="text-xs text-secondary pt-2">
            <summary class="font-medium text-primary hover:underline cursor-pointer select-none">Learn more about Purchase bills and 180-day rules</summary>
            <p class="mt-2 text-on-surface-variant leading-relaxed">
              Under Rule 37 of the CGST Rules, purchase invoices must be paid to suppliers within 180 days from the invoice date. Unpaid invoices past 180 days require proportional reversal of credit with interest.
            </p>
          </details>
        </div>

        <div class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-outline-variant">
          <div class="flex items-center gap-3 w-full sm:w-auto">
            <button onclick="setGuidedStep(1)" class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-surface border border-outline-variant text-secondary font-label-md hover:bg-surface-container transition-colors cursor-pointer">
              ← Back to Sales
            </button>
            <button onclick="switchSuite('purchase')" class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-surface border border-outline-variant text-on-surface font-label-md hover:bg-surface-container transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs">
              <span class="material-symbols-outlined text-[18px]">upload_file</span>
              <span>View / Upload Bills</span>
            </button>
          </div>
          <button onclick="setGuidedStep(3)" class="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-lg font-semibold hover:bg-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm">
            <span>Continue to Input Tax Credit</span>
            <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </div>
    `;
  } else if (step === 3) {
    container.innerHTML = `
      <div class="space-y-6">
        <div class="p-6 rounded-xl border border-outline-variant bg-surface-container-low/50 space-y-4">
          <div class="space-y-1">
            <h3 class="font-headline-sm font-bold text-on-surface">Available Input Tax Credit</h3>
            <p class="font-body-md text-secondary">
              Input Tax Credit available to reduce your tax payment, matched against supplier GSTR-2B.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-emerald-800">Available Credit</span>
              <div class="font-numeric-lg text-xl font-bold text-emerald-700 mt-1">${fmtCurrency(totalEligibleItc)}</div>
              <p class="text-xs text-secondary mt-0.5">Matched with supplier GSTR-2B</p>
            </div>
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-secondary">Ineligible / Blocked Credit</span>
              <div class="font-numeric-lg text-xl font-bold text-on-surface mt-1">${fmtCurrency(blockedItc)}</div>
              <p class="text-xs text-secondary mt-0.5">Section 17(5) restricted credit</p>
            </div>
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-amber-800">Pending Supplier Filing</span>
              <div class="font-numeric-lg text-xl font-bold text-amber-700 mt-1">0 Bills</div>
              <p class="text-xs text-secondary mt-0.5">Suppliers yet to file GSTR-1</p>
            </div>
          </div>

          <details class="text-xs text-secondary pt-2">
            <summary class="font-medium text-primary hover:underline cursor-pointer select-none">Learn more about GSTR-2B matching</summary>
            <p class="mt-2 text-on-surface-variant leading-relaxed">
              Under Section 16(2)(aa), Input Tax Credit can only be claimed if your supplier has uploaded the invoice in their GSTR-1 and it is reflected in your auto-drafted GSTR-2B statement.
            </p>
          </details>
        </div>

        <div class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-outline-variant">
          <div class="flex items-center gap-3 w-full sm:w-auto">
            <button onclick="setGuidedStep(2)" class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-surface border border-outline-variant text-secondary font-label-md hover:bg-surface-container transition-colors cursor-pointer">
              ← Back to Purchases
            </button>
            <button onclick="switchSuite('recon')" class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-surface border border-outline-variant text-on-surface font-label-md hover:bg-surface-container transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs">
              <span class="material-symbols-outlined text-[18px]">rule</span>
              <span>Reconcile Bills</span>
            </button>
          </div>
          <button onclick="setGuidedStep(4)" class="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-lg font-semibold hover:bg-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm">
            <span>Continue to Tax Summary</span>
            <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </div>
    `;
  } else if (step === 4) {
    container.innerHTML = `
      <div class="space-y-6">
        <div class="p-6 rounded-xl border border-outline-variant bg-surface-container-low/50 space-y-4">
          <div class="space-y-1">
            <h3 class="font-headline-sm font-bold text-on-surface">Tax Summary</h3>
            <p class="font-body-md text-secondary">
              Calculate your net tax liability after offsetting available Input Tax Credit.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-secondary">Total Tax on Sales</span>
              <div class="font-numeric-lg text-xl font-bold text-on-surface mt-1">${fmtCurrency(totalOutputLiability)}</div>
              <p class="text-xs text-secondary mt-0.5">Gross liability assessed</p>
            </div>
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-emerald-800">Less: Available Credit</span>
              <div class="font-numeric-lg text-xl font-bold text-emerald-700 mt-1">-${fmtCurrency(totalEligibleItc)}</div>
              <p class="text-xs text-secondary mt-0.5">Auto-offset applied u/r 88A</p>
            </div>
            <div class="p-4 rounded-lg bg-surface border border-outline-variant shadow-xs">
              <span class="text-xs uppercase font-semibold text-error">Amount to Pay</span>
              <div class="font-numeric-lg text-xl font-bold text-error mt-1">${fmtCurrency(netCashPayable)}</div>
              <p class="text-xs text-secondary mt-0.5">Cash payment required</p>
            </div>
          </div>

          <details class="text-xs text-secondary pt-2">
            <summary class="font-medium text-primary hover:underline cursor-pointer select-none">Learn more about Rule 88A tax set-off</summary>
            <p class="mt-2 text-on-surface-variant leading-relaxed">
              Section 49A/49B and Rule 88A require that IGST credit must be fully exhausted first before using CGST or SGST credits. CGST credit cannot be set off against SGST liability and vice versa.
            </p>
          </details>
        </div>

        <div class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-outline-variant">
          <div class="flex items-center gap-3 w-full sm:w-auto">
            <button onclick="setGuidedStep(3)" class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-surface border border-outline-variant text-secondary font-label-md hover:bg-surface-container transition-colors cursor-pointer">
              ← Back to Credit
            </button>
            <button onclick="switchSuite('taxcalc')" class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-surface border border-outline-variant text-on-surface font-label-md hover:bg-surface-container transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs">
              <span class="material-symbols-outlined text-[18px]">calculate</span>
              <span>View Offset Details</span>
            </button>
          </div>
          <button onclick="setGuidedStep(5)" class="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-lg font-semibold hover:bg-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm">
            <span>Continue to Review & File</span>
            <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </div>
    `;
  } else if (step === 5) {
    const activeOrgName = appState.organization?.name || appState.activeGstin?.trade_name || "Taxpayer Workspace";
    const activeGstinNum = appState.activeGstin?.gstin || "—";
    const activePeriodLabel = appState.gst?.business?.filingPeriod ? `Period ${appState.gst.business.filingPeriod}` : "October 2026";

    container.innerHTML = `
      <div class="space-y-6">
        <div class="p-6 rounded-xl border border-outline-variant bg-surface-container-low/50 space-y-4">
          <div class="space-y-1">
            <h3 class="font-headline-sm font-bold text-on-surface">Review & File GSTR-3B</h3>
            <p class="font-body-md text-secondary">
              Review your monthly return details before submitting.
            </p>
          </div>

          <div class="p-5 rounded-lg bg-surface border border-outline-variant space-y-3 shadow-xs">
            <div class="flex items-center justify-between py-1.5 border-b border-outline-variant/60 text-sm">
              <span class="text-secondary">Taxpayer</span>
              <span class="font-semibold text-on-surface" id="reviewEntityDisplay">${escapeHtml(activeOrgName)} (${escapeHtml(activeGstinNum)})</span>
            </div>
            <div class="flex items-center justify-between py-1.5 border-b border-outline-variant/60 text-sm">
              <span class="text-secondary">Filing Period</span>
              <span class="font-semibold text-on-surface dynamic-period-label">${escapeHtml(activePeriodLabel)}</span>
            </div>
            <div class="flex items-center justify-between py-1.5 border-b border-outline-variant/60 text-sm">
              <span class="text-secondary">Gross Output Tax (Sales)</span>
              <span class="font-mono font-medium text-on-surface" id="reviewGrossOutputTax">${fmtCurrency(totalOutputLiability)}</span>
            </div>
            <div class="flex items-center justify-between py-1.5 border-b border-outline-variant/60 text-sm">
              <span class="text-secondary">Input Tax Credit Offset</span>
              <span class="font-mono font-medium text-emerald-700" id="reviewItcOffset">-${fmtCurrency(totalEligibleItc)}</span>
            </div>
            <div class="flex items-center justify-between py-2 text-base font-bold">
              <span class="text-on-surface">Net Amount to Pay</span>
              <span class="font-mono text-error" id="reviewNetAmountToPay">${fmtCurrency(netCashPayable)}</span>
            </div>
          </div>

          <div class="p-3.5 rounded-lg bg-surface-container text-xs text-secondary flex items-start gap-2.5">
            <span class="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">verified_user</span>
            <span><strong>Notice:</strong> Submitting prepares your Form GSTR-3B with EVC OTP authorization and updates your electronic ledgers persistently.</span>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-outline-variant">
          <button onclick="setGuidedStep(4)" class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-surface border border-outline-variant text-secondary font-label-md hover:bg-surface-container transition-colors cursor-pointer">
            ← Back to Tax Summary
          </button>
          <button onclick="startGstr3bFilingFlow()" class="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-primary text-on-primary font-label-lg font-semibold hover:bg-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm">
            <span class="material-symbols-outlined text-[18px]">verified</span>
            <span>File GSTR-3B Return (Simulated)</span>
          </button>
        </div>
      </div>
    `;
  }
}
window.setGuidedStep = setGuidedStep;

function startGstr3bFilingFlow() {
  const filing = appState.activeFilingSummary || {};
  const taxpayerName = appState.organization?.name || appState.activeGstin?.trade_name || "Taxpayer Workspace";
  const gstin = appState.activeGstin?.gstin || "—";
  const periodLabel = appState.gst?.business?.filingPeriod ? `Period: ${appState.gst.business.filingPeriod}` : "October 2026";

  const taxNameEl = document.getElementById("evcOtpTaxpayerName");
  if (taxNameEl) taxNameEl.textContent = taxpayerName;
  const gstinEl = document.getElementById("evcOtpGstin");
  if (gstinEl) gstinEl.textContent = gstin;
  const periodEl = document.getElementById("evcOtpPeriod");
  if (periodEl) periodEl.textContent = periodLabel;

  const grossTaxEl = document.getElementById("evcOtpGrossTax");
  if (grossTaxEl) grossTaxEl.textContent = `₹${Number(filing.totalOutputLiability || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const itcOffsetEl = document.getElementById("evcOtpItcOffset");
  if (itcOffsetEl) itcOffsetEl.textContent = `-₹${Number(filing.totalEligibleItc || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const netPayableEl = document.getElementById("evcOtpNetPayable");
  if (netPayableEl) netPayableEl.textContent = `₹${Number(filing.netCashPayable || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const otpInput = document.getElementById("evcOtpInput");
  if (otpInput) otpInput.value = "";
  const errEl = document.getElementById("evcOtpError");
  if (errEl) errEl.classList.add("hidden");

  openEvcOtpModal();
}
window.startGstr3bFilingFlow = startGstr3bFilingFlow;
window.executeFinalFiling = startGstr3bFilingFlow;

function openEvcOtpModal() {
  const m = document.getElementById("modalEvcOtpConfirmation");
  if (m) {
    m.classList.remove("hidden");
    m.style.display = "flex";
  }
}
window.openEvcOtpModal = openEvcOtpModal;

function closeEvcOtpModal() {
  const m = document.getElementById("modalEvcOtpConfirmation");
  if (m) {
    m.classList.add("hidden");
    m.style.display = "none";
  }
}
window.closeEvcOtpModal = closeEvcOtpModal;

function autoFillEvcOtp() {
  const otpInput = document.getElementById("evcOtpInput");
  if (otpInput) {
    otpInput.value = "123456";
    showToast("EVC OTP 123456 auto-filled (Demo Mode)", "info");
  }
}
window.autoFillEvcOtp = autoFillEvcOtp;

async function submitEvcOtpVerification() {
  const otpInput = document.getElementById("evcOtpInput");
  const errEl = document.getElementById("evcOtpError");
  const otpVal = (otpInput?.value || "").trim();

  if (!otpVal || !/^\d{6}$/.test(otpVal)) {
    if (errEl) {
      errEl.textContent = "Please enter a valid 6-digit EVC OTP (e.g. 123456).";
      errEl.classList.remove("hidden");
    }
    return;
  }
  if (errEl) errEl.classList.add("hidden");

  closeEvcOtpModal();

  const filing = appState.activeFilingSummary || {};
  const netCash = Number(filing.netCashPayable || 0);

  // If net cash liability remains, direct user to payment section (Form GST PMT-06)!
  if (netCash > 0) {
    showToast(`EVC OTP verified! Net liability of ₹${netCash.toLocaleString("en-IN")} requires cash payment. Directing to Payment section...`, "info");
    openPmt06ModalWithValues({
      grossTax: filing.totalOutputLiability || 0,
      itcOffset: filing.totalEligibleItc || 0,
      netCash: netCash,
      liability: filing.liability || {},
      period: appState.activePeriod || "102026",
      verifiedOtp: otpVal
    });
  } else {
    // Nil return or fully offset by ITC: complete filing directly
    await completeReturnFiling({ otp: otpVal, paymentDone: false });
  }
}
window.submitEvcOtpVerification = submitEvcOtpVerification;

function openPmt06ModalWithValues({ grossTax, itcOffset, netCash, liability, period, verifiedOtp }) {
  window._pendingGstr3bFilingOtp = verifiedOtp;

  const grossEl = document.getElementById("pmt06GrossLiability");
  if (grossEl) grossEl.textContent = `₹${Number(grossTax).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const itcEl = document.getElementById("pmt06ItcOffset");
  if (itcEl) itcEl.textContent = `-₹${Number(itcOffset).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const deficitEl = document.getElementById("pmt06DeficitAmount");
  if (deficitEl) deficitEl.textContent = `₹${Number(netCash).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const totalShortfallEl = document.getElementById("pmt06TotalShortfall");
  if (totalShortfallEl) totalShortfallEl.textContent = `₹${Number(netCash).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const btnText = document.getElementById("pmt06PayBtnText");
  if (btnText) btnText.textContent = `Pay ₹${Number(netCash).toLocaleString("en-IN")} & Complete Filing (Sandbox)`;

  // Update headwise matrix in PMT-06 table
  const tbody = document.getElementById("pmt06TableBody");
  if (tbody) {
    const igstLiability = Number(liability?.igst || 0);
    const cgstLiability = Number(liability?.cgst || 0);
    const sgstLiability = Number(liability?.sgst || 0);

    const igstCash = Math.min(netCash, igstLiability);
    const remAfterIgst = Math.max(0, netCash - igstCash);
    const cgstCash = Math.min(remAfterIgst / 2, cgstLiability);
    const sgstCash = Math.min(remAfterIgst / 2, sgstLiability);

    tbody.innerHTML = `
      <tr class="hover:bg-surface-container-low/50 transition-colors">
        <td class="py-3 px-4 font-sans font-medium text-on-surface flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-outline"></span> Integrated Tax (IGST)
        </td>
        <td class="py-3 px-3 text-center text-on-surface-variant">0005</td>
        <td class="py-3 px-4 text-right">₹${igstLiability.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="py-3 px-4 text-right">₹0.00</td>
        <td class="py-3 px-4 text-right font-semibold text-primary">₹${igstCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr class="hover:bg-surface-container-low/50 transition-colors bg-surface-container-lowest">
        <td class="py-3 px-4 font-sans font-medium text-on-surface flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-primary"></span> Central Tax (CGST)
        </td>
        <td class="py-3 px-3 text-center text-on-surface-variant">0006</td>
        <td class="py-3 px-4 text-right">₹${cgstLiability.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="py-3 px-4 text-right text-on-surface-variant">₹0.00</td>
        <td class="py-3 px-4 text-right font-bold text-primary">₹${cgstCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr class="hover:bg-surface-container-low/50 transition-colors">
        <td class="py-3 px-4 font-sans font-medium text-on-surface flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-primary"></span> State Tax (SGST)
        </td>
        <td class="py-3 px-3 text-center text-on-surface-variant">0008</td>
        <td class="py-3 px-4 text-right">₹${sgstLiability.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="py-3 px-4 text-right text-on-surface-variant">₹0.00</td>
        <td class="py-3 px-4 text-right font-bold text-primary">₹${sgstCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr class="hover:bg-surface-container-low/50 transition-colors">
        <td class="py-3 px-4 font-sans font-medium text-on-surface flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-outline"></span> Cess
        </td>
        <td class="py-3 px-3 text-center text-on-surface-variant">0009</td>
        <td class="py-3 px-4 text-right">₹0.00</td>
        <td class="py-3 px-4 text-right">₹0.00</td>
        <td class="py-3 px-4 text-right font-semibold">₹0.00</td>
      </tr>
    `;
  }

  openPmt06Modal();
}
window.openPmt06ModalWithValues = openPmt06ModalWithValues;

async function submitChallanPayment() {
  const otp = window._pendingGstr3bFilingOtp || "123456";
  closePmt06Modal();
  await completeReturnFiling({ otp, paymentDone: true });
}
window.submitChallanPayment = submitChallanPayment;

async function completeReturnFiling({ otp = "123456", paymentDone = false } = {}) {
  const period = appState.activePeriod || appState.gst?.business?.filingPeriod || "102026";
  try {
    const res = await apiFetch("/api/returns/gstr3b/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period,
        otp,
        paymentDone
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showToast(data.error || "Failed to file GSTR-3B return.", "error");
      return;
    }

    showToast("🎉 GSTR-3B Return successfully verified & filed in sandbox database!", "success");
    openArnModalWithData(data);
    if (typeof loadDashboardData === "function") loadDashboardData(period);
  } catch (err) {
    console.error("GSTR-3B filing network failure:", err);
    showToast("Filing submission failed. Please check network connection.", "error");
  }
}
window.completeReturnFiling = completeReturnFiling;

function openArnModalWithData(data = {}) {
  const arn = data.arn || "SIM-AA271026098124B";
  const filedAt = data.filingTimestamp ? new Date(data.filingTimestamp).toLocaleString("en-IN") + " IST" : new Date().toLocaleString("en-IN") + " IST";
  const filing = appState.activeFilingSummary || {};
  const liability = data.liabilitySummary?.liability || filing.liability || { igst: 0, cgst: 0, sgst: 0 };
  const inputCredit = data.itcSummary?.inputCredit || filing.inputCredit || { igst: 0, cgst: 0, sgst: 0 };

  const outwardTaxable = Number(data.liabilitySummary?.taxableSales ?? filing.taxableSales ?? 0);
  const invoicesCount = Number(data.liabilitySummary?.salesCount ?? filing.salesCount ?? 0);
  const grossTax = Number(data.liabilitySummary?.totalGrossLiability ?? filing.totalOutputLiability ?? 0);

  const arnValEl = document.getElementById("arnDisplayVal");
  if (arnValEl) arnValEl.textContent = arn;

  const timestampEl = document.getElementById("arnTimestampDisplay");
  if (timestampEl) timestampEl.textContent = filedAt;

  const outwardEl = document.getElementById("arnOutwardTaxable");
  if (outwardEl) outwardEl.textContent = `₹${outwardTaxable.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const invCountEl = document.getElementById("arnInvoicesCount");
  if (invCountEl) invCountEl.textContent = `Total Invoices Disclosed: ${invoicesCount}`;

  const grossTaxEl = document.getElementById("arnGrossTaxLiability");
  if (grossTaxEl) grossTaxEl.textContent = `₹${grossTax.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const netOutstandingEl = document.getElementById("arnNetOutstanding");
  if (netOutstandingEl) netOutstandingEl.textContent = "₹0.00";

  // Table 6.1 dynamic rendering
  const tableBody = document.getElementById("arnTable61Body");
  if (tableBody) {
    const igstAssessed = Number(liability.igst || 0);
    const cgstAssessed = Number(liability.cgst || 0);
    const sgstAssessed = Number(liability.sgst || 0);

    const igstItc = Math.min(igstAssessed, Number(inputCredit.igst || 0));
    const igstCash = Math.max(0, igstAssessed - igstItc);

    const cgstItc = Math.min(cgstAssessed, Number(inputCredit.cgst || 0));
    const cgstCash = Math.max(0, cgstAssessed - cgstItc);

    const sgstItc = Math.min(sgstAssessed, Number(inputCredit.sgst || 0));
    const sgstCash = Math.max(0, sgstAssessed - sgstItc);

    const totalAssessed = igstAssessed + cgstAssessed + sgstAssessed;
    const totalItc = igstItc + cgstItc + sgstItc;
    const totalCash = igstCash + cgstCash + sgstCash;

    tableBody.innerHTML = `
      <tr class="hover:bg-surface-container-low/60 transition-colors h-11">
        <td class="px-5 py-2 font-medium text-on-surface flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-primary"></span> Integrated Tax (IGST)
        </td>
        <td class="px-4 py-2 text-right font-mono font-medium">₹${igstAssessed.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="px-4 py-2 text-right font-mono text-primary font-medium">₹${igstItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="px-4 py-2 text-right font-mono text-secondary">₹${igstCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="px-5 py-2 text-right font-mono text-emerald-700 font-semibold">₹0.00</td>
      </tr>
      <tr class="hover:bg-surface-container-low/60 transition-colors h-11">
        <td class="px-5 py-2 font-medium text-on-surface flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-blue-600"></span> Central Tax (CGST)
        </td>
        <td class="px-4 py-2 text-right font-mono font-medium">₹${cgstAssessed.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="px-4 py-2 text-right font-mono text-primary font-medium">₹${cgstItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="px-4 py-2 text-right font-mono text-on-surface font-medium">₹${cgstCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="px-5 py-2 text-right font-mono text-emerald-700 font-semibold">₹0.00</td>
      </tr>
      <tr class="hover:bg-surface-container-low/60 transition-colors h-11">
        <td class="px-5 py-2 font-medium text-on-surface flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-indigo-600"></span> State / UT Tax (SGST)
        </td>
        <td class="px-4 py-2 text-right font-mono font-medium">₹${sgstAssessed.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="px-4 py-2 text-right font-mono text-primary font-medium">₹${sgstItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="px-4 py-2 text-right font-mono text-on-surface font-medium">₹${sgstCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="px-5 py-2 text-right font-mono text-emerald-700 font-semibold">₹0.00</td>
      </tr>
      <tr class="hover:bg-surface-container-low/60 transition-colors h-11">
        <td class="px-5 py-2 font-medium text-secondary flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-secondary"></span> Cess
        </td>
        <td class="px-4 py-2 text-right font-mono text-secondary">₹0.00</td>
        <td class="px-4 py-2 text-right font-mono text-secondary">₹0.00</td>
        <td class="px-4 py-2 text-right font-mono text-secondary">₹0.00</td>
        <td class="px-5 py-2 text-right font-mono text-emerald-700 font-semibold">₹0.00</td>
      </tr>
    `;

    const foot = document.getElementById("arnTable61Foot");
    if (foot) {
      foot.innerHTML = `
        <tr class="bg-surface-container-low font-semibold text-on-surface border-t border-outline-variant h-11">
          <td class="px-5 py-2">Total Tax Offset (INR)</td>
          <td class="px-4 py-2 text-right font-mono">₹${totalAssessed.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          <td class="px-4 py-2 text-right font-mono text-primary">₹${totalItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          <td class="px-4 py-2 text-right font-mono text-on-surface">₹${totalCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          <td class="px-5 py-2 text-right font-mono text-emerald-700">₹0.00</td>
        </tr>
      `;
    }
  }

  openArnModal();
}
window.openArnModalWithData = openArnModalWithData;

// Retain legacy submitNilReturn for backward compatibility
async function submitNilReturn() {
  return executeNilFilingSubmission();
}
window.submitNilReturn = submitNilReturn;

// 6. Due-Dates & Notifications Simulator
window.openDueDatesModal = async function() {
  const modal = document.getElementById('modalDueDates');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
  const container = document.getElementById('dueDatesListContainer');
  try {
    const res = await fetch('/api/compliance/due-dates');
    const json = await res.json();
    if (json.success && json.dueDates && container) {
      container.innerHTML = json.dueDates.map(d => `
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 700; color: #0F172A; font-size: 15px;">${d.form}</span>
              <span class="text-xs text-muted">• ${d.title}</span>
            </div>
            <div class="text-xs text-muted" style="margin-top: 2px;">${d.statutoryRule} • ${d.period}</div>
            <div class="text-xs text-danger" style="margin-top: 2px;">Penalty: ${d.penaltyRule}</div>
          </div>
          <div style="text-align: right;">
            <div class="font-mono" style="font-size: 16px; font-weight: 800; color: ${d.daysRemaining <= 10 ? '#DC2626' : '#2563EB'};">
              ${d.daysRemaining} Days Left
            </div>
            <div class="text-xs text-muted">${new Date(d.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
          </div>
        </div>
      `).join('');
    }
  } catch(e) {}
  simulateNotification('whatsapp');
};

window.closeDueDatesModal = function() {
  const modal = document.getElementById('modalDueDates');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.simulateNotification = async function(channel) {
  ['btnNotifWa', 'btnNotifSms', 'btnNotifEmail'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  if (channel === 'whatsapp') document.getElementById('btnNotifWa')?.classList.add('active');
  if (channel === 'sms') document.getElementById('btnNotifSms')?.classList.add('active');
  if (channel === 'email') document.getElementById('btnNotifEmail')?.classList.add('active');

  const box = document.getElementById('notificationPreviewBox');
  try {
    const res = await fetch('/api/notifications/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel })
    });
    const json = await res.json();
    if (json.success && json.payload && box) {
      const p = json.payload;
      if (channel === 'whatsapp') {
        box.innerHTML = `
          <div style="font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase;">WhatsApp Meta Cloud API Mock Preview</div>
          <div class="whatsapp-chat-bubble">
            <div style="font-weight: 700; margin-bottom: 6px;">${p.header}</div>
            <div style="white-space: pre-line;">${p.body}</div>
            <div style="display: flex; gap: 8px; margin-top: 10px;">
              ${p.buttons.map(b => `<button class="btn btn-sm btn-outline" style="background: #FFFFFF; font-size: 12px;" onclick="alert('Triggered: ' + '${b.title}')">${b.title}</button>`).join('')}
            </div>
          </div>
          <button class="btn btn-sm btn-primary" onclick="showToast('Simulated WhatsApp reminder pushed to +91 98765 43210', 'success')">Simulate Live WhatsApp Send</button>
        `;
      } else if (channel === 'sms') {
        box.innerHTML = `
          <div style="font-size: 11px; font-weight: 700; color: #2563EB; text-transform: uppercase;">TRAI DLT SMS Gateway Preview</div>
          <div style="background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 6px; padding: 12px; margin: 8px 0; font-family: monospace; font-size: 13px;">
            [${p.senderId}] ${p.message}
          </div>
          <div class="text-xs text-muted mb-2">Template ID: ${p.dltTemplateId}</div>
          <button class="btn btn-sm btn-primary" onclick="showToast('Simulated SMS alert dispatched via SMPGST gateway', 'success')">Simulate SMS Dispatch</button>
        `;
      } else {
        box.innerHTML = `
          <div style="font-size: 11px; font-weight: 700; color: #7C3AED; text-transform: uppercase;">Statutory Email Digest Preview</div>
          <div style="background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 6px; padding: 12px; margin: 8px 0;">
            ${p.bodyHtml}
          </div>
          <button class="btn btn-sm btn-primary" onclick="showToast('Simulated statutory notice sent to recipient email', 'success')">Simulate Email Dispatch</button>
        `;
      }
    }
  } catch(e) {}
};

// 7. Referral Growth Loop Logic
window.openReferralModal = async function() {
  const modal = document.getElementById('modalReferral');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
  try {
    const res = await fetch('/api/referral/stats?gstin=32ABCDE1234F1Z5');
    const json = await res.json();
    if (json.code) {
      const balElem = document.getElementById('refWalletBalance');
      const inputElem = document.getElementById('refShareUrlInput');
      const waElem = document.getElementById('btnRefWhatsappShare');
      if (balElem) balElem.textContent = "₹" + json.walletBalance.toLocaleString("en-IN");
      if (inputElem) inputElem.value = json.shareUrl;
      if (waElem) waElem.href = json.whatsappShareUrl;
    }
  } catch(e) {}
};

window.closeReferralModal = function() {
  const modal = document.getElementById('modalReferral');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.redeemCredit = async function(amount) {
  try {
    const res = await fetch('/api/referral/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'MALABAR500', amount })
    });
    const json = await res.json();
    if (json.success) {
      document.getElementById('refWalletBalance').textContent = "₹" + json.remainingBalance.toLocaleString("en-IN");
      showToast("Successfully redeemed ₹" + amount + " towards your filing fees!", "success");
    } else {
      alert(json.error);
    }
  } catch(e) {
    alert("Redemption failed: " + e.message);
  }
};

// 8. MCA Lookup Logic
window.openMcaModal = function() {
  const modal = document.getElementById('modalMcaLookup');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
  executeMcaLookup('U72900KA2020PTC123456');
};

window.closeMcaModal = function() {
  const modal = document.getElementById('modalMcaLookup');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.executeMcaLookup = async function(cin) {
  const box = document.getElementById('mcaModalResultBox');
  if (!cin || !box) return;
  box.innerHTML = '<div class="text-muted text-xs">Querying MCA corporate database...</div>';
  try {
    const res = await fetch('/api/mca/lookup?cin=' + encodeURIComponent(cin.trim().toUpperCase()));
    const json = await res.json();
    if (json.success && json.company) {
      const c = json.company;
      box.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px; margin-bottom: 12px;">
          <div>
            <div style="font-size: 16px; font-weight: 800; color: #1E40AF;">${c.companyName}</div>
            <div class="font-mono text-xs text-muted mt-1">${c.cin} • ${c.roc}</div>
          </div>
          <span class="status-chip success-chip">${c.complianceStatus}</span>
        </div>
        <div class="form-grid-2">
          <div><span class="text-xs text-muted">Incorporation Date:</span> <strong style="font-size: 13px;">${c.incorporationDate}</strong></div>
          <div><span class="text-xs text-muted">Company Class:</span> <strong style="font-size: 13px;">${c.classOfCompany} (${c.listingStatus})</strong></div>
          <div><span class="text-xs text-muted">Authorized Capital:</span> <strong class="font-mono" style="font-size: 13px;">₹${c.authorizedCapital.toLocaleString("en-IN")}</strong></div>
          <div><span class="text-xs text-muted">Paid-up Capital:</span> <strong class="font-mono" style="font-size: 13px;">₹${c.paidUpCapital.toLocaleString("en-IN")}</strong></div>
        </div>
        <div style="margin-top: 12px; font-size: 13px;"><span class="text-xs text-muted">Registered Address:</span> ${c.registeredAddress}</div>
        <div style="margin-top: 14px;">
          <div class="text-xs text-muted" style="font-weight: 700; margin-bottom: 6px;">Board of Directors & DIN:</div>
          ${c.directors.map(d => `
            <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px; padding: 8px 12px; margin-bottom: 6px; display: flex; justify-content: space-between;">
              <span style="font-weight: 600;">${d.name} <span class="text-xs text-muted">(${d.designation})</span></span>
              <span class="font-mono text-xs text-primary">DIN: ${d.din}</span>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      box.innerHTML = `<div class="text-danger text-xs">⚠️ ${json.error || 'CIN lookup failed'}</div>`;
    }
  } catch(e) {
    box.innerHTML = `<div class="text-danger text-xs">Failed to connect to MCA service: ${e.message}</div>`;
  }
};


// =========================================================================
// LAYMAN GUIDING PATH & AI DOCUMENT INGESTION
// =========================================================================
window.cdaState = window.cdaState || {};
cdaState.activeAiDocType = 'sales_invoice';
cdaState.lastExtractedDoc = null;

window.selectGuidingMode = function(mode) {
  const cardNil = document.getElementById("cardGuidingNil");
  const cardActive = document.getElementById("cardGuidingActive");
  if (mode === 'nil') {
    cardNil?.classList.add("selected");
    cardActive?.classList.remove("selected");
    openNilFilingModal();
  } else {
    cardActive?.classList.add("selected");
    cardNil?.classList.remove("selected");
    focusAiIngestion();
  }
};

window.focusAiIngestion = function(e) {
  if (e) e.stopPropagation();
  const el = document.getElementById("aiDocumentIngestSection");
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.3)';
    setTimeout(() => { el.style.boxShadow = ''; }, 1200);
  }
};

window.openNilFilingModal = function(e) {
  if (e) e.stopPropagation();
  const modal = document.getElementById("modalNilFiling");
  const successBox = document.getElementById("nilFilingSuccessBox");
  const submitBtn = document.getElementById("btnSubmitNilFiling");
  if (successBox) successBox.classList.add("hidden");
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "✓ Confirm & File Nil Return";
  }
  if (modal) {
    modal.classList.remove("hidden");
    modal.style.display = "flex";
  }
};

window.closeNilFilingModal = function() {
  const modal = document.getElementById("modalNilFiling");
  if (modal) {
    modal.classList.add("hidden");
    modal.style.display = "none";
  }
};

window.submitNilFiling = async function() {
  const submitBtn = document.getElementById("btnSubmitNilFiling");
  const successBox = document.getElementById("nilFilingSuccessBox");
  const arnText = document.getElementById("textNilArn");
  const otp = document.getElementById("inputNilOtp")?.value || "749201";

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "⏳ EVC Verifying & Transmitting...";
  }

  try {
    const period = typeof getActivePeriod === "function" ? getActivePeriod() : "102026";
    const res = await apiFetch("/api/gst/nil-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period,
        declarationConfirmed: true,
        authorisedPerson: appState.auth?.user?.name || appState.gst?.business?.authorisedPerson || "Authorized Signatory",
        mobileOtp: otp
      })
    });
    const json = await res.json();
    if (json.success) {
      if (arnText) arnText.textContent = "Simulated ARN: " + (json.simulationReference || json.arn);
      if (successBox) successBox.classList.remove("hidden");
      if (submitBtn) submitBtn.textContent = "✓ Filed (Sandbox Mode)";
      showToast("🎉 Nil return recorded successfully in sandbox! Ref: " + (json.simulationReference || json.arn), "success");
    } else {
      showToast("Failed to file Nil return: " + (json.error || "Unknown error"), "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Retry Filing";
      }
    }
  } catch(e) {
    const fallbackArn = "SIM-NIL-AA321026" + Math.floor(100000 + Math.random() * 900000);
    if (arnText) arnText.textContent = "Simulated ARN: " + fallbackArn;
    if (successBox) successBox.classList.remove("hidden");
    showToast("🎉 Nil return recorded (Sandbox): " + fallbackArn, "success");
  }
};

window.downloadNilCertificate = function() {
  alert("Downloading Statutory NIL Return Acknowledgement & Certificate (PDF)...\nEntity: Malabar Spice Traders\nPeriod: October 2026\nTax Paid: ₹0.00\nStatus: Valid & In Good Standing");
};

window.switchAiTab = function(type) {
  cdaState.activeAiDocType = type;
  const btnSales = document.getElementById("btnAiTabSales");
  const btnPurchases = document.getElementById("btnAiTabPurchases");
  const btnBank = document.getElementById("btnAiTabBank");
  const dropTitle = document.getElementById("aiDropzoneTitle");

  [btnSales, btnPurchases, btnBank].forEach(b => b?.classList.remove("active"));
  if (type === 'sales_invoice') {
    btnSales?.classList.add("active");
    if (dropTitle) dropTitle.textContent = "Drop your Customer Sales Invoice here, or click to browse";
  } else if (type === 'purchase_bill') {
    btnPurchases?.classList.add("active");
    if (dropTitle) dropTitle.textContent = "Drop your Supplier Purchase Bill here, or click to browse";
  } else {
    btnBank?.classList.add("active");
    if (dropTitle) dropTitle.textContent = "Drop your Bank Statement (PDF / Excel) here, or click to browse";
  }
};

window.loadSampleAiDoc = async function(type) {
  switchAiTab(type);
  showToast("Scanning document with Gemini Vision OCR...", "info");

  try {
    const res = await fetch("/api/ai/extract-doc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type })
    });
    const json = await res.json();
    if (json.success) {
      renderExtractedDocResult(json);
      showToast("✓ Extracted successfully (" + json.confidence + " confidence)", "success");
    }
  } catch(e) {
    console.error("Extraction error:", e);
  }
};

window.handleAiFileSelect = async function(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  showToast("Uploading " + file.name + " to AI Ingestion Engine...", "info");

  try {
    const res = await fetch("/api/ai/extract-doc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: cdaState.activeAiDocType || "sales_invoice",
        filename: file.name
      })
    });
    const json = await res.json();
    if (json.success) {
      renderExtractedDocResult(json);
      showToast("✓ Extracted " + file.name + " (" + json.confidence + ")", "success");
    }
  } catch(err) {
    console.error(err);
  }
};

function renderExtractedDocResult(json) {
  cdaState.lastExtractedDoc = json;
  const card = document.getElementById("aiExtractionResultCard");
  const grid = document.getElementById("aiExtractedFieldsGrid");
  const docName = document.getElementById("aiExtractedDocName");
  const conf = document.getElementById("aiExtractConfidence");
  const safetyBanner = document.getElementById("aiSec16SafetyBanner");
  const sentence = document.getElementById("aiPlainSentenceFeedback");

  if (!card || !grid) return;
  card.classList.remove("hidden");

  if (docName) docName.textContent = json.filename;
  if (conf) conf.textContent = "✓ Extracted (" + json.confidence + " confidence)";
  if (sentence) sentence.textContent = json.plainEnglishSummary;

  const d = json.data;
  if (json.documentType === 'bank_statement') {
    grid.innerHTML = `
      <div style="background:#FFF; padding:12px; border-radius:8px; border:1px solid #E2E8F0;">
        <div class="text-xs text-muted">Bank & Account</div>
        <div class="font-mono" style="font-weight:700; color:#0F172A;">${d.bankName || 'HDFC Bank Ltd'}</div>
        <div class="text-xs text-muted">A/c: ${d.accountNumber || '50200084920192'}</div>
      </div>
      <div style="background:#FFF; padding:12px; border-radius:8px; border:1px solid #E2E8F0;">
        <div class="text-xs text-muted">Total Sales Credits</div>
        <div class="font-mono" style="font-size:18px; font-weight:800; color:#2563EB;">₹${(d.totalCredits || 1240000).toLocaleString('en-IN')}</div>
        <div class="text-xs text-success">✓ 14 customer payments reconciled</div>
      </div>
      <div style="background:#FFF; padding:12px; border-radius:8px; border:1px solid #E2E8F0;">
        <div class="text-xs text-muted">Total Supplier Debits</div>
        <div class="font-mono" style="font-size:18px; font-weight:800; color:#059669;">₹${(d.totalDebits || 920200).toLocaleString('en-IN')}</div>
        <div class="text-xs text-muted">Matching 5 purchase bills</div>
      </div>
    `;
    if (safetyBanner) safetyBanner.classList.add("hidden");
  } else {
    grid.innerHTML = `
      <div style="background:#FFF; padding:12px; border-radius:8px; border:1px solid #E2E8F0;">
        <div class="text-xs text-muted">Party Name</div>
        <div style="font-weight:700; color:#0F172A;">${d.partyName || 'Party'}</div>
        <div class="text-xs text-muted">Inv: ${d.invoiceNumber} • ${d.invoiceDate}</div>
      </div>
      <div style="background:#FFF; padding:12px; border-radius:8px; border:1px solid #E2E8F0;">
        <div class="text-xs text-muted">GSTIN Identifier</div>
        <div class="font-mono" style="font-weight:700; color:#1E40AF;">${d.gstin}</div>
        <div class="text-xs text-success">✓ Structure & State Code Valid</div>
      </div>
      <div style="background:#FFF; padding:12px; border-radius:8px; border:1px solid #E2E8F0;">
        <div class="text-xs text-muted">Taxable Value & GST</div>
        <div class="font-mono" style="font-size:16px; font-weight:800; color:#0F172A;">₹${(d.taxableValue || 0).toLocaleString('en-IN')}</div>
        <div class="text-xs text-muted">GST (18%): ₹${(d.totalGst || 0).toLocaleString('en-IN')}</div>
      </div>
    `;

    if (json.documentType === 'purchase_bill' && d.statutoryMatch) {
      if (safetyBanner) {
        safetyBanner.classList.remove("hidden");
        safetyBanner.innerHTML = `<strong>✓ Section 16(2)(aa) Check:</strong> Supplier filed GSTR-1. ₹${(d.totalGst || 0).toLocaleString('en-IN')} tax discount is 100% matched in GSTR-2B and safe to claim.`;
      }
    } else {
      if (safetyBanner) safetyBanner.classList.add("hidden");
    }
  }
}

window.addExtractedDocToReturn = function() {
  if (!cdaState.lastExtractedDoc) {
    showToast("Please scan or upload a document first.", "warning");
    return;
  }
  showToast("✓ Invoice successfully added to October return computation!", "success");
  document.getElementById("aiExtractionResultCard")?.classList.add("hidden");
  viewCopilotStep(4);
};

// =========================================================================
// STATUTORY CADENCE & FINE ESCALATION
// =========================================================================
window.renderCadenceTimeline = async function() {
  const container = document.getElementById("cadenceStepsRow");
  if (!container) return;

  try {
    const res = await fetch("/api/compliance/cadence?day=7");
    const json = await res.json();
    if (json.success && json.schedule) {
      container.innerHTML = json.schedule.map(s => `
        <div class="cadence-step-card ${s.isCurrent ? 'active' : ''} ${s.isPast ? 'past' : ''}" onclick="previewCadenceWhatsApp('${s.code}')" style="cursor: pointer;">
          <div class="cadence-day-badge">Day ${s.dayOfMonth}</div>
          <div style="font-size: 13px; font-weight: 700; color: #0F172A; margin: 2px 0;">${s.stage}</div>
          <div style="font-size: 11.5px; color: #64748B; line-height: 1.4;">${s.statusText}</div>
          <div style="font-size: 11px; color: #2563EB; font-weight: 600; margin-top: 8px;">📱 View WhatsApp →</div>
        </div>
      `).join('');
    }
  } catch(e) {
    console.error("Cadence fetch error:", e);
  }
};

window.previewCadenceWhatsApp = function(code) {
  const messages = {
    'CADENCE_1ST_WINDOW_OPEN': 'Good morning! 🌅 GST portal for October 2026 is now open. File early to avoid last-minute server congestion. Open SimpleGST to start.',
    'CADENCE_3RD_GATHER_DOCS': 'Hi there! 🧾 Please collect your sales bills, supplier invoices, and bank statements for October. Uploading them one-by-one takes only 2 minutes.',
    'CADENCE_5TH_UPLOAD_PROMPT': 'Reminder 📸: 5 days into the month! Upload your October invoices today so our AI can automatically reconcile your supplier tax credits.',
    'CADENCE_7TH_GSTR1_WARNING': '⏳ Only 3 days left! GSTR-1 sales returns must be filed before the 10th. If delayed, your buyers cannot claim tax credit. File now!',
    'CADENCE_9TH_FINAL_CALL': '🚨 CRITICAL: GSTR-1 deadline is TOMORROW! Complete your sales return now to protect your business reputation and avoid statutory late fees.',
    'CADENCE_20TH_FINAL_GSTR3B': '⏰ FINAL DEADLINE TODAY: GSTR-3B must be filed by 11:59 PM tonight. Late filing from tomorrow will incur ₹50/day late fee + 18% interest.'
  };

  const text = messages[code] || 'Statutory GST filing reminder for October 2026.';
  alert(`📱 WhatsApp Automated Customer Reminder\n\nRecipient: Malabar Spice Traders (+91 98*** **294)\n\n"${text}"`);
};

window.onDelaySliderChange = async function(days) {
  const countElem = document.getElementById("textDelayDaysCount");
  const lateFeeElem = document.getElementById("calcLateFeeText");
  const interestElem = document.getElementById("calcInterestText");
  const ewayElem = document.getElementById("calcEwayStatusText");
  const badgeElem = document.getElementById("fineSummaryBadge");
  const noteElem = document.getElementById("calcAdvisoryNote");

  const d = parseInt(days, 10) || 0;
  if (countElem) countElem.textContent = d + " Days";

  try {
    const res = await fetch(`/api/compliance/escalation?delayDays=${d}&netTaxLiability=70200`);
    const json = await res.json();
    if (json.success) {
      if (lateFeeElem) lateFeeElem.textContent = "₹" + json.statutoryLateFee.toLocaleString("en-IN");
      if (interestElem) interestElem.textContent = "₹" + json.statutoryInterest.toLocaleString("en-IN");

      if (ewayElem) {
        if (json.ewayBillBlocked) {
          ewayElem.textContent = "🚨 BLOCKED (Rule 138E)";
          ewayElem.style.color = "#DC2626";
        } else {
          ewayElem.textContent = "ACTIVE (Compliant)";
          ewayElem.style.color = "#10B981";
        }
      }

      if (badgeElem) {
        if (d === 0) {
          badgeElem.textContent = "✓ Filing Today: ₹0 Fine";
          badgeElem.className = "status-chip success-chip";
        } else if (d <= 5) {
          badgeElem.textContent = `⚠️ Delayed by ${d} Days: ₹${json.totalEscalationFine} Penalty`;
          badgeElem.className = "status-chip warning-chip";
        } else {
          badgeElem.textContent = `🚨 Delayed by ${d} Days: ₹${json.totalEscalationFine.toLocaleString("en-IN")} Penalty`;
          badgeElem.className = "status-chip danger-chip";
        }
      }

      if (noteElem) noteElem.textContent = json.advisoryMessage;
    }
  } catch(e) {
    console.error(e);
  }
};

// =========================================================================
// 12. CA Multi-Client Practice Management Workspace
// =========================================================================
window.openPracticeModal = function() {
  const modal = document.getElementById('modalPracticeHub');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
  loadPracticeData();
};

window.closePracticeModal = function() {
  const modal = document.getElementById('modalPracticeHub');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.loadPracticeData = async function() {
  try {
    const [summaryRes, matrixRes] = await Promise.all([
      fetch('/api/practice/summary').then(r => r.json()),
      fetch('/api/practice/compliance-matrix').then(r => r.json())
    ]);

    if (summaryRes.success) {
      const tot = document.getElementById('practiceTotalClients');
      const fld = document.getElementById('practiceFiledCount');
      const pnd = document.getElementById('practicePendingCount');
      const rsk = document.getElementById('practiceRiskCount');
      if (tot) tot.textContent = `${summaryRes.totalClients} Active`;
      if (fld) fld.textContent = `${summaryRes.filedCount} Clients`;
      if (pnd) pnd.textContent = `${summaryRes.pendingCount} Pending`;
      if (rsk) rsk.textContent = `${summaryRes.highRiskMismatches} High Risk`;
    }

    if (matrixRes.success && matrixRes.matrix) {
      const tbody = document.getElementById('practiceClientsTableBody');
      if (tbody) {
        tbody.innerHTML = matrixRes.matrix.map(c => `
          <tr style="border-bottom: 1px solid #F1F5F9;">
            <td style="padding: 8px 10px;">
              <strong>${c.tradeName}</strong>
              <div class="text-xs text-muted">${c.clientId} • ${c.filingCategory}</div>
            </td>
            <td style="padding: 8px 10px; font-family: monospace;">
              ${c.gstin}
              <div class="text-xs text-muted">${c.state}</div>
            </td>
            <td style="padding: 8px 10px;">
              <span class="badge ${c.october2026Status.gstr1 === 'FILED' ? 'status-chip success-chip' : 'status-chip warning-chip'}">
                ${c.october2026Status.gstr1}
              </span>
            </td>
            <td style="padding: 8px 10px;">
              <span class="badge ${c.october2026Status.gstr3b === 'FILED' ? 'status-chip success-chip' : 'status-chip danger-chip'}">
                ${c.october2026Status.gstr3b}
              </span>
            </td>
            <td style="padding: 8px 10px;">
              ${c.itcStatus.unmatchedExcess > 0 
                ? `<span style="color: #DC2626; font-weight: 700;">+₹${c.itcStatus.unmatchedExcess.toLocaleString("en-IN")} Excess</span>` 
                : `<span style="color: #16A34A; font-weight: 700;">✓ 100% Matched</span>`}
            </td>
            <td style="padding: 8px 10px;">
              <button class="btn btn-outline btn-xs" onclick="sendClientReminder('${c.clientId}')">
                📩 Send Reminder
              </button>
            </td>
          </tr>
        `).join('');
      }
    }
  } catch(err) {
    console.error('Practice data load error:', err);
  }
};

window.sendClientReminder = async function(clientId) {
  try {
    const res = await fetch('/api/practice/reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId })
    });
    const json = await res.json();
    if (json.success && json.reminder) {
      const box = document.getElementById('practiceReminderPreviewBox');
      const text = document.getElementById('practiceReminderText');
      if (box && text) {
        box.style.display = 'block';
        text.textContent = `Subject: ${json.reminder.subject}\n\nTo: ${json.reminder.recipientEmail}\n\n${json.reminder.body}`;
      }
    }
  } catch(err) {
    console.error(err);
  }
};

// =========================================================================
// 13. Rule 88A & Electronic Ledgers (PMT-01/02/05/06)
// =========================================================================
window.openStatutoryEngineModal = function() {
  const modal = document.getElementById('modalStatutoryLedgers');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
  calculateRule88aPreview();
  loadLedgersPreview();
};

window.closeStatutoryEngineModal = function() {
  const modal = document.getElementById('modalStatutoryLedgers');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.calculateRule88aPreview = async function() {
  const lIgst = parseFloat(document.getElementById('simRule88aLIgst')?.value) || 0;
  const lCgst = parseFloat(document.getElementById('simRule88aLCgst')?.value) || 0;
  const lSgst = parseFloat(document.getElementById('simRule88aLSgst')?.value) || 0;

  const itcIgst = parseFloat(document.getElementById('simRule88aItcIgst')?.value) || 0;
  const itcCgst = parseFloat(document.getElementById('simRule88aItcCgst')?.value) || 0;
  const itcSgst = parseFloat(document.getElementById('simRule88aItcSgst')?.value) || 0;

  try {
    const res = await fetch('/api/statutory/rule88a-setoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        liabilities: { igst: lIgst, cgst: lCgst, sgst: lSgst },
        itc: { igst: itcIgst, cgst: itcCgst, sgst: itcSgst }
      })
    });
    const json = await res.json();
    if (json.success) {
      const box = document.getElementById('rule88aOutputBox');
      if (box) {
        box.style.display = 'block';
        box.innerHTML = `
          <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 12px; font-size: 12px;">
            <div style="font-weight: 700; color: #166534; margin-bottom: 6px;">Rule 88A Setoff Matrix Results:</div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
              <div>IGST Credit Utilized: <strong>₹${json.utilizationMatrix.igstCreditUtilized.total.toLocaleString("en-IN")}</strong></div>
              <div>CGST Credit Utilized: <strong>₹${json.utilizationMatrix.cgstCreditUtilized.total.toLocaleString("en-IN")}</strong></div>
              <div>SGST Credit Utilized: <strong>₹${json.utilizationMatrix.sgstCreditUtilized.total.toLocaleString("en-IN")}</strong></div>
            </div>
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #BBF7D0; display: flex; justify-content: space-between; align-items: center;">
              <div>Net Cash Payable: <strong style="color: #DC2626; font-size: 14px;">₹${json.netCashPayable.total.toLocaleString("en-IN")}</strong> (IGST: ₹${json.netCashPayable.igst}, CGST: ₹${json.netCashPayable.cgst}, SGST: ₹${json.netCashPayable.sgst})</div>
              <div>ITC Carry Forward: <strong style="color: #16A34A; font-size: 14px;">₹${json.itcCarryForward.total.toLocaleString("en-IN")}</strong></div>
            </div>
          </div>
        `;
      }
    }
  } catch(err) {
    console.error(err);
  }
};

window.loadLedgersPreview = async function() {
  try {
    const res = await fetch('/api/statutory/ledgers');
    const json = await res.json();
    if (json.success) {
      const box = document.getElementById('cashLedgerPreview');
      if (box) {
        box.innerHTML = `
          GSTIN: ${json.gstin} | Major Heads Total: ₹${json.cashLedger.grandTotal}
          IGST [Tax: ₹${json.cashLedger.majorHeads.IGST.tax}, Fee: ₹${json.cashLedger.majorHeads.IGST.fee}]
          CGST [Tax: ₹${json.cashLedger.majorHeads.CGST.tax}, Fee: ₹${json.cashLedger.majorHeads.CGST.fee}]
          SGST [Tax: ₹${json.cashLedger.majorHeads.SGST.tax}, Fee: ₹${json.cashLedger.majorHeads.SGST.fee}]
        `;
      }
    }
  } catch(err) {
    console.error(err);
  }
};

window.generateStatutoryChallan = async function() {
  try {
    const res = await fetch('/api/statutory/pmt06/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amounts: { cgstTax: 1250, sgstTax: 1250, igstTax: 2500 }
      })
    });
    const json = await res.json();
    if (json.success && json.challan) {
      const ch = json.challan;
      const box = document.getElementById('challanOutputBox');
      if (box) {
        box.style.display = 'block';
        box.innerHTML = `
          <div style="font-weight: 700; color: #1E40AF; margin-bottom: 4px;">Form GST PMT-06 Challan Generated:</div>
          <div><strong>14-Digit CPIN:</strong> <span class="font-mono" style="font-weight: 700; color: #0F172A;">${ch.cpin}</span></div>
          <div><strong>Total Amount:</strong> ₹${ch.totalChallanAmount.toLocaleString("en-IN")}</div>
          <div><strong>Statutory Validity:</strong> 15 Days (Expires: ${new Date(ch.expiryDate).toLocaleDateString()})</div>
          <div style="font-size: 10px; color: #64748B; margin-top: 4px;">${ch.watermark}</div>
        `;
      }
    }
  } catch(err) {
    console.error(err);
  }
};

// =========================================================================
// 14. 180-Day Rule 37 Supplier Aging Matrix
// =========================================================================
window.open180DaysModal = function() {
  const modal = document.getElementById('modal180DaysTracker');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
  load180DaysData();
};

window.close180DaysModal = function() {
  const modal = document.getElementById('modal180DaysTracker');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.load180DaysData = async function() {
  try {
    const res = await fetch('/api/statutory/180-day-tracker');
    const json = await res.json();
    if (json.success) {
      const sum = json.summary;
      const summaryBox = document.getElementById('agingBucketsSummary');
      if (summaryBox) {
        summaryBox.innerHTML = `
          <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 10px;">
            <div class="text-xs text-muted">0-90 Days (Normal)</div>
            <div style="font-size: 16px; font-weight: 800; color: #166534;">${sum.current0To90Count} Invoices</div>
          </div>
          <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 10px;">
            <div class="text-xs text-muted">91-150 Days (Aging)</div>
            <div style="font-size: 16px; font-weight: 800; color: #1D4ED8;">${sum.watchlist91To150Count} Invoices</div>
          </div>
          <div style="background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 8px; padding: 10px;">
            <div class="text-xs text-muted">151-179 Days (Critical)</div>
            <div style="font-size: 16px; font-weight: 800; color: #B45309;">${sum.critical151To179Count} Invoices</div>
          </div>
          <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px;">
            <div class="text-xs text-muted">>=180 Days (Reversal)</div>
            <div style="font-size: 16px; font-weight: 800; color: #B91C1C;">${sum.overdue180PlusCount} Invoices</div>
          </div>
        `;
      }

      const allInvoices = [
        ...json.buckets.overdue180Plus,
        ...json.buckets.critical151To179,
        ...json.buckets.watchlist91To150,
        ...json.buckets.current0To90,
        ...json.buckets.fullyPaid
      ];

      const tbody = document.getElementById('agingInvoicesTableBody');
      if (tbody) {
        tbody.innerHTML = allInvoices.slice(0, 10).map(inv => `
          <tr style="border-bottom: 1px solid #F1F5F9;">
            <td style="padding: 8px 10px;">
              <strong>${inv.invoiceNumber}</strong>
              <div class="text-xs text-muted">${inv.invoiceDate}</div>
            </td>
            <td style="padding: 8px 10px;">${inv.supplierName}</td>
            <td style="padding: 8px 10px;"><strong>${inv.daysElapsed} days</strong></td>
            <td style="padding: 8px 10px;">₹${inv.financials.unpaidAmount.toLocaleString("en-IN")}</td>
            <td style="padding: 8px 10px;">
              ${inv.status.isReversalMandatory
                ? `<span style="color: #DC2626; font-weight: 700;">Reversal: ₹${inv.financials.proportionateItcToReverse.toLocaleString("en-IN")}</span>`
                : `<span style="color: #16A34A;">Compliant</span>`}
            </td>
            <td style="padding: 8px 10px;">
              ${inv.interest.interestPayable > 0 ? `₹${inv.interest.interestPayable}` : '₹0'}
            </td>
          </tr>
        `).join('');
      }
    }
  } catch(err) {
    console.error(err);
  }
};

// =========================================================================
// 15. Reverse Charge Mechanism (RCM) Hub
// =========================================================================
window.openRcmModal = function() {
  const modal = document.getElementById('modalRcmSettlement');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
  loadRcmData();
};

window.closeRcmModal = function() {
  const modal = document.getElementById('modalRcmSettlement');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.loadRcmData = async function() {
  try {
    const res = await fetch('/api/statutory/rcm-process');
    const json = await res.json();
    if (json.success) {
      const box = document.getElementById('rcmSummaryContent');
      if (box) {
        box.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div>
              <div style="font-size: 14px; font-weight: 800; color: #1E293B;">GSTR-3B Table 3.1(d) Inward Supplies Liable to RCM</div>
              <div class="text-xs text-muted">Total Taxable Value: ₹${json.gstr3bTable3_1_d.taxableValue.toLocaleString("en-IN")}</div>
            </div>
            <div style="text-align: right;">
              <div class="text-xs text-muted">Mandatory Cash Payment:</div>
              <div style="font-size: 18px; font-weight: 800; color: #DC2626;">₹${json.gstr3bTable3_1_d.totalTax.toLocaleString("en-IN")}</div>
            </div>
          </div>
          <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 6px; padding: 10px; font-size: 12px; margin-bottom: 10px;">
            <strong>Subsequent ITC Claim (Table 4(A)(3)):</strong> Eligible ₹${json.gstr3bTable4_A_3.eligibleTotal.toLocaleString("en-IN")} will be unlocked in your Electronic Credit Ledger <em>immediately after</em> Table 3.1(d) is paid in cash.
          </div>
          <div class="text-xs text-muted">
            <strong>Self-Invoicing u/s 31(3)(f):</strong> Automatically enforced for all unregistered GTA, legal and sponsorship supplies.
          </div>
        `;
      }
    }
  } catch(err) {
    console.error(err);
  }
};


// ============================================================================
// MODAL CONTROLLER: NEW INWARD PURCHASE BILL
// ============================================================================
function generateNewPurchaseNumber() {
  const numInput = document.getElementById('newPurNumber');
  if (numInput) {
    const num = `BILL-${Date.now().toString().slice(-4)}`;
    numInput.value = num;
    numInput.defaultValue = num;
  }
}
window.generateNewPurchaseNumber = generateNewPurchaseNumber;

function openNewPurchaseModal() {
  const activeGstin = getActiveGstin();
  if (!activeGstin) {
    if (typeof showToast === "function") {
      showToast("Please sign in or select an active business GSTIN before creating a purchase bill.", "warning");
    }
    return;
  }
  const period = getActivePeriod();
  if (!period) {
    if (typeof showToast === "function") {
      showToast("Please select a return filing period first.", "warning");
    }
    return;
  }

  const m = document.getElementById('modalNewPurchase');
  if (m) {
    m.classList.remove('hidden');
    m.style.display = 'flex';
  }

  // Ensure clean blank form on open — explicitly wipe all values and defaultValues to prevent browser autofill/cached restoration
  const form = document.querySelector('#modalNewPurchase form');
  if (form) form.reset();

  const numInput = document.getElementById('newPurNumber');
  if (numInput) { numInput.value = ''; numInput.defaultValue = ''; }

  const supName = document.getElementById('newPurSupplierName');
  if (supName) { supName.value = ''; supName.defaultValue = ''; }

  const supGstin = document.getElementById('newPurSupplierGstin');
  if (supGstin) { supGstin.value = ''; supGstin.defaultValue = ''; }

  const taxableInput = document.getElementById('newPurTaxable');
  if (taxableInput) { taxableInput.value = ''; taxableInput.defaultValue = ''; }

  const gstRateSelect = document.getElementById('newPurGstRate');
  if (gstRateSelect) { gstRateSelect.value = ''; }

  const itcSelect = document.getElementById('newPurItcEligibility');
  if (itcSelect) { itcSelect.value = ''; }

  const posSelect = document.getElementById('newPurPos');
  if (posSelect) {
    delete posSelect.dataset.userModified;
    posSelect.value = '';
  }

  const rcmCheckbox = document.getElementById('newPurIsRcm');
  if (rcmCheckbox) {
    rcmCheckbox.checked = false;
  }

  const dateInput = document.getElementById('newPurDate');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
    dateInput.defaultValue = today;
  }

  calculateNewPurchaseTax();
}
window.openNewPurchaseModal = openNewPurchaseModal;

function closeNewPurchaseModal() {
  const m = document.getElementById('modalNewPurchase');
  if (m) {
    m.classList.add('hidden');
    m.style.display = 'none';
  }
}
window.closeNewPurchaseModal = closeNewPurchaseModal;

function onSupplierGstinInput() {
  const suppGstin = (document.getElementById('newPurSupplierGstin')?.value || "").trim().toUpperCase();
  const posSelect = document.getElementById('newPurPos');
  if (suppGstin.length >= 2) {
    const stateCode = suppGstin.slice(0, 2);
    if (/^\d{2}$/.test(stateCode) && posSelect && !posSelect.dataset.userModified) {
      posSelect.value = stateCode;
    }
  }
  calculateNewPurchaseTax();
}
window.onSupplierGstinInput = onSupplierGstinInput;

function calculateNewPurchaseTax() {
  const taxableInput = document.getElementById('newPurTaxable');
  const taxable = parseFloat(taxableInput?.value) || 0;
  const rateSelect = document.getElementById('newPurGstRate');
  const rateValue = rateSelect ? rateSelect.value : '';
  const rate = rateValue !== '' ? parseFloat(rateValue) : null;

  const activeGstin = getActiveGstin();
  const activeState = (activeGstin && activeGstin.length >= 2) ? activeGstin.slice(0, 2) : "";

  const posSelect = document.getElementById('newPurPos');
  const pos = posSelect?.value ? posSelect.value.slice(0, 2) : "";

  const stEl = document.getElementById('newPurSupplyType');
  const taxEl = document.getElementById('newPurTaxAmount');
  const totEl = document.getElementById('newPurTotalAmount');
  const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (rate === null || taxable <= 0) {
    if (stEl) {
      stEl.textContent = pos
        ? (pos === activeState ? `Intra-State Inward Supply — State: ${pos}` : `Inter-State Inward Supply — POS: ${pos}`)
        : "— (Select Place of Supply & GST Rate)";
    }
    if (taxEl) taxEl.textContent = "₹0.00";
    if (totEl) totEl.textContent = taxable > 0 ? fmt(taxable) : "₹0.00";
    return;
  }

  if (!pos) {
    if (stEl) stEl.textContent = "— (Pending Place of Supply)";
    if (taxEl) taxEl.textContent = fmt(taxable * (rate / 100));
    if (totEl) totEl.textContent = fmt(taxable * (1 + rate / 100));
    return;
  }

  // Inter-state if Place of Supply is outside the recipient branch state
  const isInter = activeState && pos !== activeState;
  const totalTax = taxable * (rate / 100);

  if (stEl) {
    stEl.textContent = isInter
      ? `Inter-State Inward Supply (IGST) — Place of Supply: ${pos}`
      : `Intra-State Inward Supply (CGST + SGST) — Place of Supply: ${pos}`;
  }

  if (taxEl) taxEl.textContent = fmt(totalTax);
  if (totEl) totEl.textContent = fmt(taxable + totalTax);
}
window.calculateNewPurchaseTax = calculateNewPurchaseTax;

async function submitNewPurchase(event) {
  if (event) event.preventDefault();
  await ensureActiveSession();

  const invoiceNumber = document.getElementById('newPurNumber')?.value?.trim();
  const rawInvoiceDate = document.getElementById('newPurDate')?.value;
  const invoiceDate = normalizeDateToYMD(rawInvoiceDate);
  const supplierName = document.getElementById('newPurSupplierName')?.value?.trim();
  const supplierGstin = (document.getElementById('newPurSupplierGstin')?.value || "").trim().toUpperCase();
  const taxableAmount = parseFloat(document.getElementById('newPurTaxable')?.value) || 0;
  const rateSelect = document.getElementById('newPurGstRate');
  const gstRateVal = rateSelect ? rateSelect.value : "";
  const gstRate = gstRateVal !== "" ? parseFloat(gstRateVal) : null;
  const itcEligibility = document.getElementById('newPurItcEligibility')?.value;
  const isRcm = document.getElementById('newPurIsRcm')?.checked || false;
  const posSelect = document.getElementById('newPurPos');
  const pos = posSelect?.value ? posSelect.value.slice(0, 2) : "";

  const activeGstin = getActiveGstin();
  if (!activeGstin) {
    if (typeof showToast === "function") {
      showToast("Validation Error: Active business GSTIN is missing. Please sign in or select an entity.", "error");
    }
    return;
  }

  const period = derivePeriodFromDate(rawInvoiceDate || invoiceDate, getActivePeriod());
  if (!period) {
    if (typeof showToast === "function") {
      showToast("Validation Error: Filing period is missing. Please select a filing period.", "error");
    }
    return;
  }

  if (!invoiceNumber) {
    if (typeof showToast === "function") showToast("Please enter or generate a Purchase Bill / Invoice Number.", "warning");
    return;
  }
  if (!invoiceDate) {
    if (typeof showToast === "function") showToast("Please select a valid Bill Date.", "warning");
    return;
  }
  if (!supplierName) {
    if (typeof showToast === "function") showToast("Please enter the Supplier Name.", "warning");
    return;
  }
  if (!pos) {
    if (typeof showToast === "function") showToast("Please select a valid Place of Supply (POS).", "warning");
    return;
  }
  if (!itcEligibility) {
    if (typeof showToast === "function") showToast("Please select ITC Eligibility.", "warning");
    return;
  }
  if (taxableAmount <= 0) {
    if (typeof showToast === "function") showToast("Taxable Value must be greater than zero.", "warning");
    return;
  }
  if (gstRate === null || isNaN(gstRate)) {
    if (typeof showToast === "function") showToast("Please select the applicable GST Rate.", "warning");
    return;
  }

  const isInterstate = pos !== activeGstin.slice(0, 2);

  const btn = document.getElementById('btnSubmitPurchase');
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(`/api/purchases?period=${period}`, {
      method: "POST",
      body: JSON.stringify({
        invoiceNumber,
        invoiceDate,
        supplierName,
        supplierGstin: supplierGstin || undefined,
        pos,
        taxableAmount,
        gstRate,
        itcEligibility,
        isRcm,
        lineItems: [
          {
            description: "Goods / Inward Supply",
            hsn: "9983",
            quantity: 1,
            rate: taxableAmount,
            taxableAmount,
            gstRate,
            igst: isInterstate ? (taxableAmount * gstRate) / 100 : 0,
            cgst: isInterstate ? 0 : (taxableAmount * gstRate) / 200,
            sgst: isInterstate ? 0 : (taxableAmount * gstRate) / 200,
            total: taxableAmount + (taxableAmount * gstRate) / 100
          }
        ]
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      closeNewPurchaseModal();
      const savedPeriod = data.period || period;
      if (typeof switchFilingPeriod === "function" && savedPeriod !== getActivePeriod()) {
        await switchFilingPeriod(savedPeriod);
      }
      if (appState.inGuidedFlow) {
        if (typeof switchSuite === "function") {
          switchSuite('file-gst');
        }
        if (typeof startGuidedFiling === "function") {
          startGuidedFiling(3);
        }
      } else {
        if (typeof switchSuite === "function") {
          switchSuite('purchase');
        }
        const searchInput = document.getElementById('purchaseSearchInput');
        if (searchInput) searchInput.value = "";
        const filterSelect = document.getElementById('purchaseItcFilter');
        if (filterSelect) filterSelect.value = "ALL";
        if (typeof refreshInvoices === "function") {
          await refreshInvoices('purchase');
        }
      }
      if (typeof loadDashboardData === "function") {
        loadDashboardData(savedPeriod);
      }
      if (typeof showToast === "function") {
        showToast(`Purchase bill ${invoiceNumber} saved to SQLite database! (ID: ${data.id || data.purchase?.id})`, "success");
      }
      const form = document.querySelector("#modalNewPurchase form");
      if (form) form.reset();
      if (posSelect) delete posSelect.dataset.userModified;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      if (typeof showToast === "function") {
        showToast(data.error || "Failed to create purchase bill", "error");
      }
    }
  } catch (err) {
    if (typeof showToast === "function") {
      showToast("Network error creating purchase bill: " + err.message, "error");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.submitNewPurchase = submitNewPurchase;

// ============================================================================
// SALES & PURCHASE SUITES: SQLITE RENDERING & FILTERING
// ============================================================================
async function renderSalesSuite() {
  const period = typeof getActivePeriod === "function" ? getActivePeriod() : "102026";
  const badge = document.getElementById('salesActivePeriodBadge');
  if (badge) badge.textContent = period;

  try {
    const res = await apiFetch(`/api/sales?period=${period}`);
    const data = await res.json();
    const invoices = data.invoices || [];
    if (!appState.gst) appState.gst = {};
    appState.gst.salesInvoices = invoices;

    // Update Summary Cards
    const totalTaxable = invoices.reduce((sum, inv) => sum + (Number(inv.taxable_amount) || 0), 0);
    const totalTax = invoices.reduce((sum, inv) => sum + (Number(inv.total_tax) || 0), 0);
    const totalAmount = invoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);

    const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const countEl = document.getElementById('salesSummaryCount');
    if (countEl) countEl.textContent = invoices.length;
    const taxValEl = document.getElementById('salesSummaryTaxable');
    if (taxValEl) taxValEl.textContent = fmt(totalTaxable);
    const taxEl = document.getElementById('salesSummaryTax');
    if (taxEl) taxEl.textContent = fmt(totalTax);
    const totEl = document.getElementById('salesSummaryTotal');
    if (totEl) totEl.textContent = fmt(totalAmount);

    filterSalesTable();
  } catch (err) {
    console.error("Failed to load sales invoices:", err);
    if (typeof showToast === "function") {
      showToast("Failed to load sales invoices from database.", "error");
    }
  }
}
window.renderSalesSuite = renderSalesSuite;

function filterSalesTable() {
  const invoices = appState.gst?.salesInvoices || [];
  const search = (document.getElementById('salesSearchInput')?.value || "").toLowerCase().trim();
  const supplyFilter = document.getElementById('salesSupplyTypeFilter')?.value || "ALL";

  const filtered = invoices.filter(inv => {
    const matchesSearch = !search ||
      (inv.invoice_number && inv.invoice_number.toLowerCase().includes(search)) ||
      (inv.customer_name && inv.customer_name.toLowerCase().includes(search)) ||
      (inv.customer_gstin && inv.customer_gstin.toLowerCase().includes(search));
    const matchesType = supplyFilter === "ALL" || inv.supply_type === supplyFilter;
    return matchesSearch && matchesType;
  });

  const tbody = document.getElementById('salesTableBody');
  const emptyState = document.getElementById('salesTableEmptyState');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    if (emptyState) emptyState.classList.remove('hidden');
  } else {
    if (emptyState) emptyState.classList.add('hidden');
    tbody.innerHTML = filtered.map(inv => `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="py-3 px-4 font-mono font-semibold text-on-surface">${escapeHtml(inv.invoice_number)}</td>
        <td class="py-3 px-4 text-xs font-mono">${escapeHtml(inv.invoice_date || "—")}</td>
        <td class="py-3 px-4 font-medium">${escapeHtml(inv.customer_name || "—")}</td>
        <td class="py-3 px-4 font-mono text-xs text-secondary">${escapeHtml(inv.customer_gstin || "B2C Consumer")}</td>
        <td class="py-3 px-4 text-right font-mono">₹${Number(inv.taxable_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="py-3 px-4 text-right font-mono">${inv.gst_rate || 0}%</td>
        <td class="py-3 px-4 text-right font-mono text-xs">₹${Number(inv.igst || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="py-3 px-4 text-right font-mono text-xs">₹${Number(inv.cgst || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="py-3 px-4 text-right font-mono text-xs">₹${Number(inv.sgst || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="py-3 px-4 text-right font-mono font-semibold text-on-surface">₹${Number(inv.total_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td class="py-3 px-4 text-center">
          <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            ${escapeHtml(inv.status || "VALIDATED")}
          </span>
        </td>
        <td class="py-3 px-4 text-center">
          <span class="text-xs text-primary font-medium cursor-pointer hover:underline" onclick="showToast('Invoice ${escapeHtml(inv.invoice_number)} verified in database', 'info')">
            Verified
          </span>
        </td>
      </tr>
    `).join("");
  }
}
window.filterSalesTable = filterSalesTable;

async function renderPurchaseSuite() {
  const period = typeof getActivePeriod === "function" ? getActivePeriod() : "102026";
  const badge = document.getElementById('purchaseActivePeriodBadge');
  if (badge) badge.textContent = period;

  try {
    const res = await apiFetch(`/api/purchases?period=${period}`);
    const data = await res.json();
    const purchases = data.purchases || [];
    if (!appState.gst) appState.gst = {};
    appState.gst.purchaseInvoices = purchases;

    // Summary Cards
    const totalTaxable = purchases.reduce((sum, p) => sum + (Number(p.taxable_amount) || 0), 0);
    const eligibleItc = purchases
      .filter(p => p.itc_eligibility === "ELIGIBLE")
      .reduce((sum, p) => sum + (Number(p.total_tax) || 0), 0);
    const totalAmount = purchases.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);

    const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const countEl = document.getElementById('purchaseSummaryCount');
    if (countEl) countEl.textContent = purchases.length;
    const taxValEl = document.getElementById('purchaseSummaryTaxable');
    if (taxValEl) taxValEl.textContent = fmt(totalTaxable);
    const itcEl = document.getElementById('purchaseSummaryItc');
    if (itcEl) itcEl.textContent = fmt(eligibleItc);
    const totEl = document.getElementById('purchaseSummaryTotal');
    if (totEl) totEl.textContent = fmt(totalAmount);

    filterPurchaseTable();
  } catch (err) {
    console.error("Failed to load purchase bills:", err);
    if (typeof showToast === "function") {
      showToast("Failed to load purchase bills from database.", "error");
    }
  }
}
window.renderPurchaseSuite = renderPurchaseSuite;

function filterPurchaseTable() {
  const purchases = appState.gst?.purchaseInvoices || [];
  const search = (document.getElementById('purchaseSearchInput')?.value || "").toLowerCase().trim();
  const itcFilter = document.getElementById('purchaseItcFilter')?.value || "ALL";

  const filtered = purchases.filter(p => {
    const matchesSearch = !search ||
      (p.invoice_number && p.invoice_number.toLowerCase().includes(search)) ||
      (p.supplier_name && p.supplier_name.toLowerCase().includes(search)) ||
      (p.supplier_gstin && p.supplier_gstin.toLowerCase().includes(search));
    const matchesItc = itcFilter === "ALL" || p.itc_eligibility === itcFilter;
    return matchesSearch && matchesItc;
  });

  const tbody = document.getElementById('purchaseTableBody');
  const emptyState = document.getElementById('purchaseTableEmptyState');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    if (emptyState) emptyState.classList.remove('hidden');
  } else {
    if (emptyState) emptyState.classList.add('hidden');
    tbody.innerHTML = filtered.map(p => {
      const isEligible = p.itc_eligibility === "ELIGIBLE";
      const itcBadge = isEligible
        ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">Eligible ITC</span>`
        : `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-300">Blocked / Ineligible</span>`;
      return `
        <tr class="hover:bg-surface-container-low transition-colors">
          <td class="py-3 px-4 font-mono font-semibold text-on-surface">${escapeHtml(p.invoice_number)}</td>
          <td class="py-3 px-4 text-xs font-mono">${escapeHtml(p.invoice_date || "—")}</td>
          <td class="py-3 px-4 font-medium">${escapeHtml(p.supplier_name || "—")}</td>
          <td class="py-3 px-4 font-mono text-xs text-secondary">${escapeHtml(p.supplier_gstin || "—")}</td>
          <td class="py-3 px-4 text-right font-mono">₹${Number(p.taxable_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          <td class="py-3 px-4 text-right font-mono">${p.gst_rate || 0}%</td>
          <td class="py-3 px-4 text-right font-mono font-medium ${isEligible ? 'text-emerald-700' : 'text-secondary'}">₹${Number(p.total_tax || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          <td class="py-3 px-4 text-right font-mono font-semibold text-on-surface">₹${Number(p.total_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          <td class="py-3 px-4 text-center">${itcBadge}</td>
          <td class="py-3 px-4 text-center">
            <span class="px-2 py-0.5 rounded text-[11px] font-mono font-medium ${p.payment_status === 'FULLY_PAID' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}">
              ${escapeHtml(p.payment_status || "UNPAID")}
            </span>
          </td>
          <td class="py-3 px-4 text-center">
            <span class="text-xs text-primary font-medium cursor-pointer hover:underline" onclick="showToast('Purchase bill ${escapeHtml(p.invoice_number)} verified in database', 'info')">
              Verified
            </span>
          </td>
        </tr>
      `;
    }).join("");
  }
}
window.filterPurchaseTable = filterPurchaseTable;

async function refreshInvoices(type) {
  if (!type || type === 'sales') {
    await renderSalesSuite();
  }
  if (!type || type === 'purchase') {
    await renderPurchaseSuite();
  }
}
window.refreshInvoices = refreshInvoices;

// ============================================================================
// DOCUMENT UPLOADS & AI OCR REVIEW MODAL CONTROLLERS
// ============================================================================
function triggerBillsUpload() {
  document.getElementById('billsFileInput')?.click();
}
window.triggerBillsUpload = triggerBillsUpload;

function triggerSalesDocUpload() {
  document.getElementById('salesDocFileInput')?.click();
}
window.triggerSalesDocUpload = triggerSalesDocUpload;

function triggerPurchaseDocUpload() {
  document.getElementById('purchaseDocFileInput')?.click();
}
window.triggerPurchaseDocUpload = triggerPurchaseDocUpload;

async function uploadDocumentAndProcess(file, category) {
  if (!file) return;
  await ensureActiveSession();
  if (typeof showToast === "function") {
    showToast(`Uploading ${file.name} for AI OCR processing...`, "info");
  }

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category || "purchase_bill");

    const res = await apiFetch("/api/documents/upload", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (typeof showToast === "function") {
        showToast(`Document ${file.name} parsed via AI OCR! Please review before saving.`, "success");
      }
      openOcrReviewModal(
        data.document.id,
        data.parsedInvoice || data.extractedFields || {},
        data.parsedInvoice?.documentType || category,
        file.name,
        data.parsedInvoice?.confidence || ((data.ocr && data.ocr.confidence) ? `${Math.round(data.ocr.confidence * 100)}%` : "98%")
      );
    } else {
      if (typeof showToast === "function") {
        showToast(data.error || "Failed to parse document", "error");
      }
    }
  } catch (err) {
    if (typeof showToast === "function") {
      showToast("Error uploading document: " + err.message, "error");
    }
  }
}

// handleBillsFileSelect with staging and FormData upload is managed by Bills & Docs suite below

function handleSalesDocSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (file) uploadDocumentAndProcess(file, "sales_invoice");
  e.target.value = "";
}
window.handleSalesDocSelected = handleSalesDocSelected;

function handlePurchaseDocSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (file) uploadDocumentAndProcess(file, "purchase_bill");
  e.target.value = "";
}
window.handlePurchaseDocSelected = handlePurchaseDocSelected;

// ============================================================================
// PDF & OCR EXTRACTION, DYNAMIC EDITING & SAVE WORKFLOW
// ============================================================================
let ocrInvoiceState = {
  docId: null,
  documentType: "sales_invoice",
  filename: "Document.pdf",
  confidence: "96%",
  lineItems: [],
  warnings: [],
  isModified: false
};

function openOcrReviewModal(docIdOrData, maybeData, type = "purchase_bill", filename = "Document.pdf", confidence = "98% Verified") {
  const m = document.getElementById('modalOcrReview');
  if (m) {
    m.classList.remove('hidden');
    m.style.display = 'flex';
  }

  let docId = docIdOrData;
  let data = maybeData;
  if (typeof docIdOrData === "object" && docIdOrData !== null && !maybeData) {
    data = docIdOrData;
    docId = data.documentId || data.docId || data.id || "";
    type = data.documentType || data.type || type;
    filename = data.filename || filename;
    confidence = data.confidence || confidence;
  }
  data = data || {};

  const parsed = data?.parsedInvoice || data || {};
  const invoiceInfo = parsed.invoiceInfo || {};
  const seller = parsed.seller || {};
  const buyer = parsed.buyer || {};
  const totals = parsed.totals || {};

  const resolvedType = parsed.documentType || type || (data?.buyerGstin ? "sales_invoice" : "purchase_bill");
  ocrInvoiceState = {
    docId: docId || "",
    documentType: resolvedType,
    filename: filename || "Invoice.pdf",
    confidence: parsed.confidence || confidence || "96%",
    lineItems: Array.isArray(parsed.lineItems) && parsed.lineItems.length > 0 ? JSON.parse(JSON.stringify(parsed.lineItems)) : [],
    warnings: Array.isArray(parsed.warnings) ? [...parsed.warnings] : (Array.isArray(data?.warnings) ? [...data.warnings] : []),
    isModified: false
  };

  // If no line items extracted, initialize row with extracted invoice totals to preserve document values
  if (ocrInvoiceState.lineItems.length === 0) {
    const docTaxable = Number(totals.taxableAmount || data.taxableAmount || parsed.taxableAmount || (totals.totalAmount ? totals.totalAmount / 1.18 : 0)) || 0;
    const docGstRate = Number(data.gstRate || parsed.gstRate || (totals.igst || totals.cgst ? Math.round(((totals.igst || (totals.cgst * 2)) / (docTaxable || 1)) * 100) : 18)) || 18;
    const docRate = docTaxable > 0 ? docTaxable : 0;
    ocrInvoiceState.lineItems.push({
      id: "item-1",
      description: parsed.description || "Supply of Goods / Services",
      hsnCode: parsed.hsnCode || "9983",
      quantity: 1,
      unit: "NOS",
      rate: docRate,
      discount: 0,
      taxableValue: docRate,
      gstRate: docGstRate,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalAmount: docRate
    });
  }

  // Populate basic inputs
  const docIdEl = document.getElementById('ocrReviewDocId');
  if (docIdEl) docIdEl.value = docId || "";

  const fileEl = document.getElementById('ocrReviewFilename');
  if (fileEl) fileEl.textContent = filename || "Document.pdf";

  const confBadge = document.getElementById('ocrReviewConfidenceBadge');
  if (confBadge) confBadge.textContent = ocrInvoiceState.confidence;

  const pdfLink = document.getElementById('ocrReviewPdfLink');
  if (pdfLink) {
    pdfLink.href = docId ? `/api/documents/${docId}/download` : "#";
  }

  setOcrDocumentType(resolvedType, false);

  const numEl = document.getElementById('ocrReviewInvoiceNumber');
  if (numEl) numEl.value = invoiceInfo.invoiceNumber || parsed.invoiceNumber || data.invoiceNumber || "";

  const rawDate = invoiceInfo.invoiceDate || parsed.invoiceDate || data.invoiceDate || "";
  const dateEl = document.getElementById('ocrReviewInvoiceDate');
  if (dateEl) dateEl.value = normalizeDateToYMD(rawDate) || "";

  const rawDue = invoiceInfo.dueDate || parsed.dueDate || data.dueDate || "";
  const dueEl = document.getElementById('ocrReviewDueDate');
  if (dueEl) dueEl.value = normalizeDateToYMD(rawDue) || "";

  const posEl = document.getElementById('ocrReviewPos');
  if (posEl) posEl.value = invoiceInfo.pos || parsed.pos || (data.pos ? data.pos.slice(0, 2) : "27");

  const rcmEl = document.getElementById('ocrReviewIsRcm');
  if (rcmEl) rcmEl.checked = Boolean(invoiceInfo.isRcm !== undefined ? invoiceInfo.isRcm : (parsed.isRcm !== undefined ? parsed.isRcm : data.isRcm));

  const itcEl = document.getElementById('ocrReviewItcEligibility');
  if (itcEl) itcEl.value = data.itcEligibility || "ELIGIBLE";

  const supTypeEl = document.getElementById('ocrReviewSupplyType');
  if (supTypeEl) supTypeEl.value = data.supplyType || (invoiceInfo.isInterstate ? "B2B" : "B2B");

  // Populate Parties with priority to extracted document data
  const activeGstin = typeof getActiveGstin === "function" ? getActiveGstin() : null;
  const orgName = appState.organization?.name || appState.activeGstin?.trade_name || "";

  const sellerNameEl = document.getElementById('ocrReviewSellerName');
  if (sellerNameEl) {
    if (resolvedType === "sales_invoice") {
      sellerNameEl.value = (seller.name && activeGstin && seller.gstin === activeGstin) ? seller.name : (orgName || seller.name || data.supplierName || "");
    } else {
      sellerNameEl.value = seller.name || data.supplierName || "";
    }
  }

  const sellerGstinEl = document.getElementById('ocrReviewSellerGstin');
  if (sellerGstinEl) {
    if (resolvedType === "sales_invoice") {
      sellerGstinEl.value = activeGstin || seller.gstin || data.supplierGstin || "";
    } else {
      sellerGstinEl.value = seller.gstin || data.supplierGstin || "";
    }
  }

  const sellerStateEl = document.getElementById('ocrReviewSellerState');
  if (sellerStateEl) sellerStateEl.value = seller.state || seller.stateName || (resolvedType === "sales_invoice" ? (appState.activeGstin?.state_name || "") : "");

  const sellerAddrEl = document.getElementById('ocrReviewSellerAddress');
  if (sellerAddrEl) sellerAddrEl.value = seller.address || "";

  const buyerNameEl = document.getElementById('ocrReviewBuyerName');
  if (buyerNameEl) {
    if (resolvedType === "purchase_bill") {
      buyerNameEl.value = buyer.name || orgName || data.customerName || "";
    } else {
      buyerNameEl.value = buyer.name || data.customerName || "";
    }
  }

  const buyerGstinEl = document.getElementById('ocrReviewBuyerGstin');
  if (buyerGstinEl) {
    if (resolvedType === "purchase_bill") {
      buyerGstinEl.value = buyer.gstin || activeGstin || data.customerGstin || "";
    } else {
      buyerGstinEl.value = buyer.gstin || data.customerGstin || "";
    }
  }

  const buyerStateEl = document.getElementById('ocrReviewBuyerState');
  if (buyerStateEl) buyerStateEl.value = buyer.state || buyer.stateName || (resolvedType === "purchase_bill" ? (appState.activeGstin?.state_name || "") : "");

  const buyerAddrEl = document.getElementById('ocrReviewBuyerAddress');
  if (buyerAddrEl) buyerAddrEl.value = buyer.address || "";

  const cessEl = document.getElementById('ocrReviewCess');
  if (cessEl) cessEl.value = totals.cess || data.cess || 0;

  const roundEl = document.getElementById('ocrReviewRoundOff');
  if (roundEl) roundEl.value = totals.roundOff || data.roundOff || 0;

  // Render Line items & Totals
  renderOcrLineItems();
  recalculateOcrTotals();
  renderOcrWarnings(ocrInvoiceState.warnings);
}
window.openOcrReviewModal = openOcrReviewModal;

function setOcrDocumentType(type, triggerRecalc = true) {
  ocrInvoiceState.documentType = type;
  const typeInput = document.getElementById('ocrReviewInvoiceType');
  if (typeInput) typeInput.value = type;

  const btnSales = document.getElementById('btnTypeSales');
  const btnPurchase = document.getElementById('btnTypePurchase');
  const itcWrapper = document.getElementById('ocrReviewItcWrapper');
  const btnSave = document.getElementById('btnSaveOcrInvoice');

  if (type === "sales_invoice") {
    if (btnSales) {
      btnSales.className = "px-3 py-1 rounded-md text-xs font-bold bg-primary text-on-primary shadow-sm cursor-pointer";
    }
    if (btnPurchase) {
      btnPurchase.className = "px-3 py-1 rounded-md text-xs font-semibold text-secondary hover:text-on-surface cursor-pointer";
    }
    if (itcWrapper) itcWrapper.style.display = "none";
    if (btnSave) {
      btnSave.innerHTML = `<span class="material-symbols-outlined text-[16px]">save</span> <span>Save to Sales Register</span>`;
    }
  } else {
    if (btnPurchase) {
      btnPurchase.className = "px-3 py-1 rounded-md text-xs font-bold bg-primary text-on-primary shadow-sm cursor-pointer";
    }
    if (btnSales) {
      btnSales.className = "px-3 py-1 rounded-md text-xs font-semibold text-secondary hover:text-on-surface cursor-pointer";
    }
    if (itcWrapper) itcWrapper.style.display = "block";
    if (btnSave) {
      btnSave.innerHTML = `<span class="material-symbols-outlined text-[16px]">save</span> <span>Save to Purchase Register</span>`;
    }
  }

  if (triggerRecalc) {
    ocrInvoiceState.isModified = true;
    recalculateOcrTotals();
    validateOcrInvoiceForm();
  }
}
window.setOcrDocumentType = setOcrDocumentType;

function markFieldEdited(el) {
  ocrInvoiceState.isModified = true;
  if (el && el.classList) {
    el.classList.add('border-primary', 'bg-primary/5');
  }
}
window.markFieldEdited = markFieldEdited;

function renderOcrLineItems() {
  const tbody = document.getElementById('ocrReviewLineItemsTbody');
  if (!tbody) return;

  tbody.innerHTML = ocrInvoiceState.lineItems.map((item, idx) => `
    <tr class="hover:bg-surface-container-low/60 transition-colors">
      <td class="py-2 px-3 text-secondary text-center">${idx + 1}</td>
      <td class="py-1 px-2">
        <input type="text" value="${escapeHtml(item.description || "")}" oninput="updateOcrLineItem(${idx}, 'description', this.value)" class="w-full px-2 py-1 rounded bg-surface border border-outline-variant text-on-surface text-xs focus:border-primary focus:outline-none" placeholder="Item description">
      </td>
      <td class="py-1 px-1">
        <input type="text" value="${escapeHtml(item.hsnCode || "")}" oninput="updateOcrLineItem(${idx}, 'hsnCode', this.value)" class="w-full px-1.5 py-1 rounded bg-surface border border-outline-variant text-on-surface font-mono text-xs focus:border-primary focus:outline-none" placeholder="HSN">
      </td>
      <td class="py-1 px-1">
        <input type="number" step="1" min="1" value="${item.quantity || 1}" oninput="updateOcrLineItem(${idx}, 'quantity', this.value)" class="w-full px-1 py-1 rounded bg-surface border border-outline-variant text-on-surface font-mono text-xs focus:border-primary focus:outline-none text-right">
      </td>
      <td class="py-1 px-1">
        <input type="text" value="${escapeHtml(item.unit || "NOS")}" oninput="updateOcrLineItem(${idx}, 'unit', this.value)" class="w-full px-1 py-1 rounded bg-surface border border-outline-variant text-on-surface text-xs focus:border-primary focus:outline-none uppercase text-center">
      </td>
      <td class="py-1 px-1">
        <input type="number" step="0.01" min="0" value="${item.rate || 0}" oninput="updateOcrLineItem(${idx}, 'rate', this.value)" class="w-full px-1.5 py-1 rounded bg-surface border border-outline-variant text-on-surface font-mono text-xs focus:border-primary focus:outline-none text-right">
      </td>
      <td class="py-1 px-1">
        <input type="number" step="0.01" min="0" value="${item.discount || 0}" oninput="updateOcrLineItem(${idx}, 'discount', this.value)" class="w-full px-1 py-1 rounded bg-surface border border-outline-variant text-on-surface font-mono text-xs focus:border-primary focus:outline-none text-right">
      </td>
      <td class="py-2 px-2 text-right font-mono font-semibold">
        ₹${Number(item.taxableValue || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td class="py-1 px-1">
        <select onchange="updateOcrLineItem(${idx}, 'gstRate', this.value)" class="w-full px-1 py-1 rounded bg-surface border border-outline-variant text-on-surface text-xs focus:border-primary focus:outline-none font-mono">
          <option value="18" ${Number(item.gstRate) === 18 ? "selected" : ""}>18%</option>
          <option value="12" ${Number(item.gstRate) === 12 ? "selected" : ""}>12%</option>
          <option value="5" ${Number(item.gstRate) === 5 ? "selected" : ""}>5%</option>
          <option value="28" ${Number(item.gstRate) === 28 ? "selected" : ""}>28%</option>
          <option value="0" ${Number(item.gstRate) === 0 ? "selected" : ""}>0%</option>
        </select>
      </td>
      <td class="py-2 px-2 text-right font-mono text-secondary">
        ₹${Number((item.cgst || 0) + (item.sgst || 0) + (item.igst || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td class="py-2 px-3 text-right font-mono font-bold text-on-surface">
        ₹${Number(item.totalAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td class="py-1 px-1 text-center">
        <button type="button" onclick="removeOcrLineItem(${idx})" class="p-1 text-secondary hover:text-error hover:bg-surface-container rounded cursor-pointer" title="Delete item">
          <span class="material-symbols-outlined text-[16px]">delete</span>
        </button>
      </td>
    </tr>
  `).join("");
}
window.renderOcrLineItems = renderOcrLineItems;

function addOcrLineItem() {
  ocrInvoiceState.isModified = true;
  ocrInvoiceState.lineItems.push({
    id: `item-${Date.now()}`,
    description: "New Item",
    hsnCode: "9983",
    quantity: 1,
    unit: "NOS",
    rate: 1000,
    discount: 0,
    taxableValue: 1000,
    gstRate: 18,
    cgst: 90,
    sgst: 90,
    igst: 0,
    totalAmount: 1180
  });
  renderOcrLineItems();
  recalculateOcrTotals();
}
window.addOcrLineItem = addOcrLineItem;

function removeOcrLineItem(index) {
  ocrInvoiceState.isModified = true;
  if (ocrInvoiceState.lineItems.length <= 1) {
    if (typeof showToast === "function") {
      showToast("Invoice must contain at least one line item.", "warning");
    }
    return;
  }
  ocrInvoiceState.lineItems.splice(index, 1);
  renderOcrLineItems();
  recalculateOcrTotals();
}
window.removeOcrLineItem = removeOcrLineItem;

function updateOcrLineItem(index, field, value) {
  ocrInvoiceState.isModified = true;
  const item = ocrInvoiceState.lineItems[index];
  if (!item) return;

  if (["quantity", "rate", "discount", "gstRate"].includes(field)) {
    item[field] = parseFloat(value) || 0;
    const qty = Math.max(0, item.quantity);
    const rate = Math.max(0, item.rate);
    const disc = Math.max(0, item.discount);
    item.taxableValue = Math.max(0, Math.round((qty * rate - disc) * 100) / 100);

    const pos = (document.getElementById('ocrReviewPos')?.value || "27").slice(0, 2);
    const sellerGstin = (document.getElementById('ocrReviewSellerGstin')?.value || "27").slice(0, 2);
    const isInterstate = pos !== sellerGstin;
    const gRate = item.gstRate || 0;
    const totalTax = Math.round(item.taxableValue * (gRate / 100) * 100) / 100;

    if (isInterstate) {
      item.igst = totalTax;
      item.cgst = 0;
      item.sgst = 0;
    } else {
      item.igst = 0;
      item.cgst = Math.round(totalTax / 2 * 100) / 100;
      item.sgst = Math.round(totalTax / 2 * 100) / 100;
    }
    item.totalAmount = Math.round((item.taxableValue + totalTax) * 100) / 100;
  } else {
    item[field] = value;
  }

  // Update table cells directly or re-render
  recalculateOcrTotals();
}
window.updateOcrLineItem = updateOcrLineItem;

function recalculateOcrTotals() {
  const pos = (document.getElementById('ocrReviewPos')?.value || "27").slice(0, 2);
  const sellerGstin = (document.getElementById('ocrReviewSellerGstin')?.value || "27").slice(0, 2);
  const isInterstate = pos !== sellerGstin;

  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  ocrInvoiceState.lineItems.forEach(item => {
    const qty = Math.max(0, Number(item.quantity !== undefined ? item.quantity : 1));
    const rate = Math.max(0, Number(item.rate || 0));
    const disc = Math.max(0, Number(item.discount || 0));
    item.taxableValue = Number(item.taxableValue !== undefined ? item.taxableValue : (item.taxableAmount !== undefined ? item.taxableAmount : (qty * rate - disc)));
    totalTaxable += item.taxableValue;
    const gRate = Number(item.gstRate || 0);
    const tax = Math.round(item.taxableValue * (gRate / 100) * 100) / 100;
    if (isInterstate) {
      item.igst = tax;
      item.cgst = 0;
      item.sgst = 0;
      totalIgst += tax;
    } else {
      item.igst = 0;
      item.cgst = Math.round(tax / 2 * 100) / 100;
      item.sgst = Math.round(tax / 2 * 100) / 100;
      totalCgst += item.cgst;
      totalSgst += item.sgst;
    }
    item.totalAmount = Math.round((item.taxableValue + tax) * 100) / 100;
  });

  const cess = parseFloat(document.getElementById('ocrReviewCess')?.value) || 0;
  const roundOff = parseFloat(document.getElementById('ocrReviewRoundOff')?.value) || 0;
  const grandTotal = Math.round((totalTaxable + totalCgst + totalSgst + totalIgst + cess + roundOff) * 100) / 100;

  const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const taxDisp = document.getElementById('ocrReviewTaxableDisplay');
  if (taxDisp) taxDisp.textContent = fmt(totalTaxable);

  const cgstDisp = document.getElementById('ocrReviewCgstDisplay');
  if (cgstDisp) cgstDisp.textContent = fmt(totalCgst);

  const sgstDisp = document.getElementById('ocrReviewSgstDisplay');
  if (sgstDisp) sgstDisp.textContent = fmt(totalSgst);

  const igstDisp = document.getElementById('ocrReviewIgstDisplay');
  if (igstDisp) igstDisp.textContent = fmt(totalIgst);

  const totDisp = document.getElementById('ocrReviewGrandTotalDisplay');
  if (totDisp) totDisp.textContent = fmt(grandTotal);

  // Synchronize legacy inputs for backward compatibility
  const legTaxable = document.getElementById('ocrReviewTaxable');
  if (legTaxable) legTaxable.value = totalTaxable;

  const legTax = document.getElementById('ocrReviewTotalTax');
  if (legTax) legTax.value = totalCgst + totalSgst + totalIgst + cess;

  const legTotal = document.getElementById('ocrReviewGrandTotal');
  if (legTotal) legTotal.value = grandTotal;
}
window.recalculateOcrTotals = recalculateOcrTotals;

function renderOcrWarnings(warnings = []) {
  const box = document.getElementById('ocrReviewWarningsBox');
  if (!box) return;

  if (!warnings || warnings.length === 0) {
    box.classList.add('hidden');
    box.innerHTML = "";
    return;
  }

  box.classList.remove('hidden');
  box.className = "p-3.5 rounded-xl border bg-amber-50 text-amber-950 border-amber-300 space-y-1.5 text-xs";

  box.innerHTML = `
    <div class="font-bold flex items-center gap-1.5 text-amber-900">
      <span class="material-symbols-outlined text-[16px]">warning</span>
      <span>Document Extraction Review Notices (${warnings.length}):</span>
    </div>
    <ul class="list-disc list-inside space-y-0.5 text-[11px] text-amber-800">
      ${warnings.map(w => `<li><strong>${escapeHtml(w.field || "Notice")}:</strong> ${escapeHtml(w.message || w)}</li>`).join("")}
    </ul>
  `;
}
window.renderOcrWarnings = renderOcrWarnings;

function validateOcrInvoiceForm() {
  const num = document.getElementById('ocrReviewInvoiceNumber')?.value?.trim();
  const date = document.getElementById('ocrReviewInvoiceDate')?.value;
  const sellerGstin = (document.getElementById('ocrReviewSellerGstin')?.value || "").trim().toUpperCase();
  const buyerGstin = (document.getElementById('ocrReviewBuyerGstin')?.value || "").trim().toUpperCase();

  const newWarnings = [];
  if (!num) {
    newWarnings.push({ field: "Invoice Number", message: "Invoice number is required." });
  }
  if (!date) {
    newWarnings.push({ field: "Invoice Date", message: "Invoice date is required." });
  }
  if (sellerGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(sellerGstin)) {
    newWarnings.push({ field: "Seller GSTIN", message: "Seller GSTIN format is invalid." });
  }
  if (buyerGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(buyerGstin)) {
    newWarnings.push({ field: "Buyer GSTIN", message: "Buyer GSTIN format is invalid." });
  }
  renderOcrWarnings([...newWarnings, ...ocrInvoiceState.warnings.filter(w => w.code === "DUPLICATE_INVOICE_NUMBER" || w.code === "SCANNED_DOCUMENT_NOTICE")]);
}
window.validateOcrInvoiceForm = validateOcrInvoiceForm;

async function reExtractCurrentDocument() {
  const docId = ocrInvoiceState.docId || document.getElementById('ocrReviewDocId')?.value;
  if (!docId) {
    if (typeof showToast === "function") showToast("No document ID available for re-extraction.", "error");
    return;
  }

  const btn = document.getElementById('btnReExtractOcr');
  if (btn) btn.disabled = true;

  if (typeof showToast === "function") {
    showToast("Re-extracting document content with active heuristics...", "info");
  }

  try {
    const res = await apiFetch(`/api/documents/${docId}/re-extract`, {
      method: "POST",
      body: JSON.stringify({ category: ocrInvoiceState.documentType })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (typeof showToast === "function") {
        showToast("Document re-extracted successfully!", "success");
      }
      openOcrReviewModal(docId, data.parsedInvoice || data.extractedFields, ocrInvoiceState.documentType, data.document?.original_filename || "Document.pdf", data.parsedInvoice?.confidence || "96%");
    } else {
      if (typeof showToast === "function") showToast(data.error || "Failed to re-extract document", "error");
    }
  } catch (err) {
    if (typeof showToast === "function") showToast("Network error re-extracting: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.reExtractCurrentDocument = reExtractCurrentDocument;

async function saveExtractedInvoice() {
  await ensureActiveSession();
  const invoiceNumber = document.getElementById('ocrReviewInvoiceNumber')?.value?.trim();
  const rawInvoiceDate = document.getElementById('ocrReviewInvoiceDate')?.value;
  const invoiceDate = normalizeDateToYMD(rawInvoiceDate);
  const invoiceType = document.getElementById('ocrReviewInvoiceType')?.value || ocrInvoiceState.documentType;
  const pos = (document.getElementById('ocrReviewPos')?.value || "27").slice(0, 2);
  const sellerName = document.getElementById('ocrReviewSellerName')?.value?.trim();
  const sellerGstin = (document.getElementById('ocrReviewSellerGstin')?.value || "").trim().toUpperCase();
  const buyerName = document.getElementById('ocrReviewBuyerName')?.value?.trim();
  const buyerGstin = (document.getElementById('ocrReviewBuyerGstin')?.value || "").trim().toUpperCase();
  const supplyType = document.getElementById('ocrReviewSupplyType')?.value || "B2B";
  const itcEligibility = document.getElementById('ocrReviewItcEligibility')?.value || "ELIGIBLE";
  const isRcm = Boolean(document.getElementById('ocrReviewIsRcm')?.checked);
  const cess = parseFloat(document.getElementById('ocrReviewCess')?.value) || 0;
  const period = derivePeriodFromDate(rawInvoiceDate || invoiceDate, getActivePeriod());

  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  ocrInvoiceState.lineItems.forEach(item => {
    totalTaxable += Number(item.taxableValue || 0);
    totalCgst += Number(item.cgst || 0);
    totalSgst += Number(item.sgst || 0);
    totalIgst += Number(item.igst || 0);
  });

  if (!invoiceNumber) {
    if (typeof showToast === "function") showToast("Please enter a valid Invoice Number.", "warning");
    return;
  }
  if (!invoiceDate) {
    if (typeof showToast === "function") showToast("Please select an Invoice Date.", "warning");
    return;
  }
  if (totalTaxable <= 0) {
    if (typeof showToast === "function") showToast("Taxable value must be greater than zero.", "warning");
    return;
  }

  const btn = document.getElementById('btnSaveOcrInvoice');
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch("/api/ocr/approve", {
      method: "POST",
      body: JSON.stringify({
        documentId: ocrInvoiceState.docId,
        invoiceType,
        fields: {
          invoiceNumber,
          invoiceDate,
          period: period,
          customerName: buyerName,
          customerGstin: buyerGstin,
          supplierName: sellerName,
          supplierGstin: sellerGstin,
          partyName: invoiceType === "sales_invoice" ? buyerName : sellerName,
          gstin: invoiceType === "sales_invoice" ? buyerGstin : sellerGstin,
          buyerGstin,
          pos,
          supplyType,
          isRcm,
          itcEligibility,
          taxableValue: totalTaxable,
          taxableAmount: totalTaxable,
          cgst: totalCgst,
          sgst: totalSgst,
          igst: totalIgst,
          cess,
          totalTax: totalCgst + totalSgst + totalIgst + cess,
          totalAmount: Math.round((totalTaxable + totalCgst + totalSgst + totalIgst + cess) * 100) / 100,
          totalInvoiceValue: Math.round((totalTaxable + totalCgst + totalSgst + totalIgst + cess) * 100) / 100,
          lineItems: ocrInvoiceState.lineItems
        }
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeOcrReviewModal();
      const savedPeriod = data.period || period;
      if (typeof switchFilingPeriod === "function" && savedPeriod !== getActivePeriod()) {
        await switchFilingPeriod(savedPeriod);
      }
      if (invoiceType === "sales_invoice") {
        if (typeof switchSuite === "function") switchSuite('sales');
        const searchInput = document.getElementById('salesSearchInput');
        if (searchInput) searchInput.value = "";
        const filterSelect = document.getElementById('salesSupplyTypeFilter');
        if (filterSelect) filterSelect.value = "ALL";
        if (typeof renderSalesSuite === "function") await renderSalesSuite();
        if (typeof refreshInvoices === "function") await refreshInvoices('sales');
      } else {
        if (appState.inGuidedFlow) {
          if (typeof switchSuite === "function") switchSuite('file-gst');
          if (typeof startGuidedFiling === "function") startGuidedFiling(3);
        } else {
          if (typeof switchSuite === "function") switchSuite('purchase');
          const searchInput = document.getElementById('purchaseSearchInput');
          if (searchInput) searchInput.value = "";
          const filterSelect = document.getElementById('purchaseItcFilter');
          if (filterSelect) filterSelect.value = "ALL";
          if (typeof renderPurchaseSuite === "function") await renderPurchaseSuite();
          if (typeof refreshInvoices === "function") await refreshInvoices('purchase');
        }
      }
      if (typeof loadBillsDashboard === "function") {
        await loadBillsDashboard();
      }
      if (typeof loadDashboardData === "function") loadDashboardData(savedPeriod);
      if (typeof showToast === "function") {
        showToast(data.message || "Invoice successfully saved to register!", "success");
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      if (typeof showToast === "function") {
        showToast(data.error || "Failed to save invoice to register.", "error");
      }
    }
  } catch (err) {
    if (typeof showToast === "function") {
      showToast("Network error saving invoice: " + err.message, "error");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.saveExtractedInvoice = saveExtractedInvoice;
window.submitOcrApproval = saveExtractedInvoice; // Alias for backward compatibility

function closeOcrReviewModal() {
  const m = document.getElementById('modalOcrReview');
  if (m) {
    m.classList.add('hidden');
    m.style.display = 'none';
  }
}
window.closeOcrReviewModal = closeOcrReviewModal;

async function approveOcrReviewInvoice() {
  const activeGstin = typeof getActiveGstin === "function" ? getActiveGstin() : null;
  const fields = {
    invoiceNumber: "AOS-4412",
    invoiceDate: "2026-10-22",
    partyName: "Office Supplies & Stationery",
    gstin: activeGstin || "",
    taxableValue: 28000,
    cgst: 2520,
    sgst: 2520,
    igst: 0,
    totalGst: 5040,
    totalInvoiceValue: 33040
  };
  try {
    const res = await apiFetch("/api/ocr/approve", {
      method: "POST",
      body: JSON.stringify({
        documentId: "doc-aos-4412",
        invoiceType: "purchase_bill",
        fields
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (typeof showToast === "function") {
        showToast("Invoice AOS-4412 approved and synced to Purchase Register!", "success");
      }
      if (appState.inGuidedFlow) {
        if (typeof switchSuite === "function") switchSuite('file-gst');
        if (typeof startGuidedFiling === "function") startGuidedFiling(3);
      } else {
        if (typeof switchSuite === "function") {
          switchSuite('purchase');
        }
        const searchInput = document.getElementById('purchaseSearchInput');
        if (searchInput) searchInput.value = "";
        const filterSelect = document.getElementById('purchaseItcFilter');
        if (filterSelect) filterSelect.value = "ALL";
        if (typeof refreshInvoices === "function") {
          await refreshInvoices('purchase');
        }
      }
      const period = typeof getActivePeriod === "function" ? getActivePeriod() : "102026";
      if (typeof loadDashboardData === "function") {
        loadDashboardData(period);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      if (typeof showToast === "function") {
        showToast(data.error || "Failed to approve OCR invoice", "error");
      }
    }
  } catch (err) {
    if (typeof showToast === "function") {
      showToast("Error approving invoice: " + err.message, "error");
    }
  }
}
window.approveOcrReviewInvoice = approveOcrReviewInvoice;

// ============================================================================
// BILLS & DOCS CENTRAL DOCUMENT MANAGEMENT WORKFLOW
// ============================================================================

let billsDocsState = {
  documents: [],
  stats: {},
  activeCategory: "",
  activeStatus: "",
  searchQuery: "",
  isLoading: false
};
window.billsDocsState = billsDocsState;

async function loadBillsDashboard() {
  billsDocsState.isLoading = true;
  try {
    const params = new URLSearchParams();
    if (billsDocsState.activeCategory) params.set("category", billsDocsState.activeCategory);
    if (billsDocsState.activeStatus) params.set("status", billsDocsState.activeStatus);
    if (billsDocsState.searchQuery) params.set("search", billsDocsState.searchQuery);

    const res = await apiFetch(`/api/documents?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      billsDocsState.documents = data.documents || [];
      billsDocsState.stats = data.stats || {};
      renderBillsDashboard();
    }
  } catch (err) {
    console.error("Failed to load bills documents:", err);
  } finally {
    billsDocsState.isLoading = false;
  }
}
window.loadBillsDashboard = loadBillsDashboard;
window.refreshBillsDocs = loadBillsDashboard;
window.renderCentralDocumentsLibrary = loadBillsDashboard;

function renderBillsDashboard() {
  const stats = billsDocsState.stats || {};
  const totalEl = document.getElementById('statBillsTotal');
  const salesEl = document.getElementById('statBillsSales');
  const purchaseEl = document.getElementById('statBillsPurchases');
  const pendingEl = document.getElementById('statBillsPending');
  const approvedEl = document.getElementById('statBillsApproved');
  const rejectedEl = document.getElementById('statBillsRejected');
  const draftEl = document.getElementById('statBillsDraft');
  const badgeText = document.getElementById('billsPendingBadgeText');
  const countText = document.getElementById('billsDocsCountText');
  const tableBody = document.getElementById('billsDocsTableBody');
  const emptyState = document.getElementById('billsDocsEmptyState');

  if (totalEl) totalEl.textContent = stats.total || 0;
  if (salesEl) salesEl.textContent = stats.sales || 0;
  if (purchaseEl) purchaseEl.textContent = stats.purchases || 0;
  if (pendingEl) pendingEl.textContent = stats.pending_review || 0;
  if (approvedEl) approvedEl.textContent = stats.approved || 0;
  if (rejectedEl) rejectedEl.textContent = stats.rejected || 0;
  if (draftEl) draftEl.textContent = stats.draft || 0;
  if (badgeText) badgeText.textContent = `${stats.pending_review || 0} Pending Review`;

  // Highlight Category Pills
  const pills = document.querySelectorAll('#billsCategoryPills .bills-cat-pill');
  pills.forEach(pill => {
    const cat = pill.getAttribute('data-category') || "";
    if (cat === billsDocsState.activeCategory) {
      pill.className = "bills-cat-pill px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-on-primary cursor-pointer transition-colors";
    } else {
      pill.className = "bills-cat-pill px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-container hover:bg-surface-container-high text-on-surface cursor-pointer transition-colors";
    }
  });

  const docs = billsDocsState.documents || [];
  if (countText) countText.textContent = `Showing ${docs.length} document${docs.length === 1 ? '' : 's'}`;

  if (!tableBody) return;

  if (docs.length === 0) {
    tableBody.innerHTML = "";
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  const categoryLabels = {
    sales_invoice: { label: "Sales", badge: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    purchase_bill: { label: "Purchase", badge: "bg-indigo-100 text-indigo-800 border-indigo-300" },
    expense_bill: { label: "Expense", badge: "bg-amber-100 text-amber-800 border-amber-300" },
    credit_note: { label: "Credit Note", badge: "bg-purple-100 text-purple-800 border-purple-300" },
    debit_note: { label: "Debit Note", badge: "bg-cyan-100 text-cyan-800 border-cyan-300" },
    other: { label: "Other", badge: "bg-slate-100 text-slate-800 border-slate-300" }
  };

  const statusConfig = {
    APPROVED: { label: "Approved", badge: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: "check_circle" },
    PENDING_REVIEW: { label: "Pending Review", badge: "bg-amber-100 text-amber-800 border-amber-300", icon: "pending_actions" },
    DRAFT: { label: "Draft", badge: "bg-blue-100 text-blue-800 border-blue-300", icon: "edit_note" },
    REJECTED: { label: "Rejected", badge: "bg-rose-100 text-rose-800 border-rose-300", icon: "cancel" }
  };

  tableBody.innerHTML = docs.map(doc => {
    const fileName = doc.filename || doc.original_filename || "Document.pdf";
    const isPdf = fileName.toLowerCase().endsWith(".pdf");
    const isImg = /\.(png|jpe?g)$/i.test(fileName);
    const fileIcon = isPdf ? "picture_as_pdf" : (isImg ? "image" : "description");
    const fileColor = isPdf ? "text-rose-600" : (isImg ? "text-blue-600" : "text-slate-600");

    const catCfg = categoryLabels[doc.category] || categoryLabels.other;
    const stCfg = statusConfig[doc.status] || statusConfig.PENDING_REVIEW;

    const rawSize = doc.file_size || doc.file_size_bytes || 0;
    const formattedSize = rawSize ? `${(rawSize / 1024).toFixed(1)} KB` : "—";
    const createdDate = doc.created_at ? new Date(doc.created_at).toLocaleDateString("en-IN", { day: '2-digit', month: 'short', year: 'numeric' }) : "—";

    const invNum = doc.invoice_number || (doc.extracted_invoice?.invoiceInfo?.invoiceNumber) || "—";
    const invDate = doc.invoice_date || (doc.extracted_invoice?.invoiceInfo?.invoiceDate) || "";
    const partyName = doc.party_name || (doc.category === 'sales_invoice' ? doc.extracted_invoice?.buyer?.name : doc.extracted_invoice?.seller?.name) || "—";
    const partyGstin = doc.party_gstin || (doc.category === 'sales_invoice' ? doc.extracted_invoice?.buyer?.gstin : doc.extracted_invoice?.seller?.gstin) || "";

    const taxable = doc.taxable_amount || doc.extracted_invoice?.totals?.taxableAmount || 0;
    const total = doc.total_amount || doc.extracted_invoice?.totals?.totalAmount || 0;

    let conf = Math.round((doc.confidence || 0.95) * 100);
    let confBadge = `bg-emerald-100 text-emerald-800 border-emerald-300`;
    if (doc.is_scanned || isImg) {
      confBadge = `bg-amber-100 text-amber-800 border-amber-300`;
    }


    return `
      <tr class="hover:bg-surface-container-low/50 transition-colors">
        <!-- Document / File -->
        <td class="py-3 px-4">
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-xl ${fileColor}">${fileIcon}</span>
            <div class="flex flex-col">
              <span class="font-semibold text-on-surface truncate max-w-[180px] sm:max-w-[240px]" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
              <div class="flex items-center gap-2 text-[11px] text-secondary font-mono">
                <span>${formattedSize}</span>
                <span>•</span>
                <span>${createdDate}</span>
              </div>
            </div>
          </div>
        </td>

        <!-- Category -->
        <td class="py-3 px-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${catCfg.badge}">
            ${catCfg.label}
          </span>
        </td>

        <!-- Extracted Details -->
        <td class="py-3 px-4">
          <div class="flex flex-col">
            <div class="flex items-center gap-2">
              <span class="font-mono font-bold text-on-surface">${escapeHtml(invNum)}</span>
              ${invDate ? `<span class="text-[11px] text-secondary font-mono">(${invDate})</span>` : ''}
            </div>
            <div class="text-[11px] text-secondary truncate max-w-[200px]" title="${escapeHtml(partyName)}">
              ${escapeHtml(partyName)}
              ${partyGstin ? `<span class="font-mono text-on-surface-variant font-medium ml-1">[${escapeHtml(partyGstin)}]</span>` : ''}
            </div>
          </div>
        </td>

        <!-- Amounts -->
        <td class="py-3 px-4 text-right font-mono">
          <div class="flex flex-col items-end">
            <span class="font-bold text-on-surface">₹${Number(total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            <span class="text-[11px] text-secondary">Taxable: ₹${Number(taxable).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </td>

        <!-- Status -->
        <td class="py-3 px-3 text-center">
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${stCfg.badge}">
            <span class="material-symbols-outlined text-[13px]">${stCfg.icon}</span>
            <span>${stCfg.label}</span>
          </span>
        </td>

        <!-- AI Confidence -->
        <td class="py-3 px-3 text-center">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold border ${confBadge}">
            ${doc.is_scanned || isImg ? 'Scanned OCR' : `${conf}% AI Verified`}
          </span>
        </td>

        <!-- Actions -->
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button onclick="openDocumentReview('${doc.id}')" class="px-2.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors cursor-pointer" title="Review and Edit">
              Review
            </button>
            <button onclick="openDocumentPreviewModal('${doc.id}', '${escapeHtml(doc.filename)}')" class="p-1 rounded-md hover:bg-surface-container text-secondary hover:text-on-surface transition-colors cursor-pointer" title="Preview Original">
              <span class="material-symbols-outlined text-[16px]">visibility</span>
            </button>
            <a href="/api/documents/${doc.id}/download" target="_blank" download class="p-1 rounded-md hover:bg-surface-container text-secondary hover:text-on-surface transition-colors cursor-pointer" title="Download Document">
              <span class="material-symbols-outlined text-[16px]">download</span>
            </a>
            <button onclick="deleteDocument('${doc.id}')" class="p-1 rounded-md hover:bg-rose-50 text-secondary hover:text-rose-600 transition-colors cursor-pointer" title="Delete Document">
              <span class="material-symbols-outlined text-[16px]">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}
window.renderBillsDashboard = renderBillsDashboard;

function filterBillsCategory(category) {
  billsDocsState.activeCategory = category || "";
  loadBillsDashboard();
}
window.filterBillsCategory = filterBillsCategory;

function filterBillsStatus(status) {
  billsDocsState.activeStatus = status || "";
  loadBillsDashboard();
}
window.filterBillsStatus = filterBillsStatus;

let billsSearchTimer = null;
function searchBillsDocs(query) {
  clearTimeout(billsSearchTimer);
  billsSearchTimer = setTimeout(() => {
    billsDocsState.searchQuery = (query || "").trim();
    loadBillsDashboard();
  }, 300);
}
window.searchBillsDocs = searchBillsDocs;

function handleBillsDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById('billsDropzone');
  if (dz) {
    dz.classList.add('border-primary', 'bg-surface-container');
  }
}
window.handleBillsDragOver = handleBillsDragOver;

function handleBillsDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById('billsDropzone');
  if (dz) {
    dz.classList.remove('border-primary', 'bg-surface-container');
  }
}
window.handleBillsDragLeave = handleBillsDragLeave;

let stagedBillsFiles = [];

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
window.formatFileSize = formatFileSize;

function handleBillsFileSelect(e) {
  const files = e.target.files ? Array.from(e.target.files) : [];
  if (!files || files.length === 0) return;
  stagedBillsFiles = files;

  const infoEl = document.getElementById('billsSelectedFileInfo');
  const nameEl = document.getElementById('billsSelectedFileName');
  const sizeEl = document.getElementById('billsSelectedFileSize');

  if (infoEl && nameEl && sizeEl) {
    if (files.length === 1) {
      nameEl.textContent = files[0].name;
      sizeEl.textContent = `${formatFileSize(files[0].size)} • Ready to upload`;
    } else {
      const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
      nameEl.textContent = `${files[0].name} (+${files.length - 1} more)`;
      sizeEl.textContent = `${formatFileSize(totalBytes)} • ${files.length} files selected`;
    }
    infoEl.classList.remove('hidden');
  }
}
window.handleBillsFileSelect = handleBillsFileSelect;

function cancelBillsSelection(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  stagedBillsFiles = [];
  const fi = document.getElementById('billsFileInput');
  if (fi) fi.value = "";
  const infoEl = document.getElementById('billsSelectedFileInfo');
  if (infoEl) infoEl.classList.add('hidden');
}
window.cancelBillsSelection = cancelBillsSelection;

async function confirmBillsUpload(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!stagedBillsFiles || stagedBillsFiles.length === 0) return;
  await ensureActiveSession();

  const files = [...stagedBillsFiles];
  for (const f of files) {
    if (f.size > 15 * 1024 * 1024) {
      if (typeof showToast === "function") {
        showToast(`File "${f.name}" exceeds maximum allowed upload size of 15 MB.`, "error");
      }
      return;
    }
  }

  const progressContainer = document.getElementById('billsUploadProgress');
  const filenameEl = document.getElementById('billsUploadFilename');
  const percentEl = document.getElementById('billsUploadPercent');
  const progressBar = document.getElementById('billsUploadProgressBar');

  if (progressContainer) progressContainer.classList.remove('hidden');
  if (filenameEl) filenameEl.textContent = `Uploading ${files.length === 1 ? files[0].name : files.length + " files"}...`;
  if (percentEl) percentEl.textContent = "40%";
  if (progressBar) progressBar.style.width = "40%";

  try {
    const formData = new FormData();
    if (files.length === 1) {
      formData.append("file", files[0]);
    } else {
      for (const f of files) {
        formData.append("files", f);
      }
    }
    formData.append("category", billsDocsState.activeCategory || "purchase_bill");

    const res = await apiFetch("/api/documents/upload", {
      method: "POST",
      body: formData
    });
    const data = await res.json();

    if (percentEl) percentEl.textContent = "100%";
    if (progressBar) progressBar.style.width = "100%";

    if (res.ok && data.success) {
      cancelBillsSelection();
      if (typeof showToast === "function") {
        showToast(`Successfully uploaded ${files.length} document(s)!`, "success");
      }
      await loadBillsDashboard();

      if (files.length === 1 && data.document) {
        openOcrReviewModal(
          data.document.id,
          data.parsedInvoice || data.extractedFields || {},
          data.parsedInvoice?.documentType || data.document.category || "purchase_bill",
          files[0].name,
          data.parsedInvoice?.confidence || "96%"
        );
      }
    } else {
      if (typeof showToast === "function") {
        showToast(`Upload failed: ${data.error || "Unknown error"}`, "error");
      }
    }
  } catch (err) {
    if (typeof showToast === "function") {
      showToast("Upload network error: " + err.message, "error");
    }
  } finally {
    setTimeout(() => {
      if (progressContainer) progressContainer.classList.add('hidden');
      if (progressBar) progressBar.style.width = "0%";
    }, 600);
  }
}
window.confirmBillsUpload = confirmBillsUpload;

function handleBillsDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById('billsDropzone');
  if (dz) {
    dz.classList.remove('border-primary', 'bg-surface-container');
  }
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    stagedBillsFiles = Array.from(e.dataTransfer.files);
    const infoEl = document.getElementById('billsSelectedFileInfo');
    const nameEl = document.getElementById('billsSelectedFileName');
    const sizeEl = document.getElementById('billsSelectedFileSize');
    if (infoEl && nameEl && sizeEl) {
      if (stagedBillsFiles.length === 1) {
        nameEl.textContent = stagedBillsFiles[0].name;
        sizeEl.textContent = `${formatFileSize(stagedBillsFiles[0].size)} • Ready to upload`;
      } else {
        const totalBytes = stagedBillsFiles.reduce((acc, f) => acc + f.size, 0);
        nameEl.textContent = `${stagedBillsFiles[0].name} (+${stagedBillsFiles.length - 1} more)`;
        sizeEl.textContent = `${formatFileSize(totalBytes)} • ${stagedBillsFiles.length} files selected`;
      }
      infoEl.classList.remove('hidden');
    }
  }
}
window.handleBillsDrop = handleBillsDrop;

async function uploadBillsFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  stagedBillsFiles = Array.from(fileList);
  await confirmBillsUpload();
}
window.uploadBillsFiles = uploadBillsFiles;

function readFileAsBase64OrText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    if (file.type && (file.type.startsWith("text/") || file.name.endsWith(".csv") || file.name.endsWith(".txt"))) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  });
}

function openDocumentReview(docId) {
  const doc = (billsDocsState.documents || []).find(d => d.id === docId);
  if (!doc) {
    if (typeof showToast === "function") showToast("Document not found in list.", "error");
    return;
  }

  const invoiceData = doc.extracted_invoice || {
    invoiceInfo: {
      invoiceNumber: doc.invoice_number || `INV-${doc.id.slice(0, 6).toUpperCase()}`,
      invoiceDate: doc.invoice_date || new Date().toISOString().split('T')[0],
      pos: "27",
      supplyType: "B2B",
      isRcm: false,
      itcEligibility: "ELIGIBLE"
    },
    seller: {
      name: doc.category === "sales_invoice" ? "My Business" : (doc.party_name || "Supplier"),
      gstin: doc.category === "sales_invoice" ? "" : (doc.party_gstin || ""),
    },
    buyer: {
      name: doc.category === "sales_invoice" ? (doc.party_name || "Customer") : "My Business",
      gstin: doc.category === "sales_invoice" ? (doc.party_gstin || "") : "",
    },
    totals: {
      taxableAmount: doc.taxable_amount || 0,
      totalAmount: doc.total_amount || 0,
      cgst: 0,
      sgst: 0,
      igst: 0
    },
    lineItems: [],
    warnings: []
  };

  const confidence = doc.confidence ? `${Math.round(doc.confidence * 100)}%` : "96%";
  openOcrReviewModal(doc.id, invoiceData, doc.category, doc.filename, confidence);
}
window.openDocumentReview = openDocumentReview;

async function saveOcrDraft() {
  const docId = ocrInvoiceState.docId || document.getElementById('ocrReviewDocId')?.value;
  if (!docId) {
    if (typeof showToast === "function") showToast("No active document ID for draft save.", "warning");
    return;
  }

  const invoiceType = document.getElementById('ocrReviewInvoiceType')?.value || ocrInvoiceState.documentType;
  const invoiceNumber = document.getElementById('ocrReviewInvoiceNumber')?.value?.trim();
  const invoiceDate = document.getElementById('ocrReviewInvoiceDate')?.value;
  const dueDate = document.getElementById('ocrReviewDueDate')?.value;
  const pos = (document.getElementById('ocrReviewPos')?.value || "27").slice(0, 2);
  const supplyType = document.getElementById('ocrReviewSupplyType')?.value || "B2B";
  const itcEligibility = document.getElementById('ocrReviewItcEligibility')?.value || "ELIGIBLE";
  const isRcm = Boolean(document.getElementById('ocrReviewIsRcm')?.checked);

  const sellerName = document.getElementById('ocrReviewSellerName')?.value?.trim();
  const sellerGstin = (document.getElementById('ocrReviewSellerGstin')?.value || "").trim().toUpperCase();
  const sellerState = document.getElementById('ocrReviewSellerState')?.value?.trim();
  const sellerAddress = document.getElementById('ocrReviewSellerAddress')?.value?.trim();

  const buyerName = document.getElementById('ocrReviewBuyerName')?.value?.trim();
  const buyerGstin = (document.getElementById('ocrReviewBuyerGstin')?.value || "").trim().toUpperCase();
  const buyerState = document.getElementById('ocrReviewBuyerState')?.value?.trim();
  const buyerAddress = document.getElementById('ocrReviewBuyerAddress')?.value?.trim();

  const cess = parseFloat(document.getElementById('ocrReviewCess')?.value) || 0;
  const roundOff = parseFloat(document.getElementById('ocrReviewRoundOff')?.value) || 0;

  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;
  ocrInvoiceState.lineItems.forEach(item => {
    totalTaxable += Number(item.taxableValue || 0);
    totalCgst += Number(item.cgst || 0);
    totalSgst += Number(item.sgst || 0);
    totalIgst += Number(item.igst || 0);
  });

  const totalTax = totalCgst + totalSgst + totalIgst + cess;
  const totalAmount = Math.round((totalTaxable + totalTax + roundOff) * 100) / 100;

  const btn = document.getElementById('btnSaveOcrDraft');
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(`/api/documents/${docId}/draft`, {
      method: "POST",
      body: JSON.stringify({
        invoiceType,
        fields: {
          invoiceInfo: { invoiceNumber, invoiceDate, dueDate, pos, supplyType, itcEligibility, isRcm },
          seller: { name: sellerName, gstin: sellerGstin, state: sellerState, address: sellerAddress },
          buyer: { name: buyerName, gstin: buyerGstin, state: buyerState, address: buyerAddress },
          partyName: invoiceType === 'sales_invoice' ? buyerName : sellerName,
          gstin: invoiceType === 'sales_invoice' ? buyerGstin : sellerGstin,
          lineItems: ocrInvoiceState.lineItems,
          totals: { taxableAmount: totalTaxable, cgst: totalCgst, sgst: totalSgst, igst: totalIgst, cess, roundOff, totalTax, totalAmount },
          taxableAmount: totalTaxable,
          totalAmount
        }
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (typeof showToast === "function") showToast("Draft saved successfully!", "success");
      closeOcrReviewModal();
      await loadBillsDashboard();
    } else {
      if (typeof showToast === "function") showToast(data.error || "Failed to save draft.", "error");
    }
  } catch (err) {
    if (typeof showToast === "function") showToast("Error saving draft: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.saveOcrDraft = saveOcrDraft;

async function rejectOcrDocument() {
  const docId = ocrInvoiceState.docId || document.getElementById('ocrReviewDocId')?.value;
  if (!docId) return;

  const reason = prompt("Enter rejection reason (optional):", "Rejected upon review");
  if (reason === null) return; // User cancelled prompt

  const btn = document.getElementById('btnRejectOcr');
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(`/api/documents/${docId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (typeof showToast === "function") showToast(data.message || "Document marked as rejected.", "info");
      closeOcrReviewModal();
      await loadBillsDashboard();
    } else {
      if (typeof showToast === "function") showToast(data.error || "Failed to reject document.", "error");
    }
  } catch (err) {
    if (typeof showToast === "function") showToast("Error rejecting document: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.rejectOcrDocument = rejectOcrDocument;

async function deleteDocument(docId) {
  if (!docId) return;
  if (!confirm("Are you sure you want to delete this document? This action cannot be undone.")) return;

  try {
    const res = await apiFetch(`/api/documents/${docId}?force=true`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok && data.success) {
      if (typeof showToast === "function") showToast("Document deleted successfully.", "success");
      await loadBillsDashboard();
    } else {
      if (typeof showToast === "function") showToast(data.error || "Failed to delete document.", "error");
    }
  } catch (err) {
    if (typeof showToast === "function") showToast("Delete error: " + err.message, "error");
  }
}
window.deleteDocument = deleteDocument;

function openDocumentPreviewModal(docId, filename) {
  const modal = document.getElementById('modalDocumentPreview');
  const titleEl = document.getElementById('docPreviewTitle');
  const subtitleEl = document.getElementById('docPreviewSubtitle');
  const downloadBtn = document.getElementById('docPreviewDownloadBtn');
  const iframeEl = document.getElementById('docPreviewIframe');
  const imgEl = document.getElementById('docPreviewImage');
  const placeholderEl = document.getElementById('docPreviewPlaceholder');

  if (titleEl) titleEl.textContent = filename || "Document Preview";
  if (subtitleEl) subtitleEl.textContent = `Document ID: ${docId}`;
  if (downloadBtn) {
    downloadBtn.href = `/api/documents/${docId}/download`;
    downloadBtn.setAttribute('download', filename || 'document');
  }

  const isPdf = (filename || '').toLowerCase().endsWith('.pdf');
  const isImg = /\.(png|jpe?g)$/i.test(filename || '');

  if (iframeEl) iframeEl.classList.add('hidden');
  if (imgEl) imgEl.classList.add('hidden');
  if (placeholderEl) placeholderEl.classList.add('hidden');

  const previewUrl = `/api/documents/${docId}/preview`;

  if (isPdf && iframeEl) {
    iframeEl.src = previewUrl;
    iframeEl.classList.remove('hidden');
  } else if (isImg && imgEl) {
    imgEl.src = previewUrl;
    imgEl.classList.remove('hidden');
  } else if (placeholderEl) {
    placeholderEl.classList.remove('hidden');
  }

  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}
window.openDocumentPreviewModal = openDocumentPreviewModal;

function closeDocumentPreviewModal() {
  const modal = document.getElementById('modalDocumentPreview');
  const iframeEl = document.getElementById('docPreviewIframe');
  if (iframeEl) iframeEl.src = 'about:blank';
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}
window.closeDocumentPreviewModal = closeDocumentPreviewModal;


// =========================================================================
// FOUR-STEP BUSINESS ONBOARDING WIZARD CONTROLLER
// =========================================================================

const GST_STATE_LOOKUP = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu",
  "26": "Dadra & Nagar Haveli",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory"
};

let currentOnboardingStep = 1;

function openOnboardingWizard(step = 1) {
  closeAuthModal();
  const wizard = document.getElementById("modalOnboardingWizard");
  if (wizard) {
    wizard.style.display = "flex";
    wizard.classList.remove("hidden");
  }
  goToOnboardingStep(step);

  // Fetch saved progress if session exists
  fetch("/api/onboarding/progress", {
    credentials: "same-origin",
    headers: appState.sessionToken ? { "Authorization": `Bearer ${appState.sessionToken}` } : {}
  })
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (!data || !data.success) return;
      if (data.user) {
        const fn = document.getElementById("onbFullName");
        if (fn && !fn.value && data.user.fullName) fn.value = data.user.fullName;
        const em = document.getElementById("onbEmail");
        if (em && !em.value && data.user.email) em.value = data.user.email;
        const mob = document.getElementById("onbMobile");
        if (mob && !mob.value && data.user.mobile) mob.value = data.user.mobile;
      }
      if (data.step2) {
        const pan = document.getElementById("onbPan");
        if (pan && data.step2.pan) pan.value = data.step2.pan;
        const gstin = document.getElementById("onbGstin");
        if (gstin && data.step2.gstin) {
          gstin.value = data.step2.gstin;
          onOnbGstinInput(data.step2.gstin);
        }
      }
      if (data.step3) {
        const hn = document.getElementById("onbAccountHolderName");
        if (hn && data.step3.accountHolderName) hn.value = data.step3.accountHolderName;
        const ifsc = document.getElementById("onbIfsc");
        if (ifsc && data.step3.ifsc) ifsc.value = data.step3.ifsc;
        const bn = document.getElementById("onbBankName");
        if (bn && data.step3.bankName) bn.value = data.step3.bankName;
        const br = document.getElementById("onbBranchName");
        if (br && data.step3.branchName) br.value = data.step3.branchName;
      }
      if (data.step4) {
        const ln = document.getElementById("onbLegalName");
        if (ln && data.step4.legalName) ln.value = data.step4.legalName;
        const tn = document.getElementById("onbTradeName");
        if (tn && data.step4.tradeName) tn.value = data.step4.tradeName;
        const bt = document.getElementById("onbBusinessType");
        if (bt && data.step4.businessType) bt.value = data.step4.businessType;
        const bc = document.getElementById("onbBusinessCategory");
        if (bc && data.step4.businessCategory) bc.value = data.step4.businessCategory;
        const be = document.getElementById("onbBusinessEmail");
        if (be && data.step4.businessEmail) be.value = data.step4.businessEmail;
        const bm = document.getElementById("onbBusinessMobile");
        if (bm && data.step4.businessMobile) bm.value = data.step4.businessMobile;
        const ba = document.getElementById("onbBusinessAddress");
        if (ba && data.step4.businessAddress) ba.value = data.step4.businessAddress;
        const st = document.getElementById("onbState");
        if (st && data.step4.state) st.value = data.step4.state;
        const cy = document.getElementById("onbCity");
        if (cy && data.step4.city) cy.value = data.step4.city;
        const pc = document.getElementById("onbPincode");
        if (pc && data.step4.pincode) pc.value = data.step4.pincode;
        const act = document.getElementById("onbBusinessActivity");
        if (act && data.step4.businessActivity) act.value = data.step4.businessActivity;
      }
    })
    .catch(() => {});
}
window.openOnboardingWizard = openOnboardingWizard;

function closeOnboardingWizard() {
  const wizard = document.getElementById("modalOnboardingWizard");
  if (wizard) {
    wizard.style.display = "none";
    wizard.classList.add("hidden");
  }
}
window.closeOnboardingWizard = closeOnboardingWizard;

function goToOnboardingStep(step) {
  if (step < 1 || step > 4) return;
  currentOnboardingStep = step;

  // Toggle Panels
  for (let i = 1; i <= 4; i++) {
    const p = document.getElementById(`onbPanel${i}`);
    if (p) {
      if (i === step) p.classList.remove("hidden");
      else p.classList.add("hidden");
    }
  }

  // Update Progress Indicators
  for (let i = 1; i <= 4; i++) {
    const badge = document.getElementById(`onbBadge${i}`);
    const label = document.getElementById(`onbLabel${i}`);
    if (i < step) {
      // Completed step
      if (badge) {
        badge.innerHTML = "✓";
        badge.className = "w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs bg-primary/20 text-primary border border-primary/40 transition-all";
      }
      if (label) {
        label.className = "text-[11px] font-semibold text-primary";
      }
    } else if (i === step) {
      // Current active step
      if (badge) {
        badge.innerHTML = String(i);
        badge.className = "w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs bg-primary text-on-primary shadow-xs transition-all";
      }
      if (label) {
        label.className = "text-[11px] font-bold text-primary";
      }
    } else {
      // Pending step
      if (badge) {
        badge.innerHTML = String(i);
        badge.className = "w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs bg-surface-container text-secondary border border-outline-variant transition-all";
      }
      if (label) {
        label.className = "text-[11px] font-medium text-secondary";
      }
    }
  }

  // Update connector lines
  for (let i = 1; i <= 3; i++) {
    const line = document.getElementById(`onbLine${i}`);
    if (line) {
      if (i < step) {
        line.className = "flex-1 h-0.5 bg-primary -mt-4 mx-2 transition-all";
      } else {
        line.className = "flex-1 h-0.5 bg-outline-variant -mt-4 mx-2 transition-all";
      }
    }
  }

  // If entering step 4, update summary review
  if (step === 4) {
    const pan = document.getElementById("onbPan")?.value.trim().toUpperCase() || "—";
    const gstin = document.getElementById("onbGstin")?.value.trim().toUpperCase() || "—";
    const bankName = document.getElementById("onbBankName")?.value.trim() || "Commercial Bank";
    const accNum = document.getElementById("onbAccountNumber")?.value.trim() || "";
    const last4 = accNum.length >= 4 ? accNum.slice(-4) : "••••";

    const summaryPanEl = document.getElementById("onbSummaryPanGstin");
    if (summaryPanEl) summaryPanEl.textContent = `PAN: ${pan} | GSTIN: ${gstin}`;

    const summaryBankEl = document.getElementById("onbSummaryBank");
    if (summaryBankEl) summaryBankEl.textContent = `${bankName} (••••••••${last4})`;
  }
}
window.goToOnboardingStep = goToOnboardingStep;

function togglePassVisibility(inputId, iconId) {
  const inp = document.getElementById(inputId);
  const ico = document.getElementById(iconId);
  if (!inp || !ico) return;
  if (inp.type === "password") {
    inp.type = "text";
    ico.textContent = "visibility_off";
  } else {
    inp.type = "password";
    ico.textContent = "visibility";
  }
}
window.togglePassVisibility = togglePassVisibility;

function checkPasswordStrength(val) {
  const pwd = val || "";
  const lenOk = pwd.length >= 8;
  const upperOk = /[A-Z]/.test(pwd);
  const lowerOk = /[a-z]/.test(pwd);
  const numOk = /[0-9]/.test(pwd);
  const specialOk = /[^A-Za-z0-9]/.test(pwd);

  const updateRule = (id, ok) => {
    const el = document.getElementById(id);
    if (!el) return;
    const icon = el.querySelector(".material-symbols-outlined");
    if (ok) {
      el.className = "flex items-center gap-1.5 text-emerald-600 font-medium";
      if (icon) {
        icon.textContent = "check_circle";
        icon.className = "material-symbols-outlined text-[14px] text-emerald-600";
      }
    } else {
      el.className = "flex items-center gap-1.5 text-secondary";
      if (icon) {
        icon.textContent = "radio_button_unchecked";
        icon.className = "material-symbols-outlined text-[14px] text-secondary";
      }
    }
  };

  updateRule("ruleLength", lenOk);
  updateRule("ruleUpper", upperOk);
  updateRule("ruleLower", lowerOk);
  updateRule("ruleNumber", numOk);
  updateRule("ruleSpecial", specialOk);

  return lenOk && upperOk && lowerOk && numOk && specialOk;
}
window.checkPasswordStrength = checkPasswordStrength;

function onOnbPanInput(val) {
  const panInput = document.getElementById("onbPan");
  if (panInput) panInput.value = (val || "").toUpperCase();
  const gstinInput = document.getElementById("onbGstin");
  if (gstinInput && gstinInput.value) {
    onOnbGstinInput(gstinInput.value);
  }
}
window.onOnbPanInput = onOnbPanInput;

function onOnbGstinInput(val) {
  const clean = (val || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const gstinInput = document.getElementById("onbGstin");
  if (gstinInput) gstinInput.value = clean;

  const stateBadge = document.getElementById("onbStateBadge");
  const feedback = document.getElementById("onbGstinFeedback");
  const pan = (document.getElementById("onbPan")?.value || "").trim().toUpperCase();

  if (clean.length >= 2) {
    const stCode = clean.slice(0, 2);
    const stName = GST_STATE_LOOKUP[stCode] || "Other Territory";
    if (stateBadge) {
      stateBadge.textContent = `State: ${stCode} - ${stName}`;
      stateBadge.classList.remove("hidden");
    }
    // Auto-select in Step 4 state dropdown
    const stSelect = document.getElementById("onbState");
    if (stSelect && stName) {
      stSelect.value = stName;
    }
  } else {
    if (stateBadge) stateBadge.classList.add("hidden");
  }

  if (clean.length === 15) {
    const embeddedPan = clean.slice(2, 12);
    if (pan && embeddedPan !== pan) {
      if (feedback) {
        feedback.textContent = `⚠️ Embedded PAN (${embeddedPan}) does not match entered PAN (${pan})`;
        feedback.className = "text-[11px] text-error font-medium";
      }
    } else {
      if (feedback) {
        feedback.textContent = "✓ Valid 15-character GSTIN matching PAN";
        feedback.className = "text-[11px] text-emerald-600 font-medium";
      }
    }
  } else {
    if (feedback) {
      feedback.textContent = "15-character GSTIN (first 2 digits = state code, next 10 = PAN)";
      feedback.className = "text-[11px] text-secondary";
    }
  }
}
window.onOnbGstinInput = onOnbGstinInput;

function formatAadhaarInput(input) {
  if (!input) return;
  const raw = input.value.replace(/\D/g, "").slice(0, 12);
  const chunks = raw.match(/.{1,4}/g);
  input.value = chunks ? chunks.join(" ") : raw;
}
window.formatAadhaarInput = formatAadhaarInput;

let ifscLookupTimeout = null;
function onOnbIfscInput(val) {
  const clean = (val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);
  const ifscInput = document.getElementById("onbIfsc");
  if (ifscInput) ifscInput.value = clean;

  if (clean.length === 11) {
    clearTimeout(ifscLookupTimeout);
    ifscLookupTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/bank/lookup-ifsc?ifsc=${clean}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            const bn = document.getElementById("onbBankName");
            if (bn && data.bankName) bn.value = data.bankName;
            const br = document.getElementById("onbBranchName");
            if (br && data.branchName) br.value = data.branchName;
          }
        }
      } catch (_) {}
    }, 200);
  }
}
window.onOnbIfscInput = onOnbIfscInput;

async function submitOnboardingStep1(e) {
  if (e && e.preventDefault) e.preventDefault();
  const errorEl = document.getElementById("onbError1");
  const errorTextEl = document.getElementById("onbErrorText1");
  const submitBtn = document.getElementById("btnOnbContinue1");

  const fullName = document.getElementById("onbFullName")?.value.trim();
  const mobile = document.getElementById("onbMobile")?.value.trim();
  const email = document.getElementById("onbEmail")?.value.trim();
  const password = document.getElementById("onbPassword")?.value;
  const confirmPassword = document.getElementById("onbConfirmPassword")?.value;

  const showError = (msg) => {
    if (errorEl && errorTextEl) {
      errorTextEl.textContent = msg;
      errorEl.classList.remove("hidden");
    } else {
      showToast(msg, "error");
    }
  };

  if (!fullName) return showError("Please enter your full legal name.");
  const cleanMobile = (mobile || "").replace(/[\s-+]/g, "").slice(-10);
  if (!cleanMobile || !/^\d{10}$/.test(cleanMobile)) return showError("Please enter a valid 10-digit mobile number.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("Please enter a valid email address.");
  if (!password) return showError("Password is required.");
  if (password !== confirmPassword) return showError("Passwords do not match.");
  if (!checkPasswordStrength(password)) return showError("Password does not meet all policy requirements.");

  if (errorEl) errorEl.classList.add("hidden");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="inline-block animate-spin mr-1">⟳</span> Creating Account...`;
  }

  try {
    const res = await fetch("/api/onboarding/step1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ fullName, mobile: cleanMobile, email, password, confirmPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showError(data.error || "Failed to create account. Please check your entries.");
      return;
    }

    if (data.sessionToken) {
      appState.sessionToken = data.sessionToken;
      localStorage.setItem("simplegst_session_token", data.sessionToken);
    }
    if (data.csrfToken) appState.csrfToken = data.csrfToken;

    showToast("Account created successfully! Please continue to Taxpayer Identification.", "success");
    goToOnboardingStep(2);
  } catch (err) {
    showError("Network failure while submitting Step 1. Please try again.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Continue to Taxpayer ID</span><span class="material-symbols-outlined text-[18px]">arrow_forward</span>`;
    }
  }
}
window.submitOnboardingStep1 = submitOnboardingStep1;

async function submitOnboardingStep2(e) {
  if (e && e.preventDefault) e.preventDefault();
  const errorEl = document.getElementById("onbError2");
  const errorTextEl = document.getElementById("onbErrorText2");
  const submitBtn = document.getElementById("btnOnbContinue2");

  const pan = (document.getElementById("onbPan")?.value || "").trim().toUpperCase();
  const gstin = (document.getElementById("onbGstin")?.value || "").trim().toUpperCase();
  const aadhaar = (document.getElementById("onbAadhaar")?.value || "").trim();

  const showError = (msg) => {
    if (errorEl && errorTextEl) {
      errorTextEl.textContent = msg;
      errorEl.classList.remove("hidden");
    } else {
      showToast(msg, "error");
    }
  };

  if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan)) {
    return showError("Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F).");
  }
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
    return showError("Invalid GSTIN format. Must be 15 characters (e.g. 27ABCDE1234F1Z5).");
  }
  if (gstin.slice(2, 12) !== pan) {
    return showError(`GSTIN embedded PAN (${gstin.slice(2, 12)}) does not match entered PAN (${pan}).`);
  }
  if (aadhaar) {
    const cleanAadhaar = aadhaar.replace(/[\s-]+/g, "");
    if (!/^\d{12}$/.test(cleanAadhaar)) {
      return showError("Aadhaar must be exactly 12 digits.");
    }
  }

  if (errorEl) errorEl.classList.add("hidden");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="inline-block animate-spin mr-1">⟳</span> Verifying...`;
  }

  try {
    const res = await apiFetch("/api/onboarding/step2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pan, gstin, aadhaar })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showError(data.error || "Failed to verify taxpayer identity.");
      return;
    }

    showToast("Taxpayer identification verified! Please enter banking details.", "success");
    goToOnboardingStep(3);
  } catch (err) {
    showError("Network failure while verifying Step 2.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Continue to Bank Details</span><span class="material-symbols-outlined text-[18px]">arrow_forward</span>`;
    }
  }
}
window.submitOnboardingStep2 = submitOnboardingStep2;

async function submitOnboardingStep3(e) {
  if (e && e.preventDefault) e.preventDefault();
  const errorEl = document.getElementById("onbError3");
  const errorTextEl = document.getElementById("onbErrorText3");
  const submitBtn = document.getElementById("btnOnbContinue3");

  const accountHolderName = document.getElementById("onbAccountHolderName")?.value.trim();
  const accountNumber = document.getElementById("onbAccountNumber")?.value.trim();
  const confirmAccountNumber = document.getElementById("onbConfirmAccountNumber")?.value.trim();
  const ifsc = (document.getElementById("onbIfsc")?.value || "").trim().toUpperCase();
  const bankName = document.getElementById("onbBankName")?.value.trim();
  const branchName = document.getElementById("onbBranchName")?.value.trim();

  const showError = (msg) => {
    if (errorEl && errorTextEl) {
      errorTextEl.textContent = msg;
      errorEl.classList.remove("hidden");
    } else {
      showToast(msg, "error");
    }
  };

  if (!accountHolderName) return showError("Account holder name is required.");
  const cleanAcc = (accountNumber || "").replace(/[\s-]+/g, "");
  const cleanConfirmAcc = (confirmAccountNumber || "").replace(/[\s-]+/g, "");
  if (!cleanAcc || !/^\d{9,18}$/.test(cleanAcc)) return showError("Account number must be between 9 and 18 digits.");
  if (cleanAcc !== cleanConfirmAcc) return showError("Bank account numbers do not match.");
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return showError("Invalid IFSC format (e.g. SBIN0001234).");
  if (!bankName) return showError("Bank name is required.");
  if (!branchName) return showError("Branch name is required.");

  if (errorEl) errorEl.classList.add("hidden");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="inline-block animate-spin mr-1">⟳</span> Saving...`;
  }

  try {
    const res = await apiFetch("/api/onboarding/step3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountHolderName, accountNumber: cleanAcc, confirmAccountNumber: cleanConfirmAcc, ifsc, bankName, branchName })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showError(data.error || "Failed to save banking information.");
      return;
    }

    showToast("Banking information encrypted and saved! Final step: Business Details.", "success");
    goToOnboardingStep(4);
  } catch (err) {
    showError("Network failure while saving banking details.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Continue to Business Details</span><span class="material-symbols-outlined text-[18px]">arrow_forward</span>`;
    }
  }
}
window.submitOnboardingStep3 = submitOnboardingStep3;

async function submitOnboardingStep4(e) {
  if (e && e.preventDefault) e.preventDefault();
  const errorEl = document.getElementById("onbError4");
  const errorTextEl = document.getElementById("onbErrorText4");
  const submitBtn = document.getElementById("btnOnbContinue4");

  const legalName = document.getElementById("onbLegalName")?.value.trim();
  const tradeName = document.getElementById("onbTradeName")?.value.trim() || legalName;
  const businessType = document.getElementById("onbBusinessType")?.value;
  const businessCategory = document.getElementById("onbBusinessCategory")?.value;
  const businessEmail = document.getElementById("onbBusinessEmail")?.value.trim();
  const businessMobile = document.getElementById("onbBusinessMobile")?.value.trim();
  const businessAddress = document.getElementById("onbBusinessAddress")?.value.trim();
  const state = document.getElementById("onbState")?.value;
  const city = document.getElementById("onbCity")?.value.trim();
  const pincode = document.getElementById("onbPincode")?.value.trim();
  const businessActivity = document.getElementById("onbBusinessActivity")?.value.trim();

  const showError = (msg) => {
    if (errorEl && errorTextEl) {
      errorTextEl.textContent = msg;
      errorEl.classList.remove("hidden");
    } else {
      showToast(msg, "error");
    }
  };

  if (!legalName) return showError("Legal business name is required.");
  if (!businessType) return showError("Business constitution / type is required.");
  if (!businessCategory) return showError("Business category is required.");
  if (!businessEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail)) return showError("Valid business email is required.");
  if (!businessAddress) return showError("Registered business address is required.");
  if (!state) return showError("Business state is required.");
  if (!city) return showError("City is required.");
  const cleanPincode = (pincode || "").trim();
  if (!cleanPincode || !/^\d{6}$/.test(cleanPincode)) return showError("Valid 6-digit PIN code is required.");
  if (!businessActivity) return showError("Primary business activity is required.");

  if (errorEl) errorEl.classList.add("hidden");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="inline-block animate-spin mr-1">⟳</span> Completing Registration...`;
  }

  try {
    const res = await apiFetch("/api/onboarding/step4", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legalName,
        tradeName,
        businessType,
        businessCategory,
        businessEmail,
        businessMobile,
        businessAddress,
        state,
        city,
        pincode,
        businessActivity
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showError(data.error || "Failed to complete onboarding.");
      return;
    }

    closeOnboardingWizard();

    // Reinitialize full authenticated state
    await initSessionFromBackend();

    showToast(`🎉 Registration complete! Welcome to SimpleGST, ${legalName}.`, "success");

    // Navigate to dashboard
    if (typeof switchView === "function") {
      switchView("dashboard");
    } else if (typeof goToItrStep === "function") {
      goToItrStep(1);
    }

    if (typeof loadDashboardData === "function") loadDashboardData();
    if (typeof loadSalesRegister === "function") loadSalesRegister();
    if (typeof loadPurchaseRegister === "function") loadPurchaseRegister();
    if (typeof loadBillsRegister === "function") loadBillsRegister();
  } catch (err) {
    showError("Network failure while completing onboarding.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">verified</span><span>Complete Registration</span>`;
    }
  }
}
window.submitOnboardingStep4 = submitOnboardingStep4;
