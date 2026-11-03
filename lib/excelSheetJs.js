import XLSX from "xlsx";

/**
 * SheetJS Real .xlsx Workbook Builder
 * Features:
 * - Real binary .xlsx output
 * - Multi-sheet workbook with "Summary" sheet guaranteed FIRST
 * - Frozen header row
 * - Automatic column width calculation
 * - Indian number formatting ('"₹"#,##,##0.00' and '#,##,##0.00')
 */

export function buildXlsxWorkbook(sheets = []) {
  const wb = XLSX.utils.book_new();

  // Ensure "Summary" sheet is ALWAYS first
  const summarySheetIndex = sheets.findIndex(s => s.name.toLowerCase() === "summary");
  const orderedSheets = [...sheets];
  if (summarySheetIndex > 0) {
    const [summarySheet] = orderedSheets.splice(summarySheetIndex, 1);
    orderedSheets.unshift(summarySheet);
  } else if (summarySheetIndex === -1 && orderedSheets.length > 0) {
    // If no explicit summary sheet, insert one
    orderedSheets.unshift({
      name: "Summary",
      data: [
        ["Report Summary", "SimpleGST Engine"],
        ["Generated At", new Date().toISOString()],
        ["Disclaimer", "Demo files. Not official GST portal or income tax portal files."]
      ]
    });
  }

  for (const sheetDef of orderedSheets) {
    const aoa = sheetDef.data || [];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // 1. Auto column widths
    const colWidths = [];
    for (let r = 0; r < aoa.length; r++) {
      const row = aoa[r] || [];
      for (let c = 0; c < row.length; c++) {
        const val = row[c];
        const len = String(val ?? "").length;
        colWidths[c] = Math.max(colWidths[c] || 10, len + 3);
      }
    }
    ws["!cols"] = colWidths.map(w => ({ wch: Math.min(Math.max(w, 10), 55) }));

    // 2. Freeze header row (freeze row 1)
    ws["!views"] = [{ state: "frozen", ySplit: 1 }];
    ws["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };

    // 3. Indian number formatting on numeric currency cells
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[cellAddress];
        if (!cell) continue;

        // Header row styling
        if (R === 0) {
          cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E3A8A" } } };
        } else if (cell.t === "n") {
          // Check if column is a currency column or large number
          if (sheetDef.currencyCols && sheetDef.currencyCols.includes(C)) {
            cell.z = '"₹"#,##,##0.00';
          } else if (cell.v >= 100) {
            cell.z = '#,##,##0.00';
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetDef.name);
  }

  // Return binary Buffer of .xlsx
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
}

/**
 * Verifies that a generated buffer re-opens correctly via SheetJS
 */
export function verifyXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return {
    valid: Boolean(wb && wb.SheetNames && wb.SheetNames.length > 0),
    sheetNames: wb.SheetNames,
    firstSheetIsSummary: wb.SheetNames[0] === "Summary",
    sheetCount: wb.SheetNames.length
  };
}

