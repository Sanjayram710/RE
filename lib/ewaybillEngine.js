/**
 * SimpleGST E-Way Bill (EWB) Lifecycle Engine
 * Compliant with Rule 138 of CGST Rules (Mandatory for consignment value > ₹50,000)
 * Generates 12-digit E-Way Bill Number, computes Rule 138(10) distance validity, and handles Part-B vehicle updates.
 */

import { validateGstin } from "./validate.js";

const ewaybillStore = new Map();

/**
 * Calculates validity in days under Rule 138(10) of CGST Rules:
 * - Normal cargo: 1 day for every 200 km (or part thereof)
 * - Over-dimensional cargo: 1 day for every 20 km
 */
export function calculateEwbValidity(distanceKm = 100, isOverDimensional = false) {
  const km = Math.max(1, Number(distanceKm || 100));
  if (isOverDimensional) {
    return Math.ceil(km / 20);
  }
  return Math.ceil(km / 200);
}

/**
 * Generates a compliant statutory E-Way Bill
 */
export function generateEwayBill(ewbData = {}) {
  const supplierGstin = (ewbData.fromGstin || ewbData.supplierGstin || "32ABCDE1234F1Z5").toUpperCase();
  const recipientGstin = (ewbData.toGstin || ewbData.buyerGstin || "29XYZAB5678C1Z2").toUpperCase();

  const supVal = validateGstin(supplierGstin);
  if (!supVal.valid) throw new Error(`Invalid Consignor GSTIN: ${supVal.error}`);
  const recVal = validateGstin(recipientGstin);
  if (!recVal.valid) throw new Error(`Invalid Consignee GSTIN: ${recVal.error}`);

  const invoiceNo = String(ewbData.invoiceNo || `INV-${Date.now().toString().slice(-5)}`);
  const invoiceValue = Number(ewbData.invoiceValue || ewbData.totalValue || 65000);
  const distanceKm = Number(ewbData.distanceKm || 350);
  const isOverDimensional = Boolean(ewbData.isOverDimensional);
  const validityDays = calculateEwbValidity(distanceKm, isOverDimensional);

  const ewbNo = String(ewbData.ewbNo || `2410${Date.now().toString().slice(-8)}`);
  const generatedAt = new Date();
  const validUntil = new Date(generatedAt.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const ewayBill = {
    success: true,
    ewbNo,
    ewbDate: generatedAt.toISOString(),
    validUntil: validUntil.toISOString(),
    validityDays,
    status: "ACT", // Active

    partA: {
      supplyType: ewbData.supplyType || "O", // Outward
      subSupplyType: ewbData.subSupplyType || "1", // Supply
      docType: ewbData.docType || "INV",
      docNo: invoiceNo,
      docDate: ewbData.invoiceDate || generatedAt.toISOString().split("T")[0],
      fromGstin: supplierGstin,
      fromTrdName: ewbData.fromName || "Malabar Spice Traders",
      fromStateCode: supplierGstin.slice(0, 2),
      toGstin: recipientGstin,
      toTrdName: ewbData.toName || "Zenith Infotech Pvt Ltd",
      toStateCode: recipientGstin.slice(0, 2),
      totalValue: invoiceValue,
      hsnCode: ewbData.hsnCode || "84713010"
    },

    partB: {
      transporterId: (ewbData.transporterId || "29TRANS1234A1Z9").toUpperCase(),
      transporterName: ewbData.transporterName || "VRL Logistics Limited",
      transDocNo: ewbData.transDocNo || `LR-${Date.now().toString().slice(-6)}`,
      transDocDate: generatedAt.toISOString().split("T")[0],
      vehicleNo: (ewbData.vehicleNo || "KA01AB1234").toUpperCase().replace(/\s+/g, ""),
      transportMode: ewbData.transportMode || "1", // 1: Road, 2: Rail, 3: Air, 4: Ship
      distanceKm
    },

    updatesHistory: [
      {
        action: "GENERATED",
        timestamp: generatedAt.toISOString(),
        vehicleNo: (ewbData.vehicleNo || "KA01AB1234").toUpperCase().replace(/\s+/g, ""),
        remarks: "Initial EWB generation with Part A and Part B."
      }
    ],

    notice: "Demo files. Not official GST portal or income tax portal files."
  };

  ewaybillStore.set(ewbNo, ewayBill);
  return ewayBill;
}

/**
 * Updates vehicle number in Part-B (e.g. transshipment / breakdown)
 */
export function updatePartBVehicle(ewbNo, updateData = {}) {
  const ewb = ewaybillStore.get(ewbNo);
  if (!ewb) throw new Error(`E-Way Bill ${ewbNo} not found.`);
  if (ewb.status === "CNL") throw new Error(`Cannot update vehicle for cancelled EWB ${ewbNo}.`);

  const newVehicleNo = String(updateData.vehicleNo || "").toUpperCase().replace(/\s+/g, "");
  if (!newVehicleNo) throw new Error("New Vehicle Number is mandatory.");

  const prevVehicle = ewb.partB.vehicleNo;
  ewb.partB.vehicleNo = newVehicleNo;
  ewb.partB.fromPlace = updateData.fromPlace || "Bengaluru Hub";
  ewb.partB.reasonCode = updateData.reasonCode || "2"; // 1: Transshipment, 2: Breakdown, 3: Route change

  ewb.updatesHistory.push({
    action: "VEHICLE_UPDATED",
    timestamp: new Date().toISOString(),
    previousVehicle: prevVehicle,
    vehicleNo: newVehicleNo,
    reason: updateData.reason || "Transshipment / vehicle change during transit",
    fromPlace: ewb.partB.fromPlace
  });

  ewaybillStore.set(ewbNo, ewb);
  return {
    success: true,
    ewbNo,
    updatedVehicleNo: newVehicleNo,
    validUntil: ewb.validUntil,
    message: `Part-B successfully updated for vehicle ${newVehicleNo}.`
  };
}

/**
 * Cancels an E-Way Bill within 24 hours of generation
 */
export function cancelEwayBill(ewbNo, cancelReason = "1", cancelRemarks = "Order cancelled") {
  const ewb = ewaybillStore.get(ewbNo);
  if (!ewb) throw new Error(`E-Way Bill ${ewbNo} not found.`);
  if (ewb.status === "CNL") throw new Error(`E-Way Bill ${ewbNo} is already cancelled.`);

  ewb.status = "CNL";
  ewb.cancelDetails = {
    cancelDate: new Date().toISOString(),
    cancelReason: cancelReason === "1" ? "Order cancelled" : (cancelReason === "2" ? "Duplicate EWB" : "Data error"),
    cancelRemarks
  };

  ewaybillStore.set(ewbNo, ewb);
  return {
    success: true,
    ewbNo,
    status: "CNL",
    message: "E-Way Bill successfully cancelled on simulated portal."
  };
}

export function listEwayBills() {
  if (ewaybillStore.size === 0) {
    generateEwayBill({ invoiceNo: "INV-2026-901", invoiceValue: 125000, distanceKm: 420, vehicleNo: "KA01AB1234" });
    generateEwayBill({ invoiceNo: "INV-2026-902", invoiceValue: 78000, distanceKm: 180, vehicleNo: "KL07CD5678" });
  }
  return Array.from(ewaybillStore.values());
}

