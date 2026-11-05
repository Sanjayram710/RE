const fs = require('fs');
const path = require('path');

const rootDir = 'C:/RE';
const stitchBase = path.join(rootDir, 'stitch_simplegst_compliance_platform/stitch_simplegst_compliance_platform');

function getScreenMain(folder) {
  const codePath = path.join(stitchBase, folder, 'code.html');
  if (!fs.existsSync(codePath)) return '';
  const html = fs.readFileSync(codePath, 'utf8');
  const m = html.match(/<main[\s\S]*?<\/main>/i);
  return m ? m[0] : '';
}

function getPmt06Modal() {
  const codePath = path.join(stitchBase, 'file_gst_form_gst_pmt_06_challan_generation_payment_modal', 'code.html');
  if (!fs.existsSync(codePath)) return '';
  const html = fs.readFileSync(codePath, 'utf8');
  const idx = html.indexOf('id="pmt-06-modal"');
  if (idx < 0) return '';
  const start = html.lastIndexOf('<div', idx);
  const endModal = html.indexOf('</body>', idx);
  let modalHtml = endModal > 0 ? html.substring(start, endModal) : html.substring(start);

  // 1. Ensure modal is hidden by default and backdrop dismisses
  modalHtml = modalHtml.replace(
    'class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-sm" id="pmt-06-modal"',
    'class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-sm hidden" id="pmt-06-modal" onclick="if (event.target === this) closePmt06Modal()"'
  );

  // 2. Fix the X close button to call closePmt06Modal()
  modalHtml = modalHtml.replace('onclick="alert(\'Modal dismissal simulation.\')"', 'onclick="closePmt06Modal()"');

  // 3. Fix the Cancel button
  modalHtml = modalHtml.replace(
    'class="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-outline-variant hover:bg-surface-container text-on-surface font-label-md text-label-md transition-colors cursor-pointer active:scale-98" type="button">\\n              Cancel',
    'class="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-outline-variant hover:bg-surface-container text-on-surface font-label-md text-label-md transition-colors cursor-pointer active:scale-98" onclick="closePmt06Modal()" type="button">\\n              Cancel'
  );

  // 4. Fix the Pay button
  modalHtml = modalHtml.replace(
    /onclick="alert\('Sandbox Transaction Approved[^"]+"\)/,
    'onclick="submitChallanPayment()"'
  );

  return modalHtml;
}

function getArnModal() {
  const codePath = path.join(stitchBase, 'file_gst_post_filing_success_arn_statutory_acknowledgment', 'code.html');
  if (!fs.existsSync(codePath)) return '';
  const html = fs.readFileSync(codePath, 'utf8');
  const m = html.match(/<main[\s\S]*?<\/main>/i);
  if (!m) return '';
  return `
  <div id="arn-success-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-sm hidden" role="dialog" aria-modal="true">
    <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl relative p-6">
      <div class="flex justify-between items-center pb-4 border-b border-outline-variant mb-4">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-2xl">verified</span>
          <span class="font-headline-sm font-bold text-on-surface">Statutory Filing Acknowledgment (ARN)</span>
        </div>
        <button onclick="closeArnModal()" class="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg">
          <span class="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>
      <div class="arn-modal-content">
        ${m[0]}
      </div>
    </div>
  </div>`;
}

console.log('Building Unified Stitch App Integration...');

