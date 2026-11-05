const fs = require('fs');
const path = require('path');

const rootDir = 'C:/RE';
const appJsPath = path.join(rootDir, 'app.js');
const publicAppJsPath = path.join(rootDir, 'public/app.js');

let appJs = fs.readFileSync(appJsPath, 'utf8');

const targetFunction = `function executeSwitchSuite(suite) {
  appState.currentSuite = suite;
  const viewItr = document.getElementById("viewItrSuite");
  const viewExpert = document.getElementById("viewExpertSuite");
  const viewNotice = document.getElementById("viewNoticeSuite");
  const viewVault = document.getElementById("viewVaultSuite");
  const viewGst = document.getElementById("viewGstSuite");
  const viewCopilot = document.getElementById("viewCopilotSuite");
  const viewStartup = document.getElementById("viewStartupSuite");
  const viewCompliance = document.getElementById("viewComplianceSuite");

  const btnCopilot = document.getElementById("btnSuiteCopilot");
  const btnGst = document.getElementById("btnSuiteGst");
  const btnMore = document.getElementById("btnSuiteMoreServices");
  const moreServicesMenu = document.getElementById("moreServicesMenu");

  // Always close dropdown menu when switching
  moreServicesMenu?.classList.add("hidden");

  // Reset all suites
  [viewItr, viewExpert, viewNotice, viewVault, viewGst, viewCopilot, viewStartup, viewCompliance].forEach(v => {
    if (v) {
      v.classList.remove("active");
      v.classList.add("hidden");
      v.style.display = "none";
    }
  });
  [btnCopilot, btnGst, btnMore].forEach(b => b?.classList.remove("active"));

  if (suite === "gst") {
    if (viewGst) {
      viewGst.classList.add("active");
      viewGst.classList.remove("hidden");
      viewGst.style.display = "block";
    }
    btnGst?.classList.add("active");
    if (document.getElementById("currentFilingPan")) {
      document.getElementById("currentFilingPan").textContent = appState.gst?.business?.gstin || "32ABCDE1234F1Z5";
    }
    if (typeof showGstScreen === "function") {
      showGstScreen(appState?.gst?.currentScreen || "reports");
    }
  } else if (suite === "expert") {
    if (viewExpert) {
      viewExpert.classList.add("active");
      viewExpert.classList.remove("hidden");
      viewExpert.style.display = "block";
    }
    btnMore?.classList.add("active");
    if (typeof loadExpertPlans === "function") loadExpertPlans();
    if (typeof recalculateSavingsEstimator === "function") recalculateSavingsEstimator();
  } else if (suite === "startup") {
    if (viewStartup) {
      viewStartup.classList.add("active");
      viewStartup.classList.remove("hidden");
      viewStartup.style.display = "block";
    }
    btnMore?.classList.add("active");
    if (typeof selectStartupType === "function") {
      selectStartupType(window.cdaState?.selectedStartupType || 'proprietorship');
    }
  } else if (suite === "compliance") {
    if (viewCompliance) {
      viewCompliance.classList.add("active");
      viewCompliance.classList.remove("hidden");
      viewCompliance.style.display = "block";
    }
    btnMore?.classList.add("active");
    if (typeof loadComplianceScore === "function") loadComplianceScore();
  } else if (suite === "notice") {
    if (viewNotice) {
      viewNotice.classList.add("active");
      viewNotice.classList.remove("hidden");
      viewNotice.style.display = "block";
    }
    btnMore?.classList.add("active");
  } else if (suite === "vault") {
    if (viewVault) {
      viewVault.classList.add("active");
      viewVault.classList.remove("hidden");
      viewVault.style.display = "block";
    }
    btnMore?.classList.add("active");
    if (typeof loadVaultDocuments === "function") loadVaultDocuments("all");
  } else {
    // Default to GST Return Assistant (Guiding Path)
    if (viewCopilot) {
      viewCopilot.classList.add("active");
      viewCopilot.classList.remove("hidden");
      viewCopilot.style.display = "block";
    }
    btnCopilot?.classList.add("active");
    if (typeof fetchCopilotPipeline === "function") fetchCopilotPipeline();
    if (typeof renderCadenceTimeline === "function") renderCadenceTimeline();
    if (typeof onDelaySliderChange === "function") onDelaySliderChange(0);
  }
}
window.switchSuite = executeSwitchSuite;`;

