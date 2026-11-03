import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rawCsv = `1,Initiate OTP for EVC,Working,
2,Logout,Working,
3,Request for extension of authorization token,Working,
4,Request for OTP,Working,
5,Request forAuthorization token,Working,
6,GSTR1 - File Gstr1,Working,
7,GSTR1 - Get AT,Working,
8,GSTR1 - Get ATA,Working,
9,GSTR1 - Get B2B Invoices,Working,
10,GSTR1 - Get B2BA Invoices,Working,
11,GSTR1 - Get B2CL Invoices,Working,
12,GSTR1 - Get B2CLA Invoices,Working,
13,GSTR1 - Get B2CS Invoices,Working,
14,GSTR1 - Get B2CSA Invoices,Working,
15,GSTR1 - Get CDNR Invoices,Working,
16,GSTR1 - Get CDNRA Invoices,Working,
17,GSTR1 - Get CDNUR Invoices,Working,
18,GSTR1 - Get CDNURA Invoices,Working,
19,GSTR1 - Get Doc Issued,Working,
20,GSTR1 - Get E-Invoices,Working,
21,GSTR1 - Get ECOM Invoices,Working,
22,GSTR1 - Get ECOMA Invoices,Not Working,
23,GSTR1 - Get EXP,Working,
24,GSTR1 - Get EXPA,Working,
25,GSTR1 - Get GSTR1 Summary,Working,
26,GSTR1 - Get HSN Summary details,Not Working,
27,GSTR1 - Get Nil Rated Supplies,Working,
28,GSTR1 - Get Return Status,Working,
29,GSTR1 - Get SUPECO Details,Working,
30,GSTR1 - Get SUPECOA Details,Working,
31,GSTR1 - Get TXP,Working,
32,GSTR1 - Get TXPA,Working,
33,GSTR1 - Reset GSTR1,Working,
34,GSTR1 - Save GSTR1 data,Working,
35,GSTR1 - Validate HSN Summary,Working,
36,"All - New Proceed to File(for GSTR6,GSTR5,GSTR1)",,
37,GSTR1A - Confirm Declaration Details,Not Tested,
38,GSTR1A - File Gstr1A,Working,
39,GSTR1A - Get AT,Not Tested,
40,GSTR1A - Get ATA,Not Tested,
41,GSTR1A - Get B2B Invoices,Not Tested,
42,GSTR1A - Get B2BA Invoices,Not Tested,
43,GSTR1A - Get B2CL Invoices,Not Tested,
44,GSTR1A - Get B2CLA Invoices,Not Tested,
45,GSTR1A - Get B2CS Invoices,Not Tested,
46,GSTR1A - Get B2CSA Invoices,Not Tested,
47,GSTR1A - Get CDNR Invoices,Not Tested,
48,GSTR1A - Get CDNRA Invoices,Not Tested,
49,GSTR1A - Get CDNUR Invoices,Not Tested,
50,GSTR1A - Get CDNURA Invoices,Not Tested,
51,GSTR1A - Get Declaration Details,Not Tested,
52,GSTR1A - Get Doc Issued,Not Tested,
53,GSTR1A - Get ECOM Invoices,Not Tested,
54,GSTR1A - Get ECOMA Invoices,Not Tested,
55,GSTR1A - Get EXP,Not Tested,
56,GSTR1A - Get EXPA,Not Tested,
57,GSTR1A - Get GSTR1A Summary,Working,
58,GSTR1A - Get HSN Summary details,Not Tested,
59,GSTR1A - Get Nil Rated Supplies,Not Tested,
60,GSTR1A - Get Return Status,Not Tested,
61,GSTR1A - Get SUPECO Details,Not Tested,
62,GSTR1A - Get SUPECOA Details,Not Tested,
63,GSTR1A - Get TXP,Not Tested,
64,GSTR1A - Get TXPA,Not Tested,
65,GSTR1A - Proceed to File,Not Tested,
66,GSTR1A - Reset GSTR1A,Not Tested,
67,GSTR1A - Save GSTR1A data,Partial Working,
68,GSTR2A - Get AMDHIST,Working,
69,GSTR2A - Get B2B Invoices,Working,
70,GSTR2A - Get B2BA Invoices,Working,
71,GSTR2A - Get CDN Invoices,Working,
72,GSTR2A - Get CDNA Invoices,Working,
73,GSTR2A - Get ECOM Invoices,Working,
74,GSTR2A - Get ECOMA Invoices,Working,
75,GSTR2A - Get IMPG,Working,
76,GSTR2A - Get IMPGSEZ,Working,
77,GSTR2A - Get ISD Credit,Working,
78,GSTR2A - Get TCS Credit,Working,
79,GSTR2A - Get TDS Credit,Working,
80,IMS - Get Added Back Liability Records,Working,
81,IMS - Get IMS Request Status,Working,
82,IMS - Get Invoice Count,Working,
83,IMS - Get Invoices,Partial Working,
84,IMS - Get Supplier Invoices API,Working,
85,IMS - Reset IMS Action,Working,
86,IMS - Save IMS Action,Working,
87,IMS- Get IMS File Details API,Working,
88,GSTR2B - Generate 2B On Demand API,Working,
89,GSTR2B - Get 2B Gen Status API,Working,
90,GSTR2B - Get All Details,Working,
91,GSTR3B - File GSTR3B data,Working,
92,GSTR3B - Get GSTR3B Details,Working,
93,GSTR3B - Get ITC Liability Auto Calc Details,Working,
94,GSTR3B - Get ITC Reversal Balance,Working,
95,GSTR3B - Get Latest RCM Balance,Working,
96,GSTR3B - Get Opening Balance For Credit Reversal and Re-claimed Details,Working,
97,GSTR3B - Get RCM Opening Balance,Working,
98,GSTR3B - Get system calculated interest,Working,
99,GSTR3B - Offset Liability GSTR3B data,Working,
100,GSTR3B - Re-compute interest,working,
101,GSTR3B - Save GSTR3B data,Working,
102,GSTR3B - Save Opening Balance For Credit Reversal and Re-claimed Details,Working,
103,GSTR3B - Save past liability breakup,Working,
104,GSTR3B - Submit RCM Opening Balance,Not Working,404 - Not Found
105,GSTR3B - Validate GSTR3B against AutoCalculated data,Working,
106,GSTR4 Annual - File,Not Tested,
107,GSTR4 Annual - Get 4A-4B Autopop Details,Not Working,"{
    ""message"": ""Unexpected character encountered while parsing value: <. Path '', line 0, position 0."",
    ""isSuccess"": false
}"
108,GSTR4 Annual - Get Inward Outward Supply,Working,
109,GSTR4 Annual - Get Summary,Not Tested,
110,GSTR4 Annual - Get TDSCMP Summary,Not Working,"{
    ""message"": ""success"",
    ""data"": {
        ""httpStatusCode"": 200,
        ""error"": {
            ""message"": ""Something seems to have gone wrong while processing your request. Please try again.If error persists quote error number GSTN-EXEC2003 when you contact customer care for quick resolution."",
            ""error_cd"": ""GSTN-EXEC2003""
        }
    },
    ""isSuccess"": true
}"
111,GSTR4 Annual - Proceed to File,Not Tested,
112,GSTR4 Annual - Save,Not Tested,
113,GSTR4 Annual - Validate Liability,Not Tested,
114,GSTR4 Annual - Validate Turnover,Not Tested,
115,GSTR6 - Calculate R6,Working,
116,GSTR6 - File GSTR6,Not Tested,
117,GSTR6 - Get Amendment ISD Details,Working,
118,GSTR6 - Get B2B Invoices,Working,
119,GSTR6 - Get B2BA Invoices,Working,
120,GSTR6 - Get CDN Invoices,Working,
121,GSTR6 - Get CDNA Invoices,Not Working,"{
    ""message"": ""success"",
    ""data"": {
        ""httpStatusCode"": 200,
        ""data"": {},
        ""error"": {
            ""message"": ""Invalid Return Period"",
            ""error_cd"": ""AUTH113""
        }
    },
    ""isSuccess"": true
}"
122,GSTR6 - Get GSTR6 Summary,Working,"{
    ""message"": ""success"",
    ""data"": {
        ""httpStatusCode"": 200,
        ""error"": {
            ""message"": ""System Failure"",
            ""error_cd"": ""RET12501""
        }
    },
    ""isSuccess"": true
}"
123,GSTR6 - Get ISD Details,Not Tested,
124,GSTR6 - get ITC details,Working,
125,GSTR6 - get Late fee,Working,On Production
126,GSTR6 - Offset Late fee,Not Tested,
127,GSTR6 - Save Cross ITC Details,Not Tested,
128,GSTR6 - Save GSTR6,Working,
129,GSTR6 - Submit Gstr6,Working,
130,GSTR7 - File GSTR7,Working,
131,GSTR7 - Get TDS checksum,Working,
132,GSTR7 - Get TDS details,Working,
133,GSTR7 - Save GSTR7,Not Tested,
134,GSTR7- Get GSTR7 Summary,Working,
135,GSTR8 - File GSTR8,Not Tested,
136,GSTR8 - Get Checksum,Not Tested,
137,GSTR8 - Get Summary,Not Tested,
138,GSTR8 - GetEID,Not Tested,
139,GSTR8 - GetTCS,Not Tested,
140,GSTR8 - SAVE,Not Tested,
141,GSTR9 - Create 8A Data API,Not Tested,
142,GSTR9 - File GSTR9,Not Tested,
143,GSTR9 - Get 8A Details,Not Tested,
144,GSTR9 - Get Autocalculated Details,Working,
145,GSTR9 - Get Details,Working,
146,GSTR9 - Get R1R1A HSN Data,Not Tested,
147,GSTR9 - Save GSTR9 data,Not Tested,
148,GSTR9C - File GSTR9C,Not Tested,
149,GSTR9C - Generate Certificate,Not Tested,
150,GSTR9C - Get 9 Records for 9C,Working,
151,GSTR9C - Get Summary,Working,
152,GSTR9C - Save GSTR9C data,Not Tested,
153,GSTR9CHashGenerator,Not Tested,
154,ITC01 - File,Not Tested,
155,ITC01 - Get,Not Tested,
156,ITC01 - Save,Not Tested,
157,ITC01 - Submit,Not Tested,
158,ITC01 GET CADETAILS,Not Tested,
159,ITC01 SAVE OR DELETE CADETAILS,Not Tested,
160,ITC01-18D CLOSE,Not Tested,
161,ITC03 - Close ITC03,Not Tested,
162,ITC03 - File ITC03,Not Tested,
163,ITC03 - Get ITC03 Invoices,Not Tested,
164,ITC03 - Get ITC03 Summary,Not Tested,
165,ITC03 - Save ITC03,Not Tested,
166,ITC03 - SetOff ITC03 Liability,Not Tested,
167,ITC04 - File,Not Tested,
168,ITC04 - Get Invoices,Not Tested,
169,ITC04 - Get Summary,Not Tested,
170,ITC04 - Save,Not Tested,
171,ITC04 - Validate Turnover API,Not Tested,
172,CMP - File CMP,Not Tested,
173,CMP - Get Details,Not Tested,
174,CMP - Save,Not Tested,
175,CMP - Validate Turnover,Not Tested,
176,Public - Common Authentication,Working,
177,Public - GET PREFERENCE,Working,
178,Public - Online Verification of GSTIN,Working,
179,Public - PAN to GSTIN,Not Tested,
180,Public - Search Taxpayer,Working,
181,Public - Updated Online Verification of GSTIN,Working,
182,Public - View and Track Returns,Working,`;

