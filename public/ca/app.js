import { apiRequest, setCsrfToken } from "../v2/api.js";
import { escapeHtml, formatPaiseINR, formatDateIN } from "../v2/utils.js";

const CA_NAV = [
  { id: "overview", label: "Overview" },
  { id: "customers", label: "My Customers" },
  { id: "bulk", label: "Bulk Onboarding" },
  { id: "gstins", label: "GSTIN Management" },
  { id: "returns", label: "Return Preparation" },
  { id: "invoices", label: "Invoices & Documents" },
  { id: "reconciliation", label: "Reconciliation" },
  { id: "approvals", label: "Filing Approvals" },
  { id: "compliance", label: "Compliance Calendar" },
  { id: "billing", label: "Billing & Commission" },
  { id: "team", label: "Team Management" },
  { id: "notifications", label: "Notifications" },
  { id: "training", label: "Training & Support" },
  { id: "profile", label: "Profile & Settings" }
];

const CA_CATEGORIES = [
  "Chartered Accountant", "GST Practitioner", "Tax Consultant",
  "Accountant", "Accounting Firm", "GST Agent"
];

const st = {
  authenticated: false,
  isAdmin: false,
  user: null,
  profile: null,
  staffRole: "",
  isStaff: false,
  authMode: "login",
  tab: "overview",
  err: "",
  overview: null,
  customers: [],
  custSearch: "",
  selectedCustomerDetail: null,
  bulkJobs: [],
  bulkPreview: null,
  approvals: [],
  compliance: { period: "", dueDates: {}, items: [] },
  reconResult: null,
  billing: { serviceInvoices: [], hasApprovedPartnerRole: false, partnerCommissions: [] },
  team: { staff: [], assignments: [] },
  notifications: [],
  unreadCount: 0,
  training: [],
  tickets: [],
  activities: [],
  adminCas: []
};

const $ = (s) => document.querySelector(s);

function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("s");
  setTimeout(() => el.classList.remove("s"), 2800);
}

function pillClass(status) {
  const s = String(status || "").toUpperCase();
  if (["APPROVED", "ACTIVE", "COMPLIANT", "FILED", "PAID", "IMPORTED", "VALID", "RESOLVED"].includes(s)) return "";
  if (["REJECTED", "SUSPENDED", "REVOKED", "OVERDUE", "FAILED", "INVALID"].includes(s)) return "bad";
  return "warn";
}

function renderNav() {
  const nav = $("#sb-nav");
  const tbR = $("#tb-right");
  const tbT = $("#tb-title");
  if (!nav || !tbR) return;

  if (!st.authenticated) {
    nav.innerHTML = `<button type="button" class="nav-btn on">CA Sign In</button>`;
    tbT.textContent = "CA / GST Agent Portal";
    tbR.innerHTML = `<a href="/app" class="btn o sm">Customer App</a>`;
    return;
  }
  if (st.isAdmin && !st.profile) {
    nav.innerHTML = `<button type="button" class="nav-btn on">Admin CA Approvals</button>`;
    tbT.textContent = "Admin CA Management";
    tbR.innerHTML = `<span class="pill">${escapeHtml(st.user?.name || "Admin")}</span><button type="button" class="btn o sm" data-act="logout">Logout</button>`;
    return;
  }
  if (st.profile && st.profile.status !== "APPROVED") {
    nav.innerHTML = `
      <button type="button" class="nav-btn ${st.tab === "profile" ? "on" : ""}" data-tab="profile">Verification Status</button>
      <button type="button" class="nav-btn ${st.tab === "training" ? "on" : ""}" data-tab="training">Training &amp; Support</button>
    `;
  } else {
    nav.innerHTML = CA_NAV.map(n => `
      <button type="button" class="nav-btn ${st.tab === n.id ? "on" : ""}" data-tab="${n.id}">
        <span>${escapeHtml(n.label)}</span>
        ${n.id === "notifications" && st.unreadCount > 0 ? `<span class="pill">${st.unreadCount}</span>` : ""}
      </button>
    `).join("");
  }

  tbT.textContent = CA_NAV.find(x => x.id === st.tab)?.label || "CA / GST Agent Portal";
  const p = st.profile;
  tbR.innerHTML = p ? `
    <span class="pill">${escapeHtml(p.firmName)} · ${escapeHtml(st.staffRole || p.caCode)}</span>
    <button type="button" class="btn o sm" data-tab="notifications">Alerts (${st.unreadCount})</button>
    <button type="button" class="btn o sm" data-tab="training">Help</button>
    <button type="button" class="btn o sm" data-act="logout">Logout</button>
  ` : `<button type="button" class="btn o sm" data-act="logout">Logout</button>`;
}

