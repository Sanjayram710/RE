import { escapeHtml, formatPaiseINR, rupeesToPaise, formatDateIN, formatPeriodLabel, getTimeGreeting } from "./utils.js";
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
  const isReg = state.authMode === "register";
  return `
    <section class="auth-shell" aria-labelledby="auth-heading">
      <div class="card">
        <div class="meta">${isReg ? "New Business Setup" : "Secure Sign In"}</div>
        <h1 id="auth-heading" class="pt">${isReg ? "Create account" : "Sign in"}</h1>
        <p class="sub">${isReg ? "Create your SimpleGST owner account to start filing GST." : "Enter your business email and password to access your GST records."}</p>

        ${state.sessionExpiredMessage ? `<div class="banner warn" role="alert">${escapeHtml(state.sessionExpiredMessage)}</div>` : ""}
        ${state.errors.auth ? `<div class="banner err" role="alert">${escapeHtml(state.errors.auth)}</div>` : ""}

        ${isReg ? `
          <form id="register-form" novalidate>
            <div class="field">
              <label for="reg-name">Full Name</label>
              <input id="reg-name" name="fullName" type="text" required placeholder="e.g. Sanjay Kumar">
            </div>
            <div class="field">
              <label for="reg-mobile">10-digit Mobile Number</label>
              <input id="reg-mobile" name="mobile" type="tel" maxlength="10" required placeholder="9876543210">
            </div>
            <div class="field">
              <label for="reg-email">Email address</label>
              <input id="reg-email" name="email" type="email" autocomplete="email" required placeholder="you@yourshop.in">
            </div>
            <div class="field">
              <label for="reg-password">Password (8+ chars, A-Z, a-z, 0-9, symbol)</label>
              <input id="reg-password" name="password" type="password" autocomplete="new-password" required placeholder="Create a strong password">
            </div>
            <div class="field">
              <label for="reg-confirm">Confirm Password</label>
              <input id="reg-confirm" name="confirmPassword" type="password" autocomplete="new-password" required placeholder="Re-enter password">
            </div>
            <button type="submit" class="btn btn-full mag" id="register-submit-btn">Create account</button>
            <button type="button" class="btn o btn-full" data-act="toggle-auth-mode">Already have an account? Sign in</button>
          </form>
        ` : `
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
            ${state.demoCredentials ? `
              <button type="button" class="btn o btn-full" id="fill-demo-btn" data-act="fill-demo-login">Fill Demo Credentials</button>
            ` : ""}
            <button type="button" class="btn o btn-full" data-act="toggle-auth-mode">New to SimpleGST? Create account</button>
          </form>
        `}
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
    : "";

  const activePeriod = dash.period || state.period;
  const isFiled = !state.startFreshFiling && Boolean(
    (state.filingReceipt && state.filingReceipt.period === activePeriod) ||
    (state.filings || []).some((f) => f.period === activePeriod && String(f.return_type || "").includes("GSTR3B"))
  );
  const salesCount = state.startFreshFiling ? 0 : Number(m.salesCount || 0);
  const purchasesCount = state.startFreshFiling ? 0 : Number(m.purchasesCount || 0);
  const isBrandNew = salesCount === 0 && purchasesCount === 0 && !isFiled;
  const step = state.filingStep || 1;
  const step1Done = salesCount > 0 || step > 1 || isFiled;
  const step2Done = purchasesCount > 0 || step > 2 || isFiled;
  const step3Done = step > 3 || isFiled;
  const step4Done = step > 4 || isFiled;
  const step5Done = isFiled;
  const completedCount = (step1Done ? 1 : 0) + (step2Done ? 1 : 0) + (step3Done ? 1 : 0) + (step4Done ? 1 : 0) + (step5Done ? 1 : 0);
  const ringCircumference = 314.16;
  const ringTarget = (ringCircumference * (1 - completedCount / 5)).toFixed(2);
  const firstName = escapeHtml((state.user?.name || state.user?.full_name || "there").split(" ")[0]);
  const dueStr = escapeHtml(dash.statutoryDeadlines?.gstr3b || "20th of next month");
  const greetingPrefix = getTimeGreeting();
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const greetingWords = `${greetingPrefix}, ${firstName}.`.split(" ").map((w) => `<span><i>${w}</i></span>`).join(" ");

  const stripItems = `
    <span>Due ${dueStr}</span>
    <span>${completedCount} of 5 steps done</span>
    <span>ITC ${formatPaiseINR(p.totalEligibleItcPaise)}</span>
    <span>${isFiled ? "Return filed" : env.preparationOnly ? "Preparation only" : "Ready to file"}</span>
    <span>${salesCount} sales · ${purchasesCount} purchases</span>
  `;

  return `
    <div class="meta">
      <span>${escapeHtml(dash.entity?.tradeName || state.organization?.name || "")}</span>
      <code>${escapeHtml(dash.entity?.gstin || "")}</code>
      <span>${escapeHtml(dash.periodLabel || formatPeriodLabel(activePeriod))}</span>
      <span>${escapeHtml(todayLabel)}</span>
    </div>

    <h1 class="gr" aria-label="${escapeHtml(greetingPrefix)}, ${firstName}.">${greetingWords}</h1>
    ${renderMascot(completedCount, isBrandNew)}

    ${bannerHtml}

    <div class="hg">
      <div class="card">
        <div class="hl">
          <div>
            <small>${escapeHtml(dash.periodLabel || "")} return · due ${dueStr}</small>
            <h2>${isFiled ? "Your GST return<br>is filed." : isBrandNew ? "Your GST is<br>ready to start." : "Continue your<br>GST filing."}</h2>
            <button type="button" class="btn lg2 mag" data-go="${isFiled ? "history" : "file"}">
              ${isFiled ? "View filing history" : "Continue GST filing"} <span class="ar" aria-hidden="true">→</span>
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
        <button type="button" class="sr ${step1Done ? "dn" : "rd"}" data-go="file" data-step="1">
          <div>
            <b>1 · Add sales</b>
            <span>Upload outward bills to customers</span>
          </div>
          <em>${salesCount > 0 ? `Done (${salesCount}) ✓` : step1Done ? "Done ✓" : "Start →"}</em>
        </button>
        <button type="button" class="sr ${step2Done ? "dn" : "rd"}" data-go="file" data-step="2">
          <div>
            <b>2 · Add purchases</b>
            <span>Upload supplier bills &amp; match GSTR-2B</span>
          </div>
          <em>${purchasesCount > 0 ? `Done (${purchasesCount}) ✓` : step2Done ? "Done ✓" : "Start →"}</em>
        </button>
        <button type="button" class="sr ${isFiled ? "dn" : step >= 3 ? "rd" : "dm"}" data-go="file" data-step="3">
          <div>
            <b>3 · Check credit &amp; review</b>
            <span>Verify ITC, Rule 88A offset &amp; submit</span>
          </div>
          <em>${isFiled ? "Filed ✓" : step3Done ? "Done ✓" : step >= 3 ? "Ready →" : "Next →"}</em>
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
    ` : ""}

    <div class="mq" aria-hidden="true"><div>${stripItems}${stripItems}</div></div>
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
    { n: 5, label: env.preparationOnly ? "Prepare return" : "Submit" }
  ];

  let bodyHtml = "";
  if (step === 1) {
    bodyHtml = renderInvoiceListPanel("sales", state.sales, state.loading.sales, state.errors.sales, state, true);
  } else if (step === 2) {
    bodyHtml = renderInvoiceListPanel("purchases", state.purchases, state.loading.purchases, state.errors.purchases, state, true);
  } else if (step === 3) {
    bodyHtml = renderReconciliationStep(state);
  } else if (step === 4) {
    bodyHtml = renderTaxPayableStep(state, dash);
  } else {
    bodyHtml = renderSubmitStep(state, dash, env);
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

function computeOcrPreviewPaise(fields, activeStateCode) {
  const taxablePaise = rupeesToPaise(fields.taxableAmount || 0);
  const gstRate = Number(fields.gstRate !== undefined ? fields.gstRate : 18);
  const pos = String(fields.pos || activeStateCode || "27").slice(0, 2);
  const isInterstate = pos !== String(activeStateCode || "27").slice(0, 2);
  const totalTaxPaise = Math.round((taxablePaise * gstRate) / 100);
  const igstPaise = isInterstate ? totalTaxPaise : 0;
  const cgstPaise = isInterstate ? 0 : Math.floor(totalTaxPaise / 2);
  const sgstPaise = isInterstate ? 0 : (totalTaxPaise - cgstPaise);
  return {
    isInterstate,
    taxablePaise,
    igstPaise,
    cgstPaise,
    sgstPaise,
    totalTaxPaise,
    totalAmountPaise: taxablePaise + totalTaxPaise
  };
}

function renderUploadAndOcrBox(category, state) {
  const isSales = category === "sales_invoice";
  const isUploading = state.uploadingCategory === category;
  const ocr = state.ocrReview && state.ocrReview.category === category ? state.ocrReview : null;
  const activeStateCode = state.activeGstin?.state_code || "27";

  let ocrHtml = "";
  if (ocr) {
    const f = ocr.fields || {};
    const warnings = ocr.warnings || [];
    const needsConfirm = Number(ocr.confidenceScore || 0) < 0.85 || ocr.isScanned || warnings.length > 0;
    const prev = computeOcrPreviewPaise(f, activeStateCode);

    ocrHtml = `
      <div class="ocr-card" aria-live="polite">
        <div class="ocr-head">
          <h3>Review Extracted ${isSales ? "Sales Invoice" : "Purchase Bill"} · ${escapeHtml(ocr.filename)}</h3>
        </div>

        ${(warnings.length > 0 || ocr.isScanned) ? `
          <div class="ocr-warn" role="alert">
            <strong>Please verify before saving:</strong>
            <ul>
              ${ocr.isScanned ? "<li>Document appears scanned or image-based; confirm all numbers carefully.</li>" : ""}
              ${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}
            </ul>
          </div>
        ` : ""}

        ${ocr.error ? `<div class="banner err" role="alert"><span>${escapeHtml(ocr.error)}</span></div>` : ""}

        <form id="ocr-approve-form" novalidate>
          <div class="ocr-grid">
            <div class="ocr-field">
              <label for="ocr-invoiceNumber">Invoice Number *</label>
              <input id="ocr-invoiceNumber" data-ocr-field="invoiceNumber" type="text" required value="${escapeHtml(f.invoiceNumber || "")}">
            </div>
            <div class="ocr-field">
              <label for="ocr-invoiceDate">Invoice Date *</label>
              <input id="ocr-invoiceDate" data-ocr-field="invoiceDate" type="date" required value="${escapeHtml(f.invoiceDate || "")}">
            </div>
            <div class="ocr-field">
              <label for="ocr-partyName">${isSales ? "Customer Name *" : "Supplier Name *"}</label>
              <input id="ocr-partyName" data-ocr-field="partyName" type="text" required value="${escapeHtml(f.partyName || "")}">
            </div>
            <div class="ocr-field">
              <label for="ocr-gstin">${isSales ? "Customer GSTIN" : "Supplier GSTIN *"}</label>
              <input id="ocr-gstin" data-ocr-field="gstin" type="text" maxlength="15" value="${escapeHtml(f.gstin || "")}">
            </div>
            <div class="ocr-field">
              <label for="ocr-pos">Place of Supply (State Code)</label>
              <input id="ocr-pos" data-ocr-field="pos" type="text" maxlength="2" value="${escapeHtml(f.pos || activeStateCode)}">
            </div>
            <div class="ocr-field">
              <label for="ocr-taxableAmount">Taxable Value (₹) *</label>
              <input id="ocr-taxableAmount" data-ocr-field="taxableAmount" type="number" step="0.01" min="0" required value="${escapeHtml(String(f.taxableAmount ?? ""))}">
            </div>
            <div class="ocr-field">
              <label for="ocr-gstRate">GST Rate (%)</label>
              <select id="ocr-gstRate" data-ocr-field="gstRate">
                ${[0, 5, 12, 18, 28].map(r => `<option value="${r}" ${Number(f.gstRate ?? 18) === r ? "selected" : ""}>${r}%</option>`).join("")}
              </select>
            </div>
            ${!isSales ? `
              <div class="ocr-field">
                <label for="ocr-itcEligibility">ITC Eligibility</label>
                <select id="ocr-itcEligibility" data-ocr-field="itcEligibility">
                  <option value="ELIGIBLE" ${(f.itcEligibility || "ELIGIBLE") === "ELIGIBLE" ? "selected" : ""}>Eligible ITC</option>
                  <option value="INELIGIBLE_17_5" ${f.itcEligibility === "INELIGIBLE_17_5" ? "selected" : ""}>Ineligible (Sec 17(5))</option>
                  <option value="INELIGIBLE_OTHER" ${f.itcEligibility === "INELIGIBLE_OTHER" ? "selected" : ""}>Ineligible (Other)</option>
                </select>
              </div>
              <div class="ocr-field">
                <label for="ocr-isRcm">Reverse Charge (RCM)</label>
                <select id="ocr-isRcm" data-ocr-field="isRcm">
                  <option value="false" ${!f.isRcm ? "selected" : ""}>No (Regular)</option>
                  <option value="true" ${f.isRcm ? "selected" : ""}>Yes (RCM Cash Liability)</option>
                </select>
              </div>
            ` : ""}
          </div>

          <div class="ocr-tax-preview" id="ocr-tax-preview">
            <span>Supply: <b>${prev.isInterstate ? "Interstate (IGST)" : "Intrastate (CGST + SGST)"}</b></span>
            <span>CGST: <b>${formatPaiseINR(prev.cgstPaise)}</b></span>
            <span>SGST: <b>${formatPaiseINR(prev.sgstPaise)}</b></span>
            <span>IGST: <b>${formatPaiseINR(prev.igstPaise)}</b></span>
            <span>Total Tax: <b>${formatPaiseINR(prev.totalTaxPaise)}</b></span>
            <span>Total Bill: <b>${formatPaiseINR(prev.totalAmountPaise)}</b></span>
          </div>

          ${needsConfirm ? `
            <label class="ocr-confirm-box">
              <input type="checkbox" id="ocr-confirm-check" ${ocr.confirmed ? "checked" : ""}>
              <span>I have checked the extracted numbers against the bill and confirm they are accurate.</span>
            </label>
          ` : ""}

          <div class="ocr-actions">
            <button type="button" class="btn o btn-sm" data-act="discard-ocr">Discard</button>
            <button type="submit" class="btn mag" id="ocr-save-btn" ${ocr.saving || (needsConfirm && !ocr.confirmed) ? "disabled" : ""}>
              ${ocr.saving ? "Saving…" : "Confirm & Save"}
            </button>
          </div>
        </form>
      </div>
    `;
  }

  return `
    <div class="dz ${isUploading ? "on" : ""}" data-drop-cat="${category}">
      <h3>${isSales ? "Upload Sales Invoice (PDF / PNG / JPG)" : "Upload Purchase Bill (PDF / PNG / JPG)"}</h3>
      <p>${isUploading ? "Extracting fields from your document…" : "Drag and drop a bill here or choose a file (max 15 MB). You can review and edit extracted GST fields before saving."}</p>
      <input class="dz-input" type="file" id="file-upload-${category}" data-upload-cat="${category}" accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,application/pdf,image/png,image/jpeg,text/csv,text/plain">
      <div class="dz-actions">
        <label for="file-upload-${category}" class="btn btn-sm">${isUploading ? "Uploading…" : "Choose File"}</label>
      </div>
    </div>
    ${ocrHtml}
  `;
}

function renderInvoiceListPanel(kind, rows, loadState, errMsg, state, showStepNav = false) {
  const isSales = kind === "sales";
  const category = isSales ? "sales_invoice" : "purchase_bill";
  if (loadState === "loading") return renderUploadAndOcrBox(category, state) + renderLoadingCards(2);
  if (loadState === "error") return renderUploadAndOcrBox(category, state) + renderErrorBanner(errMsg || `Could not load ${kind}.`, `reload-${kind}`);

  return `
    ${renderUploadAndOcrBox(category, state)}
    ${(!rows || rows.length === 0) ? `
      <div class="empty">
        <b>No ${isSales ? "sales" : "purchase"} bills yet</b>
        <p>Upload a ${isSales ? "sales invoice" : "supplier bill"} above for this GSTIN and period.</p>
        ${showStepNav ? `<button type="button" class="btn o" data-step="${isSales ? 2 : 3}">Continue to next step →</button>` : ""}
      </div>
    ` : `
      <div class="card">
        <div class="recon-actions">
          <h2>${isSales ? "Sales Invoices" : "Purchase Bills"} (${rows.length})</h2>
          ${showStepNav ? `
            <div class="dz-actions">
              ${!isSales ? `<button type="button" class="btn o" data-step="1">← Back</button>` : ""}
              <button type="button" class="btn mag" data-step="${isSales ? 2 : 3}">Continue →</button>
            </div>
          ` : ""}
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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr class="r${state.recentAddedId === r.id ? " new-row" : ""}" data-row-id="${escapeHtml(r.id)}">
                  <td class="num"><strong>${escapeHtml(r.invoice_number)}</strong></td>
                  <td>${escapeHtml(isSales ? r.customer_name : r.supplier_name)}</td>
                  <td>${formatDateIN(r.invoice_date)}</td>
                  <td class="num">${formatPaiseINR(rupeesToPaise(r.taxable_amount))}</td>
                  <td class="num">${formatPaiseINR(rupeesToPaise(r.total_tax))}</td>
                  <td class="num"><strong>${formatPaiseINR(rupeesToPaise(r.total_amount))}</strong></td>
                  <td>
                    <button type="button" class="del" data-del-kind="${kind}" data-del-id="${escapeHtml(r.id)}" data-del-num="${escapeHtml(r.invoice_number)}">Delete</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
}

function renderReconciliationStep(state) {
  const recon = state.reconciliation || { summary: null, items: [], loading: "idle", error: "" };
  const sum = recon.summary || {};
  const items = recon.items || [];
  const dash = state.dashboard || {};
  const m = dash.metrics || {};

  return `
    <div class="card">
      <div class="recon-actions">
        <div>
          <h2>Step 3: Check tax credit &amp; GSTR-2B reconciliation</h2>
          <p class="sub">Matches your purchase bills against GSTR-2B and checks the 180-day supplier payment rule (Sec 16(2)).</p>
        </div>
        <button type="button" class="btn btn-sm" data-act="run-recon" ${recon.loading === "loading" ? "disabled" : ""}>
          ${recon.loading === "loading" ? "Checking…" : "Run GSTR-2B Match"}
        </button>
      </div>

      ${recon.error ? renderErrorBanner(recon.error, "run-recon") : ""}

      <div class="kp">
        <div class="kc"><small>Matched in GSTR-2B</small><div class="d">${Number(sum.matchedCount || 0)}</div></div>
        <div class="kc"><small>Mismatched / Missing</small><div class="d">${Number(sum.mismatchedCount || 0) + Number(sum.missingIn2bCount || 0)}</div></div>
        <div class="kc"><small>180-Day Rule 37 Alerts</small><div class="d">${Number(sum.rule37RiskCount || m.rule37RiskCount || 0)}</div></div>
        <div class="kc hi"><small>Eligible ITC</small><div class="d">${formatPaiseINR(rupeesToPaise(sum.eligibleItc ?? m.totalEligibleItc ?? 0))}</div></div>
      </div>

      ${items.length === 0 ? `
        <div class="empty">
          <b>No GSTR-2B comparison rows yet</b>
          <p>Click "Run GSTR-2B Match" above after uploading purchase bills to check credit eligibility.</p>
        </div>
      ` : `
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Supplier</th>
                <th>Invoice #</th>
                <th>Books Tax</th>
                <th>GSTR-2B Tax</th>
                <th>Guidance</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(it => {
                const st = it.match_status || "UNMATCHED";
                const bCls = st === "MATCHED" ? "ok" : st === "MISMATCHED" ? "warn" : "bad";
                return `
                  <tr class="r">
                    <td><span class="badge ${bCls}">${escapeHtml(st)}</span></td>
                    <td>${escapeHtml(it.supplier_name || it.supplier_gstin || "Supplier")}</td>
                    <td class="num">${escapeHtml(it.invoice_number || "—")}</td>
                    <td class="num">${formatPaiseINR(rupeesToPaise(it.books_tax || 0))}</td>
                    <td class="num">${formatPaiseINR(rupeesToPaise(it.gstr2b_tax || 0))}</td>
                    <td>${escapeHtml(it.action || it.investigation_notes || "Check supplier return")}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `}

      <div class="row sp2">
        <button type="button" class="btn o" data-step="2">← Back</button>
        <button type="button" class="btn mag" data-step="4">Continue to Review Tax →</button>
      </div>
    </div>
  `;
}

function renderTaxPayableStep(state, dash) {
  const m = dash.metrics || {};
  const p = m.paise || {
    totalOutputLiabilityPaise: rupeesToPaise(m.totalOutputLiability),
    totalItcUtilizedPaise: rupeesToPaise(m.totalItcUtilized),
    netCashPayablePaise: rupeesToPaise(m.netCashPayable),
    rcmLiabilityPaise: rupeesToPaise(m.rcmLiability || 0)
  };
  const matrix = dash.setoffMatrix || [];

  return `
    <div class="card">
      <div class="ca-bar">
        <div>
          <h2>Step 4: Review tax payable</h2>
          <p class="sub">Rule 88A cross-utilization order and RCM cash-only items computed in integer paise. Statutory references are flagged for CA review.</p>
        </div>
        <button type="button" class="btn o btn-sm" data-act="export-ca-csv">Export CA Review List (CSV)</button>
      </div>

      <div class="kp kp-3">
        <div class="kc"><small>Gross Tax on Sales</small><div class="d" data-count-paise="${p.totalOutputLiabilityPaise}">${formatPaiseINR(p.totalOutputLiabilityPaise)}</div></div>
        <div class="kc"><small>Eligible Credit Used</small><div class="d" data-count-paise="${p.totalItcUtilizedPaise}">${formatPaiseINR(p.totalItcUtilizedPaise)}</div></div>
        <div class="kc hi"><small>Net Cash Payable</small><div class="d" data-count-paise="${p.netCashPayablePaise}">${formatPaiseINR(p.netCashPayablePaise)}</div></div>
      </div>

      ${Number(p.rcmLiabilityPaise || 0) > 0 ? `
        <div class="rcm-box" role="status">
          <h4>Reverse Charge (RCM) Cash Liability: ${formatPaiseINR(p.rcmLiabilityPaise)}</h4>
          <p>Under Sec 9(3)/9(4), Reverse Charge tax must be paid in cash before claiming matching input credit.</p>
        </div>
      ` : ""}

      ${matrix.length > 0 ? `
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Tax Head</th>
                <th>Output Tax</th>
                <th>Credit Used (Rule 88A)</th>
                <th>Cash Payable</th>
              </tr>
            </thead>
            <tbody>
              ${matrix.map(row => `
                <tr class="r">
                  <td><strong>${escapeHtml(row.head || row.taxHead || "")}</strong></td>
                  <td class="num">${formatPaiseINR(rupeesToPaise(row.output || row.outputLiability || 0))}</td>
                  <td class="num">${formatPaiseINR(rupeesToPaise(row.itcUsed || row.creditUsed || 0))}</td>
                  <td class="num"><strong>${formatPaiseINR(rupeesToPaise(row.cashPayable || 0))}</strong></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : ""}

      <div class="row sp2">
        <button type="button" class="btn o" data-step="3">← Back</button>
        <button type="button" class="btn mag" data-step="5">Continue to Submit →</button>
      </div>
    </div>
  `;
}

function renderSubmitStep(state, dash, env) {
  if (env.preparationOnly) {
    return `
      <div class="card">
        <h2>Step 5: Preparation only</h2>
        <div class="banner info" role="status"><strong>Preparation only: filing is not connected yet.</strong> Export your CA review list or return summary for portal upload.</div>
        <div class="row sp2">
          <button type="button" class="btn o" data-step="4">← Back</button>
          <button type="button" class="btn o" data-act="export-ca-csv">Export CA Review List (CSV)</button>
        </div>
      </div>
    `;
  }

  const existingFiling = state.startFreshFiling
    ? null
    : (state.filings || []).find((f) => f.period === state.period && String(f.return_type || "").includes("GSTR3B"));
  const rec = state.filingReceipt || existingFiling;
  if (rec) {
    return `
      <div class="sim-receipt">
        <span class="sim-badge">Filed</span>
        <h2>Return Submitted</h2>
        <p class="sub">Your GSTR-3B return has been recorded for this period.</p>
        <div class="kp kp-3">
          <div class="kc"><small>Period</small><div class="d">${escapeHtml(formatPeriodLabel(rec.period || state.period))}</div></div>
          <div class="kc"><small>Status</small><div class="d">Filed</div></div>
          <div class="kc hi"><small>Submitted On</small><div class="d">${formatDateIN(rec.filingTimestamp || rec.filing_date || new Date().toISOString())}</div></div>
        </div>
        <div class="row sp2">
          <button type="button" class="btn o" data-go="history">View Filing History →</button>
          <button type="button" class="btn mag" data-act="start-new-filing">Back to Home</button>
        </div>
      </div>
    `;
  }

  const m = dash.metrics || {};
  const netCashPaise = m.paise ? m.paise.netCashPayablePaise : rupeesToPaise(m.netCashPayable || 0);

  return `
    <div class="card">
      <h2>Step 5: Review &amp; Submit</h2>
      ${state.filingError ? `<div class="banner err" role="alert"><span>${escapeHtml(state.filingError)}</span></div>` : ""}

      <div class="otp-card">
        <p class="sub">Net Cash Payable for <strong>${escapeHtml(dash.periodLabel || formatPeriodLabel(state.period))}</strong>: <strong>${formatPaiseINR(netCashPaise)}</strong></p>
        <form id="sim-file-form" novalidate>
          <div class="field">
            <label for="sim-otp-input">Enter 6-digit EVC OTP</label>
            <input id="sim-otp-input" class="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="123456" required>
          </div>
          <div class="row sp2">
            <button type="button" class="btn o" data-step="4">← Back</button>
            <button type="submit" class="btn mag" id="sim-submit-btn" ${state.submittingReturn ? "disabled" : ""}>
              ${state.submittingReturn ? "Submitting…" : "Submit GSTR-3B"}
            </button>
          </div>
        </form>
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
      ? renderInvoiceListPanel("sales", state.sales, state.loading.sales, state.errors.sales, state, false)
      : renderInvoiceListPanel("purchases", state.purchases, state.loading.purchases, state.errors.purchases, state, false)}
  `;
}

export function renderHistoryView(state) {
  if (state.loading.history === "loading") return `<h1 class="pt">History</h1>${renderLoadingCards(2)}`;
  if (state.loading.history === "error") return `<h1 class="pt">History</h1>${renderErrorBanner(state.errors.history, "reload-history")}`;

  const filings = state.filings || [];
  const months = state.monthlyHistory || [];
  return `
    <h1 class="pt">History</h1>
    <p class="sub">Last 3 months and submitted return records for ${escapeHtml(state.activeGstin?.gstin || "")}.</p>

    ${months.length > 0 ? `
      <div class="card">
        <h2>Monthly Activity (Last 3 Months)</h2>
        <p class="sub">Uploaded files, bills, and filing status by month.</p>
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Sales Bills</th>
                <th>Purchase Bills</th>
                <th>Taxable Sales</th>
                <th>Uploaded Files</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${months.map(m => `
                <tr class="r">
                  <td><strong>${escapeHtml(m.label || formatPeriodLabel(m.period))}</strong>${m.isCurrent ? ` <span class="pill">Current</span>` : ""}</td>
                  <td class="num">${Number(m.salesCount || 0)}</td>
                  <td class="num">${Number(m.purchasesCount || 0)}</td>
                  <td class="num">${formatPaiseINR(rupeesToPaise(m.salesTaxable || 0))}</td>
                  <td class="num">${Number(m.filesCount || 0)}</td>
                  <td><span class="badge ${m.status === "Filed" ? "ok" : m.status === "In Progress" ? "warn" : ""}">${escapeHtml(m.status)}</span></td>
                  <td><button type="button" class="btn o btn-sm" data-switch-period="${escapeHtml(m.period)}">Open</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    ` : ""}

    ${filings.length === 0 ? `
      <div class="empty">
        <b>No returns submitted yet</b>
        <p>Completed returns will appear here once submitted.</p>
      </div>
    ` : `
      <div class="card">
        <h2>Submitted Returns</h2>
        <div class="tw">
          <table>
            <thead><tr><th>Period</th><th>Return</th><th>Status</th><th>Submitted On</th></tr></thead>
            <tbody>
              ${filings.map(f => `
                <tr class="r">
                  <td><strong>${escapeHtml(formatPeriodLabel(f.period))}</strong></td>
                  <td>${escapeHtml(f.return_type)}</td>
                  <td><span class="badge ok">Filed</span></td>
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