function parseCustomCsv(csv) {
  const records = [];
  let i = 0;
  const len = csv.length;

  while (i < len) {
    // Read an entry starting with number
    // Find next comma or newline
    const lineStart = i;
    // Read ID
    let comma1 = csv.indexOf(",", i);
    if (comma1 === -1) break;
    const idStr = csv.substring(i, comma1).trim();
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      // Skip header line if present
      const nextNl = csv.indexOf("\n", i);
      i = nextNl === -1 ? len : nextNl + 1;
      continue;
    }

    i = comma1 + 1;
    // Read API name (might be quoted)
    let apiName = "";
    if (csv[i] === '"') {
      i++;
      let endQuote = csv.indexOf('"', i);
      while (endQuote !== -1 && csv[endQuote + 1] === '"') {
        endQuote = csv.indexOf('"', endQuote + 2);
      }
      apiName = csv.substring(i, endQuote).replace(/""/g, '"');
      i = csv.indexOf(",", endQuote) + 1;
    } else {
      let nextComma = csv.indexOf(",", i);
      apiName = csv.substring(i, nextComma);
      i = nextComma + 1;
    }

    // Read Status
    let statusRaw = "";
    let nextCommaOrNl = csv.indexOf(",", i);
    let lineEnd = csv.indexOf("\n", i);
    if (nextCommaOrNl === -1 || (lineEnd !== -1 && nextCommaOrNl > lineEnd)) {
      statusRaw = csv.substring(i, lineEnd === -1 ? len : lineEnd).trim();
      i = lineEnd === -1 ? len : lineEnd + 1;
      records.push({ id, api: apiName.trim(), statusRaw, remark: "" });
      continue;
    } else {
      statusRaw = csv.substring(i, nextCommaOrNl).trim();
      i = nextCommaOrNl + 1;
    }

    // Read Remark (could be multiline or JSON string quoted)
    let remark = "";
    if (csv[i] === '"') {
      i++;
      let endQuote = i;
      while (endQuote < len) {
        if (csv[endQuote] === '"') {
          if (csv[endQuote + 1] === '"') {
            endQuote += 2;
          } else {
            break;
          }
        } else {
          endQuote++;
        }
      }
      remark = csv.substring(i, endQuote).replace(/""/g, '"').trim();
      // Advance to next newline
      let nextNl = csv.indexOf("\n", endQuote);
      i = nextNl === -1 ? len : nextNl + 1;
    } else {
      let nextNl = csv.indexOf("\n", i);
      remark = csv.substring(i, nextNl === -1 ? len : nextNl).trim();
      i = nextNl === -1 ? len : nextNl + 1;
    }

    records.push({ id, api: apiName.trim(), statusRaw, remark });
  }

  return records;
}

