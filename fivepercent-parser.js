(function initFivePercentParser(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FivePercentParser = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function createFivePercentParser() {
const LINE_Y_TOL = 2.2;
const HEADER_SCAN_LINES = 4;

function cleanText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\u2212/g, "-")
    .replace(/−/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(value) {
  return cleanText(value).toUpperCase();
}

function firstLine(value) {
  if (!value) {
    return "";
  }
  const parts = String(value).split(/[\r\n]+/);
  return cleanText(parts.length ? parts[0] : value);
}

function looksLikeTicker(value) {
  return /^[A-Z]{4}$/.test(cleanText(value).toUpperCase());
}

function normalizeNumber(value) {
  let s = cleanText(value);
  if (!s || s === "-") {
    return "";
  }
  s = s.replace(/\(/g, "-").replace(/\)/g, "");
  s = s.replace(/%/g, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/[\u2212−]/g, "-");
  return s;
}

function looksLikeNumericInt(raw) {
  let r = normalizeNumber(raw);
  if (!r) {
    return false;
  }
  if (r.startsWith("+") || r.startsWith("-")) {
    r = r.slice(1);
  }
  return /^\d[\d.,]*$/.test(r);
}

function looksLikeNumericPct(raw) {
  let r = normalizeNumber(raw);
  if (!r) {
    return false;
  }
  if (r.startsWith("+") || r.startsWith("-")) {
    r = r.slice(1);
  }
  return /^\d+(?:[.,]\d+)?$/.test(r);
}

function parseShareInt(raw) {
  let s = normalizeNumber(raw);
  if (!s) {
    return null;
  }

  let sign = 1;
  if (s.startsWith("+")) {
    s = s.slice(1);
  } else if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }

  const parts = s.split(/[.,]/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last.length > 0 && last.length < 3) {
      parts[parts.length - 1] = last.padEnd(3, "0");
    }
    s = parts.join("");
  } else {
    s = s.replace(/[.,]/g, "");
  }

  if (!/^\d+$/.test(s)) {
    return null;
  }

  const parsed = Number(s);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return sign * parsed;
}

function looksLikeClippedSharePrefix(raw, fullValue) {
  if (fullValue === null || fullValue === undefined || !Number.isFinite(fullValue)) {
    return false;
  }

  let s = normalizeNumber(raw);
  if (!s || s === "-") {
    return false;
  }

  let rawSign = 1;
  if (s.startsWith("+")) {
    s = s.slice(1);
  } else if (s.startsWith("-")) {
    rawSign = -1;
    s = s.slice(1);
  }

  if (fullValue !== 0 && rawSign !== Math.sign(fullValue)) {
    return false;
  }

  const rawDigits = s.replace(/[.,]/g, "");
  const fullDigits = String(Math.abs(fullValue));
  if (!rawDigits || rawDigits.length >= fullDigits.length) {
    return false;
  }

  const missing = fullDigits.slice(rawDigits.length);
  return fullDigits.startsWith(rawDigits) && /^0+$/.test(missing);
}

function reconcileClippedShare(raw, parsed, candidate) {
  if (parsed === null || parsed === undefined || candidate === null || candidate === undefined) {
    return parsed;
  }
  if (parsed === candidate) {
    return parsed;
  }
  return looksLikeClippedSharePrefix(raw, candidate) ? candidate : parsed;
}

function parsePct(raw) {
  let s = normalizeNumber(raw);
  if (!s) {
    return null;
  }

  let sign = 1;
  if (s.startsWith("+")) {
    s = s.slice(1);
  } else if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }

  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(/,/g, ".");
  }

  const parsed = Number(s);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return sign * parsed;
}

function sanePctOwned(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return value >= 0 && value <= 100 ? value : null;
}

function sanePctChange(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Math.abs(value) <= 100 ? value : null;
}

function buildLinesFromTextContent(textContent) {
  const rawItems = [];

  for (const item of textContent.items || []) {
    const text = cleanText(item.str);
    if (!text) {
      continue;
    }

    const transform = item.transform || [0, 0, 0, 0, 0, 0];
    rawItems.push({
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      width: Number(item.width) || 0,
      text,
    });
  }

  rawItems.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 0.05) {
      return b.y - a.y;
    }
    return a.x - b.x;
  });

  const lines = [];
  for (const item of rawItems) {
    let bestIndex = -1;
    let bestDelta = Infinity;

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const delta = Math.abs(lines[i].y - item.y);
      if (delta <= LINE_Y_TOL && delta < bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
      if (lines[i].y - item.y > LINE_Y_TOL * 3) {
        break;
      }
    }

    if (bestIndex === -1) {
      lines.push({ y: item.y, items: [item] });
    } else {
      const line = lines[bestIndex];
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
    }
  }

  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = cleanText(line.items.map((item) => item.text).join(" "));
  }

  return lines;
}

function looksLikeHeaderContinuation(text) {
  const u = norm(text);
  if (!u) {
    return false;
  }
  return (
    u.includes("JUMLAH SAHAM") ||
    u.includes("PERSENTASE") ||
    u.includes("PERUBAHAN") ||
    u.includes("KEPEMILIKAN PER") ||
    u.includes("NAMA PEMEGANG") ||
    u.includes("KEBANGSAAN") ||
    u.includes("DOMISILI")
  );
}

function isPrimaryHeaderLine(line) {
  const u = norm(line && line.text);
  return (
    u.includes("KODE") &&
    u.includes("PEMEGANG") &&
    u.includes("ALAMAT")
  );
}

