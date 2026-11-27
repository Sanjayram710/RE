import { apiRequest, setCsrfToken } from "../v2/api.js";
import { escapeHtml, formatPaiseINR, formatDateIN } from "../v2/utils.js";

const PARTNER_NAV = [
  { id: "overview", label: "Overview" },
  { id: "customers", label: "My Customers" },
  { id: "leads", label: "Leads" },
  { id: "filings", label: "GST Filing Monitor" },
  { id: "commissions", label: "Commission & Earnings" },
  { id: "performance", label: "Performance" },
  { id: "referrals", label: "Referrals" },
  { id: "services", label: "Add-on Services" },
  { id: "training", label: "Training & Support" },
  { id: "notifications", label: "Notifications" },
  { id: "profile", label: "Partner Profile" },
  { id: "settings", label: "Settings" }
];

const CATEGORIES = [
  "Chartered Accountant", "Tax Consultant", "GST Practitioner",
  "Accounting Firm", "Business Consultant", "Referral Partner", "Other"
];

const st = {
  authenticated: false,
  isAdmin: false,
  user: null,
  partner: null,
  authMode: "login",
  tab: "overview",
  err: "",
  loading: false,
  overview: null,
  territories: [],
  customersData: { total: 0, page: 1, limit: 10, customers: [], search: "", status: "", sort: "newest" },
  leads: [],
  filingsData: { period: "", dueDates: {}, metrics: {}, items: [], statusFilter: "", gstinFilter: "" },
  commissionsData: { summary: {}, commissions: [] },
  payouts: [],
  perfData: { currentTier: "Bronze", stats: {}, tiers: [] },
  leaderboard: [],
  referralsData: { referralCode: "", referralUrl: "", referrals: [] },
  services: [],
  serviceOrders: [],
  training: [],
  tickets: [],
  activeTicket: null,
  notifications: [],
  unreadCount: 0,
  activities: [],
  admin: { partners: [], rules: [], payouts: [], tiers: [], services: [], tickets: [] }
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
  if (["APPROVED", "ACTIVE", "FILED", "PAID", "CONVERTED", "REWARD_CREDITED", "RESOLVED", "COMPLETED"].includes(s)) return "";
  if (["REJECTED", "SUSPENDED", "REVOKED", "OVERDUE", "FAILED", "CANCELLED"].includes(s)) return "bad";
  return "warn";
}