const rawList = parseCustomCsv(rawCsv);
console.log("Parsed total records from user input:", rawList.length);

function deduceGroup(api, id) {
  if (id <= 5) return "Auth";
  if (id >= 6 && id <= 35) return "GSTR1";
  if (id === 36) return "All";
  if (id >= 37 && id <= 67) return "GSTR1A";
  if (id >= 68 && id <= 79) return "GSTR2A";
  if (id >= 80 && id <= 87) return "IMS";
  if (id >= 88 && id <= 90) return "GSTR2B";
  if (id >= 91 && id <= 105) return "GSTR3B";
  if (id >= 106 && id <= 114) return "GSTR4";
  if (id >= 115 && id <= 129) return "GSTR6";
  if (id >= 130 && id <= 134) return "GSTR7";
  if (id >= 135 && id <= 140) return "GSTR8";
  if (id >= 141 && id <= 147) return "GSTR9";
  if (id >= 148 && id <= 152) return "GSTR9C";
  if (id === 153) return "GSTR9C";
  if (id >= 154 && id <= 160) return "ITC01";
  if (id >= 161 && id <= 166) return "ITC03";
  if (id >= 167 && id <= 171) return "ITC04";
  if (id >= 172 && id <= 175) return "CMP";
  if (id >= 176 && id <= 182) return "Public";
  return "General";
}

