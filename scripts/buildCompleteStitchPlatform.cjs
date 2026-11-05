const fs = require('fs');
const path = require('path');

const rootDir = 'C:/RE';
const stitchBase = path.join(rootDir, 'stitch_simplegst_compliance_platform/stitch_simplegst_compliance_platform');

function getScreenMain(folder) {
  const codePath = path.join(stitchBase, folder, 'code.html');
  if (!fs.existsSync(codePath)) {
    console.error('Missing code.html for:', folder);
    return '';
  }
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
    /class="[^"]*id="pmt-06-modal"/,
    'class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-sm hidden" id="pmt-06-modal" role="dialog" aria-modal="true" onclick="if (event.target === this) closePmt06Modal()"'
  );
  if (!modalHtml.includes('hidden')) {
    modalHtml = modalHtml.replace('id="pmt-06-modal"', 'id="pmt-06-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-sm hidden" role="dialog" aria-modal="true" onclick="if (event.target === this) closePmt06Modal()"');
  }

  // 2. Fix the X close button to call closePmt06Modal()
  modalHtml = modalHtml.replace('onclick="alert(\'Modal dismissal simulation.\')"', 'onclick="closePmt06Modal()"');
  modalHtml = modalHtml.replace('aria-label="Close Modal"', 'aria-label="Close Modal" onclick="closePmt06Modal()"');

  // 3. Fix Cancel button
  modalHtml = modalHtml.replace(
    />\s*Cancel\s*<\/button>/,
    ' onclick="closePmt06Modal()">Cancel</button>'
  );

  // 4. Fix Pay button
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
  
  let arnMain = m[0];
  // Replace static buttons with working action handlers
  arnMain = arnMain.replace(
    />\s*Return to Dashboard\s*<\/button>/,
    ' onclick="closeArnModal(); switchSuite(\'home\');">Return to Dashboard</button>'
  );
  arnMain = arnMain.replace(
    />\s*Download Signed PDF\s*<\/button>/,
    ' onclick="downloadFilingReceipt()">Download Signed PDF</button>'
  );
  arnMain = arnMain.replace(
    />\s*View in Ledgers\s*<\/button>/,
    ' onclick="closeArnModal(); switchSuite(\'gst\');">View in Ledgers</button>'
  );

  return `
  <!-- ========================================================================= -->
  <!-- MODAL: STATUTORY ARN FILING ACKNOWLEDGMENT                                -->
  <!-- ========================================================================= -->
  <div id="arn-success-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-sm hidden" role="dialog" aria-modal="true" onclick="if (event.target === this) closeArnModal()">
    <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl relative p-6">
      <div class="flex justify-between items-center pb-4 border-b border-outline-variant mb-4">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-2xl">verified</span>
          <span class="font-headline-sm font-bold text-on-surface">Statutory Filing Acknowledgment (ARN)</span>
        </div>
        <button onclick="closeArnModal()" aria-label="Close Acknowledgment Modal" class="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg cursor-pointer">
          <span class="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>
      <div class="arn-modal-content">
        ${arnMain}
      </div>
    </div>
  </div>`;
}

console.log('Extracting all 12 Stitch screens...');

const homeMain = getScreenMain('business_owner_home_dashboard');
const guidedFilingMain = getScreenMain('file_gst_guided_filing_nil_return_workflow');
const billsMain = getScreenMain('bills_documents_document_management_split_view_ocr_review');
const reconMain = getScreenMain('file_gst_gstr_2b_input_tax_credit_itc_reconciliation_engine');
const taxCalcMain = getScreenMain('file_gst_tax_calculation_final_gstr_3b_return_review');
const ledgersMain = getScreenMain('electronic_ledgers_comprehensive_gst_reports');
const caHubMain = getScreenMain('ca_practice_hub_client_management');
const healthMain = getScreenMain('gst_compliance_health_score_gst_copilot_studio');
const vendorHubMain = getScreenMain('bills_documents_vendor_communication_compliance_reminders_hub');
const onboardingMain = getScreenMain('business_onboarding_multi_gstin_management_hub');
const pmt06ModalHtml = getPmt06Modal();
const arnModalHtml = getArnModal();

