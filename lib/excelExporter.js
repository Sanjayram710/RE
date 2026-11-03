/**
 * Excel Export Engine - Mirrors ClearTax's Multi-Sheet Excel Reports
 * Generates XML Spreadsheet 2003 (.xls / .xml) workbooks with multi-tab support,
 * styles, formatting, and formulas compatible with Excel, Sheets, and Calc.
 */

function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateITRExcelReport(userData, taxComp) {
  const pan = userData.personalInfo?.pan || "";
  const name = `${userData.personalInfo?.firstName || ""} ${userData.personalInfo?.lastName || ""}`.trim();
  const ay = userData.assessmentYear || "2025-26";
  const regime = userData.taxRegime || "NEW";

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>SimpleGST</Author>
  <Created>${new Date().toISOString()}</Created>
  <Title>ITR Computation and Tax Summary</Title>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Borders/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="12" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#1B3F8B" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4D4D4"/>
   </Borders>
  </Style>
  <Style ss:ID="TitleStyle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="16" ss:Color="#1B3F8B" ss:Bold="1"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="SubtitleStyle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#555555" ss:Italic="1"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="LabelStyle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Bold="1" ss:Color="#222222"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="CurrencyStyle">
   <NumberFormat ss:Format="&#34;₹&#34;#,##0.00"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="CurrencyBold">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Bold="1" ss:Color="#1B3F8B"/>
   <NumberFormat ss:Format="&#34;₹&#34;#,##0.00"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Interior ss:Color="#EAF0FB" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="HighlightGreen">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="12" ss:Bold="1" ss:Color="#006622"/>
   <NumberFormat ss:Format="&#34;₹&#34;#,##0.00"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Interior ss:Color="#E6F5EA" ss:Pattern="Solid"/>
  </Style>
 </Styles>

 <!-- Worksheet 1: Tax Computation Summary -->
 <Worksheet ss:Name="Tax Computation Summary">
  <Table ss:ExpandedColumnCount="4" ss:DefaultRowHeight="20">
   <Column ss:Width="250"/>
   <Column ss:Width="160"/>
   <Column ss:Width="160"/>
   <Column ss:Width="180"/>
   <Row ss:Height="28">
    <Cell ss:MergeAcross="3" ss:StyleID="TitleStyle"><Data ss:Type="String">Income Tax Computation Statement (AY ${escapeXml(ay)})</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:MergeAcross="3" ss:StyleID="SubtitleStyle"><Data ss:Type="String">Generated via SimpleGST | Demo files. Not official GST portal or income tax portal files. | PAN: ${escapeXml(pan)} | Assessee: ${escapeXml(name)}</Data></Cell>
   </Row>
   <Row ss:Index="4" ss:StyleID="HeaderStyle">
    <Cell><Data ss:Type="String">Particulars</Data></Cell>
    <Cell><Data ss:Type="String">Amount (₹)</Data></Cell>
    <Cell><Data ss:Type="String">Regime Applied</Data></Cell>
    <Cell><Data ss:Type="String">Notes</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Gross Salary / Income from Employment</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${userData.income?.grossSalary || 0}</Data></Cell>
    <Cell><Data ss:Type="String">${regime}</Data></Cell>
    <Cell><Data ss:Type="String">From Form 16 / Salary slips</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Standard Deduction u/s 16(ia)</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${taxComp.standardDeduction}</Data></Cell>
    <Cell><Data ss:Type="String">${regime}</Data></Cell>
    <Cell><Data ss:Type="String">₹75,000 for New / ₹50,000 for Old</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Income from House Property</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${userData.income?.housePropertyIncome || 0}</Data></Cell>
    <Cell><Data ss:Type="String">${regime}</Data></Cell>
    <Cell><Data ss:Type="String">Rental Income / Self-occupied interest</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Income from Other Sources (Interest, Dividends)</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${userData.income?.otherIncome || 0}</Data></Cell>
    <Cell><Data ss:Type="String">${regime}</Data></Cell>
    <Cell><Data ss:Type="String">Savings bank &amp; FD interest</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="String">Gross Total Income (GTI)</Data></Cell>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="Number">${taxComp.grossTotalIncome}</Data></Cell>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="String">${regime}</Data></Cell>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="String">Sum of all income heads</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Chapter VI-A Deductions (80C, 80D, etc.)</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${taxComp.totalDeductions}</Data></Cell>
    <Cell><Data ss:Type="String">${regime}</Data></Cell>
    <Cell><Data ss:Type="String">${regime === "NEW" ? "Not applicable in New Regime" : "Eligible in Old Regime"}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="String">Net Taxable Total Income</Data></Cell>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="Number">${taxComp.netTaxableIncome}</Data></Cell>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="String">${regime}</Data></Cell>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="String">Tax base for slab rates</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Base Calculated Tax</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${taxComp.calculatedTax}</Data></Cell>
    <Cell><Data ss:Type="String">${regime}</Data></Cell>
    <Cell><Data ss:Type="String">Applying AY 2025-26 Slabs</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Health &amp; Education Cess (4%)</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${taxComp.cess}</Data></Cell>
    <Cell><Data ss:Type="String">${regime}</Data></Cell>
    <Cell><Data ss:Type="String">4% of tax</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="String">Total Tax Liability with Cess</Data></Cell>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="Number">${taxComp.totalTaxWithCess}</Data></Cell>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="String">${regime}</Data></Cell>
    <Cell ss:StyleID="CurrencyBold"><Data ss:Type="String">Gross tax due</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="LabelStyle"><Data ss:Type="String">TDS and Advance Taxes Paid</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${taxComp.totalTaxesPaid}</Data></Cell>
    <Cell><Data ss:Type="String">${regime}</Data></Cell>
    <Cell><Data ss:Type="String">Form 26AS / AIS verified</Data></Cell>
   </Row>
   <Row ss:Height="24">
    <Cell ss:StyleID="HighlightGreen"><Data ss:Type="String">${taxComp.netTaxPayable > 0 ? "Net Balance Tax Payable" : "Refund Due to Assessee"}</Data></Cell>
    <Cell ss:StyleID="HighlightGreen"><Data ss:Type="Number">${taxComp.netTaxPayable > 0 ? taxComp.netTaxPayable : taxComp.refundDue}</Data></Cell>
    <Cell ss:StyleID="HighlightGreen"><Data ss:Type="String">${regime}</Data></Cell>
    <Cell ss:StyleID="HighlightGreen"><Data ss:Type="String">${taxComp.netTaxPayable > 0 ? "Pay before return filing" : "Direct deposit to bank"}</Data></Cell>
   </Row>
  </Table>
 </Worksheet>

 <!-- Worksheet 2: Assessee & Verification Details -->
 <Worksheet ss:Name="Assessee Profile">
  <Table ss:ExpandedColumnCount="2" ss:DefaultRowHeight="20">
   <Column ss:Width="200"/>
   <Column ss:Width="280"/>
   <Row ss:Height="26">
    <Cell ss:MergeAcross="1" ss:StyleID="TitleStyle"><Data ss:Type="String">Taxpayer Filing Profile</Data></Cell>
   </Row>
   <Row ss:Index="3" ss:StyleID="HeaderStyle">
    <Cell><Data ss:Type="String">Field</Data></Cell>
    <Cell><Data ss:Type="String">Value</Data></Cell>
   </Row>
   <Row><Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Full Name</Data></Cell><Cell><Data ss:Type="String">${escapeXml(name)}</Data></Cell></Row>
   <Row><Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Permanent Account Number (PAN)</Data></Cell><Cell><Data ss:Type="String">${escapeXml(pan)}</Data></Cell></Row>
   <Row><Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Date of Birth</Data></Cell><Cell><Data ss:Type="String">${escapeXml(userData.personalInfo?.dob || "1990-05-15")}</Data></Cell></Row>
   <Row><Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Aadhaar Card No</Data></Cell><Cell><Data ss:Type="String">${escapeXml(userData.personalInfo?.aadhaar || "XXXXXXXX1234")}</Data></Cell></Row>
   <Row><Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Mobile No</Data></Cell><Cell><Data ss:Type="String">${escapeXml(userData.personalInfo?.mobile || "9876543210")}</Data></Cell></Row>
   <Row><Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Email Address</Data></Cell><Cell><Data ss:Type="String">${escapeXml(userData.personalInfo?.email || "user@example.com")}</Data></Cell></Row>
   <Row><Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Residential Address</Data></Cell><Cell><Data ss:Type="String">${escapeXml(userData.personalInfo?.address?.locality || "Bangalore")}, ${escapeXml(userData.personalInfo?.address?.stateCode || "KA")}</Data></Cell></Row>
   <Row><Cell ss:StyleID="LabelStyle"><Data ss:Type="String">Tax Filing Method</Data></Cell><Cell><Data ss:Type="String">ClearTax Offline JSON Upload</Data></Cell></Row>
  </Table>
 </Worksheet>
</Workbook>`;
}

export function generateGSTExcelReport(gstData, summary) {
  const gstin = gstData.gstin || "";
  const period = gstData.filingPeriod || "032025";
  const invoices = gstData.b2bInvoices || [];

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>SimpleGST</Author>
  <Created>${new Date().toISOString()}</Created>
  <Title>GSTR-1 Sales Register &amp; Invoicing Report</Title>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Borders/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#2E6930" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="TitleStyle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="15" ss:Color="#2E6930" ss:Bold="1"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="CurrencyStyle">
   <NumberFormat ss:Format="&#34;₹&#34;#,##0.00"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="TotalStyle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Bold="1" ss:Color="#000000"/>
   <Interior ss:Color="#E2F0D9" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="&#34;₹&#34;#,##0.00"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
  </Style>
 </Styles>

 <!-- Sheet 1: B2B Invoices Register -->
 <Worksheet ss:Name="B2B Sales Register">
  <Table ss:ExpandedColumnCount="9" ss:DefaultRowHeight="20">
   <Column ss:Width="120"/>
   <Column ss:Width="100"/>
   <Column ss:Width="160"/>
   <Column ss:Width="130"/>
   <Column ss:Width="110"/>
   <Column ss:Width="100"/>
   <Column ss:Width="100"/>
   <Column ss:Width="100"/>
   <Column ss:Width="120"/>
   <Row ss:Height="26">
    <Cell ss:MergeAcross="8" ss:StyleID="TitleStyle"><Data ss:Type="String">GSTR-1 Outward Supplies (B2B Register) - Period ${escapeXml(period)} | GSTIN: ${escapeXml(gstin)}</Data></Cell>
   </Row>
   <Row ss:Index="3" ss:StyleID="HeaderStyle">
    <Cell><Data ss:Type="String">Invoice No</Data></Cell>
    <Cell><Data ss:Type="String">Invoice Date</Data></Cell>
    <Cell><Data ss:Type="String">Recipient GSTIN</Data></Cell>
    <Cell><Data ss:Type="String">Recipient Name</Data></Cell>
    <Cell><Data ss:Type="String">Taxable Value</Data></Cell>
    <Cell><Data ss:Type="String">Rate (%)</Data></Cell>
    <Cell><Data ss:Type="String">IGST</Data></Cell>
    <Cell><Data ss:Type="String">CGST + SGST</Data></Cell>
    <Cell><Data ss:Type="String">Total Invoice Value</Data></Cell>
   </Row>
   ${invoices.map(inv => {
     const taxable = Number(inv.taxableValue || 0);
     const rate = Number(inv.rate || 18);
     const isInterState = inv.pos !== gstin.substring(0, 2);
     const igst = isInterState ? Math.round(taxable * (rate / 100)) : 0;
     const cgst = !isInterState ? Math.round(taxable * (rate / 200)) : 0;
     const sgst = !isInterState ? Math.round(taxable * (rate / 200)) : 0;
     const total = taxable + igst + cgst + sgst;
     return `   <Row>
    <Cell><Data ss:Type="String">${escapeXml(inv.invoiceNumber)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(inv.invoiceDate)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(inv.recipientGstin)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(inv.recipientName || "Customer Enterprise")}</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${taxable}</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${rate}</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${igst}</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${cgst + sgst}</Data></Cell>
    <Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${total}</Data></Cell>
   </Row>`;
   }).join("\n")}
   <Row ss:Height="22">
    <Cell ss:StyleID="TotalStyle"><Data ss:Type="String">TOTALS</Data></Cell>
    <Cell ss:StyleID="TotalStyle"><Data ss:Type="String"></Data></Cell>
    <Cell ss:StyleID="TotalStyle"><Data ss:Type="String"></Data></Cell>
    <Cell ss:StyleID="TotalStyle"><Data ss:Type="String"></Data></Cell>
    <Cell ss:StyleID="TotalStyle"><Data ss:Type="Number">${summary.totalTaxableValue}</Data></Cell>
    <Cell ss:StyleID="TotalStyle"><Data ss:Type="String"></Data></Cell>
    <Cell ss:StyleID="TotalStyle"><Data ss:Type="Number">${summary.totalIgst}</Data></Cell>
    <Cell ss:StyleID="TotalStyle"><Data ss:Type="Number">${summary.totalCgst + summary.totalSgst}</Data></Cell>
    <Cell ss:StyleID="TotalStyle"><Data ss:Type="Number">${summary.totalInvoiceValue}</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;
}

