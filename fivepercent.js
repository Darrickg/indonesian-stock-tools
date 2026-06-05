#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const parser = require("./fivepercent-parser.js");

async function extractPayload(pdfPath) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(fs.readFileSync(pdfPath)),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  try {
    const parsed = await parser.extractHoldingsFromPdf(pdf);
    if (!parsed.rows.length) {
      throw new Error("No ownership rows were extracted from this document.");
    }
    return {
      ...parsed,
      payload: parser.buildPayload(parsed.rows, parsed.groupHints),
    };
  } finally {
    await loadingTask.destroy();
  }
}

function formatInt(value) {
  return value === null || value === undefined ? "-" : value.toLocaleString("en-US");
}

function formatSignedInt(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
}

function formatPct(value) {
  return value === null || value === undefined ? "-" : `${value.toFixed(2)}%`;
}

function formatPctChange(value, sharesChange = null) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (Math.abs(value) <= 1e-12) {
    if (sharesChange !== null && sharesChange !== 0) {
      return sharesChange > 0 ? "+<0.01%" : "-<0.01%";
    }
    return "No Change";
  }
  if (Math.abs(value) < 0.005) {
    return value > 0 ? "+<0.01%" : "-<0.01%";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function printPayload(payload) {
  for (const group of payload.groups) {
    process.stdout.write(`Ticker:              ${group.ticker}\n`);
    process.stdout.write(`Owner:               ${group.owner}\n`);
    if (group.country) {
      process.stdout.write(`Country:             ${group.country}\n`);
    }
    process.stdout.write("\n");

    for (const entry of group.entries) {
      const showEntryPct = group.entries.length === 1;
      process.stdout.write(`  Sekuritas:         ${entry.sekuritas}\n`);
      process.stdout.write(`  Shares Owned:      ${formatInt(entry.shares_owned)}\n`);
      process.stdout.write(`  Shares Change:     ${formatSignedInt(entry.shares_change)}\n`);
      process.stdout.write(
        `  Percentage Owned:  ${showEntryPct ? formatPct(entry.pct_owned) : "-"}\n`,
      );
      process.stdout.write(
        `  Percentage Change: ${
          showEntryPct ? formatPctChange(entry.pct_change, entry.shares_change) : "-"
        }\n\n`,
      );
    }

    if (group.total) {
      process.stdout.write("  TOTAL (all sekuritas for this owner)\n");
      process.stdout.write(`  Shares Owned:      ${formatInt(group.total.shares_owned)}\n`);
      process.stdout.write(`  Shares Change:     ${formatSignedInt(group.total.shares_change)}\n`);
      process.stdout.write(`  Percentage Owned:  ${formatPct(group.total.pct_owned)}\n`);
      process.stdout.write(
        `  Percentage Change: ${formatPctChange(
          group.total.pct_change,
          group.total.shares_change,
        )}\n\n`,
      );
    }

    process.stdout.write("------------------------------------------------------------\n");
  }
}

function pickPdfPath(inputPath) {
  if (inputPath) {
    const full = path.resolve(inputPath);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      const files = fs
        .readdirSync(full)
        .filter((name) => name.toLowerCase().endsWith(".pdf"))
        .map((name) => path.join(full, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      return files[0] || null;
    }
    return full;
  }

  const documentsDir = path.join(__dirname, "documents");
  if (!fs.existsSync(documentsDir)) {
    return null;
  }
  const files = fs
    .readdirSync(documentsDir)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => path.join(documentsDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

async function main() {
  const pdfPath = pickPdfPath(process.argv[2]);
  if (!pdfPath || !fs.existsSync(pdfPath) || !fs.statSync(pdfPath).isFile()) {
    console.error("No PDF found. Provide a file path or place a PDF in ./documents.");
    process.exitCode = 2;
    return;
  }

  const { payload } = await extractPayload(pdfPath);
  printPayload(payload);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 2;
  });
}

module.exports = {
  extractPayload,
  printPayload,
};