console.log('Building Master Stitch Desktop Sidebar...');

const stitchSideNav = `
  <!-- ========================================================================= -->
  <!-- MASTER STITCH DESKTOP SIDEBAR & MOBILE DRAWER (SideNavBar)               -->
  <!-- ========================================================================= -->
  <!-- Mobile Backdrop Overlay -->
  <div id="sidebarBackdrop" onclick="toggleMobileSidebar()" class="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 hidden lg:hidden transition-opacity duration-300"></div>

  <!-- Standardized Stitch Side Navigation Bar -->
  <aside id="appSidebar" class="fixed top-0 left-0 bottom-0 w-64 bg-surface-container-lowest border-r border-outline-variant flex flex-col justify-between p-4 z-50 transform -translate-x-full lg:translate-x-0 transition-transform duration-300 ease-in-out shadow-sm">
    <div class="flex flex-col gap-5 overflow-y-auto">
      <!-- Brand Logo & Mobile Close -->
      <div class="flex items-center justify-between pb-3 border-b border-outline-variant">
        <div class="flex items-center gap-2.5 cursor-pointer" onclick="switchSuite('home')">
          <div class="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-on-primary shadow-sm">
            <span class="material-symbols-outlined text-2xl">account_balance</span>
          </div>
          <div class="flex flex-col">
            <span class="font-headline-sm font-bold tracking-tight text-on-surface">SimpleGST</span>
            <span class="font-label-sm text-[10px] text-primary font-semibold uppercase tracking-wider">Compliance OS</span>
          </div>
        </div>
        <!-- Mobile Drawer Close Button -->
        <button onclick="toggleMobileSidebar()" class="lg:hidden p-1.5 rounded-lg text-secondary hover:bg-surface-container transition-colors" title="Close Menu">
          <span class="material-symbols-outlined text-xl">close</span>
        </button>
      </div>

      <!-- Quick Filing Entity Switcher Card -->
      <div class="p-3 rounded-xl bg-surface-container-low border border-outline-variant flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <span class="font-label-sm text-secondary font-medium">Active GSTIN</span>
          <span class="w-2 h-2 rounded-full bg-primary" title="Active"></span>
        </div>
        <div class="font-mono text-xs font-bold text-on-surface truncate" id="sidebarGstinDisplay">27AAACA1234A1Z5</div>
        <div class="font-label-sm text-xs text-on-surface-variant truncate" id="sidebarEntityDisplay">Apex Retailers Pvt Ltd</div>
      </div>

      <!-- Primary Action CTA -->
      <button onclick="switchSuite('copilot')" class="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg shadow-sm hover:bg-primary-container active:scale-98 transition-all cursor-pointer">
        <span class="material-symbols-outlined text-[18px]">assignment_turned_in</span>
        <span>Quick File (Oct 2026)</span>
      </button>

      <!-- Navigation Destinations -->
      <nav class="flex flex-col gap-1" id="mainSidebarNav">
        <!-- 1. Home Dashboard -->
        <a id="nav-link-home" onclick="switchSuite('home'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl bg-surface-container-high text-primary font-bold border-l-4 border-primary transition-colors cursor-pointer" href="#home">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">dashboard</span>
            <span>Home</span>
          </div>
          <span class="w-2 h-2 rounded-full bg-primary"></span>
        </a>

        <!-- 2. File GST (Guided / Nil) -->
        <a id="nav-link-file-gst" onclick="switchSuite('copilot'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#file-gst">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">assignment_turned_in</span>
            <span>File GST</span>
          </div>
          <span class="font-label-sm text-[10px] bg-error-container text-on-error-container px-2 py-0.5 rounded-full font-semibold">Due Nov 20</span>
        </a>

        <!-- 3. Bills & OCR Review -->
        <a id="nav-link-bills" onclick="switchSuite('bills'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#bills-docs">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">receipt_long</span>
            <span>Bills & Docs</span>
          </div>
        </a>

        <!-- 4. GSTR-2B ITC Reconciliation -->
        <a id="nav-link-recon" onclick="switchSuite('recon'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#reconciliation">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">sync_alt</span>
            <span>Reconciliation</span>
          </div>
        </a>

        <!-- 5. Tax Calc & GSTR-3B -->
        <a id="nav-link-taxcalc" onclick="switchSuite('taxcalc'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#tax-calc">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">calculate</span>
            <span>Tax Calc (3B)</span>
          </div>
        </a>

        <!-- 6. Ledgers & Reports -->
        <a id="nav-link-reports" onclick="switchSuite('gst'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#reports">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">analytics</span>
            <span>Ledgers & Reports</span>
          </div>
        </a>

        <!-- 7. Compliance Health & Copilot -->
        <a id="nav-link-health" onclick="switchSuite('compliance'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#health-score">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">health_and_safety</span>
            <span>Compliance Health</span>
          </div>
        </a>

        <!-- 8. Vendor Communication -->
        <a id="nav-link-vendor" onclick="switchSuite('vendor'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#vendor-hub">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">mark_chat_unread</span>
            <span>Vendor Hub</span>
          </div>
        </a>

        <!-- 9. CA Practice Hub -->
        <a id="nav-link-practice" onclick="switchSuite('practice'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#ca-hub">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">group_work</span>
            <span>CA Practice Hub</span>
          </div>
          <span class="font-label-sm text-[10px] bg-secondary-container text-on-secondary-container px-1.5 py-0.5 rounded-full font-semibold">CA</span>
        </a>

        <!-- 10. Tax Experts Assistance -->
        <a id="nav-link-experts" onclick="switchSuite('expert'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#tax-experts">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">support_agent</span>
            <span>Tax Experts</span>
          </div>
        </a>

        <!-- 11. Multi-GSTIN & Settings -->
        <a id="nav-link-settings" onclick="switchSuite('startup'); return false;" class="sidebar-nav-link flex items-center justify-between px-3 py-2.5 rounded-xl text-on-surface-variant font-label-lg hover:bg-surface-container transition-colors cursor-pointer" href="#settings">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[20px]">settings</span>
            <span>Settings & Multi-GSTIN</span>
          </div>
        </a>
      </nav>
    </div>

    <!-- Bottom Compliance Status Pill & User Card -->
    <div class="pt-4 border-t border-outline-variant flex flex-col gap-3">
      <div class="flex items-center justify-between p-2 rounded-lg bg-surface border border-outline-variant text-xs">
        <span class="text-secondary">Statutory Status:</span>
        <span class="font-semibold text-primary flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-primary"></span> Active Clean
        </span>
      </div>
      <div class="flex items-center gap-3 px-1">
        <img class="w-8 h-8 rounded-full border border-outline-variant object-cover" alt="Rajesh Sharma" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC8vhD8OMV0nLIeOUrapK34uTdFHTpMK4j-gpAsiHxNbA1SHkADOqT3IFK8WDk2-rBoW-h-CAYYjg7n4iqzPt9ye5hbBTkHy6N2LbWsMrlDHmmRIPJZ_9fRUgs5NpNVb5RkgpG1dMS6zFdFPPqOwSH6UhlB-ZMBV2_oxN8iBxVgipbk6cLtou5D3hOzrKgm681Dh4PpdwhrKYmtIOk6mhzE97QED3GdpoyLGwinQ2o">
        <div class="flex flex-col truncate">
          <span class="font-label-md font-semibold text-on-surface text-xs truncate">Rajesh Sharma</span>
          <span class="font-label-sm text-secondary text-[11px]">Director</span>
        </div>
      </div>
    </div>
  </aside>
`;