const replacementFunction = `function executeSwitchSuite(suite) {
  appState.currentSuite = suite;
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

  const btnCopilot = document.getElementById("btnSuiteCopilot");
  const btnGst = document.getElementById("btnSuiteGst");
  const btnMore = document.getElementById("btnSuiteMoreServices");
  const moreServicesMenu = document.getElementById("moreServicesMenu");

  // Always close dropdown menu & mobile drawer when switching
  moreServicesMenu?.classList.add("hidden");
  closeMobileSidebar();

  // Reset all suites
  const allSuites = [
    viewItr, viewExpert, viewNotice, viewVault, viewGst, viewCopilot, 
    viewStartup, viewCompliance, viewHome, viewBills, viewRecon, 
    viewTaxCalc, viewPractice, viewVendor
  ];
  allSuites.forEach(v => {
    if (v) {
      v.classList.remove("active");
      v.classList.add("hidden");
      v.style.display = "none";
    }
  });

  // Reset nav highlights
  [btnCopilot, btnGst, btnMore].forEach(b => b?.classList.remove("active"));
  document.querySelectorAll('.sidebar-nav-link').forEach(l => {
    l.classList.remove('bg-surface-container-high', 'text-primary', 'font-bold', 'border-l-4', 'border-primary');
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
  } else if (suite === "bills" || suite === "bills-docs") {
    if (viewBills) {
      viewBills.classList.add("active");
      viewBills.classList.remove("hidden");
      viewBills.style.display = "block";
    }
    highlightSidebarNav('nav-link-bills');
    highlightBottomNav('bottom-nav-bills');
  } else if (suite === "reconciliation" || suite === "recon") {
    if (viewRecon) {
      viewRecon.classList.add("active");
      viewRecon.classList.remove("hidden");
      viewRecon.style.display = "block";
    }
    btnGst?.classList.add("active");
    highlightSidebarNav('nav-link-reports');
  } else if (suite === "tax-calc") {
    if (viewTaxCalc) {
      viewTaxCalc.classList.add("active");
      viewTaxCalc.classList.remove("hidden");
      viewTaxCalc.style.display = "block";
    }
    btnCopilot?.classList.add("active");
    highlightSidebarNav('nav-link-file-gst');
  } else if (suite === "gst" || suite === "reports") {
    if (viewGst) {
      viewGst.classList.add("active");
      viewGst.classList.remove("hidden");
      viewGst.style.display = "block";
    }
    btnGst?.classList.add("active");
    highlightSidebarNav('nav-link-reports');
    highlightBottomNav('bottom-nav-reports');
    if (document.getElementById("currentFilingPan")) {
      document.getElementById("currentFilingPan").textContent = appState.gst?.business?.gstin || "27AAACA1234A1Z5";
    }
    if (typeof showGstScreen === "function") {
      showGstScreen(appState?.gst?.currentScreen || "reports");
    }
  } else if (suite === "expert" || suite === "tax-experts") {
    if (viewExpert) {
      viewExpert.classList.add("active");
      viewExpert.classList.remove("hidden");
      viewExpert.style.display = "block";
    }
    btnMore?.classList.add("active");
    highlightSidebarNav('nav-link-experts');
    highlightBottomNav('bottom-nav-experts');
    if (typeof loadExpertPlans === "function") loadExpertPlans();
    if (typeof recalculateSavingsEstimator === "function") recalculateSavingsEstimator();
  } else if (suite === "compliance" || suite === "health") {
    if (viewCompliance) {
      viewCompliance.classList.add("active");
      viewCompliance.classList.remove("hidden");
      viewCompliance.style.display = "block";
    }
    btnMore?.classList.add("active");
    highlightSidebarNav('nav-link-health');
    if (typeof loadComplianceScore === "function") loadComplianceScore();
  } else if (suite === "practice" || suite === "ca-hub") {
    if (viewPractice) {
      viewPractice.classList.add("active");
      viewPractice.classList.remove("hidden");
      viewPractice.style.display = "block";
    }
    btnMore?.classList.add("active");
    highlightSidebarNav('nav-link-ca-hub');
  } else if (suite === "vendor" || suite === "vendor-hub") {
    if (viewVendor) {
      viewVendor.classList.add("active");
      viewVendor.classList.remove("hidden");
      viewVendor.style.display = "block";
    }
    highlightSidebarNav('nav-link-bills');
  } else if (suite === "startup" || suite === "settings") {
    if (viewStartup) {
      viewStartup.classList.add("active");
      viewStartup.classList.remove("hidden");
      viewStartup.style.display = "block";
    }
    btnMore?.classList.add("active");
    highlightSidebarNav('nav-link-settings');
    if (typeof selectStartupType === "function") {
      selectStartupType(window.cdaState?.selectedStartupType || 'proprietorship');
    }
  } else if (suite === "notice") {
    if (viewNotice) {
      viewNotice.classList.add("active");
      viewNotice.classList.remove("hidden");
      viewNotice.style.display = "block";
    }
    btnMore?.classList.add("active");
  } else if (suite === "vault") {
    if (viewVault) {
      viewVault.classList.add("active");
      viewVault.classList.remove("hidden");
      viewVault.style.display = "block";
    }
    btnMore?.classList.add("active");
    if (typeof loadVaultDocuments === "function") loadVaultDocuments("all");
  } else {
    // Default: 'copilot' / 'file-gst' (Guiding Path)
    if (viewCopilot) {
      viewCopilot.classList.add("active");
      viewCopilot.classList.remove("hidden");
      viewCopilot.style.display = "block";
    }
    btnCopilot?.classList.add("active");
    highlightSidebarNav('nav-link-file-gst');
    highlightBottomNav('bottom-nav-file-gst');
    if (typeof fetchCopilotPipeline === "function") fetchCopilotPipeline();
    if (typeof renderCadenceTimeline === "function") renderCadenceTimeline();
    if (typeof onDelaySliderChange === "function") onDelaySliderChange(0);
  }
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
  if (m) m.classList.remove('hidden');
}
window.openPmt06Modal = openPmt06Modal;

function closePmt06Modal() {
  const m = document.getElementById('pmt-06-modal');
  if (m) m.classList.add('hidden');
}
window.closePmt06Modal = closePmt06Modal;

function openArnModal() {
  const m = document.getElementById('arn-success-modal');
  if (m) m.classList.remove('hidden');
}
window.openArnModal = openArnModal;

function closeArnModal() {
  const m = document.getElementById('arn-success-modal');
  if (m) m.classList.add('hidden');
}
window.closeArnModal = closeArnModal;`;

if (appJs.includes('function executeSwitchSuite(suite)')) {
  const idx = appJs.indexOf('function executeSwitchSuite(suite)');
  const endIdx = appJs.indexOf('// ============================================================================', idx);
  appJs = appJs.substring(0, idx) + replacementFunction + '\n\n' + appJs.substring(endIdx);
  fs.writeFileSync(appJsPath, appJs, 'utf8');
  fs.writeFileSync(publicAppJsPath, appJs, 'utf8');
  console.log('Updated app.js and public/app.js successfully.');
} else {
  console.log('executeSwitchSuite not found in app.js');
}