function classifyPrimaryHeader(item) {
  const text = norm(item.text);
  if (text === "NO") {
    return "no";
  }
  if (text === "KODE" || text.includes("KODE EFEK")) {
    return "ticker";
  }
  if (text.includes("NAMA PEMEGANG REKENING EFEK")) {
    return "sekuritas";
  }
  if (text.includes("NAMA PEMEGANG SAHAM")) {
    return "owner";
  }
  if (text.includes("NAMA REKENING EFEK")) {
    return "rekening";
  }
  if (text.includes("NAMA EMITEN")) {
    return "emiten";
  }
  if (text.includes("ALAMAT") && text.includes("LANJUTAN")) {
    return "address2";
  }
  if (text === "ALAMAT") {
    return "address1";
  }
  if (text.includes("KEBANGSAAN")) {
    return "country";
  }
  if (text.includes("DOMISILI")) {
    return "domicile";
  }
  if (text === "STATUS" || text.includes("STATUS (LOKAL/ASING)")) {
    return "status";
  }
  if (text.includes("PERUBAHAN")) {
    return "change";
  }
  return "";
}

function classifyNumericHeaders(items) {
  const counts = {
    shares: 0,
    total: 0,
    pct: 0,
    ownershipStatus: 0,
    blockingReason: 0,
  };
  const result = [];

  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    const text = norm(item.text);
    let field = "";
    if (text.includes("JUMLAH SAHAM")) {
      field = counts.shares++ === 0 ? "shares_prev" : "shares_curr";
    } else if (text.includes("SAHAM GABUNGAN")) {
      field = counts.total++ === 0 ? "shares_total_prev" : "shares_total_curr";
    } else if (text.includes("PERSENTASE")) {
      field = counts.pct++ === 0 ? "pct_prev" : "pct_curr";
    } else if (text.includes("STATUS KEPEMILIKAN")) {
      field =
        counts.ownershipStatus++ === 0
          ? "ownership_status_prev"
          : "ownership_status_curr";
    } else if (text.includes("BLOCKING REASON")) {
      field =
        counts.blockingReason++ === 0
          ? "blocking_reason_prev"
          : "blocking_reason_curr";
    }

    if (field) {
      result.push({ field, item });
    }
  }

  return result;
}

function hasRequiredNumericHeaders(headers) {
  const fields = new Set(headers.map((header) => header.field));
  return [
    "shares_prev",
    "shares_total_prev",
    "pct_prev",
    "shares_curr",
    "shares_total_curr",
    "pct_curr",
  ].every((field) => fields.has(field));
}

function inferTextColumns(headerItems, numericStart) {
  const headers = [];
  let noHeader = null;

  for (const item of headerItems) {
    const field = classifyPrimaryHeader(item);
    if (!field || field === "change") {
      continue;
    }
    const header = {
      field,
      item,
      center: item.x + item.width / 2,
    };
    if (field === "no") {
      noHeader = header;
    } else if (!headers.some((entry) => entry.field === field)) {
      headers.push(header);
    }
  }

  headers.sort((a, b) => a.item.x - b.item.x);
  if (!noHeader || headers[0]?.field !== "ticker") {
    throw new Error("Unsupported table schema: missing No or Kode Efek header.");
  }

  const tickerHeader = headers[0];
  const noRight = noHeader.item.x + noHeader.item.width;
  const starts = [
    Math.max(noRight + 0.75, tickerHeader.item.x - 2),
  ];

  for (let i = 0; i < headers.length; i += 1) {
    starts.push(2 * headers[i].center - starts[i]);
  }

  // Header labels are centered. Recursively reflecting each center recovers
  // column starts; the final correction ties that sequence to the numeric band.
  const predictedEnd = starts[starts.length - 1];
  const endDelta = numericStart - predictedEnd;
  for (let i = 1; i < starts.length; i += 1) {
    starts[i] += endDelta * (i / (starts.length - 1));
  }

  const columns = [
    { field: "no", start: noHeader.item.x - 1, kind: "text" },
  ];
  for (let i = 0; i < headers.length; i += 1) {
    columns.push({ field: headers[i].field, start: starts[i], kind: "text" });
  }

  return columns;
}

function validateSchemaColumns(columns) {
  const required = [
    "ticker",
    "owner",
    "rekening",
    "status",
    "shares_prev",
    "shares_total_prev",
    "pct_prev",
    "shares_curr",
    "shares_total_curr",
    "pct_curr",
    "change",
  ];
  const fields = new Set(columns.map((column) => column.field));
  const missing = required.filter((field) => !fields.has(field));
  if (missing.length) {
    throw new Error(`Unsupported table schema: missing ${missing.join(", ")}.`);
  }

  for (let i = 1; i < columns.length; i += 1) {
    if (!(columns[i].start > columns[i - 1].start)) {
      throw new Error("Unsupported table schema: overlapping header columns.");
    }
  }
}

