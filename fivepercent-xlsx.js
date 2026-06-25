(function initFivePercentXlsx(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FivePercentXlsx = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function createFivePercentXlsx() {
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
const textDecoder = new TextDecoder("utf-8");

function asBytes(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error("Unsupported XLSX input buffer.");
}

function getUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function getUint32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>> 0
  );
}

function findEndOfCentralDirectory(bytes) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (getUint32(bytes, i) === END_OF_CENTRAL_DIR) {
      return i;
    }
  }
  throw new Error("Unsupported XLSX file: ZIP directory was not found.");
}

function decodeBytes(bytes) {
  return textDecoder.decode(bytes);
}

async function inflateRaw(bytes) {
  if (typeof require === "function") {
    try {
      const zlib = require("zlib");
      const inflated = zlib.inflateRawSync(Buffer.from(bytes));
      return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    } catch (error) {
      if (typeof DecompressionStream === "undefined") {
        throw error;
      }
    }
  }

  if (typeof DecompressionStream !== "undefined") {
    const formats = ["deflate-raw", "deflate"];
    for (const format of formats) {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (error) {
        if (format === formats[formats.length - 1]) {
          throw error;
        }
      }
    }
  }

  throw new Error("This browser cannot decompress XLSX files.");
}

async function unzip(input) {
  const bytes = asBytes(input);
  const endOffset = findEndOfCentralDirectory(bytes);
  const entryCount = getUint16(bytes, endOffset + 10);
  const directoryOffset = getUint32(bytes, endOffset + 16);
  const files = new Map();
  let cursor = directoryOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (getUint32(bytes, cursor) !== CENTRAL_FILE_HEADER) {
      throw new Error("Unsupported XLSX file: invalid ZIP central directory.");
    }

    const method = getUint16(bytes, cursor + 10);
    const compressedSize = getUint32(bytes, cursor + 20);
    const fileNameLength = getUint16(bytes, cursor + 28);
    const extraLength = getUint16(bytes, cursor + 30);
    const commentLength = getUint16(bytes, cursor + 32);
    const localHeaderOffset = getUint32(bytes, cursor + 42);
    const nameStart = cursor + 46;
    const fileName = decodeBytes(bytes.slice(nameStart, nameStart + fileNameLength));

    if (getUint32(bytes, localHeaderOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`Unsupported XLSX file: invalid ZIP local header for ${fileName}.`);
    }

    const localNameLength = getUint16(bytes, localHeaderOffset + 26);
    const localExtraLength = getUint16(bytes, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);

    if (method === 0) {
      files.set(fileName, compressed);
    } else if (method === 8) {
      files.set(fileName, await inflateRaw(compressed));
    } else {
      throw new Error(`Unsupported XLSX file: ZIP compression method ${method}.`);
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

function decodeXmlEntities(value) {
  if (!value || !value.includes("&")) {
    return value || "";
  }
  return value.replace(/&(#x?[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(parseInt(entity.slice(1), 10));
    }
    return match;
  });
}

function attr(attrs, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? decodeXmlEntities(match[1]) : "";
}

function cellRefToIndexes(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) {
    return null;
  }

  let col = 0;
  for (const ch of match[1]) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }

  return {
    row: Number(match[2]),
    col: col - 1,
  };
}