function renderAuth() {
  const isReg = st.authMode === "register";
  return `
    <div class="auth-box card">
      <div class="card-head">
        <div>
          <h1>${isReg ? "CA / GST Agent Registration" : "CA / GST Agent Sign In"}</h1>
          <p class="sub">${isReg ? "Register your CA firm or GST practice account." : "Sign in with your CA, Staff, or Admin account."}</p>
        </div>
        <button type="button" class="btn o sm" data-act="toggle-auth">${isReg ? "Back to Sign In" : "Register as CA / GST Agent"}</button>
      </div>
      ${st.err ? `<div class="banner err" role="alert">${escapeHtml(st.err)}</div>` : ""}
      ${isReg ? `
        <form id="ca-reg-form">
          <div class="g2">
            <div class="field"><label for="cr-name">Full Name *</label><input id="cr-name" required></div>
            <div class="field"><label for="cr-firm">Firm Name *</label><input id="cr-firm" required></div>
            <div class="field"><label for="cr-email">Email *</label><input id="cr-email" type="email" required></div>
            <div class="field"><label for="cr-mob">10-digit Mobile *</label><input id="cr-mob" maxlength="10" required></div>
            <div class="field"><label for="cr-pwd">Password *</label><input id="cr-pwd" type="password" required></div>
            <div class="field"><label for="cr-cat">Category *</label><select id="cr-cat">${CA_CATEGORIES.map(c => `<option>${escapeHtml(c)}</option>`).join("")}</select></div>
            <div class="field"><label for="cr-mem">Membership / Reg No.</label><input id="cr-mem"></div>
            <div class="field"><label for="cr-exp">Years of Experience</label><input id="cr-exp" type="number" min="0" value="3"></div>
            <div class="field"><label for="cr-pan">PAN *</label><input id="cr-pan" maxlength="10" required></div>
            <div class="field"><label for="cr-gst">GSTIN (optional)</label><input id="cr-gst" maxlength="15"></div>
            <div class="field"><label for="cr-st">State *</label><input id="cr-st" required></div>
            <div class="field"><label for="cr-dt">District *</label><input id="cr-dt" required></div>
            <div class="field"><label for="cr-pin">PIN Code *</label><input id="cr-pin" maxlength="6" required></div>
            <div class="field"><label for="cr-addr">Office Address *</label><input id="cr-addr" required></div>
          </div>
          <div class="tb-r">
            <button type="submit" class="btn">Submit CA Application</button>
            <button type="button" class="btn o" data-act="save-ca-draft">Save Draft</button>
          </div>
        </form>
      ` : `
        <form id="ca-login-form">
          <div class="field"><label for="cl-email">Email</label><input id="cl-email" type="email" required></div>
          <div class="field"><label for="cl-pwd">Password</label><input id="cl-pwd" type="password" required></div>
          <button type="submit" class="btn">Sign In</button>
        </form>
      `}
    </div>
  `;
}

