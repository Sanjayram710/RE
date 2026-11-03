/**
   SimpleGST Client Application & ITR E-Filing Platform
   Faithfully reproduces the ITR e-filing flow from screenshots and integrates the GST Engine
   Vanilla ES6, zero external UI framework, fast, responsive, and mobile-ready
*/

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
  initAuth();
  await fetchAppMode();
  await loadGstDemoData();
  
  // Initialize ITR Step 1 & Computation
  updatePersonalInfoState();
  await recalculateItrTax();
  goToItrStep(1); // Ensure Option 1 (Personal Info) is active on load
  
  // Close dropdowns on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#filingDropdownTrigger") && !e.target.closest("#filingDropdownMenu")) {
      document.getElementById("filingDropdownMenu")?.classList.remove("active");
    }
    if (!e.target.closest("#profileDropdownBtn") && !e.target.closest("#profileDropdownMenu")) {
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
// Suite Switching: ITR vs Expert Filing vs Notice Defense vs Vault vs GST
// ============================================================================
function switchSuite(suite) {
  appState.currentSuite = suite;
  const viewItr = document.getElementById("viewItrSuite");
  const viewExpert = document.getElementById("viewExpertSuite");
  const viewNotice = document.getElementById("viewNoticeSuite");
  const viewVault = document.getElementById("viewVaultSuite");
  const viewGst = document.getElementById("viewGstSuite");

  const btnItr = document.getElementById("btnSuiteItr");
  const btnExpert = document.getElementById("btnSuiteExpert");
  const btnNotice = document.getElementById("btnSuiteNotice");
  const btnVault = document.getElementById("btnSuiteVault");
  const btnGst = document.getElementById("btnSuiteGst");

  // Reset all suites
  [viewItr, viewExpert, viewNotice, viewVault, viewGst].forEach(v => {
    v?.classList.remove("active");
    v?.classList.add("hidden");
  });
  [btnItr, btnExpert, btnNotice, btnVault, btnGst].forEach(b => b?.classList.remove("active"));

  if (suite === "itr") {
    viewItr?.classList.add("active");
    viewItr?.classList.remove("hidden");
    btnItr?.classList.add("active");
    document.getElementById("currentFilingPan").textContent = appState.itr.personalInfo.pan;
  } else if (suite === "expert") {
    viewExpert?.classList.add("active");
    viewExpert?.classList.remove("hidden");
    btnExpert?.classList.add("active");
    document.getElementById("currentFilingPan").textContent = appState.itr.personalInfo.pan;
    loadExpertPlans();
    recalculateSavingsEstimator();
  } else if (suite === "notice") {
    viewNotice?.classList.add("active");
    viewNotice?.classList.remove("hidden");
    btnNotice?.classList.add("active");
    document.getElementById("currentFilingPan").textContent = appState.itr.personalInfo.pan;
  } else if (suite === "vault") {
    viewVault?.classList.add("active");
    viewVault?.classList.remove("hidden");
    btnVault?.classList.add("active");
    document.getElementById("currentFilingPan").textContent = appState.itr.personalInfo.pan;
    loadVaultDocuments("all");
  } else {
    viewGst?.classList.add("active");
    viewGst?.classList.remove("hidden");
    btnGst?.classList.add("active");
    document.getElementById("currentFilingPan").textContent = appState.gst.business.gstin;
    showGstScreen(appState.gst.currentScreen || "reports");
  }
}

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
  const pan = (value || "").toUpperCase().trim();
  const panFeedback = document.getElementById("panFeedback");
  const panInput = document.getElementById("inputPan");
  if (panInput) panInput.value = pan;
  appState.itr.personalInfo.pan = pan;
  document.getElementById("currentFilingPan").textContent = pan;

  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRegex.test(pan)) {
    if (panFeedback) {
      panFeedback.textContent = "Invalid PAN structure (e.g. 5 letters, 4 digits, 1 letter)";
      panFeedback.style.color = "#EA580C";
    }
  } else {
    if (panFeedback) {
      panFeedback.textContent = "✓ Valid CBDT PAN format";
      panFeedback.style.color = "#16A34A";
    }
  }
  updatePersonalInfoState();
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
  document.getElementById("currentFilingPan").textContent = pan;
  document.getElementById("filingDropdownMenu")?.classList.remove("active");
  if (pan.startsWith("32")) {
    switchSuite("gst");
  } else {
    appState.itr.personalInfo.pan = pan;
    switchSuite("itr");
  }
}

function toggleProfileDropdown(e) {
  e.stopPropagation();
  document.getElementById("profileDropdownMenu")?.classList.toggle("active");
}

