import { escapeHtml, formatPaiseINR, rupeesToPaise, formatDateIN } from "./utils.js";
import { isMotionReduced } from "./motion.js";

function renderLoadingCards(count = 4) {
  return `
    <div class="kp" aria-busy="true" aria-label="Loading data">
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
      ${retryAction ? `<button type="button" class="btn o btn-sm" data-act="${escapeHtml(retryAction)}">Retry</button>` : ""}
    </div>
  `;
}

function renderMascot(completedCount, isBrandNew) {
  const bubble = isBrandNew
    ? "Let’s get started!"
    : completedCount >= 4
      ? "Ready to submit!"
      : `${completedCount} of 5 steps done!`;
  return `
    <div class="mas" id="mas" aria-hidden="true">
      <div class="bub">${escapeHtml(bubble)}</div>
      <svg viewBox="0 0 120 130">
        <circle cx="60" cy="66" r="52" fill="#FFC857" stroke="#E0A21B" stroke-width="5"/>
        <circle cx="60" cy="66" r="41" fill="none" stroke="#E0A21B" stroke-width="2" stroke-dasharray="3 5"/>
        <text x="60" y="44" text-anchor="middle" font-size="17" font-weight="800" fill="#B07A00">₹</text>
        <g class="bl"><circle cx="44" cy="62" r="10" fill="#fff"/><circle cx="76" cy="62" r="10" fill="#fff"/></g>
        <circle class="pp" cx="44" cy="62" r="5" fill="#12142B"/>
        <circle class="pp" cx="76" cy="62" r="5" fill="#12142B"/>
        <path d="M42 84q18 16 36 0" fill="none" stroke="#12142B" stroke-width="4" stroke-linecap="round"/>
        <circle cx="32" cy="80" r="5" fill="#FF9B7A" opacity=".6"/>
        <circle cx="88" cy="80" r="5" fill="#FF9B7A" opacity=".6"/>
      </svg>
    </div>
  `;
}

export function renderAuthView(state) {
  return `
    <section class="auth-shell" aria-labelledby="auth-heading">
      <div class="card">
        <div class="meta">Secure Sign In</div>
        <h1 id="auth-heading" class="pt">Sign in</h1>
        <p class="sub">Enter your business email and password to access your GST records.</p>

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
          <button type="submit" class="btn btn-full mag" id="login-submit-btn">Sign in</button>
        </form>
      </div>
    </section>
  `;
}