console.log('Building Master Stitch Global Header...');

const stitchTopHeader = `
  <!-- ========================================================================= -->
  <!-- MASTER STITCH TOP GLOBAL HEADER (TopNavBar)                               -->
  <!-- ========================================================================= -->
  <header class="sticky top-0 z-40 h-16 w-full bg-surface-container-lowest border-b border-outline-variant px-4 sm:px-6 flex items-center justify-between shadow-sm">
    <div class="flex items-center gap-3">
      <!-- Mobile Hamburger Drawer Toggle -->
      <button onclick="toggleMobileSidebar()" class="lg:hidden p-2 -ml-2 rounded-xl text-on-surface hover:bg-surface-container focus:outline-none transition-colors cursor-pointer" title="Toggle Navigation Menu">
        <span class="material-symbols-outlined text-2xl">menu</span>
      </button>

      <!-- Business Entity & GSTIN Switcher -->
      <div class="relative">
        <button onclick="toggleFilingDropdown(event)" class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-outline-variant text-on-surface hover:bg-surface-container transition-colors cursor-pointer text-left">
          <span class="material-symbols-outlined text-primary text-[18px]">domain</span>
          <span class="font-label-lg font-semibold text-xs sm:text-sm" id="currentFilingEntityName">Apex Retailers Pvt Ltd</span>
          <span class="font-mono text-xs text-secondary hidden sm:inline" id="currentFilingPan">27AAACA1234A1Z5</span>
          <span class="material-symbols-outlined text-secondary text-[16px]">expand_more</span>
        </button>
        <!-- Filing Entity Dropdown -->
        <div id="filingDropdownMenu" class="filing-dropdown-menu hidden absolute top-full left-0 mt-2 w-72 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-xl z-50 p-2">
          <div class="p-2 text-xs font-semibold text-secondary uppercase tracking-wider">Select GSTIN Entity</div>
          <div class="filing-menu-item p-2.5 rounded-lg hover:bg-surface-container cursor-pointer transition-colors" onclick="selectFilingEntity('27AAACA1234A1Z5', 'Apex Retailers Pvt Ltd', 'Main Branch')">
            <div class="entity-pan font-mono font-bold text-xs text-primary">27AAACA1234A1Z5</div>
            <div class="entity-name text-xs text-on-surface">Apex Retailers Pvt Ltd • Maharashtra</div>
          </div>
          <div class="filing-menu-item p-2.5 rounded-lg hover:bg-surface-container cursor-pointer transition-colors" onclick="selectFilingEntity('29AAACB1234F1Z5', 'Bangalore Spice Mart', 'Karnataka Branch')">
            <div class="entity-pan font-mono font-bold text-xs text-primary">29AAACB1234F1Z5</div>
            <div class="entity-name text-xs text-on-surface">Bangalore Spice Mart • Karnataka Branch</div>
          </div>
          <div class="filing-menu-item p-2.5 rounded-lg hover:bg-surface-container cursor-pointer transition-colors" onclick="selectFilingEntity('32ABCDE1234F1Z5', 'Malabar Spice Traders', 'Kerala Branch')">
            <div class="entity-pan font-mono font-bold text-xs text-primary">32ABCDE1234F1Z5</div>
            <div class="entity-name text-xs text-on-surface">Malabar Spice Traders • Kerala Branch</div>
          </div>
        </div>
      </div>

      <!-- Active Filing Period Badge -->
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-label-md">
        <span class="material-symbols-outlined text-secondary text-[16px]">calendar_month</span>
        <span id="global-filing-period" class="font-medium text-xs sm:text-sm">Oct 2026</span>
        <span class="text-xs text-error font-semibold flex items-center gap-1 hidden xs:inline-flex">
          <span class="w-1.5 h-1.5 rounded-full bg-error"></span>Due Nov 20
        </span>
      </div>
    </div>

    <!-- Right Header Actions -->
    <div class="flex items-center gap-2 sm:gap-3">
      <!-- Role Switcher -->
      <div class="relative">
        <button onclick="toggleRoleMenu(event)" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container font-label-sm text-secondary hover:text-on-surface font-medium cursor-pointer transition-colors text-xs">
          <span id="currentUserRole">Business Owner</span>
          <span class="material-symbols-outlined text-[14px]">expand_more</span>
        </button>
        <div id="roleDropdownMenu" class="hidden absolute right-0 mt-2 w-48 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-xl z-50 p-1.5">
          <button onclick="switchRole('owner')" class="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-surface-container text-on-surface font-medium flex items-center gap-2 cursor-pointer">
            <span class="material-symbols-outlined text-[16px] text-primary">person</span> Business Owner
          </button>
          <button onclick="switchRole('ca')" class="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-surface-container text-on-surface font-medium flex items-center gap-2 cursor-pointer">
            <span class="material-symbols-outlined text-[16px] text-primary">account_balance</span> Chartered Accountant
          </button>
        </div>
      </div>

      <!-- Expert Help Shortcut Button -->
      <button onclick="switchSuite('expert')" aria-label="Expert Help" class="p-2 rounded-lg text-secondary hover:bg-surface-container hover:text-primary transition-colors cursor-pointer" title="CA Expert Help">
        <span class="material-symbols-outlined text-[20px]">support_agent</span>
      </button>

      <!-- Notifications Bell Button -->
      <button onclick="toggleNotificationDrawer()" aria-label="Notifications" class="relative p-2 rounded-lg text-secondary hover:bg-surface-container transition-colors cursor-pointer">
        <span class="material-symbols-outlined text-[20px]">notifications</span>
        <span class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-error"></span>
      </button>

      <!-- User Profile Dropdown -->
      <div class="relative pl-1 sm:pl-2">
        <button onclick="toggleProfileDropdown(event)" class="flex items-center gap-2 cursor-pointer focus:outline-none">
          <img class="w-8 h-8 rounded-full border border-outline-variant object-cover" alt="Rajesh Sharma" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC8vhD8OMV0nLIeOUrapK34uTdFHTpMK4j-gpAsiHxNbA1SHkADOqT3IFK8WDk2-rBoW-h-CAYYjg7n4iqzPt9ye5hbBTkHy6N2LbWsMrlDHmmRIPJZ_9fRUgs5NpNVb5RkgpG1dMS6zFdFPPqOwSH6UhlB-ZMBV2_oxN8iBxVgipbk6cLtou5D3hOzrKgm681Dh4PpdwhrKYmtIOk6mhzE97QED3GdpoyLGwinQ2o">
          <div class="hidden lg:flex flex-col text-left">
            <span class="font-label-md font-semibold text-on-surface leading-tight text-xs" id="navUserName">Rajesh Sharma</span>
            <span class="font-label-sm text-secondary text-[10px]">Director</span>
          </div>
        </button>
        <!-- Profile Dropdown Menu -->
        <div id="profileDropdownMenu" class="profile-dropdown-menu hidden absolute right-0 mt-2 w-64 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-xl z-50 p-2">
          <div class="p-3 border-b border-outline-variant bg-surface-container-low rounded-lg mb-2">
            <div class="font-bold text-xs text-on-surface" id="menuUserFullName">Rajesh Sharma</div>
            <div class="text-[11px] text-secondary" id="menuUserEmail">rajesh.sharma@apexretail.com</div>
          </div>
          <a href="#profile" onclick="openProfileModal(); return false;" class="profile-menu-link flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-on-surface hover:bg-surface-container cursor-pointer">
            <span class="material-symbols-outlined text-[16px]">account_circle</span> Profile & GSTIN Details
          </a>
          <a href="#returns" onclick="viewMyReturns(); return false;" class="profile-menu-link flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-on-surface hover:bg-surface-container cursor-pointer">
            <span class="material-symbols-outlined text-[16px]">receipt_long</span> My GST Returns & History
          </a>
          <a href="#settings" onclick="switchSuite('startup'); return false;" class="profile-menu-link flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-on-surface hover:bg-surface-container cursor-pointer">
            <span class="material-symbols-outlined text-[16px]">settings</span> Multi-GSTIN & Settings
          </a>
          <div class="border-t border-outline-variant my-1"></div>
          <button onclick="logoutAction()" class="w-full text-left flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-error hover:bg-error-container/20 font-semibold cursor-pointer">
            <span class="material-symbols-outlined text-[16px]">logout</span> Log Out
          </button>
        </div>
      </div>
    </div>
  </header>
`;

