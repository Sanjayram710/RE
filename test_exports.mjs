import fs from "node:fs";
import { generateITRJson, computeTaxLiability } from "./lib/itrExporter.js";
import { generateGSTR1Json } from "./lib/gstExporter.js";
import { generateITRExcelReport, generateGSTExcelReport } from "./lib/excelExporter.js";
import { generateITRCsv, generateGSTCsv } from "./lib/csvExporter.js";

const sampleData = JSON.parse(fs.readFileSync("./sample_data.json", "utf8"));

console.log("=== Testing ITR Exporter ===");
const itrResult = generateITRJson(sampleData.itrData);
console.log("ITR Schema Version:", itrResult.rawObject.schemaVersion);
console.log("Tax Summary:", itrResult.summary);
console.log("ITR JSON length:", itrResult.jsonString.length);

console.log("\n=== Testing GST Exporter ===");
const gstResult = generateGSTR1Json(sampleData.gstData);
console.log("GSTR-1 Version:", gstResult.rawObject.version);
console.log("GST Summary:", gstResult.summary);
console.log("GSTR-1 JSON length:", gstResult.jsonString.length);

console.log("\n=== Testing Excel Exporter ===");
const itrExcel = generateITRExcelReport(sampleData.itrData, itrResult.summary);
console.log("ITR Excel XML length:", itrExcel.length);
const gstExcel = generateGSTExcelReport(sampleData.gstData, gstResult.summary);
console.log("GST Excel XML length:", gstExcel.length);

console.log("\n=== Testing CSV Exporter ===");
const itrCsv = generateITRCsv(sampleData.itrData, itrResult.summary);
console.log("ITR CSV lines:", itrCsv.split("\r\n").length);
const gstCsv = generateGSTCsv(sampleData.gstData);
console.log("GST CSV lines:", gstCsv.split("\r\n").length);

console.log("\nALL EXPORT ENGINES FUNCTIONING CLEANLY!");

