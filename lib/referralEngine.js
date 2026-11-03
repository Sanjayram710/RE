/**
 * Referral Growth Loop Engine
 * Manages post-filing referral generation, referral codes,
 * wallet credits, and discount coupons.
 */

const REFERRAL_STORE = new Map([
  [
    "MALABAR500",
    {
      code: "MALABAR500",
      ownerGstin: "32ABCDE1234F1Z5",
      ownerName: "Anil Varma (Malabar Spice Traders)",
      creditPerReferral: 500,
      refereeDiscount: 250,
      totalInvites: 6,
      registeredCount: 4,
      filedCount: 3,
      walletBalance: 1500,
      totalEarned: 1500,
      history: [
        { date: "2026-10-15", businessName: "Kochi Marine Exporters", status: "FILED", creditEarned: 500 },
        { date: "2026-10-22", businessName: "Green Valley Organics", status: "FILED", creditEarned: 500 },
        { date: "2026-10-29", businessName: "Apex Logistics Kerala", status: "FILED", creditEarned: 500 },
        { date: "2026-11-01", businessName: "Coastal Hardware Traders", status: "REGISTERED", creditEarned: 0 }
      ]
    }
  ]
]);

export function getOrCreateReferralCode(gstin = "32ABCDE1234F1Z5", businessName = "Malabar Spice Traders") {
  const cleanGstin = gstin.trim().toUpperCase();
  const prefix = cleanGstin.substring(2, 7) || "GST";
  const code = `${prefix}500`;

  if (!REFERRAL_STORE.has(code)) {
    REFERRAL_STORE.set(code, {
      code,
      ownerGstin: cleanGstin,
      ownerName: businessName,
      creditPerReferral: 500,
      refereeDiscount: 250,
      totalInvites: 0,
      registeredCount: 0,
      filedCount: 0,
      walletBalance: 500, // Welcome signup bonus
      totalEarned: 500,
      history: [
        { date: new Date().toISOString().slice(0, 10), businessName: "Welcome Onboarding Credit", status: "CREDITED", creditEarned: 500 }
      ]
    });
  }

  const record = REFERRAL_STORE.get(code);
  const shareUrl = `https://simplegst.in/ref/${code}`;
  const whatsappShareText = encodeURIComponent(
    `Hey, I file my GST & ITR hassle-free with SimpleGST. Use my link to get flat ₹250 off on your first filing: ${shareUrl}`
  );

  return {
    success: true,
    code,
    shareUrl,
    whatsappShareUrl: `https://api.whatsapp.com/send?text=${whatsappShareText}`,
    creditPerReferral: record.creditPerReferral,
    refereeDiscount: record.refereeDiscount,
    walletBalance: record.walletBalance,
    totalInvites: record.totalInvites,
    registeredCount: record.registeredCount,
    filedCount: record.filedCount,
    totalEarned: record.totalEarned,
    history: record.history
  };
}

export function redeemReferralCredit(code, amountToRedeem) {
  const record = REFERRAL_STORE.get(code);
  if (!record) {
    return { success: false, error: "Invalid referral code." };
  }
  if (amountToRedeem <= 0 || amountToRedeem > record.walletBalance) {
    return { success: false, error: `Invalid redemption amount. Available balance: ₹${record.walletBalance}` };
  }

  record.walletBalance -= amountToRedeem;
  record.history.unshift({
    date: new Date().toISOString().slice(0, 10),
    businessName: "Credit Redeemed for Filing Fee",
    status: "REDEEMED",
    creditEarned: -amountToRedeem
  });

  return {
    success: true,
    redeemed: amountToRedeem,
    remainingBalance: record.walletBalance
  };
}
