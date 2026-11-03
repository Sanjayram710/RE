export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  gstRate: number; // 0, 5, 12, 18, 28
  taxableAmount: number;
  taxAmount: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  partyName: string;
  partyGstin: string;
  date: string;
  taxableAmount: number;
  igst: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  totalAmount: number;
  status: 'matched' | 'mismatch' | 'duplicate' | 'pending' | 'hold';
  type: 'B2B' | 'B2C' | 'SEZ';
  isInterState?: boolean;
  items?: InvoiceItem[];
  notes?: string;
}

export interface ItcException {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  supplierGstin: string;
  taxAmount: number;
  reason: string;
  status: 'hold' | 'accepted' | 'rejected';
}

export interface TaxCalculationResult {
  taxableSales: number;
  outputTax: {
    igst: number;
    cgst: number;
    sgst: number;
    total: number;
  };
  taxablePurchases: number;
  grossItc: number;
  heldItc: number;
  eligibleItc: {
    igst: number;
    cgst: number;
    sgst: number;
    total: number;
  };
  netPayable: {
    igst: number;
    cgst: number;
    sgst: number;
    total: number;
  };
}

export * from './gst.js';