console.log('Building Master Stitch Mobile Bottom Navigation...');

const stitchBottomNav = `
  <!-- ========================================================================= -->
  <!-- MASTER STITCH 5-ITEM MOBILE BOTTOM NAVIGATION (BottomNavBar)              -->
  <!-- ========================================================================= -->
  <nav id="appBottomNav" class="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-surface-container-lowest border-t border-outline-variant z-40 flex items-center justify-around px-2 shadow-lg">
    <button id="bottom-nav-home" onclick="switchSuite('home')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-primary font-bold transition-colors p-1.5 cursor-pointer">
      <span class="material-symbols-outlined text-[20px]">dashboard</span>
      <span class="text-[10px]">Home</span>
    </button>
    <button id="bottom-nav-file-gst" onclick="switchSuite('copilot')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-secondary hover:text-primary transition-colors p-1.5 cursor-pointer">
      <span class="material-symbols-outlined text-[20px]">assignment_turned_in</span>
      <span class="text-[10px]">File GST</span>
    </button>
    <button id="bottom-nav-bills" onclick="switchSuite('bills')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-secondary hover:text-primary transition-colors p-1.5 cursor-pointer">
      <span class="material-symbols-outlined text-[20px]">receipt_long</span>
      <span class="text-[10px]">Bills</span>
    </button>
    <button id="bottom-nav-reports" onclick="switchSuite('gst')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-secondary hover:text-primary transition-colors p-1.5 cursor-pointer">
      <span class="material-symbols-outlined text-[20px]">analytics</span>
      <span class="text-[10px]">Reports</span>
    </button>
    <button id="bottom-nav-experts" onclick="switchSuite('expert')" class="bottom-nav-btn flex flex-col items-center gap-0.5 text-secondary hover:text-primary transition-colors p-1.5 cursor-pointer">
      <span class="material-symbols-outlined text-[20px]">support_agent</span>
      <span class="text-[10px]">Experts</span>
    </button>
  </nav>
`;

