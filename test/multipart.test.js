import { describe, it } from "node:test";
import assert from "node:assert";
import { parseMultipartBuffer } from "../lib/multipart.js";

describe("Multipart Parser", () => {
  it("should parse text fields and binary file buffers", () => {
    const boundary = "----WebKitFormBoundaryTest123";
    const crlf = "\r\n";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="category"${crlf}${crlf}purchase_bill${crlf}`),
      Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="sample.pdf"${crlf}Content-Type: application/pdf${crlf}${crlf}%PDF-1.4 binary content here${crlf}`),
      Buffer.from(`--${boundary}--${crlf}`)
    ]);

    const parsed = parseMultipartBuffer(payload, `multipart/form-data; boundary=${boundary}`);
    assert.strictEqual(parsed.category, "purchase_bill");
    assert.ok(parsed.file, "file object should be present");
    assert.strictEqual(parsed.filename, "sample.pdf");
    assert.strictEqual(parsed.contentType, "application/pdf");
    assert.strictEqual(parsed.fileBytes.toString("utf8"), "%PDF-1.4 binary content here");
    assert.strictEqual(parsed.files.length, 1);
  });
});