function renderPending() {
  const p = st.profile;
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h1>CA Verification Status: <span class="pill ${pillClass(p.status)}">${escapeHtml(p.status)}</span></h1>
          <p class="sub">${escapeHtml(p.firmName)} (${escapeHtml(p.caCode)}) · ${escapeHtml(p.category)}</p>
        </div>
      </div>
      ${p.status === "REJECTED" && p.rejectionReason ? `<div class="banner err"><strong>Reason:</strong> ${escapeHtml(p.rejectionReason)}</div>` : ""}
      ${["DRAFT", "SUBMITTED", "UNDER_REVIEW"].includes(p.status) ? `<div class="banner warn">Only approved CA/GST Agent accounts can access client GST workspaces. Upload your PAN or membership certificate below.</div>` : ""}
      <form id="ca-doc-form" class="g2">
        <div class="field"><label for="cdoc-type">Document Type</label><select id="cdoc-type"><option value="PAN_PROOF">PAN Proof</option><option value="MEMBERSHIP_CERT">Professional Membership Certificate</option><option value="FIRM_REG">Firm Registration</option><option value="GST_CERT">GST Certificate</option></select></div>
        <div class="field"><label for="cdoc-file">File (PDF/PNG/JPG)</label><input id="cdoc-file" type="file" accept=".pdf,.png,.jpg,.jpeg" required></div>
        <div><button type="submit" class="btn sm">Upload Document</button></div>
      </form>
      <div class="tw" style="margin-top:12px"><table><thead><tr><th>Type</th><th>File</th><th>Status</th><th>Date</th></tr></thead><tbody>
        ${(p.documents || []).length === 0 ? `<tr><td colspan="4">No documents uploaded yet.</td></tr>` : p.documents.map(d => `<tr><td>${escapeHtml(d.doc_type)}</td><td>${escapeHtml(d.original_name)}</td><td><span class="pill">${escapeHtml(d.status)}</span></td><td>${formatDateIN(d.created_at)}</td></tr>`).join("")}
      </tbody></table></div>
    </div>
  `;
}

function renderAdminCas() {
  return `
    <div class="card">
      <h2>CA / GST Agent Applications (${st.adminCas.length})</h2>
      <div class="tw" style="margin-top:12px"><table><thead><tr><th>Code</th><th>Firm</th><th>Category</th><th>PAN</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        ${st.adminCas.length === 0 ? `<tr><td colspan="6">No CA applications yet.</td></tr>` : st.adminCas.map(c => `
          <tr>
            <td><strong>${escapeHtml(c.caCode)}</strong></td>
            <td>${escapeHtml(c.firmName)}<div class="sub">${escapeHtml(c.fullName)} · ${escapeHtml(c.email)}</div></td>
            <td>${escapeHtml(c.category)}</td>
            <td>${escapeHtml(c.panMasked)}</td>
            <td><span class="pill ${pillClass(c.status)}">${escapeHtml(c.status)}</span></td>
            <td>
              <button type="button" class="btn sm" data-adm-ca="${escapeHtml(c.id)}" data-val="APPROVED">Approve</button>
              <button type="button" class="btn o sm" data-adm-ca="${escapeHtml(c.id)}" data-val="REJECTED">Reject</button>
              <button type="button" class="btn bad sm" data-adm-ca="${escapeHtml(c.id)}" data-val="SUSPENDED">Suspend</button>
            </td>
          </tr>
        `).join("")}
      </tbody></table></div>
    </div>
  `;
}

function renderCaBody() {
  const consented = st.customers.filter(c => c.consent_granted && c.consent_status === "ACTIVE");

  if (st.tab === "overview") {
    const k = st.overview?.kpis || {};
    return `
      <div class="kpis">
        <div class="kpi"><small>Total Customers</small><div class="kpi-v">${k.totalCustomers || 0}</div></div>
        <div class="kpi"><small>Active (Consented)</small><div class="kpi-v">${k.activeCustomers || 0}</div></div>
        <div class="kpi"><small>Total GSTINs</small><div class="kpi-v">${k.totalGstins || 0}</div></div>
        <div class="kpi"><small>Returns Pending</small><div class="kpi-v">${k.returnsPending || 0}</div></div>
        <div class="kpi"><small>Awaiting Approval</small><div class="kpi-v">${k.returnsAwaitingApproval || 0}</div></div>
        <div class="kpi"><small>Returns Filed</small><div class="kpi-v">${k.returnsFiled || 0}</div></div>
        <div class="kpi"><small>Overdue Customers</small><div class="kpi-v">${k.overdueCustomers || 0}</div></div>
        <div class="kpi hi"><small>Service Revenue</small><div class="kpi-v">${formatPaiseINR(k.monthlyRevenuePaise || 0)}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Quick Actions</h3></div>
        <div class="tb-r">
          <button type="button" class="btn sm" data-tab="customers">Add Customer</button>
          <button type="button" class="btn o sm" data-tab="bulk">Bulk Import Customers</button>
          <button type="button" class="btn o sm" data-tab="returns">Prepare GSTR-1 / GSTR-3B</button>
          <button type="button" class="btn o sm" data-tab="reconciliation">Review Reconciliation</button>
          <button type="button" class="btn o sm" data-tab="compliance">Compliance Calendar</button>
        </div>
      </div>
      <div class="g2">
        <div class="card">
          <h3>Recent Customers</h3>
          ${(st.overview?.recentCustomers || []).length === 0 ? `<div class="empty">No customers added yet.</div>` : `
            <div class="tw"><table><thead><tr><th>Business</th><th>Consent</th></tr></thead><tbody>
              ${st.overview.recentCustomers.map(c => `<tr><td>${escapeHtml(c.business_name)}</td><td><span class="pill ${pillClass(c.consent_status)}">${escapeHtml(c.consent_status)}</span></td></tr>`).join("")}
            </tbody></table></div>
          `}
        </div>
        <div class="card">
          <h3>Pending Filing Approvals</h3>
          ${(st.overview?.pendingApprovals || []).length === 0 ? `<div class="empty">No pending approvals.</div>` : `
            <div class="tw"><table><thead><tr><th>Return</th><th>GSTIN</th><th>Status</th></tr></thead><tbody>
              ${st.overview.pendingApprovals.map(a => `<tr><td>${escapeHtml(a.return_type)} (${escapeHtml(a.period)})</td><td class="num">${escapeHtml(a.gstin)}</td><td><span class="pill ${pillClass(a.status)}">${escapeHtml(a.status)}</span></td></tr>`).join("")}
            </tbody></table></div>
          `}
        </div>
      </div>
    `;
  }

  if (st.tab === "customers") {
    return `
      <div class="card">
        <h3>Add / Invite Customer</h3>
        <form id="ca-add-cust-form">
          <div class="g3">
            <div class="field"><label for="cc-name">Customer Name *</label><input id="cc-name" required></div>
            <div class="field"><label for="cc-biz">Business Name *</label><input id="cc-biz" required></div>
            <div class="field"><label for="cc-email">Email *</label><input id="cc-email" type="email" required></div>
            <div class="field"><label for="cc-mob">Mobile *</label><input id="cc-mob" maxlength="10" required></div>
            <div class="field"><label for="cc-pan">PAN *</label><input id="cc-pan" maxlength="10" required></div>
            <div class="field"><label for="cc-gst">GSTIN (optional)</label><input id="cc-gst" maxlength="15"></div>
            <div class="field"><label for="cc-st">State *</label><input id="cc-st" required></div>
            <div class="field"><label for="cc-dt">District *</label><input id="cc-dt" required></div>
            <div class="field"><label for="cc-pin">PIN *</label><input id="cc-pin" maxlength="6" required></div>
          </div>
          <div class="field"><label for="cc-addr">Address *</label><input id="cc-addr" required></div>
          <button type="submit" class="btn sm">Invite Customer</button>
        </form>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>My Customers (${st.customers.length})</h3>
          <div class="tb-r">
            <input id="ca-cust-search" placeholder="Search business/email…" value="${escapeHtml(st.custSearch)}">
            <button type="button" class="btn o sm" data-act="search-ca-cust">Search</button>
          </div>
        </div>
        ${st.customers.length === 0 ? `<div class="empty">No customers found.</div>` : `
          <div class="tw"><table><thead><tr><th>Business</th><th>PAN</th><th>GSTINs</th><th>Consent</th><th>Actions</th></tr></thead><tbody>
            ${st.customers.map(c => `
              <tr>
                <td><strong>${escapeHtml(c.business_name)}</strong><div class="sub">${escapeHtml(c.customer_name)} · ${escapeHtml(c.email)}</div></td>
                <td class="num">${escapeHtml(c.pan)}</td>
                <td>${c.gstinCount}</td>
                <td><span class="pill ${pillClass(c.consent_status)}">${escapeHtml(c.consent_status)}</span></td>
                <td>${c.consent_granted ? `<button type="button" class="btn o sm" data-view-cust="${escapeHtml(c.id)}">Inspect</button>` : `<span class="sub">Awaiting consent</span>`}</td>
              </tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
      ${st.selectedCustomerDetail ? `
        <div class="card">
          <h3>Customer Workspace: ${escapeHtml(st.selectedCustomerDetail.customer.business_name)}</h3>
          <p class="sub">GSTINs: ${(st.selectedCustomerDetail.gstins || []).map(g => escapeHtml(g.gstin)).join(", ") || "None"} · Sales: ${(st.selectedCustomerDetail.invoices || []).length} · Purchases: ${(st.selectedCustomerDetail.purchases || []).length}</p>
        </div>
      ` : ""}
    `;
  }

  if (st.tab === "bulk") {
    const pv = st.bulkPreview;
    return `
      <div class="card">
        <div class="card-head">
          <div><h3>Bulk Customer Onboarding (CSV / XLSX)</h3><p class="sub">Download template, upload CSV or XLSX, review valid/invalid/duplicate rows, then confirm.</p></div>
          <a href="/api/ca/bulk-import/template" class="btn o sm">Download CSV Template</a>
        </div>
        <form id="ca-bulk-form" class="tb-r">
          <input id="ca-bulk-file" type="file" accept=".csv,.xlsx,.xls" required>
          <button type="submit" class="btn sm">Upload &amp; Validate</button>
        </form>
      </div>
      ${pv ? `
        <div class="card">
          <div class="card-head">
            <h3>Import Preview (${pv.job.total_records} rows: ${pv.job.valid_records} valid, ${pv.job.invalid_records} invalid, ${pv.job.duplicate_records} duplicate)</h3>
            <div class="tb-r">
              ${pv.job.status === "PREVIEW" && pv.job.valid_records > 0 ? `<button type="button" class="btn sm" data-confirm-bulk="${escapeHtml(pv.job.id)}">Confirm Valid Import (${pv.job.valid_records})</button>` : ""}
              <a href="/api/ca/bulk-import/${escapeHtml(pv.job.id)}/errors.csv" class="btn o sm">Download Error Report</a>
            </div>
          </div>
          <div class="tw"><table><thead><tr><th>Row</th><th>Status</th><th>Error</th></tr></thead><tbody>
            ${pv.records.map(r => `<tr><td>${r.row_index}</td><td><span class="pill ${pillClass(r.status)}">${escapeHtml(r.status)}</span></td><td>${escapeHtml(r.error_message || "—")}</td></tr>`).join("")}
          </tbody></table></div>
        </div>
      ` : ""}
    `;
  }

  if (st.tab === "gstins") {
    return `
      <div class="card">
        <h3>Add GSTIN for Consented Customer</h3>
        ${consented.length === 0 ? `<div class="empty">No consented customers yet.</div>` : `
          <form id="ca-add-gstin-form" class="g3">
            <div class="field"><label for="cg-cust">Customer</label><select id="cg-cust">${consented.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.business_name)}</option>`).join("")}</select></div>
            <div class="field"><label for="cg-gst">15-char GSTIN</label><input id="cg-gst" maxlength="15" required></div>
            <div class="field"><label for="cg-freq">Frequency</label><select id="cg-freq"><option value="MONTHLY">Monthly</option><option value="QRMP">QRMP</option></select></div>
            <div><button type="submit" class="btn sm">Add GSTIN</button></div>
          </form>
        `}
      </div>
      <div class="card">
        <h3>Customer GSTINs</h3>
        <div class="tw"><table><thead><tr><th>Customer</th><th>GSTIN</th><th>State</th><th>Frequency</th></tr></thead><tbody>
          ${consented.flatMap(c => (c.gstins || []).map(g => `<tr><td>${escapeHtml(c.business_name)}</td><td class="num"><strong>${escapeHtml(g.gstin)}</strong></td><td>${escapeHtml(g.state_name)}</td><td>${escapeHtml(g.filing_frequency)}</td></tr>`)).join("") || `<tr><td colspan="4">No GSTINs linked.</td></tr>`}
        </tbody></table></div>
      </div>
    `;
  }

  if (st.tab === "returns") {
    const gstOptions = consented.flatMap(c => (c.gstins || []).map(g => ({ custId: c.id, custName: c.business_name, gstinId: g.id, gstin: g.gstin })));
    return `
      <div class="card">
        <h3>Prepare GSTR-1 / GSTR-3B Draft</h3>
        <p class="sub">Uses the deterministic SimpleGST backend calculation &amp; statutory classification engines.</p>
        ${gstOptions.length === 0 ? `<div class="empty">No consented customer GSTINs available.</div>` : `
          <form id="ca-prep-ret-form" class="g3">
            <div class="field"><label for="pr-gst">Customer &amp; GSTIN</label><select id="pr-gst">${gstOptions.map(o => `<option value="${escapeHtml(o.custId)}|${escapeHtml(o.gstinId)}">${escapeHtml(o.custName)} · ${escapeHtml(o.gstin)}</option>`).join("")}</select></div>
            <div class="field"><label for="pr-type">Return</label><select id="pr-type"><option value="GSTR1">GSTR-1</option><option value="GSTR3B">GSTR-3B</option></select></div>
            <div class="field"><label for="pr-per">Period (MMYYYY)</label><input id="pr-per" value="${escapeHtml(st.compliance.period || "112026")}" maxlength="6" required></div>
            <div><button type="submit" class="btn sm">Prepare Draft</button></div>
          </form>
        `}
      </div>
    `;
  }

  if (st.tab === "approvals") {
    return `
      <div class="card">
        <h3>Filing Approval Workflow (${st.approvals.length})</h3>
        ${st.approvals.length === 0 ? `<div class="empty">No return drafts prepared yet.</div>` : `
          <div class="tw"><table><thead><tr><th>Customer</th><th>GSTIN</th><th>Return</th><th>Period</th><th>Status</th><th>Actions</th></tr></thead><tbody>
            ${st.approvals.map(a => `
              <tr>
                <td>${escapeHtml(a.customer_name)}</td>
                <td class="num">${escapeHtml(a.gstin)}</td>
                <td>${escapeHtml(a.return_type)} v${a.version}</td>
                <td class="num">${escapeHtml(a.period)}</td>
                <td><span class="pill ${pillClass(a.status)}">${escapeHtml(a.status)}</span></td>
                <td>
                  ${a.status === "DRAFT" || a.status === "CHANGES_REQUESTED" ? `<button type="button" class="btn o sm" data-send-app="${escapeHtml(a.id)}">Send for Approval</button>` : ""}
                  <button type="button" class="btn sm" data-file-app="${escapeHtml(a.id)}">File Return</button>
                </td>
              </tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "reconciliation") {
    return `
      <div class="card">
        <h3>GSTR-2B &amp; ITC Reconciliation</h3>
        ${consented.length === 0 ? `<div class="empty">No consented customers available.</div>` : `
          <form id="ca-recon-form" class="tb-r">
            <select id="rc-cust">${consented.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.business_name)}</option>`).join("")}</select>
            <button type="submit" class="btn sm">Run / View Reconciliation</button>
          </form>
        `}
        ${st.reconResult ? `<div class="banner info" style="margin-top:14px">Period ${escapeHtml(st.reconResult.period)}: ${(st.reconResult.items || []).length} reconciliation items loaded.</div>` : ""}
      </div>
    `;
  }

  if (st.tab === "compliance") {
    return `
      <div class="card">
        <h3>Customer Compliance Tracking (${escapeHtml(st.compliance.period || "")})</h3>
        ${(st.compliance.items || []).length === 0 ? `<div class="empty">No active consented customer GSTINs.</div>` : `
          <div class="tw"><table><thead><tr><th>Customer</th><th>GSTIN</th><th>Freq</th><th>GSTR-1</th><th>GSTR-3B</th><th>Due Date</th><th>Status</th><th>Action</th></tr></thead><tbody>
            ${st.compliance.items.map(i => `
              <tr>
                <td>${escapeHtml(i.customerName)}</td>
                <td class="num">${escapeHtml(i.gstin)}</td>
                <td>${escapeHtml(i.filingFrequency)}</td>
                <td>${escapeHtml(i.gstr1Status)}</td>
                <td>${escapeHtml(i.gstr3bStatus)}</td>
                <td>${escapeHtml(i.dueDate)}</td>
                <td><span class="pill ${pillClass(i.complianceStatus)}">${escapeHtml(i.complianceStatus)}</span></td>
                <td><button type="button" class="btn o sm" data-ca-remind="${escapeHtml(i.customerId)}">Remind</button></td>
              </tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "billing") {
    return `
      <div class="card">
        <h3>Create Professional Service Invoice</h3>
        ${consented.length === 0 ? `<div class="empty">Onboard and get customer consent before billing.</div>` : `
          <form id="ca-bill-form" class="g3">
            <div class="field"><label for="cb-cust">Customer</label><select id="cb-cust">${consented.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.business_name)}</option>`).join("")}</select></div>
            <div class="field"><label for="cb-desc">Service Description</label><input id="cb-desc" placeholder="Monthly GST Return Prep" required></div>
            <div class="field"><label for="cb-amt">Fee Amount (₹)</label><input id="cb-amt" type="number" min="1" step="0.01" required></div>
            <div><button type="submit" class="btn sm">Create Invoice</button></div>
          </form>
        `}
      </div>
      <div class="card">
        <h3>Professional Service Invoices (${st.billing.serviceInvoices.length})</h3>
        ${st.billing.serviceInvoices.length === 0 ? `<div class="empty">No service invoices yet.</div>` : `
          <div class="tw"><table><thead><tr><th>Invoice #</th><th>Customer</th><th>Service</th><th>Total (incl. GST)</th><th>Status</th><th>Action</th></tr></thead><tbody>
            ${st.billing.serviceInvoices.map(i => `
              <tr>
                <td class="num">${escapeHtml(i.invoice_number)}</td>
                <td>${escapeHtml(i.customer_name)}</td>
                <td>${escapeHtml(i.service_description)}</td>
                <td class="num"><strong>${formatPaiseINR(i.total_paise)}</strong></td>
                <td><span class="pill ${pillClass(i.status)}">${escapeHtml(i.status)}</span></td>
                <td>${i.status === "UNPAID" ? `<button type="button" class="btn sm" data-mark-paid="${escapeHtml(i.id)}">Mark Paid</button>` : "Paid ✓"}</td>
              </tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
      ${st.billing.hasApprovedPartnerRole ? `
        <div class="card">
          <h3>SimpleGST Partner Commissions (Separate Ledger)</h3>
          ${(st.billing.partnerCommissions || []).length === 0 ? `<div class="empty">No partner commissions recorded.</div>` : `
            <div class="tw"><table><thead><tr><th>Txn Ref</th><th>Source</th><th>Commission</th><th>Status</th></tr></thead><tbody>
              ${st.billing.partnerCommissions.map(c => `<tr><td class="num">${escapeHtml(c.transaction_ref)}</td><td>${escapeHtml(c.source_type)}</td><td class="num">${formatPaiseINR(c.commission_amount_paise)}</td><td><span class="pill">${escapeHtml(c.status)}</span></td></tr>`).join("")}
            </tbody></table></div>
          `}
        </div>
      ` : ""}
    `;
  }

  if (st.tab === "team") {
    return st.isStaff ? `<div class="banner info">Staff members cannot manage firm team settings.</div>` : `
      <div class="card">
        <h3>Invite CA Staff Member</h3>
        <form id="ca-staff-form" class="g3">
          <div class="field"><label for="cs-name">Name</label><input id="cs-name" required></div>
          <div class="field"><label for="cs-email">Email</label><input id="cs-email" type="email" required></div>
          <div class="field"><label for="cs-role">Role</label><select id="cs-role"><option>Senior Accountant</option><option>Accountant</option><option>GST Executive</option><option>Reviewer</option></select></div>
          <div><button type="submit" class="btn sm">Invite Staff</button></div>
        </form>
      </div>
      <div class="card">
        <h3>Firm Team (${st.team.staff.length})</h3>
        <div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>
          ${st.team.staff.length === 0 ? `<tr><td colspan="4">No staff members invited yet.</td></tr>` : st.team.staff.map(s => `<tr><td>${escapeHtml(s.full_name)}</td><td>${escapeHtml(s.email)}</td><td>${escapeHtml(s.role)}</td><td><span class="pill">${escapeHtml(s.status)}</span></td></tr>`).join("")}
        </tbody></table></div>
      </div>
    `;
  }

  if (st.tab === "notifications") {
    return `
      <div class="card">
        <div class="card-head"><h3>Notifications (${st.notifications.length})</h3><button type="button" class="btn o sm" data-act="read-all-ca-notif">Mark All Read</button></div>
        ${st.notifications.length === 0 ? `<div class="empty">No notifications.</div>` : `
          <div class="tw"><table><thead><tr><th>Category</th><th>Message</th><th>Date</th></tr></thead><tbody>
            ${st.notifications.map(n => `<tr><td><span class="pill">${escapeHtml(n.category)}</span></td><td><strong>${escapeHtml(n.title)}</strong><div class="sub">${escapeHtml(n.message)}</div></td><td>${formatDateIN(n.created_at)}</td></tr>`).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "training") {
    return `
      <div class="card">
        <h3>CA Training &amp; Help Centre</h3>
        <div class="g3" style="margin-top:12px">
          ${st.training.map(m => `<div class="card" style="margin:0"><span class="pill">${escapeHtml(m.category)} · ${escapeHtml(m.duration)}</span><h4 style="margin-top:8px">${escapeHtml(m.title)}</h4><p class="sub">${escapeHtml(m.summary)}</p></div>`).join("")}
        </div>
      </div>
      <div class="card">
        <h3>Support Tickets (${st.tickets.length})</h3>
        <form id="ca-tkt-form" class="g2">
          <div class="field"><label for="ct-cat">Category</label><select id="ct-cat"><option>GST Filing</option><option>Customer Onboarding</option><option>OCR &amp; Documents</option><option>Billing</option><option>Technical</option></select></div>
          <div class="field"><label for="ct-sub">Subject</label><input id="ct-sub" required></div>
          <div class="field" style="grid-column:1/-1"><label for="ct-desc">Description</label><textarea id="ct-desc" rows="2" required></textarea></div>
          <div><button type="submit" class="btn sm">Submit Ticket</button></div>
        </form>
      </div>
    `;
  }

  return renderPending() + `
    <div class="card">
      <h3>Firm Activity History</h3>
      <div class="tw"><table><thead><tr><th>Action</th><th>Timestamp</th></tr></thead><tbody>
        ${st.activities.length === 0 ? `<tr><td colspan="2">No activity logged yet.</td></tr>` : st.activities.map(a => `<tr><td>${escapeHtml(a.action)}</td><td>${formatDateIN(a.created_at)}</td></tr>`).join("")}
      </tbody></table></div>
    </div>
  `;
}

function render() {
  renderNav();
  const app = $("#app");
  if (!app) return;
  if (!st.authenticated) app.innerHTML = renderAuth();
  else if (st.isAdmin && !st.profile) app.innerHTML = renderAdminCas();
  else if (st.profile && st.profile.status !== "APPROVED" && st.tab !== "training") app.innerHTML = renderPending();
  else app.innerHTML = renderCaBody();
  bindForms();
}

async function loadData() {
  const sess = await apiRequest("/api/auth/session").catch(() => ({ authenticated: false }));
  if (!sess.authenticated) { st.authenticated = false; st.profile = null; st.isAdmin = false; render(); return; }
  st.authenticated = true;
  if (sess.csrfToken) setCsrfToken(sess.csrfToken);
  st.user = sess.user;

  try {
    const prof = await apiRequest("/api/ca/profile");
    st.profile = prof.profile;
    st.staffRole = prof.staffRole;
    st.isStaff = prof.isStaff;
    st.isAdmin = false;
  } catch {
    st.profile = null;
    st.isAdmin = sess.user?.role === "OWNER";
  }

  if (st.isAdmin && !st.profile) {
    const res = await apiRequest("/api/admin/cas").catch(() => ({ cas: [] }));
    st.adminCas = res.cas || [];
    render();
    return;
  }

  if (st.profile) {
    const [nRes, tRes, kRes] = await Promise.all([
      apiRequest("/api/ca/notifications").catch(() => ({ notifications: [], unreadCount: 0 })),
      apiRequest("/api/ca/training").catch(() => ({ modules: [] })),
      apiRequest("/api/ca/support/tickets").catch(() => ({ tickets: [] }))
    ]);
    st.notifications = nRes.notifications || [];
    st.unreadCount = nRes.unreadCount || 0;
    st.training = tRes.modules || [];
    st.tickets = kRes.tickets || [];

    if (st.profile.status === "APPROVED") {
      const [ov, cs, ap, cm, bl, tm, ac] = await Promise.all([
        apiRequest("/api/ca/overview").catch(() => null),
        apiRequest(`/api/ca/customers?search=${encodeURIComponent(st.custSearch)}`).catch(() => ({ customers: [] })),
        apiRequest("/api/ca/approvals").catch(() => ({ approvals: [] })),
        apiRequest("/api/ca/compliance").catch(() => ({ items: [] })),
        apiRequest("/api/ca/billing").catch(() => ({ serviceInvoices: [], partnerCommissions: [] })),
        apiRequest("/api/ca/team").catch(() => ({ staff: [], assignments: [] })),
        apiRequest("/api/ca/activities").catch(() => ({ activities: [] }))
      ]);
      st.overview = ov;
      st.customers = cs.customers || [];
      st.approvals = ap.approvals || [];
      st.compliance = cm;
      st.billing = bl;
      st.team = tm;
      st.activities = ac.activities || [];
    } else st.tab = "profile";
  }
  render();
}

function bindForms() {
  $("#ca-login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    st.err = "";
    try {
      const res = await apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ email: $("#cl-email").value.trim(), password: $("#cl-pwd").value }) });
      if (res.csrfToken) setCsrfToken(res.csrfToken);
      await loadData();
    } catch (err) { st.err = err.message; render(); }
  });
  $("#ca-reg-form")?.addEventListener("submit", async (e) => { e.preventDefault(); await submitCaReg(false); });
  $("#ca-doc-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = $("#cdoc-file")?.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    fd.append("docType", $("#cdoc-type").value);
    try { await apiRequest("/api/ca/documents", { method: "POST", body: fd }); toast("Document uploaded"); await loadData(); } catch (err) { toast(err.message); }
  });
  $("#ca-add-cust-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/ca/customers", {
        method: "POST",
        body: JSON.stringify({
          customerName: $("#cc-name").value.trim(), businessName: $("#cc-biz").value.trim(), email: $("#cc-email").value.trim(),
          mobile: $("#cc-mob").value.trim(), pan: $("#cc-pan").value.trim(), gstin: $("#cc-gst").value.trim(),
          state: $("#cc-st").value.trim(), district: $("#cc-dt").value.trim(), pincode: $("#cc-pin").value.trim(), address: $("#cc-addr").value.trim()
        })
      });
      toast("Customer invitation sent");
      await loadData();
    } catch (err) { toast(err.message); }
  });
  $("#ca-bulk-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = $("#ca-bulk-file")?.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await apiRequest("/api/ca/bulk-import/preview", { method: "POST", body: fd });
      st.bulkPreview = res;
      toast("Bulk file validated");
      render();
    } catch (err) { toast(err.message); }
  });
  $("#ca-add-gstin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest(`/api/ca/customers/${$("#cg-cust").value}/gstins`, {
        method: "POST",
        body: JSON.stringify({ gstin: $("#cg-gst").value.trim(), filingFrequency: $("#cg-freq").value })
      });
      toast("GSTIN added");
      await loadData();
    } catch (err) { toast(err.message); }
  });
  $("#ca-prep-ret-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const [customerId, gstinId] = $("#pr-gst").value.split("|");
    try {
      await apiRequest("/api/ca/returns/prepare", {
        method: "POST",
        body: JSON.stringify({ customerId, gstinId, returnType: $("#pr-type").value, period: $("#pr-per").value.trim() })
      });
      toast("Return draft prepared");
      st.tab = "approvals";
      await loadData();
    } catch (err) { toast(err.message); }
  });
  $("#ca-recon-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      st.reconResult = await apiRequest(`/api/ca/customers/${$("#rc-cust").value}/reconciliation`);
      render();
    } catch (err) { toast(err.message); }
  });
  $("#ca-bill-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/ca/billing", {
        method: "POST",
        body: JSON.stringify({ customerId: $("#cb-cust").value, serviceDescription: $("#cb-desc").value.trim(), amount: Number($("#cb-amt").value) })
      });
      toast("Service invoice created");
      await loadData();
    } catch (err) { toast(err.message); }
  });
  $("#ca-staff-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/ca/team/invite", {
        method: "POST",
        body: JSON.stringify({ fullName: $("#cs-name").value.trim(), email: $("#cs-email").value.trim(), role: $("#cs-role").value })
      });
      toast("Staff member invited");
      await loadData();
    } catch (err) { toast(err.message); }
  });
  $("#ca-tkt-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/ca/support/tickets", {
        method: "POST",
        body: JSON.stringify({ category: $("#ct-cat").value, subject: $("#ct-sub").value.trim(), description: $("#ct-desc").value.trim() })
      });
      toast("Support ticket submitted");
      await loadData();
    } catch (err) { toast(err.message); }
  });
}

