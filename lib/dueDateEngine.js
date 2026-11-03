/**
 * Statutory Due-Date & Automated Reminder Engine
 * Calculates statutory deadlines for Indian GST filings,
 * computes countdown clocks, and formats multi-channel notification payloads.
 */

export function getStatutoryDueDates(referenceDate = new Date("2026-11-03T12:00:00Z")) {
  const ref = new Date(referenceDate);

  // November 2026 Deadlines
  const deadlines = [
    {
      id: "gstr1_monthly",
      form: "GSTR-1",
      title: "Outward Supplies (Monthly)",
      period: "October 2026",
      statutoryRule: "Section 37 - 11th of succeeding month",
      dueDate: "2026-11-11T23:59:59Z",
      frequency: "Monthly",
      penaltyRule: "₹50/day late fee (₹20 for NIL return) under Section 47"
    },
    {
      id: "qrmp_iff",
      form: "IFF (QRMP)",
      title: "Invoice Furnishing Facility",
      period: "October 2026",
      statutoryRule: "Rule 59(2) - 13th of succeeding month",
      dueDate: "2026-11-13T23:59:59Z",
      frequency: "Monthly (QRMP)",
      penaltyRule: "Optional facility; invoices not uploaded cannot be claimed in GSTR-2B"
    },
    {
      id: "gstr3b_monthly",
      form: "GSTR-3B",
      title: "Monthly Summary & Tax Payment",
      period: "October 2026",
      statutoryRule: "Section 39 - 20th of succeeding month",
      dueDate: "2026-11-20T23:59:59Z",
      frequency: "Monthly",
      penaltyRule: "18% p.a. interest under Sec 50 + ₹50/day late fee"
    },
    {
      id: "cmp08_quarterly",
      form: "CMP-08",
      title: "Composition Scheme Quarterly Challan",
      period: "Q3 (Oct-Dec 2026)",
      statutoryRule: "Rule 62 - 18th of month following quarter",
      dueDate: "2027-01-18T23:59:59Z",
      frequency: "Quarterly",
      penaltyRule: "Interest @ 18% p.a. on unpaid tax"
    },
    {
      id: "gstr9_annual",
      form: "GSTR-9 & 9C",
      title: "Annual Return & Reconciliation",
      period: "FY 2025-26",
      statutoryRule: "Section 44 - 31st December following FY",
      dueDate: "2026-12-31T23:59:59Z",
      frequency: "Annual",
      penaltyRule: "₹200/day late fee subject to maximum 0.50% of turnover"
    }
  ];

  return deadlines.map(item => {
    const dueTime = new Date(item.dueDate).getTime();
    const diffMs = dueTime - ref.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const hoursRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60)));

    let urgency = "NORMAL";
    let status = "UPCOMING";
    if (daysRemaining < 0) {
      status = "OVERDUE";
      urgency = "CRITICAL";
    } else if (daysRemaining <= 3) {
      status = "URGENT";
      urgency = "HIGH";
    } else if (daysRemaining <= 10) {
      status = "APPROACHING";
      urgency = "MEDIUM";
    }

    return {
      ...item,
      daysRemaining,
      hoursRemaining,
      urgency,
      status
    };
  });
}

export function generateNotificationPayload({
  channel = "whatsapp", // "whatsapp" | "sms" | "email"
  taxpayerName = "Anil Varma",
  businessName = "Malabar Spice Traders",
  gstin = "32ABCDE1234F1Z5",
  form = "GSTR-3B",
  period = "October 2026",
  dueDate = "20th Nov 2026",
  amountDue = "₹70,200",
  recipientPhone = "+91 98765 43210",
  recipientEmail = "accounts@malabarspices.com"
} = {}) {
  const cleanChannel = channel.toLowerCase();

  if (cleanChannel === "whatsapp") {
    return {
      channel: "WHATSAPP",
      recipient: recipientPhone,
      templateName: "gst_statutory_filing_reminder_v2",
      header: "SimpleGST Statutory Reminder",
      body: `Hello *${taxpayerName}* (${businessName}),\n\nYour *${form}* return for *${period}* is due on *${dueDate}*.\n\n*Estimated Tax Payable:* ${amountDue}\n*GSTIN:* ${gstin}\n\nAvoid ₹50/day late fees and 18% p.a. interest. You can review your computed return and authorize 1-click filing immediately.`,
      buttons: [
        { type: "URL", title: "Review & File 1-Click", url: "https://simplegst.in/app/copilot" },
        { type: "QUICK_REPLY", title: "Remind me in 2 days" }
      ],
      timestamp: new Date().toISOString()
    };
  }

  if (cleanChannel === "sms") {
    return {
      channel: "SMS",
      recipient: recipientPhone,
      senderId: "SMPGST",
      message: `Dear ${taxpayerName}, GSTR-3B for ${period} (GSTIN: ${gstin}) is due on ${dueDate}. Payable: ${amountDue}. Avoid late fees, file now: https://sgst.in/3b`,
      dltTemplateId: "1107161829304918231",
      timestamp: new Date().toISOString()
    };
  }

  // Email format
  return {
    channel: "EMAIL",
    recipient: recipientEmail,
    subject: `[Action Required] GST Return Deadline Reminder for ${businessName} - ${form} (${period})`,
    bodyHtml: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #E2E8F0; border-radius: 8px; padding: 24px;">
        <h2 style="color: #1E40AF; margin-top: 0;">SimpleGST Statutory Due-Date Notice</h2>
        <p>Dear <strong>${taxpayerName}</strong>,</p>
        <p>This is an automated statutory compliance reminder for <strong>${businessName}</strong> (GSTIN: <code>${gstin}</code>).</p>
        <div style="background-color: #F8FAFC; border-left: 4px solid #2563EB; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Return Form:</strong> ${form}</p>
          <p style="margin: 4px 0;"><strong>Period:</strong> ${period}</p>
          <p style="margin: 4px 0;"><strong>Statutory Due Date:</strong> <span style="color: #DC2626; font-weight: bold;">${dueDate}</span></p>
          <p style="margin: 4px 0;"><strong>Estimated Tax Liability:</strong> <strong>${amountDue}</strong></p>
        </div>
        <p>Filing after ${dueDate} incurs a mandatory late fee of ₹50 per day under Section 47 and 18% annual interest under Section 50 of the CGST Act.</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="https://simplegst.in/app/copilot" style="background-color: #2563EB; color: #FFFFFF; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">Open GST Copilot & File Now</a>
        </div>
      </div>
    `,
    timestamp: new Date().toISOString()
  };
}