function parseSharedStrings(xml) {
  const strings = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch;
  while ((siMatch = siRegex.exec(xml))) {
    const parts = [];
    const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch;
    while ((textMatch = textRegex.exec(siMatch[1]))) {
      parts.push(decodeXmlEntities(textMatch[1]));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

function parseCellValue(attrs, body, sharedStrings) {
  const type = attr(attrs, "t");
  if (type === "inlineStr") {
    const parts = [];
    const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch;
    while ((textMatch = textRegex.exec(body))) {
      parts.push(decodeXmlEntities(textMatch[1]));
    }
    return parts.join("");
  }

  const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
  if (!valueMatch) {
    return "";
  }

  const value = decodeXmlEntities(valueMatch[1]);
  if (type === "s") {
    const index = Number(value);
    return Number.isInteger(index) ? sharedStrings[index] || "" : "";
  }
  if (type === "b") {
    return value === "1" ? "TRUE" : "FALSE";
  }
  return value;
}

function parseMergeRefs(xml) {
  const refs = [];
  const mergeRegex = /<mergeCell\b[^>]*\bref="([^"]+)"/g;
  let match;
  while ((match = mergeRegex.exec(xml))) {
    refs.push(decodeXmlEntities(match[1]));
  }
  return refs;
}

function applyMerges(rowMap, mergeRefs) {
  for (const ref of mergeRefs) {
    const [startRef, endRef] = ref.split(":");
    if (!startRef || !endRef) {
      continue;
    }
    const start = cellRefToIndexes(startRef);
    const end = cellRefToIndexes(endRef);
    if (!start || !end) {
      continue;
    }

    const topRow = rowMap.get(start.row);
    const value = topRow && topRow.cells[start.col] !== undefined ? topRow.cells[start.col] : "";
    if (value === "") {
      continue;
    }

    for (let row = start.row; row <= end.row; row += 1) {
      const rowEntry = rowMap.get(row);
      if (!rowEntry) {
        continue;
      }
      for (let col = start.col; col <= end.col; col += 1) {
        if (rowEntry.cells[col] === undefined || rowEntry.cells[col] === "") {
          rowEntry.cells[col] = value;
        }
      }
    }
  }
}

function parseWorksheetXml(xml, sharedStrings) {
  const rows = [];
  const rowMap = new Map();
  const dimensionMatch = /<dimension\b[^>]*\bref="([^"]+)"/.exec(xml);
  const dimension = dimensionMatch ? decodeXmlEntities(dimensionMatch[1]) : "";
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml))) {
    const rowAttrs = rowMatch[1];
    const rowNumber = Number(attr(rowAttrs, "r")) || rows.length + 1;
    const row = { rowNumber, cells: [] };
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[2]))) {
      const cellAttrs = cellMatch[1];
      const cellRef = attr(cellAttrs, "r");
      const indexes = cellRefToIndexes(cellRef);
      if (!indexes) {
        continue;
      }
      row.cells[indexes.col] = parseCellValue(cellAttrs, cellMatch[2] || "", sharedStrings);
    }

    rows.push(row);
    rowMap.set(rowNumber, row);
  }

  applyMerges(rowMap, parseMergeRefs(xml));
  return { rows, dimension };
}

function parseWorkbookSheetName(xml) {
  const match = /<sheet\b[^>]*\bname="([^"]+)"/.exec(xml);
  return match ? decodeXmlEntities(match[1]) : "";
}

async function readWorkbook(input) {
  const files = await unzip(input);
  const worksheetBytes = files.get("xl/worksheets/sheet1.xml");
  if (!worksheetBytes) {
    throw new Error("Unsupported XLSX file: worksheet sheet1.xml was not found.");
  }

  const workbookXml = files.has("xl/workbook.xml") ? decodeBytes(files.get("xl/workbook.xml")) : "";
  const sharedStringsXml = files.has("xl/sharedStrings.xml")
    ? decodeBytes(files.get("xl/sharedStrings.xml"))
    : "";
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const worksheetXml = decodeBytes(worksheetBytes);
  const sheet = parseWorksheetXml(worksheetXml, sharedStrings);

  return {
    ...sheet,
    sheetName: parseWorkbookSheetName(workbookXml),
    title: sheet.rows[0] && sheet.rows[0].cells[0] ? sheet.rows[0].cells[0] : "",
  };
}

return Object.freeze({
  decodeXmlEntities,
  parseSharedStrings,
  parseWorksheetXml,
  readWorkbook,
});
});