export function renderHomeView(state) {
  if (state.loading.dashboard === "loading") {
    return `
      <div class="meta">Loading your business summary…</div>
      <h1 class="gr"><span><i>Good</i></span> <span><i>morning.</i></span></h1>
      ${renderLoadingCards(4)}
    `;
  }

  if (state.loading.dashboard === "error") {
    return `
      <h1 class="pt">Home</h1>
      ${renderErrorBanner(state.errors.dashboard || "Could not load dashboard summary.", "reload-dashboard")}
    `;
  }

  const dash = state.dashboard;
  if (!dash || dash.empty) {
    return `
      <div class="empty">
        <b>Welcome to SimpleGST</b>
        <p>Select or add a GSTIN registration in Settings to begin tracking your sales, purchases, and GST returns.</p>
        <button type="button" class="btn mag" data-go="settings">Open Settings</button>
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

  const isBrandNew = Number(m.salesCount || 0) === 0 && Number(m.purchasesCount || 0) === 0;
  const step = state.filingStep || 1;
  const completedCount = (Number(m.salesCount || 0) > 0 ? 1 : 0) + (Number(m.purchasesCount || 0) > 0 ? 1 : 0) + (step > 3 ? 1 : 0) + (step > 4 ? 1 : 0);
  const ringCircumference = 314.16;
  const ringTarget = (ringCircumference * (1 - completedCount / 5)).toFixed(2);
  const firstName = escapeHtml((state.user?.name || state.user?.full_name || "there").split(" ")[0]);
  const dueStr = escapeHtml(dash.statutoryDeadlines?.gstr3b || "20th of next month");
  const greetingWords = `Good morning, ${firstName}.`.split(" ").map((w) => `<span><i>${w}</i></span>`).join(" ");

  const stripItems = `
    <span>Due ${dueStr}</span>
    <span>${completedCount} of 5 steps done</span>
    <span>ITC ${formatPaiseINR(p.totalEligibleItcPaise)}</span>
    <span>${env.preparationOnly ? "Preparation only" : "Simulation ready"}</span>
    <span>${Number(m.salesCount || 0)} sales · ${Number(m.purchasesCount || 0)} purchases</span>
  `;

  return `
    <div class="meta">
      <span>${escapeHtml(dash.entity?.tradeName || state.organization?.name || "")}</span>
      <code>${escapeHtml(dash.entity?.gstin || "")}</code>
      <span>${escapeHtml(dash.periodLabel || dash.period || "")}</span>
    </div>

    <h1 class="gr" aria-label="Good morning, ${firstName}.">${greetingWords}</h1>
    ${renderMascot(completedCount, isBrandNew)}

    ${bannerHtml}

    <div class="hg">
      <div class="card">
        <div class="hl">
          <div>
            <small>${escapeHtml(dash.periodLabel || "")} return · due ${dueStr}</small>
            <h2>${isBrandNew ? "Your GST is<br>ready to start." : "Continue your<br>GST filing."}</h2>
            <button type="button" class="btn lg2 mag" data-go="file">
              Continue GST filing <span class="ar" aria-hidden="true">→</span>
            </button>
          </div>
          <div class="rg">
            <svg viewBox="0 0 120 120" role="img" aria-label="${completedCount} of 5 steps done">
              <circle class="t" cx="60" cy="60" r="50"></circle>
              <circle class="p" cx="60" cy="60" r="50" data-to="${ringTarget}"></circle>
            </svg>
            <div class="rc">
              <b>${completedCount}/5</b>
              <span>steps done</span>
            </div>
          </div>
        </div>
      </div>

      <div class="stk">
        <button type="button" class="sr ${Number(m.salesCount || 0) > 0 ? "dn" : "rd"}" data-go="file" data-step="1">
          <div>
            <b>1 · Add sales</b>
            <span>Upload outward bills to customers</span>
          </div>
          <em>${Number(m.salesCount || 0) > 0 ? `Done (${Number(m.salesCount)}) ✓` : "Start →"}</em>
        </button>
        <button type="button" class="sr ${Number(m.purchasesCount || 0) > 0 ? "dn" : "rd"}" data-go="file" data-step="2">
          <div>
            <b>2 · Add purchases</b>
            <span>Upload supplier bills &amp; match GSTR-2B</span>
          </div>
          <em>${Number(m.purchasesCount || 0) > 0 ? `Done (${Number(m.purchasesCount)}) ✓` : "Start →"}</em>
        </button>
        <button type="button" class="sr ${step >= 3 ? "rd" : "dm"}" data-go="file" data-step="3">
          <div>
            <b>3 · Check credit &amp; review</b>
            <span>Verify ITC, Rule 88A offset &amp; submit (${env.preparationOnly ? "Prep only" : "Simulation"})</span>
          </div>
          <em>${step >= 3 ? "Ready →" : "Next →"}</em>
        </button>
      </div>
    </div>

    <div class="kp">
      <div class="kc">
        <small>Total Sales (${Number(m.salesCount || 0)} bills)</small>
        <div class="d" data-count-paise="${p.taxableSalesPaise}">${formatPaiseINR(p.taxableSalesPaise)}</div>
      </div>
      <div class="kc">
        <small>Total Purchases (${Number(m.purchasesCount || 0)} bills)</small>
        <div class="d" data-count-paise="${p.taxablePurchasesPaise}">${formatPaiseINR(p.taxablePurchasesPaise)}</div>
      </div>
      <div class="kc">
        <small>Available Tax Credit (ITC)</small>
        <div class="d" data-count-paise="${p.totalEligibleItcPaise}">${formatPaiseINR(p.totalEligibleItcPaise)}</div>
      </div>
      <div class="kc hi">
        <small>Estimated GST to Pay</small>
        <div class="d" data-count-paise="${p.netCashPayablePaise}">${formatPaiseINR(p.netCashPayablePaise)}</div>
      </div>
    </div>

    ${isBrandNew ? `
      <div class="empty">
        <b>No bills added yet for ${escapeHtml(dash.periodLabel || "this month")}</b>
        <p>Start by adding your sales bills or uploading supplier purchase bills. We will calculate your tax credit and payable GST automatically.</p>
        <button type="button" class="btn mag" data-go="file">Add your first bill →</button>
      </div>
    ` : `
      <div class="mq" aria-hidden="true"><div>${stripItems}${stripItems}</div></div>
    `}
  `;
}

export function renderFileView(state) {
  const dash = state.dashboard || {};
  const env = dash.environment || {};
  const step = state.filingStep || 1;
  const steps = [
    { n: 1, label: "Add sales" },
    { n: 2, label: "Add purchases" },
    { n: 3, label: "Check tax credit" },
    { n: 4, label: "Review tax payable" },
    { n: 5, label: env.preparationOnly ? "Prepare return" : "Submit (Simulation)" }
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
        <div class="banner info">Reconciliation summary and mismatch explanations are wired in Phase 3.</div>
        <div class="row sp2">
          <button type="button" class="btn o" data-step="2">← Back</button>
          <button type="button" class="btn mag" data-step="4">Continue to Review Tax →</button>
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
        <div class="kp kp-3">
          <div class="kc"><small>Gross Tax on Sales</small><div class="d" data-count-paise="${p.totalOutputLiabilityPaise}">${formatPaiseINR(p.totalOutputLiabilityPaise)}</div></div>
          <div class="kc"><small>Eligible Credit Used</small><div class="d" data-count-paise="${p.totalItcUtilizedPaise}">${formatPaiseINR(p.totalItcUtilizedPaise)}</div></div>
          <div class="kc hi"><small>Net Cash Payable</small><div class="d" data-count-paise="${p.netCashPayablePaise}">${formatPaiseINR(p.netCashPayablePaise)}</div></div>
        </div>
        <div class="row sp2">
          <button type="button" class="btn o" data-step="3">← Back</button>
          <button type="button" class="btn mag" data-step="5">Continue to Submit →</button>
        </div>
      </div>
    `;
  } else {
    bodyHtml = env.preparationOnly ? `
      <div class="card">
        <h2>Step 5: Preparation only</h2>
        <div class="banner info" role="status"><strong>Preparation only: filing is not connected yet.</strong> Export your CA review list or return summary for portal upload.</div>
        <button type="button" class="btn o" data-step="4">← Back</button>
      </div>
    ` : `
      <div class="card">
        <h2>Step 5: Review &amp; Submit (Simulation)</h2>
        <div class="banner warn" role="status"><strong>Simulation Mode:</strong> This submission records a local simulated acknowledgement (<code>SIM-...</code>) and does not transmit to GSTN.</div>
        <p class="sub">Interactive EVC OTP confirmation and receipt flow will be completed in Phase 3.</p>
        <button type="button" class="btn o" data-step="4">← Back</button>
      </div>
    `;
  }

  return `
    <h1 class="pt">File GST Return</h1>
    <div class="sub">Period: <strong>${escapeHtml(dash.periodLabel || state.period || "")}</strong> · Draft progress is saved automatically for this GSTIN.</div>
    <div class="stp" role="tablist" aria-label="Filing steps">
      ${steps.map(s => `
        <button type="button" class="sp ${step === s.n ? "on" : s.n < step ? "dn" : ""}" data-step="${s.n}">
          <b>${s.n < step ? "✓" : s.n}</b>${escapeHtml(s.label)}
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
      <div class="empty">
        <b>No ${isSales ? "sales" : "purchase"} bills yet</b>
        <p>Bills uploaded or created for this GSTIN and period will appear here.</p>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="row sp2" style="margin-bottom:14px">
        <h2>${isSales ? "Sales Invoices" : "Purchase Bills"} (${rows.length})</h2>
        <button type="button" class="btn mag" data-step="${isSales ? 2 : 3}">Continue →</button>
      </div>
      <div class="tw">
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
              <tr class="r">
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
    <h1 class="pt">My Invoices</h1>
    <p class="sub">Verified sales and purchase bills stored for ${escapeHtml(state.activeGstin?.gstin || "")}.</p>
    <div class="stp">
      <button type="button" class="sp ${tab === "sales" ? "on" : ""}" data-inv-tab="sales"><b>S</b>Sales (${state.sales.length})</button>
      <button type="button" class="sp ${tab === "purchases" ? "on" : ""}" data-inv-tab="purchases"><b>P</b>Purchases (${state.purchases.length})</button>
    </div>
    ${tab === "sales"
      ? renderInvoiceListPanel("sales", state.sales, state.loading.sales, state.errors.sales)
      : renderInvoiceListPanel("purchases", state.purchases, state.loading.purchases, state.errors.purchases)}
  `;
}

export function renderHistoryView(state) {
  if (state.loading.history === "loading") return `<h1 class="pt">History</h1>${renderLoadingCards(2)}`;
  if (state.loading.history === "error") return `<h1 class="pt">History</h1>${renderErrorBanner(state.errors.history, "reload-history")}`;

  const filings = state.filings || [];
  return `
    <h1 class="pt">History</h1>
    <p class="sub">Saved return acknowledgements for ${escapeHtml(state.activeGstin?.gstin || "")}.</p>
    ${filings.length === 0 ? `
      <div class="empty">
        <b>No returns submitted yet</b>
        <p>Completed filings (including local Simulation filings) will appear here with their reference numbers.</p>
      </div>
    ` : `
      <div class="card">
        <div class="tw">
          <table>
            <thead><tr><th>Period</th><th>Return</th><th>Status</th><th>Reference / ARN</th><th>Date</th></tr></thead>
            <tbody>
              ${filings.map(f => `
                <tr class="r">
                  <td class="num">${escapeHtml(f.period)}</td>
                  <td>${escapeHtml(f.return_type)}</td>
                  <td><span class="pill ${f.simulationMode ? "warn" : ""}">${escapeHtml(f.displayStatus || f.status)}</span></td>
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
  const m = state.dashboard?.metrics || {};
  const p = m.paise || {
    taxableSalesPaise: rupeesToPaise(m.taxableSales),
    totalEligibleItcPaise: rupeesToPaise(m.totalEligibleItc),
    netCashPayablePaise: rupeesToPaise(m.netCashPayable)
  };
  return `
    <h1 class="pt">GST Copilot</h1>
    <p class="sub">Answers come from deterministic backend GST calculations for ${escapeHtml(state.activeGstin?.gstin || "")}.</p>
    <div class="cpg">
      <div class="card" style="padding:0;overflow:hidden;margin:0">
        <div class="ms2" id="copilot-page-msgs">
          ${state.copilotMessages.length === 0 ? `<div class="m b">Ask me about your tax payable, eligible ITC, or filing deadline.</div>` : ""}
          ${state.copilotMessages.map(msg => `<div class="m ${msg.role === "user" ? "u" : "b"}">${escapeHtml(msg.text)}</div>`).join("")}
        </div>
        <div class="cs">
          <button type="button" data-act="ask-chip" data-q="How much tax do I owe?">Tax to pay?</button>
          <button type="button" data-act="ask-chip" data-q="How much ITC can I claim?">ITC?</button>
          <button type="button" data-act="ask-chip" data-q="Explain my GSTR-3B">GSTR-3B?</button>
        </div>
        <form id="copilot-page-form" class="cf">
          <label for="copilot-page-input" class="skip-link">Ask Copilot</label>
          <input id="copilot-page-input" class="in2" type="text" placeholder="How much tax do I owe?">
          <button type="submit" class="btn btn-sm">Ask</button>
        </form>
      </div>
      <div class="card">
        <h3>From your records</h3>
        <p class="sub">Total sales: <strong class="num">${formatPaiseINR(p.taxableSalesPaise)}</strong></p>
        <p class="sub">Tax credit (ITC): <strong class="num">${formatPaiseINR(p.totalEligibleItcPaise)}</strong></p>
        <p class="sub">Estimated tax to pay: <strong class="num">${formatPaiseINR(p.netCashPayablePaise)}</strong></p>
      </div>
    </div>
  `;
}

export function renderExpertsView(state) {
  const plans = state.expertPlans || [];
  return `
    <h1 class="pt">Tax Experts</h1>
    <p class="sub">Chartered Accountant assistance for your GST returns.</p>
    ${plans.length === 0 ? `<div class="empty"><b>No plans loaded</b><p>Check back shortly or contact support.</p></div>` : `
      <div class="g3">
        ${plans.map(pl => `
          <div class="card kc">
            <h3>${escapeHtml(pl.title || pl.name)}</h3>
            <div class="d num">${formatPaiseINR(rupeesToPaise(pl.discountPrice || pl.price || 0))}</div>
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
    <h1 class="pt">Start a business</h1>
    <p class="sub">Track your business formation and GST registration stages.</p>
    <div class="card">
      ${prof ? `
        <p><strong>Proposed Name:</strong> ${escapeHtml(prof.proposed_business_name || "Not set")}</p>
        <p><strong>Structure:</strong> ${escapeHtml(prof.business_structure || "Not selected")}</p>
        <p><strong>Status:</strong> <span class="pill v">${escapeHtml(prof.registration_status || "IN_PROGRESS")}</span></p>
      ` : `<p class="sub">No startup profile initialized for this organization yet.</p>`}
    </div>
  `;
}

export function renderSettingsView(state) {
  const gstins = state.allGstins || [];
  const reduced = isMotionReduced();
  return `
    <h1 class="pt">Settings</h1>
    <p class="sub">Active organization: <strong>${escapeHtml(state.organization?.name || "")}</strong></p>

    <div class="card">
      <h2 style="margin-bottom:10px">Preferences</h2>
      <div class="tg">
        <div>
          <b>Reduce animations</b>
          <span class="sub">Turn off page sweep, count-up, and cursor motion (follows device setting by default).</span>
        </div>
        <button type="button" class="sw2" role="switch" id="reduce-motion-toggle" data-act="toggle-reduce-motion" aria-checked="${reduced}" aria-label="Reduce animations"></button>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-bottom:12px">Registered GSTIN Branches (${gstins.length})</h2>
      ${gstins.length === 0 ? `<p class="sub">No GSTIN registrations found.</p>` : `
        <div class="tw">
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
                        ? `<span class="pill">Active</span>`
                        : `<button type="button" class="btn o btn-sm" data-switch-gstin="${escapeHtml(g.id)}">Switch</button>`}
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
