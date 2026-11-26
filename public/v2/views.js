import { escapeHtml, formatPaiseINR, rupeesToPaise, formatDateIN } from "./utils.js";

function renderLoadingCards(count = 4) {
  return `
    <div class="kpi-grid" aria-busy="true" aria-label="Loading data">
      ${Array.from({ length: count }, () => `
        <div class="card">
          <div class="skel skel-title"></div>
          <div class="skel skel-val"></div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderErrorBanner(message, retryAction) {
  return `
    <div class="banner err" role="alert">
      <span>${escapeHtml(message)}</span>
      ${retryAction ? `<button type="button" class="btn outline" data-act="${escapeHtml(retryAction)}">Retry</button>` : ""}
    </div>
  `;
}

export function renderAuthView(state) {
  return `
    <section class="auth-shell" aria-labelledby="auth-heading">
      <div class="card">
        <div class="eyebrow">Secure Sign In</div>
        <h1 id="auth-heading" class="page-title auth-h1">Sign in to SimpleGST</h1>
        <p class="sub">Enter your business account email and password to view your GST records.</p>

        ${state.sessionExpiredMessage ? `<div class="banner warn" role="alert">${escapeHtml(state.sessionExpiredMessage)}</div>` : ""}
        ${state.errors.auth ? `<div class="banner err" role="alert">${escapeHtml(state.errors.auth)}</div>` : ""}

        <form id="login-form" novalidate>
          <div class="field">
            <label for="login-email">Email address</label>
            <input id="login-email" name="email" type="email" autocomplete="email" required placeholder="you@yourshop.in">
          </div>
          <div class="field">
            <label for="login-password">Password</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password">
          </div>
          <button type="submit" class="btn btn-full" id="login-submit-btn">Sign in</button>
        </form>
      </div>
    </section>
  `;
}

export function renderHomeView(state) {
  if (state.loading.dashboard === "loading") {
    return `
      <div class="eyebrow">Loading your business summary…</div>
      <h1 class="hero-title">Your GST, made simple.</h1>
      ${renderLoadingCards(4)}
    `;
  }

  if (state.loading.dashboard === "error") {
    return `
      <h1 class="page-title">Home</h1>
      ${renderErrorBanner(state.errors.dashboard || "Could not load dashboard summary.", "reload-dashboard")}
    `;
  }

  const dash = state.dashboard;
  if (!dash || dash.empty) {
    return `
      <div class="empty-state">
        <h3>Welcome to SimpleGST</h3>
        <p>Select or add a GSTIN registration in Settings to begin tracking your sales, purchases, and GST returns.</p>
        <button type="button" class="btn" data-go="settings">Open Settings</button>
      </div>
    `;
  }

  const m = dash.metrics || {};
  const p = m.paise || {
    taxableSalesPaise: rupeesToPaise(m.taxableSales),
    totalOutputLiabilityPaise: rupeesToPaise(m.totalOutputLiability),
    taxablePurchasesPaise: rupeesToPaise(m.taxablePurchases),
    totalEligibleItcPaise: rupeesToPaise(m.totalEligibleItc),
    netCashPayablePaise: rupeesToPaise(m.netCashPayable)
  };

  const env = dash.environment || {};
  const bannerHtml = env.preparationOnly
    ? `<div class="banner info" role="status"><strong>Preparation only:</strong> filing is not connected yet. You can prepare bills, reconcile, and review tax calculations.</div>`
    : `<div class="banner info" role="status"><strong>Simulation Mode:</strong> Filing uses local simulation and is not transmitted to GSTN.</div>`;

  const isBrandNewBusiness = Number(m.salesCount || 0) === 0 && Number(m.purchasesCount || 0) === 0;
  const step = state.filingStep || 1;
  const completedCount = (Number(m.salesCount || 0) > 0 ? 1 : 0) + (Number(m.purchasesCount || 0) > 0 ? 1 : 0) + (step > 3 ? 1 : 0) + (step > 4 ? 1 : 0);
  const ringPct = Math.min(100, completedCount * 20);
  const firstName = escapeHtml((state.user?.name || state.user?.full_name || "there").split(" ")[0]);
  const dueStr = escapeHtml(dash.statutoryDeadlines?.gstr3b || "20th of next month");

  return `
    <div class="eyebrow">
      <span>${escapeHtml(dash.entity?.tradeName || state.organization?.name || "")}</span>
      <span>·</span>
      <span class="num">${escapeHtml(dash.entity?.gstin || "")}</span>
      <span>·</span>
      <span>${escapeHtml(dash.periodLabel || dash.period || "")}</span>
    </div>

    <h1 class="hero-title">Good morning, ${firstName}.</h1>

    ${bannerHtml}

    <div class="hg">
      <div class="card">
        <div class="hl">
          <div>
            <small>${escapeHtml(dash.periodLabel || "")} return · due ${dueStr}</small>
            <h2>${isBrandNewBusiness ? "Your GST is<br>ready to start." : "Continue your<br>GST filing."}</h2>
            <button type="button" class="btn" data-go="file">Continue GST filing →</button>
          </div>
          <div class="rg">
            <svg viewBox="0 0 120 120" role="img" aria-label="${completedCount} of 5 steps done">
              <circle class="t" cx="60" cy="60" r="50"></circle>
              <circle class="p" cx="60" cy="60" r="50" data-pct="${ringPct}"></circle>
            </svg>
            <div class="rc">
              <b>${completedCount}/5</b>
              <span>steps done</span>
            </div>
          </div>
        </div>
      </div>

      <div class="stk">
        <button type="button" class="sr ${Number(m.salesCount || 0) > 0 ? "dn" : ""}" data-go="file" data-step="1">
          <div>
            <b>1 · Add sales</b>
            <span>Upload outward bills to customers</span>
          </div>
          <em>${Number(m.salesCount || 0) > 0 ? `Done (${Number(m.salesCount)}) ✓` : "Start →"}</em>
        </button>
        <button type="button" class="sr ${Number(m.purchasesCount || 0) > 0 ? "dn" : ""}" data-go="file" data-step="2">
          <div>
            <b>2 · Add purchases</b>
            <span>Upload supplier bills &amp; match GSTR-2B</span>
          </div>
          <em>${Number(m.purchasesCount || 0) > 0 ? `Done (${Number(m.purchasesCount)}) ✓` : "Start →"}</em>
        </button>
        <button type="button" class="sr ${step >= 3 ? "" : "dm"}" data-go="file" data-step="3">
          <div>
            <b>3 · Check credit &amp; review</b>
            <span>Verify ITC, Rule 88A offset &amp; submit (${env.preparationOnly ? "Prep only" : "Simulation"})</span>
          </div>
          <em>${step >= 3 ? "Ready →" : "Next →"}</em>
        </button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="card">
        <div class="kpi-label">Total Sales (${Number(m.salesCount || 0)} bills)</div>
        <div class="kpi-val num">${formatPaiseINR(p.taxableSalesPaise)}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Total Purchases (${Number(m.purchasesCount || 0)} bills)</div>
        <div class="kpi-val num">${formatPaiseINR(p.taxablePurchasesPaise)}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Available Tax Credit (ITC)</div>
        <div class="kpi-val num">${formatPaiseINR(p.totalEligibleItcPaise)}</div>
      </div>
      <div class="card fill">
        <div class="kpi-label mut-on-fill">Estimated GST to Pay</div>
        <div class="kpi-val num">${formatPaiseINR(p.netCashPayablePaise)}</div>
      </div>
    </div>

    ${isBrandNewBusiness ? `
      <div class="empty-state">
        <h3>No bills added yet for ${escapeHtml(dash.periodLabel || "this month")}</h3>
        <p>Start by adding your sales bills or uploading supplier purchase bills. We will calculate your tax credit and payable GST automatically.</p>
        <button type="button" class="btn" data-go="file">Add your first bill →</button>
      </div>
    ` : ""}
  `;
}

export function renderFileView(state) {
  const dash = state.dashboard || {};
  const env = dash.environment || {};
  const step = state.filingStep || 1;
  const steps = [
    { n: 1, label: "1. Add sales" },
    { n: 2, label: "2. Add purchases" },
    { n: 3, label: "3. Check tax credit" },
    { n: 4, label: "4. Review tax payable" },
    { n: 5, label: env.preparationOnly ? "5. Prepare return" : "5. Submit (Simulation)" }
  ];

  let bodyHtml = "";
  if (step === 1) {
    bodyHtml = renderInvoiceListPanel("sales", state.sales, state.loading.sales, state.errors.sales);
  } else if (step === 2) {
    bodyHtml = renderInvoiceListPanel("purchases", state.purchases, state.loading.purchases, state.errors.purchases);
  } else if (step === 3) {
    bodyHtml = `
      <div class="card">
        <h2>Step 3: Check tax credit &amp; reconciliation</h2>
        <p class="sub">Compare your purchase bills against GSTR-2B and verify the 180-day payment rule before claiming ITC.</p>
        <div class="banner info">Reconciliation summary and mismatch explanations are wired in detail in Phase 3.</div>
        <div class="row-between">
          <button type="button" class="btn outline" data-step="2">← Back</button>
          <button type="button" class="btn" data-step="4">Continue to Review Tax →</button>
        </div>
      </div>
    `;
  } else if (step === 4) {
    const m = dash.metrics || {};
    const p = m.paise || {
      totalOutputLiabilityPaise: rupeesToPaise(m.totalOutputLiability),
      totalItcUtilizedPaise: rupeesToPaise(m.totalItcUtilized),
      netCashPayablePaise: rupeesToPaise(m.netCashPayable)
    };
    bodyHtml = `
      <div class="card">
        <h2>Step 4: Review tax payable</h2>
        <p class="sub">Computed by the backend Rule 88A engine in integer paise.</p>
        <div class="kpi-grid kpi-grid-3">
          <div class="card"><div class="kpi-label">Gross Tax on Sales</div><div class="kpi-val num">${formatPaiseINR(p.totalOutputLiabilityPaise)}</div></div>
          <div class="card"><div class="kpi-label">Eligible Credit Used</div><div class="kpi-val num">${formatPaiseINR(p.totalItcUtilizedPaise)}</div></div>
          <div class="card fill"><div class="kpi-label mut-on-fill">Net Cash Payable</div><div class="kpi-val num">${formatPaiseINR(p.netCashPayablePaise)}</div></div>
        </div>
        <div class="row-between">
          <button type="button" class="btn outline" data-step="3">← Back</button>
          <button type="button" class="btn" data-step="5">Continue to Submit →</button>
        </div>
      </div>
    `;
  } else {
    bodyHtml = env.preparationOnly ? `
      <div class="card">
        <h2>Step 5: Preparation only</h2>
        <div class="banner info" role="status"><strong>Preparation only: filing is not connected yet.</strong> Export your CA review list or return summary for portal upload.</div>
        <button type="button" class="btn outline" data-step="4">← Back</button>
      </div>
    ` : `
      <div class="card">
        <h2>Step 5: Review &amp; Submit (Simulation)</h2>
        <div class="banner warn" role="status"><strong>Simulation Mode:</strong> This submission records a local simulated acknowledgement (<code>SIM-...</code>) and does not transmit to GSTN.</div>
        <p class="sub">Full EVC OTP confirmation and receipt flow will be completed in Phase 3.</p>
        <button type="button" class="btn outline" data-step="4">← Back</button>
      </div>
    `;
  }

  return `
    <h1 class="page-title">File GST Return</h1>
    <div class="sub">Period: <strong>${escapeHtml(dash.periodLabel || state.period || "")}</strong> · Draft progress is saved automatically for this GSTIN.</div>
    <div class="stepper" role="tablist" aria-label="Filing steps">
      ${steps.map(s => `
        <button type="button" class="step-btn ${step === s.n ? "active" : s.n < step ? "done" : ""}" data-step="${s.n}">
          ${escapeHtml(s.label)}
        </button>
      `).join("")}
    </div>
    ${bodyHtml}
  `;
}

function renderInvoiceListPanel(kind, rows, loadState, errMsg) {
  const isSales = kind === "sales";
  if (loadState === "loading") return renderLoadingCards(2);
  if (loadState === "error") return renderErrorBanner(errMsg || `Could not load ${kind}.`, `reload-${kind}`);

  if (!rows || rows.length === 0) {
    return `
      <div class="empty-state">
        <h3>No ${isSales ? "sales" : "purchase"} bills yet</h3>
        <p>Bills uploaded or created for this GSTIN and period will appear here.</p>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="row-between section-h2">
        <h2>${isSales ? "Sales Invoices" : "Purchase Bills"} (${rows.length})</h2>
        <button type="button" class="btn" data-step="${isSales ? 2 : 3}">Continue →</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>${isSales ? "Customer" : "Supplier"}</th>
              <th>Date</th>
              <th>Taxable</th>
              <th>GST</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td class="num"><strong>${escapeHtml(r.invoice_number)}</strong></td>
                <td>${escapeHtml(isSales ? r.customer_name : r.supplier_name)}</td>
                <td>${formatDateIN(r.invoice_date)}</td>
                <td class="num">${formatPaiseINR(rupeesToPaise(r.taxable_amount))}</td>
                <td class="num">${formatPaiseINR(rupeesToPaise(r.total_tax))}</td>
                <td class="num"><strong>${formatPaiseINR(rupeesToPaise(r.total_amount))}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderInvoicesView(state) {
  const tab = state.invoiceTab || "sales";
  return `
    <h1 class="page-title">Invoices</h1>
    <p class="sub">Verified sales and purchase bills stored for ${escapeHtml(state.activeGstin?.gstin || "")}.</p>
    <div class="stepper">
      <button type="button" class="step-btn ${tab === "sales" ? "active" : ""}" data-inv-tab="sales">Sales (${state.sales.length})</button>
      <button type="button" class="step-btn ${tab === "purchases" ? "active" : ""}" data-inv-tab="purchases">Purchases (${state.purchases.length})</button>
    </div>
    ${tab === "sales"
      ? renderInvoiceListPanel("sales", state.sales, state.loading.sales, state.errors.sales)
      : renderInvoiceListPanel("purchases", state.purchases, state.loading.purchases, state.errors.purchases)}
  `;
}

export function renderHistoryView(state) {
  if (state.loading.history === "loading") return `<h1 class="page-title">History</h1>${renderLoadingCards(2)}`;
  if (state.loading.history === "error") return `<h1 class="page-title">History</h1>${renderErrorBanner(state.errors.history, "reload-history")}`;

  const filings = state.filings || [];
  return `
    <h1 class="page-title">Filing History</h1>
    <p class="sub">Saved return acknowledgements for ${escapeHtml(state.activeGstin?.gstin || "")}.</p>
    ${filings.length === 0 ? `
      <div class="empty-state">
        <h3>No returns submitted yet</h3>
        <p>Completed filings (including local Simulation filings) will appear here with their reference numbers.</p>
      </div>
    ` : `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Period</th><th>Return</th><th>Status</th><th>Reference / ARN</th><th>Date</th></tr></thead>
            <tbody>
              ${filings.map(f => `
                <tr>
                  <td class="num">${escapeHtml(f.period)}</td>
                  <td>${escapeHtml(f.return_type)}</td>
                  <td><span class="pill ${f.simulationMode ? "warn" : "ok"}">${escapeHtml(f.displayStatus || f.status)}</span></td>
                  <td class="num">${escapeHtml(f.arn || "—")}</td>
                  <td>${formatDateIN(f.filing_date)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
}

export function renderCopilotView(state) {
  return `
    <h1 class="page-title">GST Copilot</h1>
    <p class="sub">Answers come from deterministic backend GST calculations for ${escapeHtml(state.activeGstin?.gstin || "")}.</p>
    <div class="card">
      <div id="copilot-page-msgs" class="cop-page-msgs">
        ${state.copilotMessages.length === 0 ? `<div class="msg bot">Ask me about your tax payable, eligible ITC, or filing deadline.</div>` : ""}
        ${state.copilotMessages.map(m => `<div class="msg ${m.role === "user" ? "user" : "bot"}">${escapeHtml(m.text)}</div>`).join("")}
      </div>
      <form id="copilot-page-form" class="row-between">
        <label for="copilot-page-input" class="skip-link">Ask Copilot</label>
        <input id="copilot-page-input" class="cop-page-input" type="text" placeholder="How much tax do I owe?">
        <button type="submit" class="btn">Ask</button>
      </form>
    </div>
  `;
}

export function renderExpertsView(state) {
  const plans = state.expertPlans || [];
  return `
    <h1 class="page-title">Tax Experts</h1>
    <p class="sub">Chartered Accountant assistance for your GST returns.</p>
    ${plans.length === 0 ? `<div class="empty-state"><h3>No plans loaded</h3><p>Check back shortly or contact support.</p></div>` : `
      <div class="kpi-grid kpi-grid-auto">
        ${plans.map(pl => `
          <div class="card">
            <h3>${escapeHtml(pl.title || pl.name)}</h3>
            <div class="kpi-val num">${formatPaiseINR(rupeesToPaise(pl.discountPrice || pl.price || 0))}</div>
            <p class="sub">${escapeHtml(pl.interval || "per month")}</p>
          </div>
        `).join("")}
      </div>
    `}
  `;
}

export function renderStartupView(state) {
  const prof = state.startupProfile;
  return `
    <h1 class="page-title">Start a business</h1>
    <p class="sub">Track your business formation and GST registration stages.</p>
    <div class="card">
      ${prof ? `
        <p><strong>Proposed Name:</strong> ${escapeHtml(prof.proposed_business_name || "Not set")}</p>
        <p><strong>Structure:</strong> ${escapeHtml(prof.business_structure || "Not selected")}</p>
        <p><strong>Status:</strong> <span class="pill soft">${escapeHtml(prof.registration_status || "IN_PROGRESS")}</span></p>
      ` : `<p class="sub">No startup profile initialized for this organization yet.</p>`}
    </div>
  `;
}

export function renderSettingsView(state) {
  const gstins = state.allGstins || [];
  return `
    <h1 class="page-title">Settings &amp; Multi-GSTIN</h1>
    <p class="sub">Active organization: <strong>${escapeHtml(state.organization?.name || "")}</strong></p>
    <div class="card">
      <h2 class="section-h2">Registered GSTIN Branches (${gstins.length})</h2>
      ${gstins.length === 0 ? `<p class="sub">No GSTIN registrations found.</p>` : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>GSTIN</th><th>Trade Name</th><th>State</th><th>Action</th></tr></thead>
            <tbody>
              ${gstins.map(g => {
                const isAct = state.activeGstin && state.activeGstin.id === g.id;
                return `
                  <tr>
                    <td class="num"><strong>${escapeHtml(g.gstin)}</strong></td>
                    <td>${escapeHtml(g.trade_name)}</td>
                    <td>${escapeHtml(g.state_name)}</td>
                    <td>
                      ${isAct
                        ? `<span class="pill ok">Active</span>`
                        : `<button type="button" class="btn outline" data-switch-gstin="${escapeHtml(g.id)}">Switch</button>`}
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

