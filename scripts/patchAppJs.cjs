const fs = require('fs');
const path = require('path');

const rootDir = 'C:/RE';
const appJsPath = path.join(rootDir, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// 1. Replace default suite startup
appJs = appJs.replace(
  "switchSuite('copilot');\n  selectFilingEntity('32ABCDE1234F1Z5', 'Malabar Spice Traders', 'GST & Business');",
  "switchSuite('home');\n  selectFilingEntity('27AAACA1234A1Z5', 'Apex Retailers Pvt Ltd', 'Main Branch');"
);
appJs = appJs.replace(
  'switchSuite("copilot");\n  selectFilingEntity("32ABCDE1234F1Z5", "Malabar Spice Traders", "GST & Business");',
  'switchSuite("home");\n  selectFilingEntity("27AAACA1234A1Z5", "Apex Retailers Pvt Ltd", "Main Branch");'
);

// 2. Enhance selectFilingEntity
const selectEntityOld = `function selectFilingEntity(pan, name, subtitle) {
  document.getElementById("currentFilingPan").textContent = pan;
  document.getElementById("filingDropdownMenu")?.classList.remove("active");
  switchSuite("copilot");
}`;

const selectEntityNew = `function selectFilingEntity(pan, name, subtitle) {
  const panEl = document.getElementById("currentFilingPan");
  if (panEl) panEl.textContent = pan;
  const nameEl = document.getElementById("currentFilingEntityName");
  if (nameEl) nameEl.textContent = name;
  const sidePan = document.getElementById("sidebarGstinDisplay");
  if (sidePan) sidePan.textContent = pan;
  const sideEntity = document.getElementById("sidebarEntityDisplay");
  if (sideEntity) sideEntity.textContent = name;
  document.getElementById("filingDropdownMenu")?.classList.add("hidden");
  document.getElementById("filingDropdownMenu")?.classList.remove("active");
}`;

if (appJs.includes(selectEntityOld)) {
  appJs = appJs.replace(selectEntityOld, selectEntityNew);
}

// 3. Ensure dropdown & drawer functions exist
const helperFunctions = `
// ============================================================================
// STITCH UI CONTROLS & DROPDOWNS
// ============================================================================
function toggleFilingDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("filingDropdownMenu");
  if (menu) menu.classList.toggle("hidden");
}
window.toggleFilingDropdown = toggleFilingDropdown;

function toggleRoleMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("roleDropdownMenu");
  if (menu) menu.classList.toggle("hidden");
}
window.toggleRoleMenu = toggleRoleMenu;

function switchRole(role) {
  const roleEl = document.getElementById("currentUserRole");
  const roleMenu = document.getElementById("roleDropdownMenu");
  if (roleMenu) roleMenu.classList.add("hidden");
  if (role === "ca") {
    if (roleEl) roleEl.textContent = "Chartered Accountant";
    switchSuite("practice");
  } else {
    if (roleEl) roleEl.textContent = "Business Owner";
    switchSuite("home");
  }
}
window.switchRole = switchRole;

function toggleNotificationDrawer() {
  if (typeof showToast === "function") {
    showToast("🔔 2 Statutory Alerts: GSTR-3B due in 15 days; 1 vendor ITC mismatch.", "info");
  }
}
window.toggleNotificationDrawer = toggleNotificationDrawer;

window.showArnModal = function() {
  const m = document.getElementById('arn-success-modal');
  if (m) m.classList.remove('hidden');
};
`;

if (!appJs.includes('toggleFilingDropdown')) {
  appJs += '\n' + helperFunctions;
}

// 4. Update executeSwitchSuite to handle all Stitch routes
const executeSwitchOldPattern = /function executeSwitchSuite\(suite\) \{[\s\S]*?window\.switchSuite = executeSwitchSuite;/;

const executeSwitchNew = `function executeSwitchSuite(suite) {
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

  // Always close dropdowns & mobile drawer when switching
  document.getElementById("filingDropdownMenu")?.classList.add("hidden");
  document.getElementById("roleDropdownMenu")?.classList.add("hidden");
  document.getElementById("profileDropdownMenu")?.classList.remove("active");
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
  } else if (suite === "copilot" || suite === "guided" || suite === "file-gst") {
    if (viewCopilot) {
      viewCopilot.classList.add("active");
      viewCopilot.classList.remove("hidden");
      viewCopilot.style.display = "block";
    }
    highlightSidebarNav('nav-link-file-gst');
    highlightBottomNav('bottom-nav-file-gst');
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
    highlightSidebarNav('nav-link-health');
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
  }

  // Scroll smoothly to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.switchSuite = executeSwitchSuite;`;

appJs = appJs.replace(executeSwitchOldPattern, executeSwitchNew);

fs.writeFileSync(appJsPath, appJs, 'utf8');
fs.writeFileSync(path.join(rootDir, 'public/app.js'), appJs, 'utf8');
console.log('app.js and public/app.js updated successfully.');