function buildHeaderSchema(headerItems, numericItems, headerStart, dataStart) {
  const numericHeaders = classifyNumericHeaders(numericItems);
  if (!hasRequiredNumericHeaders(numericHeaders)) {
    throw new Error("Unsupported table schema: numeric headers were not recognized.");
  }

  const firstNumericStart = numericHeaders[0].item.x - 1;
  const columns = inferTextColumns(headerItems, firstNumericStart);
  for (const header of numericHeaders) {
    columns.push({ field: header.field, start: header.item.x - 0.75, kind: "numeric" });
  }

  const changeHeader = headerItems.find(
    (item) => classifyPrimaryHeader(item) === "change",
  );
  const lastNumericHeader = numericHeaders[numericHeaders.length - 1].item;
  if (!changeHeader) {
    throw new Error("Unsupported table schema: missing Perubahan header.");
  }
  const lastNumericRight = lastNumericHeader.x + lastNumericHeader.width;
  columns.push({
    field: "change",
    start: (lastNumericRight + changeHeader.x) / 2,
    kind: "numeric",
  });

  columns.sort((a, b) => a.start - b.start);
  validateSchemaColumns(columns);

  const fields = new Set(columns.map((column) => column.field));
  return {
    columns,
    headerStart,
    dataStart,
    displayRekeningAsSekuritas: !fields.has("sekuritas"),
    preferCachedOwner: !fields.has("sekuritas"),
  };
}

function discoverHeaderSchemas(lines) {
  const schemas = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isPrimaryHeaderLine(lines[i])) {
      continue;
    }

    const headerItems = [...(lines[i].items || [])];
    const numericItems = [];
    let numericIndex = -1;
    const end = Math.min(lines.length, i + HEADER_SCAN_LINES);
    for (let j = i + 1; j < end; j += 1) {
      headerItems.push(...(lines[j].items || []));
      numericItems.push(...(lines[j].items || []));
      if (hasRequiredNumericHeaders(classifyNumericHeaders(numericItems))) {
        numericIndex = j;
        break;
      }
    }
    if (numericIndex === -1) {
      throw new Error("Unsupported table schema: numeric header row was not found.");
    }

    schemas.push(buildHeaderSchema(headerItems, numericItems, i, numericIndex + 1));
  }

  for (let i = 0; i < schemas.length; i += 1) {
    schemas[i].dataEnd = i + 1 < schemas.length ? schemas[i + 1].headerStart : lines.length;
  }
  return schemas;
}

function columnForX(x, columns) {
  let field = "";
  for (const column of columns) {
    // Text starts drift slightly from centered labels. Numeric bands cannot use
    // that tolerance because short values and "-" sit near the next boundary.
    const tolerance = column.kind === "text" ? 2.25 : 0.25;
    if (x + tolerance < column.start) {
      break;
    }
    field = column.field;
  }
  return field;
}

function assignItemsToCells(items, columns) {
  const cells = {};
  for (const item of items || []) {
    const field = columnForX(item.x, columns);
    if (!field) {
      continue;
    }
    if (!cells[field]) {
      cells[field] = cleanText(item.text);
    } else {
      cells[field] = cleanText(`${cells[field]} ${item.text}`);
    }
  }
  return cells;
}

function reconcilePctAndChange(cells) {
  const pctRaw = cleanText(cells.pct_curr || "");
  const changeRaw = cleanText(cells.change || "");
  if (!pctRaw || looksLikeNumericInt(changeRaw)) {
    return;
  }

  const parts = pctRaw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return;
  }

  const pctCandidate = parts[0];
  const changeCandidate = parts[parts.length - 1];
  if (!looksLikeNumericPct(pctCandidate) || !looksLikeNumericInt(changeCandidate)) {
    return;
  }

  cells.pct_curr = pctCandidate;
  cells.change = changeCandidate;
}

function reconcilePctStatus(cells) {
  for (const field of ["pct_prev", "pct_curr", "pct_change"]) {
    const raw = cleanText(cells[field] || "");
    if (!raw || looksLikeNumericPct(raw)) {
      continue;
    }

    const firstToken = raw.split(/\s+/)[0];
    if (looksLikeNumericPct(firstToken)) {
      cells[field] = firstToken;
    }
  }
}

function hasUsefulNumeric(cells) {
  const candidates = [
    cells.shares_curr,
    cells.shares_prev,
    cells.shares_total_curr,
    cells.shares_total_prev,
    cells.change,
    cells.pct_curr,
    cells.pct_prev,
    cells.pct_change,
  ];
  return candidates.some((v) => looksLikeNumericInt(v) || looksLikeNumericPct(v) || cleanText(v) === "-");
}

function looksLikeOwnerFallback(value) {
  const s = cleanText(value);
  if (!s) {
    return false;
  }
  if (!/[A-Za-z]/.test(s)) {
    return false;
  }
  if (s.length > 80) {
    return false;
  }
  const words = s.split(" ").filter(Boolean);
  if (words.length > 10) {
    return false;
  }
  if (/\b(S\/A|A[\/-]C|TRUST|TR\b|BRANCH|OMNIBUS|CLIENT|CUSTODY|REGISTRAR|ODD\s+LOTS)\b/i.test(s)) {
    return false;
  }
  return true;
}

function ownerCandidateFromRekening(value) {
  let s = cleanText(value);
  if (!s) {
    return "";
  }

  const qqParts = s.split(/\bQQ\b/i).map((part) => cleanText(part)).filter(Boolean);
  if (qqParts.length > 1) {
    s = qqParts[qqParts.length - 1];
  }

  s = cleanText(s.split(/\bA[\/-]C\b/i)[0]);
  s = cleanText(s.split(/\b(ODD\s+LOTS|CLIENT|FIRM\s+AC|REGISTRAR)\b/i)[0]);

  return s;
}