async function submitCaReg(submitAsDraft) {
  st.err = "";
  try {
    const res = await apiRequest("/api/ca/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: $("#cr-name").value.trim(), firmName: $("#cr-firm").value.trim(), email: $("#cr-email").value.trim(),
        mobile: $("#cr-mob").value.trim(), password: $("#cr-pwd").value, category: $("#cr-cat").value,
        membershipNumber: $("#cr-mem").value.trim(), yearsExperience: $("#cr-exp").value, pan: $("#cr-pan").value.trim(),
        gstin: $("#cr-gst").value.trim(), state: $("#cr-st").value.trim(), district: $("#cr-dt").value.trim(),
        pincode: $("#cr-pin").value.trim(), officeAddress: $("#cr-addr").value.trim(), submitAsDraft
      })
    });
    if (res.csrfToken) setCsrfToken(res.csrfToken);
    toast("CA application recorded");
    await loadData();
  } catch (err) { st.err = err.message; render(); }
}

document.addEventListener("click", async (e) => {
  if (e.target.closest("#menu-toggle")) { $("#sidebar")?.classList.add("open"); return; }
  if (e.target.closest("#sb-close")) { $("#sidebar")?.classList.remove("open"); return; }
  const tabBtn = e.target.closest("[data-tab]");
  if (tabBtn) { st.tab = tabBtn.dataset.tab; $("#sidebar")?.classList.remove("open"); render(); return; }

  const actBtn = e.target.closest("[data-act]");
  if (actBtn) {
    const act = actBtn.dataset.act;
    if (act === "toggle-auth") { st.authMode = st.authMode === "login" ? "register" : "login"; st.err = ""; render(); }
    else if (act === "save-ca-draft") await submitCaReg(true);
    else if (act === "logout") { await apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => {}); await loadData(); }
    else if (act === "search-ca-cust") { st.custSearch = $("#ca-cust-search")?.value || ""; await loadData(); }
    else if (act === "read-all-ca-notif") { await apiRequest("/api/ca/notifications/read-all", { method: "POST", body: JSON.stringify({}) }); await loadData(); }
    return;
  }

  const admCa = e.target.closest("[data-adm-ca]");
  if (admCa) {
    const val = admCa.dataset.val;
    const reason = val === "REJECTED" ? (prompt("Rejection reason:") || "Incomplete credentials") : undefined;
    try { await apiRequest(`/api/admin/cas/${admCa.dataset.admCa}/status`, { method: "POST", body: JSON.stringify({ status: val, rejectionReason: reason }) }); toast(`CA marked ${val}`); await loadData(); } catch (err) { toast(err.message); }
    return;
  }

  const viewCust = e.target.closest("[data-view-cust]");
  if (viewCust) {
    try { st.selectedCustomerDetail = await apiRequest(`/api/ca/customers/${viewCust.dataset.viewCust}`); render(); } catch (err) { toast(err.message); }
    return;
  }

  const confBulk = e.target.closest("[data-confirm-bulk]");
  if (confBulk) {
    try { const r = await apiRequest(`/api/ca/bulk-import/${confBulk.dataset.confirmBulk}/confirm`, { method: "POST", body: JSON.stringify({}) }); toast(`Imported ${r.imported} customers`); st.bulkPreview = null; await loadData(); } catch (err) { toast(err.message); }
    return;
  }

  const sendApp = e.target.closest("[data-send-app]");
  if (sendApp) {
    try { await apiRequest(`/api/ca/approvals/${sendApp.dataset.sendApp}/submit`, { method: "POST", body: JSON.stringify({}) }); toast("Sent for customer approval"); await loadData(); } catch (err) { toast(err.message); }
    return;
  }

  const fileApp = e.target.closest("[data-file-app]");
  if (fileApp) {
    try { const r = await apiRequest(`/api/ca/approvals/${fileApp.dataset.fileApp}/file`, { method: "POST", body: JSON.stringify({}) }); toast(r.message || "Filed"); } catch (err) { toast(err.message); }
    return;
  }

  const markPaid = e.target.closest("[data-mark-paid]");
  if (markPaid) {
    try { await apiRequest(`/api/ca/billing/${markPaid.dataset.markPaid}/mark-paid`, { method: "POST", body: JSON.stringify({}) }); toast("Marked paid"); await loadData(); } catch (err) { toast(err.message); }
    return;
  }

  const rem = e.target.closest("[data-ca-remind]");
  if (rem) {
    try { const r = await apiRequest("/api/ca/compliance/remind", { method: "POST", body: JSON.stringify({ customerId: rem.dataset.caRemind, period: st.compliance.period }) }); toast(r.message); } catch (err) { toast(err.message); }
  }
});

loadData();
