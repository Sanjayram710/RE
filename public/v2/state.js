/**
 * Central Application State for SimpleGST v2
 * No hardcoded financial figures, no mock invoices, no fake ARNs.
 */

export function createInitialState() {
  return {
    authChecked: false,
    authenticated: false,
    sessionExpiredMessage: "",
    user: null,
    organization: null,
    activeGstin: null,
    allGstins: [],
    period: "",
    view: "home",
    filingStep: 1,
    invoiceTab: "sales",
    historyTab: "filings",
    copilotOpen: false,

    loading: {
      dashboard: "idle",
      sales: "idle",
      purchases: "idle",
      draft: "idle",
      history: "idle",
      documents: "idle",
      experts: "idle",
      startup: "idle"
    },
    errors: {
      dashboard: "",
      sales: "",
      purchases: "",
      draft: "",
      history: "",
      documents: "",
      auth: ""
    },

    dashboard: null,
    draft: null,
    sales: [],
    purchases: [],
    documents: [],
    filings: [],
    monthlyHistory: [],
    expertPlans: [],
    startupProfile: null,
    copilotMessages: [],
    ocrReview: null,
    uploadingCategory: null,
    recentAddedId: null,
    reconciliation: { summary: null, items: [], loading: "idle", error: "" },
    filingReceipt: null,
    submittingReturn: false,
    filingError: ""
  };
}

export const state = createInitialState();

export function clearBusinessCache() {
  state.dashboard = null;
  state.draft = null;
  state.filingStep = 1;
  state.sales = [];
  state.purchases = [];
  state.documents = [];
  state.filings = [];
  state.monthlyHistory = [];
  state.ocrReview = null;
  state.uploadingCategory = null;
  state.recentAddedId = null;
  state.reconciliation = { summary: null, items: [], loading: "idle", error: "" };
  state.filingReceipt = null;
  state.submittingReturn = false;
  state.filingError = "";
  state.errors.dashboard = "";
  state.errors.sales = "";
  state.errors.purchases = "";
  state.errors.draft = "";
  state.errors.history = "";
  state.errors.documents = "";
  state.loading.dashboard = "idle";
  state.loading.sales = "idle";
  state.loading.purchases = "idle";
  state.loading.draft = "idle";
  state.loading.history = "idle";
  state.loading.documents = "idle";
}