function canonicalOwnerName(value) {
  let k = cleanText(value).toUpperCase();
  k = k.replace(/[^A-Z0-9 ]+/g, " ");
  k = k.replace(/\b(DRS|DR|IR|PROF|H|HJ|H\.)\b/g, " ");
  k = k.replace(/\s+/g, " ").trim();
  return k;
}

function looksAccountLikeOwner(value) {
  return /\b(S\/A|A[\/-]C|QQ|TRUST|TR\b|OMNIBUS|CLIENT|CUSTODY|FIRM\s+AC)\b/i.test(cleanText(value));
}

function ownerEntityTokens(value) {
  const legal = new Set(["PT", "TBK", "LTD", "LIMITED", "PTE", "PLC", "CO", "CORP", "INC"]);
  const noise = new Set(["QQ", "CLIENT", "CUSTODY", "FIRM", "AC"]);

  const normalized = canonicalOwnerName(value)
    .replace(/\bINTL\b/g, "INTERNATIONAL")
    .replace(/\bHOLDINGS\b/g, "HOLDING")
    .replace(/\bAND\b/g, " ");

  return normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => !legal.has(token) && !noise.has(token));
}

function sameOwnerEntity(a, b) {
  const ca = canonicalOwnerName(a);
  const cb = canonicalOwnerName(b);
  if (!ca || !cb) {
    return false;
  }
  if (ca === cb) {
    return true;
  }

  const ta = ownerEntityTokens(a);
  const tb = ownerEntityTokens(b);
  if (!ta.length || !tb.length) {
    return false;
  }

  const setB = new Set(tb);
  const overlap = ta.filter((token) => setB.has(token)).length;
  const ratio = overlap / Math.min(ta.length, tb.length);
  return ratio >= 0.75;
}

function storeGroupHint(state, ticker, ownerRaw, pctOwned, pctChange, sharesChange) {
  if (!ticker || !ownerRaw) {
    return;
  }

  const [, ownerKey] = normalizeOwnerKey(ownerRaw);
  const key = `${ticker}\u0000${ownerKey}`;
  const prev = state.groupHints.get(key) || {};

  state.groupHints.set(key, {
    pct_owned: pctOwned !== null && pctOwned !== undefined ? pctOwned : prev.pct_owned ?? null,
    pct_change: pctChange !== null && pctChange !== undefined ? pctChange : prev.pct_change ?? null,
    shares_change: sharesChange !== null && sharesChange !== undefined ? sharesChange : prev.shares_change ?? null,
  });
}

