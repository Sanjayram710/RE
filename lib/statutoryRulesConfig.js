/**
 * Statutory Rules Configuration — Republic of India GST Compliance
 * Governed by: CGST Act 2017, IGST Act 2017, CGST Rules 2017, CBIC Notifications & Circulars
 * Updated through: November 2026
 */

export const STATUTORY_RULES = {
  jurisdiction: 'Republic of India',
  acts: ['CGST Act, 2017', 'IGST Act, 2017', 'UTGST Act, 2017'],

  // Section 47 & CBIC Rationalization: Late Fee Caps (per Act / halved for CGST & SGST)
  lateFee: {
    statutoryMaxPerDay: 200, // ₹100 CGST + ₹100 SGST per day (Sec 47)
    statutoryMaxCap: 10000,  // ₹5,000 CGST + ₹5,000 SGST
    rationalizedSlabs: [
      {
        type: 'NIL_LIABILITY',
        description: 'Nil Tax Liability in GSTR-1 / GSTR-3B',
        perDay: 20, // ₹10 CGST + ₹10 SGST
        maxCap: 500, // ₹250 CGST + ₹250 SGST total
        authority: 'Notification No. 19/2021-CT & 20/2021-CT'
      },
      {
        type: 'AATO_LE_1_5_CR',
        description: 'Aggregate Turnover up to ₹1.5 Crores',
        perDay: 50, // ₹25 CGST + ₹25 SGST
        maxCap: 2000, // ₹1,000 CGST + ₹1,000 SGST total
        authority: 'Notification No. 19/2021-CT & 20/2021-CT'
      },
      {
        type: 'AATO_1_5_TO_5_CR',
        description: 'Aggregate Turnover between ₹1.5 Cr and ₹5 Crores',
        perDay: 50,
        maxCap: 5000, // ₹2,500 CGST + ₹2,500 SGST total
        authority: 'Notification No. 19/2021-CT & 20/2021-CT'
      },
      {
        type: 'AATO_GT_5_CR',
        description: 'Aggregate Turnover above ₹5 Crores',
        perDay: 50,
        maxCap: 10000, // ₹5,000 CGST + ₹5,000 SGST total
        authority: 'CGST Act Section 47(1)'
      }
    ]
  },

  // Section 50: Interest Provisions
  interestRates: {
    delayedNetCashTax: {
      ratePercentPerAnnum: 18,
      section: 'Section 50(1) Proviso (inserted via Finance Act 2021 w.e.f. 01-07-2017)',
      base: 'NET_CASH_LIABILITY', // Interest payable ONLY on cash portion debited via ECL
      description: 'Interest on delayed payment of tax paid via Electronic Cash Ledger'
    },
    wrongfulItcAvailedAndUtilized: {
      ratePercentPerAnnum: 24,
      section: 'Section 50(3) read with Rule 88B (substituted w.e.f. 05-07-2022 via Finance Act 2022)',
      base: 'UTILIZED_ITC_AMOUNT',
      description: 'Interest on input tax credit wrongly availed and utilized'
    },
    rule37Reversal: {
      ratePercentPerAnnum: 18,
      section: 'Second proviso to Section 16(2) read with Rule 37 & Section 50(1)',
      base: 'REVERSED_ITC_AMOUNT',
      description: 'Interest for non-payment of invoice consideration to supplier within 180 days'
    }
  },

  // GSTR-1 Thresholds & Tables
  gstr1: {
    b2clThreshold: 100000, // Slashed from ₹2.5L to ₹1.0L w.e.f. 10-07-2024 via Notif 12/2024-CT
    b2clAuthority: 'CBIC Notification No. 12/2024-Central Tax',
    tables: {
      table4: '4A, 4B, 4C, 6B, 6C - B2B Invoices (Registered Recipients)',
      table5: '5A, 5B - B2C (Large) Inter-state Invoices > ₹1,00,000',
      table6: '6A - Exports, 6B - SEZ Supplies with/without payment of tax',
      table7: '7A, 7B - B2C (Small) Intra-state all & Inter-state <= ₹1,00,000',
      table8: '8A, 8B, 8C, 8D - Nil Rated, Exempted & Non-GST Outward Supplies',
      table9: '9A, 9B, 9C - Credit / Debit Notes (Registered & Unregistered Large)',
      table11: '11A, 11B - Advances Received & Advance Adjustments',
      table12: '12 - HSN Summary of Outward Supplies (Mandatory rates & values)',
      table13: '13 - Documents Issued during the tax period',
      table14: '14 - Supplies made through Electronic Commerce Operators (Sec 52 & 9(5))',
      table15: '15 - Supplies u/s 9(5) where ECO is liable to pay tax'
    }
  },

  // Section 17(5): Blocked Credit Categories
  blockedCredits: {
    authority: 'CGST Act Section 17(5) as amended by CGST Amendment Act 2018 and Finance Act 2023',
    clauses: {
      '17(5)(a)': {
        clause: '17(5)(a)',
        name: 'Motor Vehicles for transportation of persons',
        description: 'Motor vehicles having approved seating capacity of not more than 13 persons (including driver), unless used for making further taxable supply, passenger transport or driving training.',
        isBlockedByDefault: true
      },
      '17(5)(aa)': {
        clause: '17(5)(aa)',
        name: 'Vessels and Aircraft',
        description: 'Vessels and aircraft unless used for specific business purposes.',
        isBlockedByDefault: true
      },
      '17(5)(b)': {
        clause: '17(5)(b)',
        name: 'Food, beverages, catering, club membership, life/health insurance',
        description: 'Food and beverages, outdoor catering, beauty treatment, health services, cosmetic surgery, club membership, health/life insurance (unless obligatory under statutory employer mandate).',
        isBlockedByDefault: true
      },
      '17(5)(c)': {
        clause: '17(5)(c)',
        name: 'Works Contract for construction of immovable property',
        description: 'Works contract services supplied for construction of an immovable property (other than plant and machinery) except where it is an input service for further works contract.',
        isBlockedByDefault: true
      },
      '17(5)(d)': {
        clause: '17(5)(d)',
        name: 'Goods/Services for own construction of immovable property',
        description: 'Goods or services received by a taxable person for construction of an immovable property on own account, capitalized in books.',
        isBlockedByDefault: true
      },
      '17(5)(e)': {
        clause: '17(5)(e)',
        name: 'Composition Scheme Supplies',
        description: 'Goods or services on which tax has been paid under Section 10.',
        isBlockedByDefault: true
      },
      '17(5)(f)': {
        clause: '17(5)(f)',
        name: 'Non-resident Taxable Person',
        description: 'Goods or services received by a non-resident taxable person (except goods imported).',
        isBlockedByDefault: true
      },
      '17(5)(fa)': {
        clause: '17(5)(fa)',
        name: 'Corporate Social Responsibility (CSR)',
        description: 'Goods or services or both received by a taxable person, which are used or intended to be used for activities relating to his obligations under section 135 of the Companies Act, 2013.',
        effectiveDate: '01-10-2023 (Finance Act 2023 / Notif 28/2023-CT)',
        isBlockedByDefault: true
      },
      '17(5)(g)': {
        clause: '17(5)(g)',
        name: 'Personal Consumption',
        description: 'Goods or services or both used for personal consumption.',
        isBlockedByDefault: true
      },
      '17(5)(h)': {
        clause: '17(5)(h)',
        name: 'Lost, Stolen, Destroyed, Written Off or Gift/Samples',
        description: 'Goods lost, stolen, destroyed, written off or disposed of by way of gift or free samples.',
        isBlockedByDefault: true
      },
      '17(5)(i)': {
        clause: '17(5)(i)',
        name: 'Taxes paid under Section 74, 129, or 130',
        description: 'Any tax paid in accordance with the provisions of sections 74, 129 and 130 (fraud, evasion, confiscation).',
        isBlockedByDefault: true
      }
    }
  },

  // QRMP Scheme & Due Dates
  qrmp: {
    aatoThreshold: 50000000, // ₹5 Crores AATO
    authority: 'Notification No. 82/2020-CT to 84/2020-CT read with Rule 61A',
    stateCategories: {
      category1: {
        dueDay: 22,
        name: 'Category 1 States (Southern & Western)',
        states: [
          'Chhattisgarh', 'Madhya Pradesh', 'Gujarat', 'Maharashtra', 'Karnataka',
          'Goa', 'Kerala', 'Tamil Nadu', 'Telangana', 'Andhra Pradesh',
          'Daman and Diu', 'Dadra and Nagar Haveli', 'Puducherry',
          'Andaman and Nicobar Islands', 'Lakshadweep'
        ],
        stateCodes: ['22', '23', '24', '27', '29', '30', '32', '33', '36', '37', '26', '25', '34', '35', '31']
      },
      category2: {
        dueDay: 24,
        name: 'Category 2 States (Northern & Eastern)',
        states: [
          'Himachal Pradesh', 'Punjab', 'Uttarakhand', 'Haryana', 'Rajasthan',
          'Uttar Pradesh', 'Bihar', 'Sikkim', 'Arunachal Pradesh', 'Nagaland',
          'Manipur', 'Mizoram', 'Tripura', 'Meghalaya', 'Assam', 'West Bengal',
          'Jharkhand', 'Odisha', 'Jammu and Kashmir', 'Ladakh', 'Chandigarh', 'Delhi'
        ],
        stateCodes: ['02', '03', '05', '06', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '01', '38', '04', '07']
      }
    },
    iffDueDay: 13,
    pmt06DueDay: 25,
    fixedSumPercentage: 35 // 35% of previous quarter net cash tax
  },

  // Electronic Ledgers & Challan Specification
  ledgers: {
    pmt01: {
      form: 'GST PMT-01',
      name: 'Electronic Liability Register',
      rule: 'CGST Rule 85',
      parts: {
        part1: 'Return-related liabilities (GSTR-3B self-assessed tax, interest, late fees)',
        part2: 'Other liabilities (Demand orders DRC-07, appeal prepayments, DRC-01B/C liabilities)'
      }
    },
    pmt02: {
      form: 'GST PMT-02',
      name: 'Electronic Credit Ledger',
      rule: 'CGST Rule 86',
      subHeads: ['IGST', 'CGST', 'SGST', 'Cess'],
      utilizationRestriction: 'Can ONLY be used for payment of OUTPUT TAX (Sec 49(4)). Cannot pay RCM, interest, penalty or fees.'
    },
    pmt05: {
      form: 'GST PMT-05',
      name: 'Electronic Cash Ledger',
      rule: 'CGST Rule 87',
      majorHeads: ['IGST', 'CGST', 'SGST', 'Cess'],
      minorHeads: ['Tax', 'Interest', 'Penalty', 'Fee', 'Other']
    },
    pmt06: {
      form: 'GST PMT-06',
      name: 'GST Challan',
      rule: 'CGST Rule 87(2) & 87(3)',
      cpinLength: 14, // 14-digit CPIN
      cpinValidityDays: 15,
      modes: ['NEFT_RTGS', 'NET_BANKING', 'OVER_THE_COUNTER', 'UPI']
    },
    pmt09: {
      form: 'GST PMT-09',
      name: 'Application for Transfer of amount in Cash Ledger',
      rule: 'CGST Rule 87(13)',
      description: 'Transfer cash between Major Heads and Minor Heads within cash ledger of same GSTIN or distinct person GSTINs.'
    }
  }
};