function renderNav() {
  const nav = $("#sb-nav");
  const tbR = $("#tb-right");
  const tbT = $("#tb-title");
  if (!nav || !tbR) return;

  if (!st.authenticated) {
    nav.innerHTML = `<button type="button" class="nav-btn on">Partner Sign In</button>`;
    tbT.textContent = "SimpleGST Partner Portal";
    tbR.innerHTML = `<a href="/app" class="btn o sm">Customer App</a>`;
    return;
  }

  if (st.isAdmin && !st.partner) {
    nav.innerHTML = `<button type="button" class="nav-btn on">Admin Partner Console</button>`;
    tbT.textContent = "Partner Admin Console";
    tbR.innerHTML = `
      <span class="pill">${escapeHtml(st.user?.name || "Admin")}</span>
      <button type="button" class="btn o sm" data-act="logout">Logout</button>
    `;
    return;
  }

  if (st.partner && st.partner.status !== "APPROVED") {
    nav.innerHTML = `
      <button type="button" class="nav-btn ${st.tab === "profile" ? "on" : ""}" data-tab="profile">Application Status</button>
      <button type="button" class="nav-btn ${st.tab === "training" ? "on" : ""}" data-tab="training">Training &amp; Support</button>
      <button type="button" class="nav-btn ${st.tab === "notifications" ? "on" : ""}" data-tab="notifications">Notifications ${st.unreadCount ? `(${st.unreadCount})` : ""}</button>
    `;
  } else {
    nav.innerHTML = PARTNER_NAV.map(n => `
      <button type="button" class="nav-btn ${st.tab === n.id ? "on" : ""}" data-tab="${n.id}">
        <span>${escapeHtml(n.label)}</span>
        ${n.id === "notifications" && st.unreadCount > 0 ? `<span class="pill">${st.unreadCount}</span>` : ""}
      </button>
    `).join("");
  }

  const p = st.partner;
  tbT.textContent = PARTNER_NAV.find(x => x.id === st.tab)?.label || "Partner Portal";
  tbR.innerHTML = p ? `
    <span class="pill">${escapeHtml(p.partnerCode)} · ${escapeHtml(p.tier)}</span>
    <span class="sub">${escapeHtml(p.fullName)}</span>
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
          <h1>${isReg ? "Partner Registration & Onboarding" : "Partner Portal Sign In"}</h1>
          <p class="sub">${isReg ? "Apply as a SimpleGST Partner (CA, Tax Consultant, GST Practitioner, or Referral Partner)." : "Sign in with your Partner or Admin account."}</p>
        </div>
        <button type="button" class="btn o sm" data-act="toggle-auth">${isReg ? "Have an account? Sign In" : "Apply as Partner"}</button>
      </div>
      ${st.err ? `<div class="banner err" role="alert">${escapeHtml(st.err)}</div>` : ""}

      ${isReg ? `
        <form id="partner-reg-form">
          <div class="g2">
            <div class="field"><label for="pr-name">Full Name *</label><input id="pr-name" required></div>
            <div class="field"><label for="pr-biz">Business / Firm Name *</label><input id="pr-biz" required></div>
            <div class="field"><label for="pr-email">Email *</label><input id="pr-email" type="email" required></div>
            <div class="field"><label for="pr-mobile">10-digit Mobile *</label><input id="pr-mobile" maxlength="10" required></div>
            <div class="field"><label for="pr-pwd">Password *</label><input id="pr-pwd" type="password" required></div>
            <div class="field"><label for="pr-btype">Business Type *</label><input id="pr-btype" placeholder="Proprietorship / LLP / Firm" required></div>
            <div class="field"><label for="pr-pan">PAN Number *</label><input id="pr-pan" maxlength="10" required></div>
            <div class="field"><label for="pr-gstin">GSTIN (optional)</label><input id="pr-gstin" maxlength="15"></div>
            <div class="field"><label for="pr-cat">Partner Category *</label><select id="pr-cat">${CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select></div>
            <div class="field"><label for="pr-exp">Years of Experience</label><input id="pr-exp" type="number" min="0" value="2"></div>
            <div class="field"><label for="pr-state">State *</label><input id="pr-state" required></div>
            <div class="field"><label for="pr-dist">District *</label><input id="pr-dist" required></div>
            <div class="field"><label for="pr-city">City *</label><input id="pr-city" required></div>
            <div class="field"><label for="pr-pin">PIN Code *</label><input id="pr-pin" maxlength="6" required></div>
          </div>
          <div class="field"><label for="pr-addr">Business Address *</label><input id="pr-addr" required></div>
          <div class="tb-r">
            <button type="submit" class="btn">Submit Application</button>
            <button type="button" class="btn o" data-act="save-partner-draft">Save as Draft</button>
          </div>
        </form>
      ` : `
        <form id="partner-login-form">
          <div class="field"><label for="pl-email">Email</label><input id="pl-email" type="email" required></div>
          <div class="field"><label for="pl-pwd">Password</label><input id="pl-pwd" type="password" required></div>
          <button type="submit" class="btn">Sign In</button>
        </form>
      `}
    </div>
  `;
}

function renderPendingStatus() {
  const p = st.partner;
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h1>Application Status: <span class="pill ${pillClass(p.status)}">${escapeHtml(p.status)}</span></h1>
          <p class="sub">Partner Code: <strong>${escapeHtml(p.partnerCode)}</strong> · ${escapeHtml(p.businessName)}</p>
        </div>
      </div>
      ${p.status === "REJECTED" && p.rejectionReason ? `<div class="banner err"><strong>Rejection Reason:</strong> ${escapeHtml(p.rejectionReason)}</div>` : ""}
      ${p.status === "SUSPENDED" ? `<div class="banner err">Your partner account is suspended. Contact support for assistance.</div>` : ""}
      ${["DRAFT", "SUBMITTED", "UNDER_REVIEW"].includes(p.status) ? `
        <div class="banner warn">Only approved and active partners receive access to customer, lead, filing, and commission tools. Upload verification documents below while your application is reviewed.</div>
      ` : ""}
      <form id="partner-doc-form" class="g2">
        <div class="field">
          <label for="pdoc-type">Document Type</label>
          <select id="pdoc-type">
            <option value="PAN_PROOF">PAN Card Proof</option>
            <option value="BUSINESS_REGISTRATION">Business Registration Proof</option>
            <option value="GST_CERTIFICATE">GST Registration Certificate</option>
            <option value="PROFESSIONAL_CREDENTIAL">Professional Credential (CA/GSTP)</option>
          </select>
        </div>
        <div class="field"><label for="pdoc-file">File (PDF, PNG, JPG, max 15 MB)</label><input id="pdoc-file" type="file" accept=".pdf,.png,.jpg,.jpeg" required></div>
        <div><button type="submit" class="btn sm">Upload Verification Document</button></div>
      </form>
      <div class="tw" style="margin-top:14px">
        <table>
          <thead><tr><th>Type</th><th>File</th><th>Status</th><th>Uploaded</th></tr></thead>
          <tbody>
            ${(p.documents || []).length === 0 ? `<tr><td colspan="4">No documents uploaded yet.</td></tr>` : p.documents.map(d => `
              <tr><td>${escapeHtml(d.doc_type)}</td><td>${escapeHtml(d.original_name)}</td><td><span class="pill">${escapeHtml(d.status)}</span></td><td>${formatDateIN(d.created_at)}</td></tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAdminConsole() {
  const a = st.admin;
  return `
    <div class="card">
      <div class="card-head"><h2>Partner Applications &amp; Approvals (${a.partners.length})</h2></div>
      <div class="tw">
        <table>
          <thead><tr><th>Code</th><th>Business</th><th>Category</th><th>PAN</th><th>Status</th><th>Docs</th><th>Actions</th></tr></thead>
          <tbody>
            ${a.partners.length === 0 ? `<tr><td colspan="7">No partner applications yet.</td></tr>` : a.partners.map(p => `
              <tr>
                <td><strong>${escapeHtml(p.partnerCode)}</strong></td>
                <td>${escapeHtml(p.businessName)}<div class="sub">${escapeHtml(p.email)}</div></td>
                <td>${escapeHtml(p.category)}</td>
                <td>${escapeHtml(p.panMasked)}</td>
                <td><span class="pill ${pillClass(p.status)}">${escapeHtml(p.status)}</span></td>
                <td>${(p.documents || []).length}</td>
                <td>
                  <button type="button" class="btn sm" data-adm-status="${escapeHtml(p.id)}" data-val="APPROVED">Approve</button>
                  <button type="button" class="btn o sm" data-adm-status="${escapeHtml(p.id)}" data-val="REJECTED">Reject</button>
                  <button type="button" class="btn bad sm" data-adm-status="${escapeHtml(p.id)}" data-val="SUSPENDED">Suspend</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="g2">
      <div class="card">
        <h3>Assign Territory &amp; PIN Codes</h3>
        <form id="adm-terr-form">
          <div class="field"><label for="at-pid">Partner</label><select id="at-pid">${a.partners.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.businessName)} (${escapeHtml(p.partnerCode)})</option>`).join("")}</select></div>
          <div class="g2">
            <div class="field"><label for="at-st">State</label><input id="at-st" required></div>
            <div class="field"><label for="at-dt">District</label><input id="at-dt" required></div>
            <div class="field"><label for="at-ct">City</label><input id="at-ct" required></div>
            <div class="field"><label for="at-pins">PIN Codes (comma-separated)</label><input id="at-pins" placeholder="400001,400002" required></div>
          </div>
          <button type="submit" class="btn sm">Assign Territory</button>
        </form>
      </div>

      <div class="card">
        <h3>Assign Lead to Partner</h3>
        <form id="adm-lead-form">
          <div class="field"><label for="al-pid">Partner</label><select id="al-pid">${a.partners.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.businessName)}</option>`).join("")}</select></div>
          <div class="g2">
            <div class="field"><label for="al-name">Customer Name</label><input id="al-name" required></div>
            <div class="field"><label for="al-biz">Business Name</label><input id="al-biz" required></div>
            <div class="field"><label for="al-phone">Phone</label><input id="al-phone" required></div>
            <div class="field"><label for="al-email">Email</label><input id="al-email" type="email"></div>
            <div class="field"><label for="al-pin">PIN Code</label><input id="al-pin" maxlength="6"></div>
            <div class="field"><label for="al-pri">Priority</label><select id="al-pri"><option>MEDIUM</option><option>HIGH</option><option>LOW</option></select></div>
          </div>
          <button type="submit" class="btn sm">Assign Lead</button>
        </form>
      </div>
    </div>

    <div class="card">
      <h3>Payout Requests (${a.payouts.length})</h3>
      <div class="tw">
        <table>
          <thead><tr><th>Partner</th><th>Amount</th><th>Account</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            ${a.payouts.length === 0 ? `<tr><td colspan="5">No payout requests.</td></tr>` : a.payouts.map(po => `
              <tr>
                <td>${escapeHtml(po.business_name)}</td>
                <td class="num">${formatPaiseINR(po.amount_paise)}</td>
                <td>${escapeHtml(po.bank_account_masked)} (${escapeHtml(po.ifsc)})</td>
                <td><span class="pill ${pillClass(po.status)}">${escapeHtml(po.status)}</span></td>
                <td>
                  ${po.status === "PENDING" ? `
                    <button type="button" class="btn sm" data-adm-pay="${escapeHtml(po.id)}" data-val="PAID">Mark Paid</button>
                    <button type="button" class="btn bad sm" data-adm-pay="${escapeHtml(po.id)}" data-val="REJECTED">Reject</button>
                  ` : "Processed"}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPartnerView() {
  if (st.tab === "overview") {
    const k = st.overview?.kpis || {};
    return `
      <div class="kpis">
        <div class="kpi"><small>Total Customers</small><div class="kpi-v">${k.totalCustomers || 0}</div></div>
        <div class="kpi"><small>Active Customers</small><div class="kpi-v">${k.activeCustomers || 0}</div></div>
        <div class="kpi"><small>New Leads</small><div class="kpi-v">${k.newLeads || 0}</div></div>
        <div class="kpi"><small>Converted Leads</small><div class="kpi-v">${k.convertedLeads || 0}</div></div>
        <div class="kpi"><small>Pending GST Returns</small><div class="kpi-v">${k.pendingGstReturns || 0}</div></div>
        <div class="kpi hi"><small>Total Commission</small><div class="kpi-v">${formatPaiseINR(k.totalCommissionPaise || 0)}</div></div>
        <div class="kpi"><small>Pending Payouts</small><div class="kpi-v">${formatPaiseINR(k.pendingPayoutsPaise || 0)}</div></div>
      </div>
      <div class="g2">
        <div class="card">
          <div class="card-head"><h3>Recent Leads</h3><button type="button" class="btn o sm" data-tab="leads">All Leads</button></div>
          ${(st.overview?.recentLeads || []).length === 0 ? `<div class="empty">No leads assigned yet.</div>` : `
            <div class="tw"><table><thead><tr><th>Lead</th><th>Business</th><th>Status</th></tr></thead><tbody>
              ${st.overview.recentLeads.map(l => `<tr><td>${escapeHtml(l.lead_code)}</td><td>${escapeHtml(l.business_name)}</td><td><span class="pill ${pillClass(l.status)}">${escapeHtml(l.status)}</span></td></tr>`).join("")}
            </tbody></table></div>
          `}
        </div>
        <div class="card">
          <div class="card-head"><h3>Recent Customers</h3><button type="button" class="btn o sm" data-tab="customers">All Customers</button></div>
          ${(st.overview?.recentCustomers || []).length === 0 ? `<div class="empty">No customers added yet.</div>` : `
            <div class="tw"><table><thead><tr><th>Business</th><th>Status</th><th>Added</th></tr></thead><tbody>
              ${st.overview.recentCustomers.map(c => `<tr><td>${escapeHtml(c.business_name)}</td><td><span class="pill ${pillClass(c.onboarding_status)}">${escapeHtml(c.onboarding_status)}</span></td><td>${formatDateIN(c.created_at)}</td></tr>`).join("")}
            </tbody></table></div>
          `}
        </div>
      </div>
      <div class="card">
        <h3>Assigned Territories &amp; PIN Codes</h3>
        ${st.territories.length === 0 ? `<div class="empty">No territories assigned by Admin yet.</div>` : `
          <div class="tw"><table><thead><tr><th>State</th><th>District</th><th>City</th><th>PIN Code</th><th>Customers</th><th>Leads</th></tr></thead><tbody>
            ${st.territories.map(t => `<tr><td>${escapeHtml(t.state)}</td><td>${escapeHtml(t.district)}</td><td>${escapeHtml(t.city)}</td><td class="num">${escapeHtml(t.pincode)}</td><td>${t.customersCount}</td><td>${t.leadsCount}</td></tr>`).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "customers") {
    const cd = st.customersData;
    return `
      <div class="card">
        <h3>Onboard New Customer</h3>
        <p class="sub">Customer access requires customer consent in their SimpleGST Settings.</p>
        <form id="add-cust-form">
          <div class="g3">
            <div class="field"><label for="ac-name">Customer Name *</label><input id="ac-name" required></div>
            <div class="field"><label for="ac-biz">Business Name *</label><input id="ac-biz" required></div>
            <div class="field"><label for="ac-email">Email *</label><input id="ac-email" type="email" required></div>
            <div class="field"><label for="ac-mob">Mobile *</label><input id="ac-mob" maxlength="10" required></div>
            <div class="field"><label for="ac-type">Business Type *</label><input id="ac-type" value="Proprietorship" required></div>
            <div class="field"><label for="ac-pan">PAN *</label><input id="ac-pan" maxlength="10" required></div>
            <div class="field"><label for="ac-gst">GSTIN (optional)</label><input id="ac-gst" maxlength="15"></div>
            <div class="field"><label for="ac-st">State *</label><input id="ac-st" required></div>
            <div class="field"><label for="ac-dt">District *</label><input id="ac-dt" required></div>
            <div class="field"><label for="ac-pin">PIN Code *</label><input id="ac-pin" maxlength="6" required></div>
          </div>
          <div class="field"><label for="ac-addr">Address *</label><input id="ac-addr" required></div>
          <button type="submit" class="btn sm">Send Customer Invitation</button>
        </form>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>My Customers (${cd.total})</h3>
          <div class="tb-r">
            <input id="cust-search" placeholder="Search name/email…" value="${escapeHtml(cd.search)}">
            <select id="cust-status">
              <option value="">All Statuses</option>
              <option value="ACTIVE" ${cd.status === "ACTIVE" ? "selected" : ""}>Active</option>
              <option value="INVITED" ${cd.status === "INVITED" ? "selected" : ""}>Invited</option>
              <option value="CONSENT_PENDING" ${cd.status === "CONSENT_PENDING" ? "selected" : ""}>Consent Pending</option>
              <option value="REVOKED" ${cd.status === "REVOKED" ? "selected" : ""}>Revoked</option>
            </select>
            <button type="button" class="btn o sm" data-act="filter-cust">Filter</button>
          </div>
        </div>
        ${cd.customers.length === 0 ? `<div class="empty">No matching customers found.</div>` : `
          <div class="tw"><table><thead><tr><th>Customer</th><th>Mobile</th><th>GSTINs</th><th>Onboarding</th><th>Filing Status</th><th>Add GSTIN</th></tr></thead><tbody>
            ${cd.customers.map(c => `
              <tr>
                <td><strong>${escapeHtml(c.business_name)}</strong><div class="sub">${escapeHtml(c.customer_name)} · ${escapeHtml(c.email)}</div></td>
                <td class="num">${escapeHtml(c.mobile)}</td>
                <td>${c.gstinCount}</td>
                <td><span class="pill ${pillClass(c.onboarding_status)}">${escapeHtml(c.onboarding_status)}</span></td>
                <td>${escapeHtml(c.lastFilingStatus)}</td>
                <td>${c.consent_granted ? `<button type="button" class="btn o sm" data-add-gstin="${escapeHtml(c.id)}">+ GSTIN</button>` : `<span class="sub">Awaiting consent</span>`}</td>
              </tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "leads") {
    return `
      <div class="card">
        <h3>Assigned Leads (${st.leads.length})</h3>
        ${st.leads.length === 0 ? `<div class="empty">No leads assigned to you yet.</div>` : `
          <div class="tw"><table><thead><tr><th>Code</th><th>Lead</th><th>PIN / City</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead><tbody>
            ${st.leads.map(l => `
              <tr>
                <td><strong>${escapeHtml(l.lead_code)}</strong></td>
                <td>${escapeHtml(l.business_name)}<div class="sub">${escapeHtml(l.customer_name)} · ${escapeHtml(l.phone)}</div></td>
                <td>${escapeHtml(l.pincode || "—")} ${escapeHtml(l.city || "")}</td>
                <td><span class="pill">${escapeHtml(l.priority)}</span></td>
                <td><span class="pill ${pillClass(l.status)}">${escapeHtml(l.status)}</span></td>
                <td>
                  ${l.status !== "CONVERTED" ? `
                    <button type="button" class="btn sm" data-lead-act="${escapeHtml(l.id)}" data-val="ACCEPTED">Accept</button>
                    <button type="button" class="btn o sm" data-lead-act="${escapeHtml(l.id)}" data-val="CONTACTED">Contacted</button>
                    <button type="button" class="btn sm" data-lead-conv="${escapeHtml(l.id)}">Convert</button>
                  ` : "Converted ✓"}
                </td>
              </tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "filings") {
    const fd = st.filingsData;
    const m = fd.metrics || {};
    return `
      <div class="kpis">
        <div class="kpi"><small>Consented Customers</small><div class="kpi-v">${m.totalCustomers || 0}</div></div>
        <div class="kpi"><small>Returns Pending</small><div class="kpi-v">${m.returnsPending || 0}</div></div>
        <div class="kpi hi"><small>Returns Filed</small><div class="kpi-v">${m.returnsCompleted || 0}</div></div>
        <div class="kpi"><small>Overdue Returns</small><div class="kpi-v">${m.overdueReturns || 0}</div></div>
      </div>
      <div class="card">
        <h3>Customer GST Filing Status (${escapeHtml(fd.period || "")})</h3>
        ${(fd.items || []).length === 0 ? `<div class="empty">No active consented customer GSTINs for this period.</div>` : `
          <div class="tw"><table><thead><tr><th>Customer</th><th>GSTIN</th><th>GSTR-1</th><th>GSTR-3B</th><th>2B Recon</th><th>Due Date</th><th>Status</th><th>Action</th></tr></thead><tbody>
            ${fd.items.map(it => `
              <tr>
                <td><strong>${escapeHtml(it.customerName)}</strong></td>
                <td class="num">${escapeHtml(it.gstin)}</td>
                <td>${escapeHtml(it.gstr1Status)}</td>
                <td>${escapeHtml(it.gstr3bStatus)}</td>
                <td>${escapeHtml(it.reconStatus)}</td>
                <td>${escapeHtml(it.dueDate)}</td>
                <td><span class="pill ${pillClass(it.filingStatus)}">${escapeHtml(it.filingStatus)}</span></td>
                <td><button type="button" class="btn o sm" data-remind-cust="${escapeHtml(it.customerId)}">Remind</button></td>
              </tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "commissions") {
    const s = st.commissionsData.summary || {};
    const rows = st.commissionsData.commissions || [];
    return `
      <div class="kpis">
        <div class="kpi hi"><small>Total Commission Earned</small><div class="kpi-v">${formatPaiseINR(s.totalEarnedPaise || 0)}</div></div>
        <div class="kpi"><small>Available for Payout</small><div class="kpi-v">${formatPaiseINR(s.availableForPayoutPaise || 0)}</div></div>
        <div class="kpi"><small>Pending</small><div class="kpi-v">${formatPaiseINR(s.pendingPaise || 0)}</div></div>
        <div class="kpi"><small>Paid Out</small><div class="kpi-v">${formatPaiseINR(s.paidPaise || 0)}</div></div>
      </div>
      <div class="card">
        <h3>Request Payout</h3>
        <form id="payout-req-form" class="g3">
          <div class="field"><label for="po-amt">Amount (₹)</label><input id="po-amt" type="number" min="1" step="0.01" required></div>
          <div class="field"><label for="po-acc">Bank Account Number</label><input id="po-acc" required></div>
          <div class="field"><label for="po-ifsc">IFSC Code</label><input id="po-ifsc" maxlength="11" required></div>
          <div><button type="submit" class="btn sm">Submit Payout Request</button></div>
        </form>
      </div>
      <div class="card">
        <h3>Commission Ledger (${rows.length})</h3>
        ${rows.length === 0 ? `<div class="empty">No commission transactions yet.</div>` : `
          <div class="tw"><table><thead><tr><th>Txn Ref</th><th>Source</th><th>Amount</th><th>Rate</th><th>Commission</th><th>Status</th><th>Date</th></tr></thead><tbody>
            ${rows.map(r => `
              <tr>
                <td class="num">${escapeHtml(r.transaction_ref)}</td>
                <td>${escapeHtml(r.source_type)}</td>
                <td class="num">${formatPaiseINR(r.transaction_amount_paise)}</td>
                <td>${escapeHtml(r.commission_rate_label)}</td>
                <td class="num"><strong>${formatPaiseINR(r.commission_amount_paise)}</strong></td>
                <td><span class="pill ${pillClass(r.status)}">${escapeHtml(r.status)}</span></td>
                <td>${formatDateIN(r.created_at)}</td>
              </tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "performance") {
    return `
      <div class="card">
        <h3>Current Tier: <span class="pill">${escapeHtml(st.perfData.currentTier)}</span></h3>
        <div class="tw" style="margin-top:12px">
          <table><thead><tr><th>Tier</th><th>Min Customers</th><th>Min Conversions</th><th>Min Revenue</th><th>Bonus Rate</th></tr></thead><tbody>
            ${(st.perfData.tiers || []).map(t => `
              <tr><td><strong>${escapeHtml(t.tier)}</strong></td><td>${t.min_customers}</td><td>${t.min_conversions}</td><td class="num">${formatPaiseINR(t.min_revenue_paise)}</td><td>+${(t.commission_bonus_bps / 100).toFixed(2)}%</td></tr>
            `).join("")}
          </tbody></table>
        </div>
      </div>
      <div class="card">
        <h3>Partner Leaderboard</h3>
        ${st.leaderboard.length === 0 ? `<div class="empty">No approved partners on leaderboard yet.</div>` : `
          <div class="tw"><table><thead><tr><th>Rank</th><th>Partner</th><th>Tier</th><th>Customers</th><th>Conversions</th><th>Score</th></tr></thead><tbody>
            ${st.leaderboard.map(r => `
              <tr><td><strong>#${r.rank}</strong></td><td>${escapeHtml(r.displayName)} ${r.isSelf ? `<span class="pill">You</span>` : ""}</td><td>${escapeHtml(r.tier)}</td><td>${r.customers}</td><td>${r.conversions}</td><td class="num"><strong>${r.score}</strong></td></tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "referrals") {
    const rd = st.referralsData;
    return `
      <div class="card">
        <h3>Your Referral Code: <code>${escapeHtml(rd.referralCode)}</code></h3>
        <p class="sub">Share link: <code>${escapeHtml(location.origin + rd.referralUrl)}</code></p>
        <form id="ref-track-form" class="g3" style="margin-top:14px">
          <div class="field"><label for="rf-email">Referred Customer Email</label><input id="rf-email" type="email" required></div>
          <div class="field"><label for="rf-mob">Referred Mobile</label><input id="rf-mob" maxlength="10"></div>
          <div class="field"><label>&nbsp;</label><button type="submit" class="btn sm">Record Referral</button></div>
        </form>
      </div>
      <div class="card">
        <h3>Referral History (${(rd.referrals || []).length})</h3>
        ${(rd.referrals || []).length === 0 ? `<div class="empty">No referrals recorded yet.</div>` : `
          <div class="tw"><table><thead><tr><th>Email</th><th>Status</th><th>Reward</th><th>Date</th></tr></thead><tbody>
            ${rd.referrals.map(r => `<tr><td>${escapeHtml(r.referred_email)}</td><td><span class="pill ${pillClass(r.status)}">${escapeHtml(r.status)}</span></td><td class="num">${formatPaiseINR(r.reward_paise)}</td><td>${formatDateIN(r.created_at)}</td></tr>`).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "services") {
    const consented = (st.customersData.customers || []).filter(c => c.consent_granted);
    return `
      <div class="card">
        <h3>Add-on Service Catalogue</h3>
        <div class="g3" style="margin-top:12px">
          ${st.services.map(s => `
            <div class="card" style="margin:0">
              <h4>${escapeHtml(s.name)}</h4>
              <p class="sub">${escapeHtml(s.description)}</p>
              <p><strong>${formatPaiseINR(s.price_paise)}</strong> · Commission ${(s.commission_bps / 100).toFixed(1)}%</p>
              <p class="sub">ETA: ${escapeHtml(s.estimated_delivery)}</p>
              ${consented.length > 0 ? `<button type="button" class="btn sm" data-order-svc="${escapeHtml(s.id)}">Request for Client</button>` : `<span class="sub">Onboard &amp; get customer consent first</span>`}
            </div>
          `).join("")}
        </div>
      </div>
      <div class="card">
        <h3>Service Orders (${st.serviceOrders.length})</h3>
        ${st.serviceOrders.length === 0 ? `<div class="empty">No add-on service orders placed yet.</div>` : `
          <div class="tw"><table><thead><tr><th>Service</th><th>Customer</th><th>Amount</th><th>Commission</th><th>Status</th></tr></thead><tbody>
            ${st.serviceOrders.map(o => `<tr><td>${escapeHtml(o.service_name)}</td><td>${escapeHtml(o.customer_name)}</td><td class="num">${formatPaiseINR(o.amount_paise)}</td><td class="num">${formatPaiseINR(o.commission_paise)}</td><td><span class="pill ${pillClass(o.status)}">${escapeHtml(o.status)}</span></td></tr>`).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "training") {
    return `
      <div class="card">
        <h3>Partner Training Centre</h3>
        <div class="g3" style="margin-top:12px">
          ${st.training.map(m => `
            <div class="card" style="margin:0">
              <span class="pill">${escapeHtml(m.category)} · ${escapeHtml(m.duration)}</span>
              <h4 style="margin-top:8px">${escapeHtml(m.title)}</h4>
              <p class="sub">${escapeHtml(m.summary)}</p>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="card">
        <h3>Create Support Ticket</h3>
        <form id="ticket-form" class="g2">
          <div class="field"><label for="tk-cat">Category</label><select id="tk-cat"><option>Account Issues</option><option>Customer Onboarding</option><option>GST Filing</option><option>Payments</option><option>Commission</option><option>Referrals</option><option>Technical Issues</option><option>Other</option></select></div>
          <div class="field"><label for="tk-sub">Subject</label><input id="tk-sub" required></div>
          <div class="field" style="grid-column:1/-1"><label for="tk-desc">Description</label><textarea id="tk-desc" rows="3" required></textarea></div>
          <div><button type="submit" class="btn sm">Submit Ticket</button></div>
        </form>
      </div>
      <div class="card">
        <h3>My Support Tickets (${st.tickets.length})</h3>
        ${st.tickets.length === 0 ? `<div class="empty">No support tickets created.</div>` : `
          <div class="tw"><table><thead><tr><th>Subject</th><th>Category</th><th>Status</th><th>Updated</th></tr></thead><tbody>
            ${st.tickets.map(t => `<tr><td>${escapeHtml(t.subject)}</td><td>${escapeHtml(t.category)}</td><td><span class="pill ${pillClass(t.status)}">${escapeHtml(t.status)}</span></td><td>${formatDateIN(t.updated_at)}</td></tr>`).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "notifications") {
    return `
      <div class="card">
        <div class="card-head">
          <h3>Notifications (${st.notifications.length})</h3>
          <button type="button" class="btn o sm" data-act="read-all-notif">Mark All Read</button>
        </div>
        ${st.notifications.length === 0 ? `<div class="empty">You are all caught up.</div>` : `
          <div class="tw"><table><thead><tr><th>Category</th><th>Notification</th><th>Time</th><th>Action</th></tr></thead><tbody>
            ${st.notifications.map(n => `
              <tr>
                <td><span class="pill">${escapeHtml(n.category)}</span></td>
                <td><strong>${escapeHtml(n.title)}</strong><div class="sub">${escapeHtml(n.message)}</div></td>
                <td>${formatDateIN(n.created_at)}</td>
                <td>${n.is_read ? "Read" : `<button type="button" class="btn o sm" data-read-notif="${escapeHtml(n.id)}">Mark Read</button>`}</td>
              </tr>
            `).join("")}
          </tbody></table></div>
        `}
      </div>
    `;
  }

  if (st.tab === "profile") {
    const p = st.partner;
    return renderPendingStatus() + `
      <div class="card">
        <h3>Partner Profile Details</h3>
        <div class="g2" style="margin-top:12px">
          <p><strong>Partner ID:</strong> ${escapeHtml(p.partnerCode)}</p>
          <p><strong>Tier:</strong> ${escapeHtml(p.tier)}</p>
          <p><strong>PAN (Masked):</strong> ${escapeHtml(p.panMasked)}</p>
          <p><strong>GSTIN (Masked):</strong> ${escapeHtml(p.gstinMasked || "Not provided")}</p>
          <p><strong>Email:</strong> ${escapeHtml(p.email)}</p>
          <p><strong>Mobile:</strong> ${escapeHtml(p.mobile)}</p>
        </div>
        <form id="profile-upd-form" class="g2" style="margin-top:14px">
          <div class="field"><label for="pu-biz">Business Name</label><input id="pu-biz" value="${escapeHtml(p.businessName)}"></div>
          <div class="field"><label for="pu-city">City</label><input id="pu-city" value="${escapeHtml(p.city)}"></div>
          <div class="field"><label for="pu-addr">Address</label><input id="pu-addr" value="${escapeHtml(p.address)}"></div>
          <div class="field"><label for="pu-pin">PIN Code</label><input id="pu-pin" maxlength="6" value="${escapeHtml(p.pincode)}"></div>
          <div><button type="submit" class="btn sm">Save Profile</button></div>
        </form>
      </div>
    `;
  }

  return `
    <div class="card">
      <h3>Partner Activity History</h3>
      ${st.activities.length === 0 ? `<div class="empty">No activity logged yet.</div>` : `
        <div class="tw"><table><thead><tr><th>Action</th><th>Timestamp</th></tr></thead><tbody>
          ${st.activities.map(a => `<tr><td>${escapeHtml(a.action)}</td><td>${formatDateIN(a.created_at)}</td></tr>`).join("")}
        </tbody></table></div>
      `}
    </div>
  `;
}

function render() {
  renderNav();
  const app = $("#app");
  if (!app) return;
  if (!st.authenticated) app.innerHTML = renderAuth();
  else if (st.isAdmin && !st.partner) app.innerHTML = renderAdminConsole();
  else if (st.partner && st.partner.status !== "APPROVED" && st.tab !== "training" && st.tab !== "notifications") {
    app.innerHTML = renderPendingStatus();
  } else app.innerHTML = renderPartnerView();
  bindForms();
}

async function loadData() {
  const sess = await apiRequest("/api/auth/session").catch(() => ({ authenticated: false }));
  if (!sess.authenticated) {
    st.authenticated = false;
    st.partner = null;
    st.isAdmin = false;
    render();
    return;
  }
  st.authenticated = true;
  if (sess.csrfToken) setCsrfToken(sess.csrfToken);
  st.user = sess.user;

  try {
    const prof = await apiRequest("/api/partner/profile");
    st.partner = prof.profile;
    st.isAdmin = false;
  } catch {
    st.partner = null;
    st.isAdmin = sess.user?.role === "OWNER";
  }

  if (st.isAdmin && !st.partner) {
    const [pRes, poRes] = await Promise.all([
      apiRequest("/api/admin/partners").catch(() => ({ partners: [] })),
      apiRequest("/api/admin/partners/payouts").catch(() => ({ payouts: [] }))
    ]);
    st.admin.partners = pRes.partners || [];
    st.admin.payouts = poRes.payouts || [];
    render();
    return;
  }

  if (st.partner) {
    const [notifRes, trnRes, tktRes] = await Promise.all([
      apiRequest("/api/partner/notifications").catch(() => ({ notifications: [], unreadCount: 0 })),
      apiRequest("/api/partner/training").catch(() => ({ modules: [] })),
      apiRequest("/api/partner/support/tickets").catch(() => ({ tickets: [] }))
    ]);
    st.notifications = notifRes.notifications || [];
    st.unreadCount = notifRes.unreadCount || 0;
    st.training = trnRes.modules || [];
    st.tickets = tktRes.tickets || [];

    if (st.partner.status === "APPROVED") {
      const [ov, tr, cs, ld, fl, cm, pf, lb, rf, sv, so, ac] = await Promise.all([
        apiRequest("/api/partner/overview").catch(() => null),
        apiRequest("/api/partner/territories").catch(() => ({ territories: [] })),
        apiRequest(`/api/partner/customers?search=${encodeURIComponent(st.customersData.search)}&status=${encodeURIComponent(st.customersData.status)}`).catch(() => ({ total: 0, customers: [] })),
        apiRequest("/api/partner/leads").catch(() => ({ leads: [] })),
        apiRequest("/api/partner/filings").catch(() => ({ items: [], metrics: {} })),
        apiRequest("/api/partner/commissions").catch(() => ({ summary: {}, commissions: [] })),
        apiRequest("/api/partner/performance").catch(() => ({ currentTier: "Bronze", tiers: [] })),
        apiRequest("/api/partner/leaderboard").catch(() => ({ leaderboard: [] })),
        apiRequest("/api/partner/referrals").catch(() => ({ referralCode: "", referralUrl: "", referrals: [] })),
        apiRequest("/api/partner/services").catch(() => ({ services: [] })),
        apiRequest("/api/partner/service-orders").catch(() => ({ orders: [] })),
        apiRequest("/api/partner/activities").catch(() => ({ activities: [] }))
      ]);
      st.overview = ov;
      st.territories = tr.territories || [];
      st.customersData = { ...st.customersData, total: cs.total || 0, customers: cs.customers || [] };
      st.leads = ld.leads || [];
      st.filingsData = { ...st.filingsData, ...fl };
      st.commissionsData = cm;
      st.perfData = pf;
      st.leaderboard = lb.leaderboard || [];
      st.referralsData = rf;
      st.services = sv.services || [];
      st.serviceOrders = so.orders || [];
      st.activities = ac.activities || [];
    } else {
      st.tab = "profile";
    }
  }
  render();
}

function bindForms() {
  $("#partner-login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    st.err = "";
    try {
      const res = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: $("#pl-email").value.trim(), password: $("#pl-pwd").value })
      });
      if (res.csrfToken) setCsrfToken(res.csrfToken);
      await loadData();
    } catch (err) { st.err = err.message; render(); }
  });

  $("#partner-reg-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitPartnerReg(false);
  });

  $("#partner-doc-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#pdoc-file")?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("docType", $("#pdoc-type").value);
    try {
      await apiRequest("/api/partner/documents", { method: "POST", body: fd });
      toast("Document uploaded");
      await loadData();
    } catch (err) { toast(err.message); }
  });

  $("#adm-terr-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/admin/partners/territories", {
        method: "POST",
        body: JSON.stringify({
          partnerId: $("#at-pid").value, state: $("#at-st").value.trim(), district: $("#at-dt").value.trim(),
          city: $("#at-ct").value.trim(), pincodes: $("#at-pins").value.split(",").map(s => s.trim()).filter(Boolean)
        })
      });
      toast("Territory assigned");
      await loadData();
    } catch (err) { toast(err.message); }
  });

  $("#adm-lead-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/admin/partners/leads", {
        method: "POST",
        body: JSON.stringify({
          partnerId: $("#al-pid").value, customerName: $("#al-name").value.trim(), businessName: $("#al-biz").value.trim(),
          phone: $("#al-phone").value.trim(), email: $("#al-email").value.trim(), pincode: $("#al-pin").value.trim(), priority: $("#al-pri").value
        })
      });
      toast("Lead assigned");
      await loadData();
    } catch (err) { toast(err.message); }
  });

  $("#add-cust-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/partner/customers", {
        method: "POST",
        body: JSON.stringify({
          customerName: $("#ac-name").value.trim(), businessName: $("#ac-biz").value.trim(), email: $("#ac-email").value.trim(),
          mobile: $("#ac-mob").value.trim(), businessType: $("#ac-type").value.trim(), pan: $("#ac-pan").value.trim(),
          gstin: $("#ac-gst").value.trim(), state: $("#ac-st").value.trim(), district: $("#ac-dt").value.trim(),
          pincode: $("#ac-pin").value.trim(), address: $("#ac-addr").value.trim()
        })
      });
      toast("Customer invitation sent");
      await loadData();
    } catch (err) { toast(err.message); }
  });

  $("#payout-req-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/partner/payouts", {
        method: "POST",
        body: JSON.stringify({ amount: Number($("#po-amt").value), bankAccountNumber: $("#po-acc").value.trim(), ifsc: $("#po-ifsc").value.trim() })
      });
      toast("Payout requested");
      await loadData();
    } catch (err) { toast(err.message); }
  });

  $("#ref-track-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/partner/referrals/track", {
        method: "POST",
        body: JSON.stringify({ referredEmail: $("#rf-email").value.trim(), referredMobile: $("#rf-mob").value.trim() })
      });
      toast("Referral recorded");
      await loadData();
    } catch (err) { toast(err.message); }
  });

  $("#ticket-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/partner/support/tickets", {
        method: "POST",
        body: JSON.stringify({ category: $("#tk-cat").value, subject: $("#tk-sub").value.trim(), description: $("#tk-desc").value.trim() })
      });
      toast("Support ticket created");
      await loadData();
    } catch (err) { toast(err.message); }
  });

  $("#profile-upd-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/partner/profile", {
        method: "PUT",
        body: JSON.stringify({
          businessName: $("#pu-biz").value.trim(), city: $("#pu-city").value.trim(),
          address: $("#pu-addr").value.trim(), pincode: $("#pu-pin").value.trim()
        })
      });
      toast("Profile updated");
      await loadData();
    } catch (err) { toast(err.message); }
  });
}