function rowsFromLines(lines, state) {
  const out = [];
  const schemas = discoverHeaderSchemas(lines);
  state.schemaCount += schemas.length;

  for (const schema of schemas) {
    for (let i = schema.dataStart; i < schema.dataEnd; i += 1) {
      const line = lines[i];
      if (!line || !line.text) {
        continue;
      }

      const upper = norm(line.text);
      if (looksLikeHeaderContinuation(upper) || upper.includes("KEPEMILIKAN EFEK DIATAS 5%")) {
        continue;
      }

      const cells = assignItemsToCells(line.items, schema.columns);
      reconcilePctAndChange(cells);
      reconcilePctStatus(cells);
      if (!hasUsefulNumeric(cells)) {
        continue;
      }

      const rawTicker = norm(cells.ticker || "");
      let ticker = "";
      if (looksLikeTicker(rawTicker)) {
        ticker = rawTicker;
        state.lastTicker = ticker;
      } else if (!rawTicker && state.lastTicker) {
        ticker = state.lastTicker;
      } else {
        continue;
      }

      let ownerFromCell = cleanText(cells.owner || "");
      const cachedOwner = state.lastOwnerByTicker.get(ticker) || "";
      const rekeningCandidate = cleanText(cells.rekening || "");
      const ownerFromRekeningCandidate = ownerCandidateFromRekening(rekeningCandidate);
      const ownerFromRekening = looksLikeOwnerFallback(ownerFromRekeningCandidate)
        ? ownerFromRekeningCandidate
        : "";

      if (ownerFromCell && cachedOwner && looksAccountLikeOwner(ownerFromCell)) {
        ownerFromCell = "";
      }

      let ownerRaw = ownerFromCell;
      if (!ownerRaw) {
        if (schema.preferCachedOwner && cachedOwner) {
          ownerRaw = cachedOwner;
        } else if (ownerFromRekening) {
          if (!cachedOwner || !sameOwnerEntity(ownerFromRekening, cachedOwner)) {
            ownerRaw = ownerFromRekening;
          } else {
            ownerRaw = cachedOwner;
          }
        } else {
          ownerRaw = cachedOwner;
        }
      }

      if (ownerRaw) {
        state.lastOwnerByTicker.set(ticker, ownerRaw);
      }

      let countryRaw = cleanText(cells.country || "");
      const countryKey = ownerRaw ? `${ticker}\u0000${canonicalOwnerName(ownerRaw)}` : "";
      if (countryRaw) {
        state.lastCountryByOwner.set(countryKey, countryRaw);
      } else if (countryKey) {
        countryRaw = state.lastCountryByOwner.get(countryKey) || "";
      }

      const sekuritasRaw = cleanText(
        cells.sekuritas ||
          (schema.displayRekeningAsSekuritas ? cells.rekening : ""),
      );

      const sharesOwnedRaw = cleanText(cells.shares_curr || cells.shares_total_curr || "");
      let sharesOwned = looksLikeNumericInt(sharesOwnedRaw) ? parseShareInt(sharesOwnedRaw) : null;

      const sharesPrevRaw = cleanText(cells.shares_prev || cells.shares_total_prev || "");
      let sharesPrev = looksLikeNumericInt(sharesPrevRaw) ? parseShareInt(sharesPrevRaw) : null;

      if (sharesOwned === null && sharesPrev !== null && (sharesOwnedRaw === "" || sharesOwnedRaw === "-")) {
        sharesOwned = 0;
      }
      if (sharesPrev === null && sharesOwned !== null && sharesPrevRaw === "-") {
        sharesPrev = 0;
      }

      let sharesChange = null;
      const changeRaw = cleanText(cells.change || "");
      if (looksLikeNumericInt(changeRaw)) {
        sharesChange = parseShareInt(changeRaw);
      }

      if (sharesPrev !== null && sharesChange !== null && looksLikeNumericInt(sharesOwnedRaw)) {
        sharesOwned = reconcileClippedShare(sharesOwnedRaw, sharesOwned, sharesPrev + sharesChange);
      }
      if (sharesOwned !== null && sharesChange !== null && looksLikeNumericInt(sharesPrevRaw)) {
        sharesPrev = reconcileClippedShare(sharesPrevRaw, sharesPrev, sharesOwned - sharesChange);
      }

      const computedSharesChange =
        sharesPrev !== null && sharesOwned !== null ? sharesOwned - sharesPrev : null;
      if (computedSharesChange !== null && sharesChange === null) {
        sharesChange = computedSharesChange;
      } else if (
        computedSharesChange !== null &&
        sharesChange !== computedSharesChange &&
        looksLikeClippedSharePrefix(changeRaw, computedSharesChange)
      ) {
        sharesChange = computedSharesChange;
      }

      let pctOwned = null;
      const pctOwnedRaw = cleanText(cells.pct_curr || "");
      if (looksLikeNumericPct(pctOwnedRaw)) {
        pctOwned = sanePctOwned(parsePct(pctOwnedRaw));
      }

      let pctPrev = null;
      const pctPrevRaw = cleanText(cells.pct_prev || "");
      if (looksLikeNumericPct(pctPrevRaw)) {
        pctPrev = sanePctOwned(parsePct(pctPrevRaw));
      }
      if (pctPrev === null && pctOwned !== null && pctPrevRaw === "-") {
        pctPrev = 0;
      }

      let pctChange = null;
      const pctChangeRaw = cleanText(cells.pct_change || "");
      if (looksLikeNumericPct(pctChangeRaw)) {
        pctChange = sanePctChange(parsePct(pctChangeRaw));
      }
      if (pctChange === null && pctOwned !== null && pctPrev !== null) {
        pctChange = sanePctChange(pctOwned - pctPrev);
      }

      const looksLikeSummaryOnlyRow =
        !sekuritasRaw &&
        cleanText(cells.owner || "") &&
        (looksLikeNumericPct(cells.pct_curr || "") || looksLikeNumericPct(cells.pct_prev || "")) &&
        (looksLikeNumericInt(cells.shares_total_curr || "") ||
          looksLikeNumericInt(cells.shares_curr || "") ||
          looksLikeNumericInt(cells.shares_total_prev || "") ||
          looksLikeNumericInt(cells.shares_prev || ""));

      if (looksLikeSummaryOnlyRow) {
        storeGroupHint(state, ticker, ownerRaw, pctOwned, pctChange, sharesChange);
        continue;
      }

      const hasSignal = [sharesOwned, sharesPrev, sharesChange, pctOwned, pctPrev, pctChange].some(
        (v) => v !== null && v !== undefined,
      );
      if (!hasSignal || sharesOwned === null) {
        continue;
      }

      storeGroupHint(state, ticker, ownerRaw, pctOwned, pctChange, sharesChange);

      out.push({
        ticker,
        owner_raw: ownerRaw,
        sekuritas_raw: sekuritasRaw,
        country_raw: countryRaw,
        shares_owned: sharesOwned,
        shares_change: sharesChange,
        pct_owned: pctOwned,
        pct_change: pctChange,
      });
    }
  }

  return out;
}

function sheetValue(row, col) {
  if (!row || !row.cells || col === undefined || col === null || col < 0) {
    return "";
  }
  return cleanText(row.cells[col]);
}

function maxSheetColumn(rows) {
  let max = -1;
  for (const row of rows || []) {
    if (!row || !row.cells) {
      continue;
    }
    for (let i = row.cells.length - 1; i >= 0; i -= 1) {
      if (row.cells[i] !== undefined && row.cells[i] !== "") {
        max = Math.max(max, i);
        break;
      }
    }
  }
  return max;
}

function findSheetHeaderRows(sheetRows) {
  for (let i = 0; i < sheetRows.length - 1; i += 1) {
    const row = sheetRows[i];
    const next = sheetRows[i + 1];
    const joined = [...(row.cells || []), ...(next.cells || [])]
      .map((value) => norm(value))
      .join(" ");

    if (
      joined.includes("KODE EFEK") &&
      joined.includes("NAMA PEMEGANG SAHAM") &&
      joined.includes("KEPEMILIKAN PER") &&
      joined.includes("JUMLAH SAHAM") &&
      joined.includes("PERSENTASE KEPEMILIKAN") &&
      joined.includes("PERUBAHAN")
    ) {
      return { headerRow: row, subheaderRow: next, dataStartIndex: i + 2 };
    }
  }

  throw new Error("Unsupported XLSX schema: no supported 5% ownership table header was found.");
}