// 1. Read existing index.html
const indexHtmlPath = path.join(rootDir, 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// 2. Read Stitch Screen Main sections
const homeMain = getScreenMain('business_owner_home_dashboard');
const nilGuidedMain = getScreenMain('file_gst_guided_filing_nil_return_workflow');
const billsMain = getScreenMain('bills_documents_document_management_split_view_ocr_review');
const reconMain = getScreenMain('file_gst_gstr_2b_input_tax_credit_itc_reconciliation_engine');
const taxCalcMain = getScreenMain('file_gst_tax_calculation_final_gstr_3b_return_review');
const ledgersMain = getScreenMain('electronic_ledgers_comprehensive_gst_reports');
const healthMain = getScreenMain('gst_compliance_health_score_gst_copilot_studio');
const caHubMain = getScreenMain('ca_practice_hub_client_management');
const vendorHubMain = getScreenMain('bills_documents_vendor_communication_compliance_reminders_hub');
const onboardingMain = getScreenMain('business_onboarding_multi_gstin_management_hub');
const pmt06Modal = getPmt06Modal();
const arnModal = getArnModal();

console.log('All screens extracted.');

// 3. Prepare Stitch Head elements (Fonts + Tailwind)
const stitchHeadScripts = `
  <!-- Google Fonts: Plus Jakarta Sans, Inter & Material Symbols Outlined -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
  <script id="tailwind-config">
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            "primary": "#00685f",
            "primary-container": "#008378",
            "on-primary": "#ffffff",
            "on-primary-container": "#f4fffc",
            "surface": "#f8f9ff",
            "surface-dim": "#cbdbf5",
            "surface-bright": "#f8f9ff",
            "surface-container-lowest": "#ffffff",
            "surface-container-low": "#eff4ff",
            "surface-container": "#e5eeff",
            "surface-container-high": "#dce9ff",
            "surface-container-highest": "#d3e4fe",
            "on-surface": "#0b1c30",
            "on-surface-variant": "#3d4947",
            "secondary": "#565e74",
            "secondary-container": "#dae2fd",
            "on-secondary": "#ffffff",
            "on-secondary-container": "#5c647a",
            "tertiary": "#4b41e1",
            "tertiary-container": "#645efb",
            "on-tertiary": "#ffffff",
            "error": "#ba1a1a",
            "error-container": "#ffdad6",
            "on-error": "#ffffff",
            "outline": "#6d7a77",
            "outline-variant": "#bcc9c6"
          },
          fontFamily: {
            "display-lg": ["Plus Jakarta Sans"],
            "headline-lg": ["Plus Jakarta Sans"],
            "headline-md": ["Plus Jakarta Sans"],
            "headline-sm": ["Plus Jakarta Sans"],
            "body-lg": ["Inter"],
            "body-md": ["Inter"],
            "body-sm": ["Inter"],
            "label-lg": ["Inter"],
            "label-md": ["Inter"],
            "label-sm": ["Inter"]
          }
        }
      }
    };
  </script>
`;

// Inject into head if not present
if (!indexHtml.includes('cdn.tailwindcss.com')) {
  indexHtml = indexHtml.replace('</head>', `${stitchHeadScripts}\n</head>`);
}

// 4. Construct Stitch SideNav
const stitchSideNav = `
  <!-- ========================================================================= -->
  <!-- STITCH RESPONSIVE SIDENAV (Fixed Desktop lg:block, Slide Drawer on Mobile)  -->
  <!-- ========================================================================= -->
  <aside id="appSidebar" class="stitch-sidebar fixed left-0 top-0 h-screen w-64 flex flex-col justify-between p-4 z-50 bg-surface-container-lowest border-r border-outline-variant transition-transform duration-200 ease-in-out select-none -translate-x-full lg:translate-x-0">
    <div class="flex flex-col gap-5">
      <!-- Platform Emblem & Brand -->
      <div class="flex items-center justify-between px-2 pt-1">
        <div class="flex items-center gap-2.5 cursor-pointer" onclick="switchSuite('home')">
          <div class="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center font-bold shadow-sm">
            <span class="material-symbols-outlined text-[24px]">account_balance</span>
          </div>
          <div class="flex flex-col">
            <span class="font-headline-sm text-headline-sm font-bold text-primary tracking-tight">SimpleGST</span>
            <span class="font-label-sm text-label-sm text-secondary">Enterprise Compliance</span>
          </div>
        </div>
        <!-- Mobile Close Drawer Button -->
        <button onclick="closeMobileSidebar()" class="lg:hidden p-1.5 rounded-lg text-secondary hover:bg-surface-container text-on-surface">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <!-- Quick Action CTA: + File GST Return -->
      <div class="px-1">
        <button onclick="switchSuite('copilot')" class="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg shadow-sm hover:bg-primary-container active:scale-98 transition-all cursor-pointer">
          <span class="material-symbols-outlined text-[18px]">add_circle</span>
          <span>File GST Return</span>
        </button>
      </div>

      <!-- Primary Navigation Links Stack -->
      <nav class="flex flex-col gap-1 overflow-y-auto max-h-[calc(100vh-270px)] pr-1 custom-scrollbar">
        <div class="px-3 pt-1 pb-1 font-label-sm text-[11px] text-secondary uppercase tracking-wider font-bold">Core Workflow</div>
        
        <!-- Home -->
        <a id="nav-link-home" onclick="switchSuite('home'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#home">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">dashboard</span>
            <span>Home</span>
          </div>
        </a>

        <!-- File GST (Active Return Assistant) -->
        <a id="nav-link-file-gst" onclick="switchSuite('copilot'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl bg-surface-container-high text-primary font-bold border-l-4 border-primary transition-colors cursor-pointer" href="#file-gst">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]" style="font-variation-settings: 'FILL' 1;">assignment_turned_in</span>
            <span>File GST</span>
          </div>
          <span class="font-label-sm text-[11px] bg-error-container text-on-error-container px-2 py-0.5 rounded-full font-bold">Due Nov 20</span>
        </a>

        <!-- Bills & Docs (Split-View OCR Review) -->
        <a id="nav-link-bills" onclick="switchSuite('bills'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#bills-docs">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">receipt_long</span>
            <span>Bills & Docs</span>
          </div>
          <span class="font-label-sm text-[11px] bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full font-semibold">OCR</span>
        </a>

        <!-- Reports & Ledgers -->
        <a id="nav-link-reports" onclick="switchSuite('gst'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#reports">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">analytics</span>
            <span>Reports & Ledgers</span>
          </div>
        </a>

        <div class="px-3 pt-3 pb-1 font-label-sm text-[11px] text-secondary uppercase tracking-wider font-bold">Management & Advisory</div>

        <!-- Compliance Health Score -->
        <a id="nav-link-health" onclick="switchSuite('compliance'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#health-score">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">verified_user</span>
            <span>Health & Copilot</span>
          </div>
          <span class="font-label-sm text-[11px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">94/100</span>
        </a>

        <!-- Tax Experts (Assisted CA Filing) -->
        <a id="nav-link-experts" onclick="switchSuite('expert'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#tax-experts">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">support_agent</span>
            <span>Tax Experts</span>
          </div>
          <span class="font-label-sm text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">Free Trial</span>
        </a>

        <!-- CA Practice Hub -->
        <a id="nav-link-ca-hub" onclick="openPracticeModal(); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#ca-hub">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">domain</span>
            <span>CA Practice Hub</span>
          </div>
        </a>

        <!-- Settings & Multi-GSTIN Hub -->
        <a id="nav-link-settings" onclick="switchSuite('startup'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#settings">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">settings</span>
            <span>Multi-GSTIN</span>
          </div>
        </a>
      </nav>
    </div>

    <!-- Sidebar Bottom Entity Card -->
    <div class="flex flex-col gap-2 pt-3 border-t border-outline-variant">
      <div onclick="toggleFilingDropdown(event)" class="p-2.5 rounded-xl bg-surface-container-low border border-outline-variant flex items-center justify-between hover:bg-surface-container transition-colors cursor-pointer">
        <div class="flex items-center gap-2.5 truncate">
          <div class="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center font-bold text-xs shrink-0">
            AP
          </div>
          <div class="truncate">
            <p class="font-label-md text-label-md font-bold text-on-surface truncate">Apex Retailers Pvt Ltd</p>
            <p class="font-label-sm text-[11px] text-secondary font-mono truncate">27AAACA1234A1Z5</p>
          </div>
        </div>
        <span class="material-symbols-outlined text-secondary text-[18px] shrink-0">unfold_more</span>
      </div>
    </div>
  </aside>

  <!-- Mobile Drawer Backdrop -->
  <div id="mobileDrawerBackdrop" onclick="closeMobileSidebar()" class="fixed inset-0 bg-slate-900/60 z-40 hidden lg:hidden backdrop-blur-xs transition-opacity duration-200"></div>
`;

// 5. Construct Mobile Sticky Bottom Navigation Bar
const stitchBottomNav = `
  <!-- ========================================================================= -->
  <!-- MOBILE STICKY BOTTOM NAVIGATION BAR (Visible on < 768px for 1-Thumb Nav)   -->
  <!-- ========================================================================= -->
  <nav id="mobileBottomNav" class="fixed bottom-0 inset-x-0 z-40 bg-surface-container-lowest border-t border-outline-variant py-1.5 flex justify-around items-center lg:hidden shadow-lg backdrop-blur-md">
    <button id="bottom-nav-home" onclick="switchSuite('home')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-secondary hover:text-primary transition-colors p-1.5">
      <span class="material-symbols-outlined text-[20px]">dashboard</span>
      <span class="text-[10px] font-semibold">Home</span>
    </button>
    <button id="bottom-nav-file-gst" onclick="switchSuite('copilot')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-primary font-bold transition-colors p-1.5">
      <span class="material-symbols-outlined text-[20px]" style="font-variation-settings: 'FILL' 1;">assignment_turned_in</span>
      <span class="text-[10px] font-bold">File GST</span>
    </button>
    <button id="bottom-nav-bills" onclick="switchSuite('bills')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-secondary hover:text-primary transition-colors p-1.5">
      <span class="material-symbols-outlined text-[20px]">receipt_long</span>
      <span class="text-[10px] font-semibold">Bills</span>
    </button>
    <button id="bottom-nav-reports" onclick="switchSuite('gst')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-secondary hover:text-primary transition-colors p-1.5">
      <span class="material-symbols-outlined text-[20px]">analytics</span>
      <span class="text-[10px] font-semibold">Reports</span>
    </button>
    <button id="bottom-nav-experts" onclick="switchSuite('expert')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-secondary hover:text-primary transition-colors p-1.5">
      <span class="material-symbols-outlined text-[20px]">support_agent</span>
      <span class="text-[10px] font-semibold">Experts</span>
    </button>
  </nav>
`;

// 6. Wrap stitch screens in suite containers
const stitchHomeSuiteHtml = `
  <!-- ========================================================================= -->
  <!-- SUITE: HOME DASHBOARD (Stitch Screen 1)                                   -->
  <!-- ========================================================================= -->
  <div id="viewHomeSuite" class="app-suite-container hidden">
    ${homeMain}
  </div>
`;

const stitchBillsSuiteHtml = `
  <!-- ========================================================================= -->
  <!-- SUITE: BILLS & DOCS SPLIT-VIEW OCR REVIEW (Stitch Screen 3)               -->
  <!-- ========================================================================= -->
  <div id="viewBillsSuite" class="app-suite-container hidden">
    ${billsMain}
  </div>
`;

const stitchReconSuiteHtml = `
  <!-- ========================================================================= -->
  <!-- SUITE: GSTR-2B ITC RECONCILIATION ENGINE (Stitch Screen 4)               -->
  <!-- ========================================================================= -->
  <div id="viewReconSuite" class="app-suite-container hidden">
    ${reconMain}
  </div>
`;

const stitchTaxCalcSuiteHtml = `
  <!-- ========================================================================= -->
  <!-- SUITE: TAX CALCULATION & GSTR-3B REVIEW (Stitch Screen 5)                -->
  <!-- ========================================================================= -->
  <div id="viewTaxCalcSuite" class="app-suite-container hidden">
    ${taxCalcMain}
  </div>
`;

const stitchPracticeSuiteHtml = `
  <!-- ========================================================================= -->
  <!-- SUITE: CA PRACTICE HUB CLIENT MANAGEMENT (Stitch Screen 8)               -->
  <!-- ========================================================================= -->
  <div id="viewPracticeSuite" class="app-suite-container hidden">
    ${caHubMain}
  </div>
`;

const stitchVendorSuiteHtml = `
  <!-- ========================================================================= -->
  <!-- SUITE: VENDOR COMMUNICATION & COMPLIANCE HUB (Stitch Screen 11)          -->
  <!-- ========================================================================= -->
  <div id="viewVendorSuite" class="app-suite-container hidden">
    ${vendorHubMain}
  </div>
`;

// Insert SideNav and BottomNav into index.html
if (!indexHtml.includes('id="appSidebar"')) {
  // Insert sidebar right after <body> tag
  indexHtml = indexHtml.replace('<body>', `<body>\n${stitchSideNav}`);
}

// Add hamburger button to the header navbar-header if not present
if (!indexHtml.includes('toggleMobileSidebar()')) {
  const hamburgerBtn = `
    <!-- Mobile Hamburger Drawer Toggle -->
    <button onclick="toggleMobileSidebar()" class="lg:hidden p-2 mr-2 rounded-xl text-on-surface hover:bg-surface-container focus:outline-none transition-colors" title="Toggle Menu">
      <span class="material-symbols-outlined text-2xl">menu</span>
    </button>
  `;
  indexHtml = indexHtml.replace('<div class="navbar-brand"', `${hamburgerBtn}\n        <div class="navbar-brand"`);
}

// Insert desktop offset wrapper around main canvas if not present
if (!indexHtml.includes('id="stitchMainWrapper"')) {
  indexHtml = indexHtml.replace('<header class="navbar-header">', `<div id="stitchMainWrapper" class="lg:pl-64 flex flex-col flex-1 min-w-0 pb-16 lg:pb-0">\n<header class="navbar-header">`);
}

// Insert the new suite views right before the existing modals or before </body>
const newSuitesHtml = `
  ${stitchHomeSuiteHtml}
  ${stitchBillsSuiteHtml}
  ${stitchReconSuiteHtml}
  ${stitchTaxCalcSuiteHtml}
  ${stitchPracticeSuiteHtml}
  ${stitchVendorSuiteHtml}
  ${pmt06Modal}
  ${arnModal}
  ${stitchBottomNav}
  </div> <!-- Close stitchMainWrapper -->
`;

if (!indexHtml.includes('id="viewHomeSuite"')) {
  indexHtml = indexHtml.replace('</body>', `${newSuitesHtml}\n</body>`);
}

// Write back updated index.html
fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
console.log('Updated index.html successfully.');

// Write to public/index.html as well
const publicIndexHtmlPath = path.join(rootDir, 'public/index.html');
fs.writeFileSync(publicIndexHtmlPath, indexHtml, 'utf8');
console.log('Updated public/index.html successfully.');