// Read the existing index.html head section (styles, meta, fonts)
const originalHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const headEndIdx = originalHtml.indexOf('</head>');
const headContent = originalHtml.substring(0, headEndIdx + 7);

// Extract existing modals that are not in stitch (Auth modal, Profile modal, Orders modal, Support drawer)
function extractExistingBlock(id) {
  const start = originalHtml.indexOf(`id="${id}"`);
  if (start < 0) return '';
  const divStart = originalHtml.lastIndexOf('<div', start);
  // find closing div matching
  let depth = 0;
  let idx = divStart;
  while (idx < originalHtml.length) {
    if (originalHtml.substring(idx, idx + 4) === '<div') {
      depth++;
      idx += 4;
    } else if (originalHtml.substring(idx, idx + 6) === '</div>') {
      depth--;
      idx += 6;
      if (depth === 0) {
        return originalHtml.substring(divStart, idx);
      }
    } else {
      idx++;
    }
  }
  return '';
}

const authModalHtml = extractExistingBlock('authModal');
const profileModalHtml = extractExistingBlock('profileModal');
const expertModalHtml = extractExistingBlock('expertAssistedModal');

// Extract existing secondary suites for continuity (Expert, Notice, Vault)
function extractSuiteBlock(id) {
  const start = originalHtml.indexOf(`id="${id}"`);
  if (start < 0) return '';
  const divStart = originalHtml.lastIndexOf('<div', start);
  let depth = 0;
  let idx = divStart;
  while (idx < originalHtml.length) {
    if (originalHtml.substring(idx, idx + 4) === '<div') {
      depth++;
      idx += 4;
    } else if (originalHtml.substring(idx, idx + 6) === '</div>') {
      depth--;
      idx += 6;
      if (depth === 0) {
        return originalHtml.substring(divStart, idx);
      }
    } else {
      idx++;
    }
  }
  return '';
}