function classifySheetTextHeader(value) {
  const text = norm(value);
  if (text === "NO") {
    return "no";
  }
  if (text === "KODE EFEK") {
    return "ticker";
  }
  if (text === "NAMA EMITEN") {
    return "emiten";
  }
  if (text === "NAMA PEMEGANG REKENING EFEK") {
    return "sekuritas";
  }
  if (text === "NAMA PEMEGANG SAHAM") {
    return "owner";
  }
  if (text === "NAMA REKENING EFEK") {
    return "rekening";
  }
  if (text === "KEBANGSAAN") {
    return "country";
  }
  if (text === "DOMISILI") {
    return "domicile";
  }
  if (text.includes("STATUS (LOKAL/ASING)")) {
    return "status";
  }
  if (text === "PERUBAHAN") {
    return "change";
  }
  return "";
}

function classifySheetNumericSubheader(value) {
  const text = norm(value);
  if (text.includes("JUMLAH SAHAM")) {
    return "shares";
  }
  if (text.includes("SAHAM GABUNGAN")) {
    return "total";
  }
  if (text.includes("PERSENTASE KEPEMILIKAN")) {
    return "pct";
  }
  if (text.includes("STATUS KEPEMILIKAN")) {
    return "ownership_status";
  }
  if (text.includes("BLOCKING REASON")) {
    return "blocking_reason";
  }
  return "";
}

function buildSheetSchema(headerRow, subheaderRow) {
  const maxCol = maxSheetColumn([headerRow, subheaderRow]);
  const columns = {};
  const ownershipSections = [];

  for (let col = 0; col <= maxCol; col += 1) {
    const headerText = sheetValue(headerRow, col);
    const subheaderText = sheetValue(subheaderRow, col);
    const textField = classifySheetTextHeader(headerText);

    if (textField && !columns[textField]) {
      columns[textField] = col;
    }

    if (norm(headerText).includes("KEPEMILIKAN PER")) {
      const last = ownershipSections[ownershipSections.length - 1];
      if (!last || last.label !== headerText) {
        ownershipSections.push({ label: headerText, cols: [] });
      }
      ownershipSections[ownershipSections.length - 1].cols.push({ col, subheaderText });
    }
  }

  if (ownershipSections.length < 2) {
    throw new Error("Unsupported XLSX schema: ownership date sections were not recognized.");
  }

  const previous = ownershipSections[0];
  const current = ownershipSections[1];

  for (const section of [
    { period: "prev", section: previous },
    { period: "curr", section: current },
  ]) {
    for (const entry of section.section.cols) {
      const numericField = classifySheetNumericSubheader(entry.subheaderText);
      if (!numericField) {
        continue;
      }
      if (numericField === "shares") {
        columns[`shares_${section.period}`] = entry.col;
      } else if (numericField === "total") {
        columns[`shares_total_${section.period}`] = entry.col;
      } else if (numericField === "pct") {
        columns[`pct_${section.period}`] = entry.col;
      } else {
        columns[`${numericField}_${section.period}`] = entry.col;
      }
    }
  }

  const required = [
    "ticker",
    "owner",
    "rekening",
    "shares_prev",
    "shares_total_prev",
    "pct_prev",
    "shares_curr",
    "shares_total_curr",
    "pct_curr",
    "change",
  ];
  const missing = required.filter((field) => columns[field] === undefined);
  if (missing.length) {
    throw new Error(`Unsupported XLSX schema: missing ${missing.join(", ")}.`);
  }

  return {
    columns,
    displayRekeningAsSekuritas: columns.sekuritas === undefined,
    schemaCount: 1,
  };
}

function parseSheetShare(value) {
  const raw = cleanText(value);
  const normalized = normalizeNumber(raw);
  if (!normalized || normalized === "-") {
    return null;
  }

  if (/^[+-]?\d+\.\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    if (!Number.isInteger(numeric) && Math.abs(numeric) < 1000) {
      return Math.round(numeric * 1000);
    }
    return Math.round(numeric);
  }

  return looksLikeNumericInt(raw) ? parseShareInt(raw) : null;
}

function parseSheetPct(value) {
  const raw = cleanText(value);
  return looksLikeNumericPct(raw) ? parsePct(raw) : null;
}