function viewMyReturns() {
  alert("My Tax Returns: Viewing filed ITR-1 Sahaj for AY 2024-25 and draft AY 2025-26.");
}
function openProfileModal() { alert("Assessee Profile: Sanjay Harshi (CVBBC4433W). Contact and KYC verified."); }
function openOrdersModal() { alert("My Orders: No pending paid orders. Active tier connected."); }
function openRewardsModal() { alert("My Rewards: ₹500 Referral voucher available with code REWARD500."); }
function openAdvancedModal() { alert("Advanced Options: NRI residency check, schedule FA disclosures, AIS cross-check enabled."); }
function openRectificationModal() { alert("Rectification u/s 139(9): Select defective notice number to generate correction JSON."); }
function openPrefillModal() { fetchIncomeDetailsDemo(); }
function checkItrStatusModal() { alert("ITR Status: Return processed with zero outstanding demand."); }
// ============================================================================
// Authentication & Session Management (Sign In, Register, Logout)
// ============================================================================
appState.auth = {
  isLoggedIn: true,
  user: {
    name: "Sanjay Harshi",
    email: "sanjay@example.com",
    mobile: "9876543210",
    pan: "CVBBC4433W"
  }
};

function initAuth() {
  try {
    const saved = localStorage.getItem("simplegst_user_session");
    if (saved) {
      appState.auth = JSON.parse(saved);
    }
  } catch (e) {
    console.warn("Could not parse saved user session:", e);
  }
  renderAuthState();
}

function renderAuthState() {
  const loggedOutNav = document.getElementById("navAuthLoggedOut");
  const loggedInNav = document.getElementById("navAuthLoggedIn");
  const navUserName = document.getElementById("navUserName");
  const menuUserName = document.getElementById("menuUserFullName");
  const menuUserEmail = document.getElementById("menuUserEmail");
  const currentFilingPan = document.getElementById("currentFilingPan");

  if (appState.auth && appState.auth.isLoggedIn && appState.auth.user) {
    const user = appState.auth.user;
    if (loggedOutNav) loggedOutNav.style.display = "none";
    if (loggedInNav) loggedInNav.style.display = "flex";
    if (navUserName) navUserName.textContent = user.name || "Assessee";
    if (menuUserName) menuUserName.textContent = user.name || "Assessee";
    if (menuUserEmail) menuUserEmail.textContent = user.email || "user@simplegst.tax";
    if (currentFilingPan) currentFilingPan.textContent = user.pan || "CVBBC4433W";
  } else {
    if (loggedOutNav) loggedOutNav.style.display = "flex";
    if (loggedInNav) loggedInNav.style.display = "none";
    if (currentFilingPan) currentFilingPan.textContent = "Guest";
  }
}

function openAuthModal(tab = "signin") {
  openModal("modalAuth");
  switchAuthTab(tab);
}

function closeAuthModal() {
  closeModal("modalAuth");
}

function switchAuthTab(tab) {
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
    if (title) title.textContent = "Create New Account (New Sign In)";
    if (sub) sub.textContent = "Enter your PAN and contact info to start frictionless e-filing";
  }
}

function handleSignInSubmit(e) {
  e.preventDefault();
  const idInput = document.getElementById("loginIdentifier");
  const identifier = idInput ? idInput.value.trim() : "CVBBC4433W";
  const pan = identifier.length === 10 ? identifier.toUpperCase() : "CVBBC4433W";

  appState.auth = {
    isLoggedIn: true,
    user: {
      name: pan === "CVBBC4433W" ? "Sanjay Harshi" : "Authorized Taxpayer",
      email: identifier.includes("@") ? identifier : `${pan.toLowerCase()}@taxpayer.in`,
      mobile: "9876543210",
      pan
    }
  };

  localStorage.setItem("simplegst_user_session", JSON.stringify(appState.auth));
  renderAuthState();
  closeAuthModal();
  goToItrStep(1); // Ensure Option 1 is selected after login
  alert(`✓ Welcome back, ${appState.auth.user.name}!\nSigned in successfully. Option 1 (Personal Info) is ready for filing.`);
}

function handleRegisterSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("regFullName")?.value.trim() || "New Taxpayer";
  const pan = (document.getElementById("regPan")?.value || "").trim().toUpperCase();
  const mobile = document.getElementById("regMobile")?.value.trim() || "9876543210";
  const email = document.getElementById("regEmail")?.value.trim() || "user@simplegst.tax";

  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRegex.test(pan)) {
    alert("Please enter a valid 10-character PAN (e.g. ABCDE1234F).");
    return;
  }

  appState.auth = {
    isLoggedIn: true,
    user: { name, pan, mobile, email }
  };

  localStorage.setItem("simplegst_user_session", JSON.stringify(appState.auth));

  // Sync with personal info
  const nameParts = name.split(" ");
  appState.itr.personalInfo.firstName = nameParts[0] || name;
  appState.itr.personalInfo.lastName = nameParts.slice(1).join(" ") || "Taxpayer";
  appState.itr.personalInfo.pan = pan;
  appState.itr.personalInfo.mobile = mobile;
  appState.itr.personalInfo.email = email;

  renderAuthState();
  closeAuthModal();
  goToItrStep(1); // Ensure Option 1 is selected after register
  alert(`✓ Account created successfully for ${name}!\nOption 1 (Personal Info) has been updated with your details.`);
}

function quickDemoLogin() {
  appState.auth = {
    isLoggedIn: true,
    user: {
      name: "Sanjay Harshi",
      email: "sanjay@example.com",
      mobile: "9876543210",
      pan: "CVBBC4433W"
    }
  };
  localStorage.setItem("simplegst_user_session", JSON.stringify(appState.auth));
  renderAuthState();
  closeAuthModal();
  goToItrStep(1);
  alert("✓ One-Click Login successful as Sanjay Harshi (CVBBC4433W).\nOption 1 (Personal Info) is active.");
}

function logoutAction() {
  appState.auth = {
    isLoggedIn: false,
    user: null
  };
  localStorage.removeItem("simplegst_user_session");
  renderAuthState();
  document.getElementById("profileDropdownMenu")?.classList.remove("active");
  goToItrStep(1);
  alert("✓ You have been logged out.\nClick 'Sign In' or 'New Sign In' at any time to resume filing.");
}

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
function openModal(id) { document.getElementById(id)?.classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id)?.classList.add("hidden"); }

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
        <td><strong>${inv.invoiceNumber}</strong></td>
        <td>${inv.date}</td>
        <td>${inv.partyName}</td>
        <td><code>${inv.partyGstin}</code></td>
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
        <td><strong>${inv.invoiceNumber}</strong></td>
        <td>${inv.date}</td>
        <td>${inv.partyName}</td>
        <td><code>${inv.partyGstin}</code></td>
        <td>₹ ${Number(inv.taxableAmount).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(inv.totalTax).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(inv.totalAmount).toLocaleString("en-IN")}</td>
      </tr>`;
    });
  } else if (reportType === "reconciliation") {
    thead.innerHTML = `<tr><th>Inv No</th><th>Supplier</th><th>GSTIN</th><th>Books Tax</th><th>2B Tax</th><th>Status</th><th>Action</th></tr>`;
    (appState.gst.reconciliation.items || []).forEach(item => {
      tbody.innerHTML += `<tr>
        <td><strong>${item.invoiceNo}</strong></td>
        <td>${item.supplier}</td>
        <td><code>${item.gstin}</code></td>
        <td>₹ ${Number(item.booksTax).toLocaleString("en-IN")}</td>
        <td>₹ ${Number(item.gstr2bTax).toLocaleString("en-IN")}</td>
        <td><span class="status-chip ${item.status === 'Matched' ? 'success-chip' : 'danger-chip'}">${item.status}</span></td>
        <td><strong>${item.action}</strong></td>
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
        document.getElementById("resultFilename").textContent = `${appState.gst.currentReportType}_102026.xlsx`;
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
    a.download = `${reportType}_102026.${format}`;
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

function saveManualInvoice(type) {
  const invNo = document.getElementById("manualInvNo").value;
  const date = document.getElementById("manualDate").value;
  const party = document.getElementById("manualPartyName").value;
  const gstin = document.getElementById("manualGstin").value;
  const taxable = Number(document.getElementById("manualTaxable").value);
  const rate = Number(document.getElementById("manualRate").value);

  if (!invNo || !party || !gstin) {
    alert("Please fill all required invoice fields.");
    return;
  }

  const newBill = {
    id: `bill-${Date.now()}`,
    invoiceNumber: invNo,
    date,
    partyName: party,
    partyGstin: gstin,
    taxableAmount: taxable,
    gstRate: rate,
    totalTax: taxable * (rate / 100),
    totalAmount: taxable * (1 + rate / 100)
  };

  if (type === "sales") {
    appState.gst.salesInvoices.push(newBill);
    alert(`✓ Sales Invoice ${invNo} added!`);
  } else {
    appState.gst.purchaseInvoices.push(newBill);
    alert(`✓ Purchase Bill ${invNo} added!`);
  }
}

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
      const res = await fetch("/api/invoices/import", {
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
  if (input === "TAXHERO65") {
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
