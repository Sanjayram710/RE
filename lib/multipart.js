/**
 * SimpleGST Multipart Form-Data Parser
 * Native Node.js buffer-based parser without external dependencies.
 */

export function parseMultipartBuffer(buffer, contentType) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return {};
  }
  const match = (contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw new Error("Missing multipart boundary");
  }
  const boundaryStr = (match[1] || match[2]).trim();
  const boundary = Buffer.from(`--${boundaryStr}`);
  const result = { files: [] };

  let start = 0;
  while (start < buffer.length) {
    const boundaryIdx = buffer.indexOf(boundary, start);
    if (boundaryIdx === -1) break;

    const partStart = boundaryIdx + boundary.length;
    // Check if it's the closing delimiter: boundary + "--"
    if (buffer.subarray(partStart, partStart + 2).toString("ascii") === "--") {
      break;
    }

    // Advance past CRLF or LF after the boundary
    let dataStart = partStart;
    if (buffer[dataStart] === 0x0d && buffer[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (buffer[dataStart] === 0x0a) {
      dataStart += 1;
    }

    // Next boundary index marks end of this part
    const nextBoundaryIdx = buffer.indexOf(boundary, dataStart);
    if (nextBoundaryIdx === -1) break;

    // Body ends right before next boundary (ignoring preceding CRLF / LF)
    let dataEnd = nextBoundaryIdx;
    if (dataEnd >= 2 && buffer[dataEnd - 2] === 0x0d && buffer[dataEnd - 1] === 0x0a) {
      dataEnd -= 2;
    } else if (dataEnd >= 1 && buffer[dataEnd - 1] === 0x0a) {
      dataEnd -= 1;
    }

    const partBuffer = buffer.subarray(dataStart, dataEnd);

    // Find separator between headers and body: \r\n\r\n or \n\n
    let headerSep = Buffer.from("\r\n\r\n");
    let headerSepIdx = partBuffer.indexOf(headerSep);
    let headerSepLen = 4;
    if (headerSepIdx === -1) {
      headerSep = Buffer.from("\n\n");
      headerSepIdx = partBuffer.indexOf(headerSep);
      headerSepLen = 2;
    }

    if (headerSepIdx !== -1) {
      const headerStr = partBuffer.subarray(0, headerSepIdx).toString("utf8");
      const bodyBuffer = partBuffer.subarray(headerSepIdx + headerSepLen);

      // Parse headers
      const headerLines = headerStr.split(/\r?\n/);
      let fieldName = null;
      let filename = null;
      let partContentType = "application/octet-stream";

      for (const line of headerLines) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();

        if (key === "content-disposition") {
          const nameMatch = value.match(/name=(?:"([^"]+)"|([^;]+))/i);
          if (nameMatch) fieldName = (nameMatch[1] || nameMatch[2]).trim();

          const fileMatch = value.match(/filename=(?:"([^"]+)"|([^;]+))/i);
          if (fileMatch) filename = (fileMatch[1] || fileMatch[2]).trim();
        } else if (key === "content-type") {
          partContentType = value;
        }
      }

      if (fieldName) {
        if (filename !== null && filename !== undefined) {
          const fileObj = {
            filename,
            contentType: partContentType,
            data: bodyBuffer,
            size: bodyBuffer.length,
            fileBytes: bodyBuffer
          };
          result.files.push(fileObj);
          if (!result.file) {
            result.file = fileObj;
            result.filename = filename;
            result.fileBytes = bodyBuffer;
            result.contentType = partContentType;
          }
          result[fieldName] = fileObj;
        } else {
          result[fieldName] = bodyBuffer.toString("utf8");
        }
      }
    }

    start = nextBoundaryIdx;
  }

  return result;
}