async function submitPartnerReg(submitAsDraft) {
  st.err = "";
  try {
    const res = await apiRequest("/api/partner/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: $("#pr-name").value.trim(), businessName: $("#pr-biz").value.trim(), email: $("#pr-email").value.trim(),
        mobile: $("#pr-mobile").value.trim(), password: $("#pr-pwd").value, businessType: $("#pr-btype").value.trim(),
        pan: $("#pr-pan").value.trim(), gstin: $("#pr-gstin").value.trim(), category: $("#pr-cat").value,
        yearsExperience: $("#pr-exp").value, state: $("#pr-state").value.trim(), district: $("#pr-dist").value.trim(),
        city: $("#pr-city").value.trim(), pincode: $("#pr-pin").value.trim(), address: $("#pr-addr").value.trim(),
        submitAsDraft
      })
    });
    if (res.csrfToken) setCsrfToken(res.csrfToken);
    toast(submitAsDraft ? "Draft saved" : "Application submitted");
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
    else if (act === "save-partner-draft") await submitPartnerReg(true);
    else if (act === "logout") { await apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => {}); await loadData(); }
    else if (act === "filter-cust") { st.customersData.search = $("#cust-search")?.value || ""; st.customersData.status = $("#cust-status")?.value || ""; await loadData(); }
    else if (act === "read-all-notif") { await apiRequest("/api/partner/notifications/read-all", { method: "POST", body: JSON.stringify({}) }); await loadData(); }
    return;
  }

  const admSt = e.target.closest("[data-adm-status]");
  if (admSt) {
    const val = admSt.dataset.val;
    const reason = val === "REJECTED" ? (prompt("Enter rejection reason:") || "Incomplete verification documents") : undefined;
    try {
      await apiRequest(`/api/admin/partners/${admSt.dataset.admStatus}/status`, { method: "POST", body: JSON.stringify({ status: val, rejectionReason: reason }) });
      toast(`Partner marked ${val}`);
      await loadData();
    } catch (err) { toast(err.message); }
    return;
  }

  const admPay = e.target.closest("[data-adm-pay]");
  if (admPay) {
    const val = admPay.dataset.val;
    const reason = val === "REJECTED" ? (prompt("Rejection reason:") || "Verification failed") : undefined;
    try {
      await apiRequest(`/api/admin/partners/payouts/${admPay.dataset.admPay}/process`, { method: "POST", body: JSON.stringify({ status: val, rejectionReason: reason }) });
      toast(`Payout ${val}`);
      await loadData();
    } catch (err) { toast(err.message); }
    return;
  }

  const leadAct = e.target.closest("[data-lead-act]");
  if (leadAct) {
    try {
      await apiRequest(`/api/partner/leads/${leadAct.dataset.leadAct}`, { method: "PATCH", body: JSON.stringify({ status: leadAct.dataset.val, notes: `Updated to ${leadAct.dataset.val}` }) });
      toast(`Lead updated to ${leadAct.dataset.val}`);
      await loadData();
    } catch (err) { toast(err.message); }
    return;
  }

  const leadConv = e.target.closest("[data-lead-conv]");
  if (leadConv) {
    const pan = prompt("Confirm Customer 10-char PAN (leave blank if GSTIN already has it):") || undefined;
    try {
      await apiRequest(`/api/partner/leads/${leadConv.dataset.leadConv}/convert`, { method: "POST", body: JSON.stringify({ pan }) });
      toast("Lead converted to customer");
      await loadData();
    } catch (err) { toast(err.message); }
    return;
  }

  const remBtn = e.target.closest("[data-remind-cust]");
  if (remBtn) {
    try {
      const r = await apiRequest("/api/partner/filings/remind", { method: "POST", body: JSON.stringify({ customerId: remBtn.dataset.remindCust, period: st.filingsData.period }) });
      toast(r.message || "Reminder sent");
    } catch (err) { toast(err.message); }
    return;
  }

  const addGst = e.target.closest("[data-add-gstin]");
  if (addGst) {
    const gstin = prompt("Enter 15-character GSTIN:");
    if (!gstin) return;
    try {
      await apiRequest(`/api/partner/customers/${addGst.dataset.addGstin}/gstins`, { method: "POST", body: JSON.stringify({ gstin }) });
      toast("GSTIN added");
      await loadData();
    } catch (err) { toast(err.message); }
    return;
  }

  const ordSvc = e.target.closest("[data-order-svc]");
  if (ordSvc) {
    const consented = (st.customersData.customers || []).filter(c => c.consent_granted);
    if (!consented[0]) return;
    try {
      await apiRequest("/api/partner/service-orders", { method: "POST", body: JSON.stringify({ customerId: consented[0].id, serviceId: ordSvc.dataset.orderSvc }) });
      toast("Service order requested");
      await loadData();
    } catch (err) { toast(err.message); }
    return;
  }

  const rn = e.target.closest("[data-read-notif]");
  if (rn) {
    await apiRequest(`/api/partner/notifications/${rn.dataset.readNotif}/read`, { method: "POST", body: JSON.stringify({}) });
    await loadData();
  }
});

loadData();