function rowsFromSheetRows(sheetRows, state) {
  const out = [];
  const { headerRow, subheaderRow, dataStartIndex } = findSheetHeaderRows(sheetRows);
  const schema = buildSheetSchema(headerRow, subheaderRow);
  state.schemaCount += schema.schemaCount;

  for (let i = dataStartIndex; i < sheetRows.length; i += 1) {
    const row = sheetRows[i];
    if (!row || !row.cells) {
      continue;
    }

    const rawTicker = norm(sheetValue(row, schema.columns.ticker));
    let ticker = "";
    if (looksLikeTicker(rawTicker)) {
      ticker = rawTicker;
      state.lastTicker = ticker;
    } else if (!rawTicker && state.lastTicker) {
      ticker = state.lastTicker;
    } else {
      continue;
    }

    let ownerRaw = sheetValue(row, schema.columns.owner);
    if (!ownerRaw) {
      ownerRaw = state.lastOwnerByTicker.get(ticker) || "";
    }
    if (!ownerRaw) {
      continue;
    }
    state.lastOwnerByTicker.set(ticker, ownerRaw);

    let countryRaw = sheetValue(row, schema.columns.country);
    const countryKey = `${ticker}\u0000${canonicalOwnerName(ownerRaw)}`;
    if (countryRaw) {
      state.lastCountryByOwner.set(countryKey, countryRaw);
    } else {
      countryRaw = state.lastCountryByOwner.get(countryKey) || "";
    }

    const sekuritasRaw = sheetValue(
      row,
      schema.displayRekeningAsSekuritas ? schema.columns.rekening : schema.columns.sekuritas,
    );

    const sharesOwnedRaw = sheetValue(row, schema.columns.shares_curr);
    let sharesOwned = parseSheetShare(sharesOwnedRaw);
    const sharesPrevRaw = sheetValue(row, schema.columns.shares_prev);
    let sharesPrev = parseSheetShare(sharesPrevRaw);

    if (sharesOwned === null && sharesPrev !== null && (sharesOwnedRaw === "" || sharesOwnedRaw === "-")) {
      sharesOwned = 0;
    }
    if (sharesPrev === null && sharesOwned !== null && sharesPrevRaw === "-") {
      sharesPrev = 0;
    }

    let sharesChange = parseSheetShare(sheetValue(row, schema.columns.change));
    const computedSharesChange =
      sharesPrev !== null && sharesOwned !== null ? sharesOwned - sharesPrev : null;
    if (computedSharesChange !== null && sharesChange === null) {
      sharesChange = computedSharesChange;
    }

    const pctOwned = sanePctOwned(parseSheetPct(sheetValue(row, schema.columns.pct_curr)));
    const pctPrev = sanePctOwned(parseSheetPct(sheetValue(row, schema.columns.pct_prev)));
    const pctChange =
      pctOwned !== null && pctPrev !== null ? sanePctChange(pctOwned - pctPrev) : null;

    const hasSignal = [sharesOwned, sharesPrev, sharesChange, pctOwned, pctPrev, pctChange].some(
      (v) => v !== null && v !== undefined,
    );
    if (!hasSignal || sharesOwned === null) {
      continue;
    }

    storeGroupHint(state, ticker, ownerRaw, pctOwned, pctChange, sharesChange);

    out.push({
      ticker,
      owner_raw: ownerRaw,
      sekuritas_raw: sekuritasRaw,
      country_raw: countryRaw,
      shares_owned: sharesOwned,
      shares_change: sharesChange,
      pct_owned: pctOwned,
      pct_change: pctChange,
    });
  }

  return out;
}

function normalizeOwnerKey(ownerRaw) {
  const display = firstLine(ownerRaw) || cleanText(ownerRaw);

  const tokens = ownerEntityTokens(display);
  let key = tokens.length ? tokens.join(" ") : canonicalOwnerName(display);
  key = key.replace(/\s+/g, " ").trim();

  return [display, key];
}

function ownerDisplayScore(name) {
  const n = norm(name);
  if (!n) {
    return -1;
  }

  let score = 0;
  if (/^PT\b/.test(n)) {
    score += 4;
  }
  if (/\bTBK\b/.test(n)) {
    score += 2;
  }
  if (!looksAccountLikeOwner(n)) {
    score += 2;
  }
  if (!/\bQQ\b/.test(n)) {
    score += 1;
  }
  return score;
}

function preferOwnerDisplay(existingName, candidateName) {
  const existing = cleanText(existingName);
  const candidate = cleanText(candidateName);

  if (!candidate) {
    return existing;
  }
  if (!existing) {
    return candidate;
  }

  const existingScore = ownerDisplayScore(existing);
  const candidateScore = ownerDisplayScore(candidate);
  if (candidateScore > existingScore) {
    return candidate;
  }
  if (candidateScore === existingScore && candidate.length > existing.length) {
    return candidate;
  }
  return existing;
}

function hasChange(entry) {
  if (entry.shares_change !== null && entry.shares_change !== 0) {
    return true;
  }
  if (entry.pct_change !== null && Math.abs(entry.pct_change) > 1e-12) {
    return true;
  }
  return false;
}

function pickGroupPct(values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  if (!present.length) {
    return null;
  }

  const buckets = new Map();
  for (const value of present) {
    const rounded = Math.round(value * 10000) / 10000;
    if (!buckets.has(rounded)) {
      buckets.set(rounded, []);
    }
    buckets.get(rounded).push(value);
  }

  let best = [];
  for (const vals of buckets.values()) {
    if (vals.length > best.length) {
      best = vals;
    }
  }

  return best.length ? best.reduce((a, b) => a + b, 0) / best.length : null;
}


