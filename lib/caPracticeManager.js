/**
 * CA Multi-Client Practice Management Engine
 * 
 * Capabilities:
 * - Multi-client workspace & GSTIN portfolio management
 * - Compliance Matrix across tax periods (GSTR-1 & GSTR-3B filing statuses)
 * - Pending Document Tracking (Missing sales bills, purchase invoices, e-way bills)
 * - ITC Mismatch Dashboard (Books vs GSTR-2B Section 16(2)(aa) variance)
 * - Statutory Client Escalations & Automated Reminders
 */

export const PRACTICE_CLIENTS = [
  {
    clientId: 'CLI-001',
    tradeName: 'Apex Hypermarkets Pvt Ltd',
    pan: 'AAACB1234F',
    gstin: '32AAACB1234F1Z5',
    state: 'Kerala',
    category: 'REGULAR_MONTHLY',
    assignedCA: 'CA Sanjay Ram, FCA',
    status: 'ACTIVE',
    filingHistory: {
      '092026': { gstr1: 'FILED', gstr1Arn: 'AA3209260012345', gstr3b: 'FILED', gstr3bArn: 'AB3209260054321' },
      '102026': { gstr1: 'READY_TO_FILE', gstr1Arn: null, gstr3b: 'PENDING_PREREQUISITE', gstr3bArn: null }
    },
    itcMismatch: { booksItc: 245000, gstr2bItc: 240000, difference: 5000, risk: 'MEDIUM' }
  },
  {
    clientId: 'CLI-002',
    tradeName: 'Zenith Logistics LLP',
    pan: 'BBBCB5678G',
    gstin: '29BBBCB5678G1Z2',
    state: 'Karnataka',
    category: 'QRMP_QUARTERLY',
    assignedCA: 'CA Ramesh Kumar, ACA',
    status: 'ACTIVE',
    filingHistory: {
      'Q2-2026': { gstr1: 'FILED', gstr1Arn: 'AA2909260098765', gstr3b: 'FILED', gstr3bArn: 'AB2909260067890' },
      '102026': { pmt06: 'PAID', iff: 'OPTIONAL_PENDING' }
    },
    itcMismatch: { booksItc: 82000, gstr2bItc: 82000, difference: 0, risk: 'LOW' }
  },
  {
    clientId: 'CLI-003',
    tradeName: 'Greenfield Agri Ventures',
    pan: 'CCCCB9012H',
    gstin: '33CCCCB9012H1Z9',
    state: 'Tamil Nadu',
    category: 'REGULAR_MONTHLY',
    assignedCA: 'CA Sanjay Ram, FCA',
    status: 'ACTIVE',
    filingHistory: {
      '092026': { gstr1: 'FILED', gstr1Arn: 'AA3309260011223', gstr3b: 'FILED', gstr3bArn: 'AB3309260033221' },
      '102026': { gstr1: 'PENDING_DOCS', gstr1Arn: null, gstr3b: 'LOCKED', gstr3bArn: null }
    },
    itcMismatch: { booksItc: 120000, gstr2bItc: 90000, difference: 30000, risk: 'HIGH' }
  }
];

/**
 * Returns practice summary dashboard.
 */
export function getPracticeDashboardSummary() {
  const totalClients = PRACTICE_CLIENTS.length;
  let filedCount = 0;
  let pendingCount = 0;
  let highRiskMismatches = 0;

  for (const client of PRACTICE_CLIENTS) {
    const cur = client.filingHistory['102026'];
    if (cur && (cur.gstr1 === 'FILED' || cur.pmt06 === 'PAID')) {
      filedCount++;
    } else {
      pendingCount++;
    }
    if (client.itcMismatch && client.itcMismatch.risk === 'HIGH') {
      highRiskMismatches++;
    }
  }

  return {
    totalClients,
    filedCount,
    pendingCount,
    highRiskMismatches,
    clients: PRACTICE_CLIENTS
  };
}

/**
 * Returns compliance matrix for practice clients.
 */
export function getPracticeComplianceMatrix() {
  return PRACTICE_CLIENTS.map(c => ({
    clientId: c.clientId,
    tradeName: c.tradeName,
    gstin: c.gstin,
    state: c.state,
    filingCategory: c.category,
    october2026Status: {
      gstr1: c.filingHistory['102026']?.gstr1 || c.filingHistory['102026']?.iff || 'PENDING',
      gstr3b: c.filingHistory['102026']?.gstr3b || (c.category === 'QRMP_QUARTERLY' ? 'QUARTERLY_DUE_NOV_22' : 'LOCKED_BY_SEC_39_10')
    },
    itcStatus: {
      booksItc: c.itcMismatch.booksItc,
      gstr2bItc: c.itcMismatch.gstr2bItc,
      unmatchedExcess: c.itcMismatch.difference,
      riskLevel: c.itcMismatch.risk,
      action: c.itcMismatch.difference > 0 ? 'Hold claim until 2B reflection or issue vendor notice' : 'Eligible for 100% claim'
    }
  }));
}

/**
 * Generates automated compliance reminder for a client.
 */
export function generateClientReminder(clientId) {
  const client = PRACTICE_CLIENTS.find(c => c.clientId === clientId);
  if (!client) throw new Error('Client not found');

  return {
    clientId: client.clientId,
    tradeName: client.tradeName,
    gstin: client.gstin,
    recipientEmail: `accounts@${client.tradeName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
    subject: `[Urgent GST Compliance] Pending Documents & GSTR-1 Deadline for Period October 2026`,
    body: `Dear ${client.tradeName} Team,\n\nThis is a compliance reminder from ${client.assignedCA}.\n\nUnder Section 37(1) of the CGST Act, your GSTR-1 for October 2026 is due on the 11th. Please note that under Section 39(10), GSTR-3B cannot be prepared or filed until GSTR-1 is complete.\n\nCurrent Status:\n- GSTR-1: ${client.filingHistory['102026']?.gstr1 || 'Pending documents'}\n- ITC Mismatch: ₹${client.itcMismatch.difference} excess in books vs GSTR-2B.\n\nPlease upload all pending sales invoices and bank statements to the SimpleGST vault immediately.\n\nRegards,\nPractice Compliance Cell`,
    timestamp: new Date().toISOString()
  };
}
