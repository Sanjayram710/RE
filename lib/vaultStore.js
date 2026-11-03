/**
 * SimpleGST In-App Tax Document Vault & Repository
 * Organizes tax documents with category tagging, metadata, and import triggers
 */

export const INITIAL_VAULT_DOCUMENTS = [
  {
    id: "doc-1",
    name: "Form_16_Part_A_and_B_AY2025-26.pdf",
    category: "Salary & Form 16",
    fileType: "PDF",
    size: "248 KB",
    uploadDate: "2026-10-15",
    status: "Verified",
    description: "Salary TDS certificate issued by Infosys BPM Limited",
    downloadUrl: "#"
  },
  {
    id: "doc-2",
    name: "Annual_Information_Statement_AIS_2024-25.json",
    category: "AIS & TIS",
    fileType: "JSON",
    size: "82 KB",
    uploadDate: "2026-10-18",
    status: "Parsed",
    description: "Comprehensive financial transaction ledger from incometax.gov.in",
    downloadUrl: "#"
  },
  {
    id: "doc-3",
    name: "Form_26AS_Tax_Credit_Statement.pdf",
    category: "Tax Credits (26AS)",
    fileType: "PDF",
    size: "180 KB",
    uploadDate: "2026-10-20",
    status: "Reconciled",
    description: "Verified tax credits deposited against PAN CVBBC4433W",
    downloadUrl: "#"
  },
  {
    id: "doc-4",
    name: "Zerodha_Tax_PnL_FY2024-25.xlsx",
    category: "Broker Reports",
    fileType: "XLSX",
    size: "420 KB",
    uploadDate: "2026-10-25",
    status: "Processed",
    description: "Capital gains statement with STCG @ 20% and LTCG 112A schedule",
    downloadUrl: "#"
  },
  {
    id: "doc-5",
    name: "ITR1_Ack_AY2024-25_Verified.pdf",
    category: "Filed Returns (ITR-V)",
    fileType: "PDF",
    size: "112 KB",
    uploadDate: "2025-07-28",
    status: "Filed & Processed",
    description: "Official CBDT e-Filing Acknowledgement Receipt",
    downloadUrl: "#"
  }
];

class VaultStore {
  constructor() {
    this.documents = [...INITIAL_VAULT_DOCUMENTS];
  }

  listDocuments(category = "all") {
    if (!category || category === "all") {
      return this.documents;
    }
    return this.documents.filter(d => d.category.toLowerCase().includes(category.toLowerCase()));
  }

  addDocument(doc) {
    const newDoc = {
      id: `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: doc.name || "Tax_Document.pdf",
      category: doc.category || "General Documents",
      fileType: (doc.name || "").split(".").pop().toUpperCase() || "PDF",
      size: doc.size || "150 KB",
      uploadDate: new Date().toISOString().split("T")[0],
      status: "Uploaded & Verified",
      description: doc.description || "Uploaded taxpayer compliance record",
      downloadUrl: "#"
    };
    this.documents.unshift(newDoc);
    return newDoc;
  }

  deleteDocument(id) {
    const idx = this.documents.findIndex(d => d.id === id);
    if (idx !== -1) {
      return this.documents.splice(idx, 1)[0];
    }
    return null;
  }
}

export const vaultStore = new VaultStore();