const expertSuiteHtml = extractSuiteBlock('viewExpertSuite');
const noticeSuiteHtml = extractSuiteBlock('viewNoticeSuite');
const vaultSuiteHtml = extractSuiteBlock('viewVaultSuite');

// Assemble the unified, flawless HTML
const finalHtml = `${headContent}
<body class="bg-surface text-on-surface antialiased font-sans flex min-h-screen">

  ${stitchSideNav}

  <!-- Main Content Canvas Wrapper (Offset by 256px on Desktop) -->
  <div id="stitchMainWrapper" class="lg:pl-64 flex flex-col flex-1 min-w-0 pb-16 lg:pb-0">
    
    ${stitchTopHeader}

    <!-- ========================================================================= -->
    <!-- 1. HOME DASHBOARD SUITE (Stitch Screen 1)                                -->
    <!-- ========================================================================= -->
    <div id="viewHomeSuite" class="app-suite-container active">
      ${homeMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 2. GUIDED GST FILING & NIL RETURN SUITE (Stitch Screen 2)                -->
    <!-- ========================================================================= -->
    <div id="viewCopilotSuite" class="app-suite-container hidden">
      ${guidedFilingMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 3. BILLS & OCR SPLIT-VIEW REVIEW SUITE (Stitch Screen 3)                 -->
    <!-- ========================================================================= -->
    <div id="viewBillsSuite" class="app-suite-container hidden">
      ${billsMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 4. GSTR-2B ITC RECONCILIATION ENGINE SUITE (Stitch Screen 4)             -->
    <!-- ========================================================================= -->
    <div id="viewReconSuite" class="app-suite-container hidden">
      ${reconMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 5. TAX CALCULATION & GSTR-3B REVIEW SUITE (Stitch Screen 5)              -->
    <!-- ========================================================================= -->
    <div id="viewTaxCalcSuite" class="app-suite-container hidden">
      ${taxCalcMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 6. ELECTRONIC LEDGERS & REPORTS SUITE (Stitch Screen 6)                  -->
    <!-- ========================================================================= -->
    <div id="viewGstSuite" class="app-suite-container hidden">
      ${ledgersMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 7. CA PRACTICE HUB CLIENT MANAGEMENT SUITE (Stitch Screen 7)             -->
    <!-- ========================================================================= -->
    <div id="viewPracticeSuite" class="app-suite-container hidden">
      ${caHubMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 8. COMPLIANCE HEALTH SCORE & COPILOT STUDIO (Stitch Screen 8)            -->
    <!-- ========================================================================= -->
    <div id="viewComplianceSuite" class="app-suite-container hidden">
      ${healthMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 9. VENDOR COMMUNICATION & COMPLIANCE HUB (Stitch Screen 9)               -->
    <!-- ========================================================================= -->
    <div id="viewVendorSuite" class="app-suite-container hidden">
      ${vendorHubMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 10. MULTI-GSTIN & BUSINESS ONBOARDING (Stitch Screen 12)                 -->
    <!-- ========================================================================= -->
    <div id="viewStartupSuite" class="app-suite-container hidden">
      ${onboardingMain}
    </div>

    <!-- ========================================================================= -->
    <!-- 11. TAX EXPERTS CONSULTATION & ASSISTED FILING                            -->
    <!-- ========================================================================= -->
    ${expertSuiteHtml ? expertSuiteHtml.replace('active', 'hidden') : ''}

    <!-- ========================================================================= -->
    <!-- 12. DEPARTMENT NOTICES & AUDIT DEFENSE                                    -->
    <!-- ========================================================================= -->
    ${noticeSuiteHtml ? noticeSuiteHtml.replace('active', 'hidden') : ''}

    <!-- ========================================================================= -->
    <!-- 13. STATUTORY DOCUMENT VAULT                                              -->
    <!-- ========================================================================= -->
    ${vaultSuiteHtml ? vaultSuiteHtml.replace('active', 'hidden') : ''}

    <!-- ========================================================================= -->
    <!-- MODALS & OVERLAYS                                                         -->
    <!-- ========================================================================= -->
    ${pmt06ModalHtml}
    ${arnModalHtml}
    ${authModalHtml}
    ${profileModalHtml}
    ${expertModalHtml}

    ${stitchBottomNav}

  </div> <!-- Close stitchMainWrapper -->

  <script src="/app.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(rootDir, 'index.html'), finalHtml, 'utf8');
console.log('index.html written successfully, length:', finalHtml.length);

fs.writeFileSync(path.join(rootDir, 'public/index.html'), finalHtml, 'utf8');
console.log('public/index.html written successfully, length:', finalHtml.length);