function computeChangedRowsSummary(rows, groupHints = new Map()) {
  const grouped = new Map();

  for (const row of rows) {
    const [, ownerKey] = normalizeOwnerKey(row.owner_raw);
    const key = `${row.ticker}\u0000${ownerKey}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  let changed = 0;
  for (const [, entries] of grouped) {
    const shareChangedRows = entries.filter(
      (entry) => entry.shares_change !== null && entry.shares_change !== undefined && entry.shares_change !== 0,
    ).length;

    let pctOnlyRows = entries.filter(
      (entry) =>
        (entry.shares_change === null || entry.shares_change === 0) &&
        entry.pct_change !== null &&
        entry.pct_change !== undefined &&
        Math.abs(entry.pct_change) > 1e-12,
    ).length;

    // Some PDFs split a single owner-level percentage change into a separate
    // per-sekuritas row while multiple share-change rows already exist.
    // In that pattern, counting every pct-only row overstates changed rows.
    if (shareChangedRows >= 2 && pctOnlyRows > 0) {
      pctOnlyRows -= 1;
    }

    changed += shareChangedRows + Math.max(0, pctOnlyRows);
  }

  return changed;
}

function buildPayload(rows, groupHints = new Map()) {
  const grouped = new Map();
  const ownerDisplay = new Map();
  const ownerCountry = new Map();

  for (const row of rows) {
    const [display, ownerKey] = normalizeOwnerKey(row.owner_raw);
    const mapKey = `${row.ticker}\u0000${ownerKey}`;

    if (!grouped.has(row.ticker)) {
      grouped.set(row.ticker, new Map());
    }
    if (!grouped.get(row.ticker).has(ownerKey)) {
      grouped.get(row.ticker).set(ownerKey, []);
    }
    grouped.get(row.ticker).get(ownerKey).push(row);

    ownerDisplay.set(mapKey, preferOwnerDisplay(ownerDisplay.get(mapKey) || "", display));
    const country = row.country_raw ? firstLine(row.country_raw) : "";
    if (country && !ownerCountry.has(mapKey)) {
      ownerCountry.set(mapKey, country);
    }
  }

  const changedGroups = new Set();
  const tickersForCheck = [...grouped.keys()];
  for (const ticker of tickersForCheck) {
    for (const ownerKey of grouped.get(ticker).keys()) {
      const key = `${ticker}\u0000${ownerKey}`;
      const entries = grouped.get(ticker).get(ownerKey) || [];
      const hint = groupHints.get(key) || null;
      const hintChanged =
        Boolean(hint) &&
        ((hint.shares_change !== null && hint.shares_change !== undefined && hint.shares_change !== 0) ||
          (hint.pct_change !== null && hint.pct_change !== undefined && Math.abs(hint.pct_change) > 1e-12));

      if (entries.some((entry) => hasChange(entry)) || hintChanged) {
        changedGroups.add(key);
      }
    }
  }

  const result = [];
  const tickers = [...grouped.keys()].sort();
  for (const ticker of tickers) {
    const owners = [...grouped.get(ticker).keys()].sort();
    for (const ownerKey of owners) {
      const key = `${ticker}\u0000${ownerKey}`;
      if (!changedGroups.has(key)) {
        continue;
      }

      const entries = grouped.get(ticker).get(ownerKey);
      const hint = groupHints.get(key) || null;
      const items = entries.map((entry) => ({
        sekuritas: firstLine(entry.sekuritas_raw) || cleanText(entry.sekuritas_raw) || "-",
        shares_owned: entry.shares_owned,
        shares_change: entry.shares_change,
        pct_owned:
          entries.length === 1 && (entry.pct_owned === null || entry.pct_owned === undefined) && hint
            ? hint.pct_owned ?? null
            : entry.pct_owned,
        pct_change:
          entries.length === 1 && (entry.pct_change === null || entry.pct_change === undefined) && hint
            ? hint.pct_change ?? null
            : entry.pct_change,
      }));

      let total = null;
      if (entries.length > 1) {
        const changes = entries.map((e) => e.shares_change).filter((v) => v !== null && v !== undefined);
        total = {
          shares_owned: entries.reduce((sum, e) => sum + e.shares_owned, 0),
          shares_change: changes.length ? changes.reduce((a, b) => a + b, 0) : null,
          pct_owned: pickGroupPct([...entries.map((e) => e.pct_owned), hint ? hint.pct_owned : null]),
          pct_change: pickGroupPct([...entries.map((e) => e.pct_change), hint ? hint.pct_change : null]),
        };
      }

      result.push({
        ticker,
        owner: ownerDisplay.get(key) || "",
        country: ownerCountry.get(key) || "",
        entries: items,
        total,
      });
    }
  }

  const summary = {
    groups: result.length,
    rows: result.reduce((sum, g) => sum + g.entries.length, 0),
    tickers: new Set(result.map((g) => g.ticker)).size,
    changed_rows: computeChangedRowsSummary(rows, groupHints),
    total_rows: rows.length,
  };

  return { summary, groups: result };
}

function createParserState() {
  return {
    lastTicker: "",
    lastOwnerByTicker: new Map(),
    lastCountryByOwner: new Map(),
    groupHints: new Map(),
    schemaCount: 0,
  };
}

async function extractHoldingsFromPdf(pdf) {
  const rows = [];
  const state = createParserState();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent({ disableCombineTextItems: false });
    const lines = buildLinesFromTextContent(textContent);
    rows.push(...rowsFromLines(lines, state));
    page.cleanup();
  }

  if (state.schemaCount === 0) {
    throw new Error("No supported 5% ownership table header was found.");
  }

  return {
    rows,
    groupHints: state.groupHints,
    schemaCount: state.schemaCount,
  };
}

function extractHoldingsFromSheetRows(sheetRows) {
  const state = createParserState();
  const rows = rowsFromSheetRows(sheetRows, state);

  if (state.schemaCount === 0) {
    throw new Error("No supported 5% ownership table header was found.");
  }

  return {
    rows,
    groupHints: state.groupHints,
    schemaCount: state.schemaCount,
  };
}

return Object.freeze({
  buildLinesFromTextContent,
  buildPayload,
  createParserState,
  discoverHeaderSchemas,
  extractHoldingsFromPdf,
  extractHoldingsFromSheetRows,
  rowsFromLines,
  rowsFromSheetRows,
});
});