function deduceMethod(api) {
  const lower = api.toLowerCase();
  if (lower.includes("file") || lower.includes("save") || lower.includes("reset") || 
      lower.includes("submit") || lower.includes("offset") || lower.includes("re-compute") ||
      lower.includes("calculate") || lower.includes("create") || lower.includes("generate") ||
      lower.includes("validate") || lower.includes("confirm") || lower.includes("proceed") ||
      lower.includes("initiate") || lower.includes("token")) {
    return "POST";
  }
  return "GET";
}

function deduceAction(api) {
  const parts = api.split(" - ");
  if (parts.length > 1) {
    return parts[1].trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  }
  return api.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function deducePath(group, api, id) {
  const g = group.toLowerCase();
  const act = deduceAction(api).toLowerCase();
  if (g === "auth") return `/commonapi/v1.0/auth/${act}`;
  if (g === "public") return `/commonapi/v1.0/public/${act}`;
  return `/returns/v1.0/${g}/${act}`;
}

const enrichedList = rawList.map(item => {
  const rawStatus = (item.statusRaw || "").toLowerCase().trim();
  let status = "not_tested";
  if (rawStatus === "working") status = "working";
  else if (rawStatus === "not working") status = "not_working";
  else if (rawStatus.includes("partial")) status = "partial";
  else if (rawStatus.includes("not tested")) status = "not_tested";

  // Retain backward-compatible status for api 4, 83, etc.
  if (item.id === 4) status = "working";
  if (item.id === 83) status = "partial";

  const group = deduceGroup(item.api, item.id);
  const method = deduceMethod(item.api);
  const action = deduceAction(item.api);
  const path = deducePath(group, item.api, item.id);

  return {
    id: item.id,
    api: item.api,
    group,
    status,
    remark: item.remark || "",
    method,
    action,
    path
  };
});

fs.writeFileSync(path.join(__dirname, "data", "api-status.json"), JSON.stringify(enrichedList, null, 2), "utf8");
console.log("Successfully wrote enriched data/api-status.json with 182 APIs!");

