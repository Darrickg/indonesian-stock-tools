let parserReady = false;
let pdfReady = false;
let xlsxReady = false;

function postProgress(jobId, titleKey, detailKey) {
  self.postMessage({ type: "progress", jobId, titleKey, detailKey });
}

function ensureSharedParser() {
  if (!self.FivePercentParser) {
    importScripts("./fivepercent-parser.js?v=jsparser-12");
  }
  if (!self.FivePercentParser) {
    throw new Error("Could not load the 5% ownership parser.");
  }
  parserReady = true;
}

function ensureXlsxParser() {
  if (!self.FivePercentXlsx) {
    importScripts("./fivepercent-xlsx.js?v=jsparser-12");
  }
  if (!self.FivePercentXlsx || typeof self.FivePercentXlsx.readWorkbook !== "function") {
    throw new Error("Could not load the XLSX parser.");
  }
  xlsxReady = true;
}

function ensurePdfRuntime(jobId) {
  if (pdfReady) {
    return;
  }
  postProgress(jobId, "progress_loading_runtime_title", "progress_loading_runtime_detail");

  if (typeof self.window === "undefined") {
    self.window = self;
  }

  if (!self.pdfjsLib) {
    importScripts("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js");
  }

  if (!self.pdfjsLib || typeof self.pdfjsLib.getDocument !== "function") {
    throw new Error("Could not load PDF.js runtime in browser worker.");
  }

  if (!self.pdfjsWorker) {
    importScripts("./pdf.worker.min.js");
  }

  if (self.pdfjsLib.GlobalWorkerOptions) {
    self.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "./pdf.worker.min.js",
      self.location.href,
    ).toString();
  }

  postProgress(jobId, "progress_loading_parser_title", "progress_loading_parser_detail");
  pdfReady = true;
}

async function ensureRuntime(jobId, fileKind) {
  ensureSharedParser();

  if (fileKind === "xlsx") {
    if (!xlsxReady) {
      postProgress(jobId, "progress_loading_parser_title", "progress_loading_parser_detail");
      ensureXlsxParser();
    }
    return;
  }

  ensurePdfRuntime(jobId);
}

async function parsePdfBuffer(jobId, buffer) {
  postProgress(jobId, "progress_parsing_pdf_title", "progress_parsing_pdf_detail");

  const loadingTask = self.pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  try {
    const { rows, groupHints } =
      await self.FivePercentParser.extractHoldingsFromPdf(pdf);
    if (!rows.length) {
      throw new Error("No ownership rows were extracted from this document.");
    }
    return self.FivePercentParser.buildPayload(rows, groupHints);
  } finally {
    await loadingTask.destroy();
  }
}

async function parseXlsxBuffer(jobId, buffer) {
  postProgress(jobId, "progress_parsing_xlsx_title", "progress_parsing_xlsx_detail");

  const workbook = await self.FivePercentXlsx.readWorkbook(buffer);
  const { rows, groupHints } =
    self.FivePercentParser.extractHoldingsFromSheetRows(workbook.rows);
  if (!rows.length) {
    throw new Error("No ownership rows were extracted from this spreadsheet.");
  }
  return self.FivePercentParser.buildPayload(rows, groupHints);
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type !== "parse") {
    return;
  }

  const jobId = msg.jobId ?? 0;
  const fileKind = msg.fileKind === "xlsx" ? "xlsx" : "pdf";
  try {
    await ensureRuntime(jobId, fileKind);
    const payload =
      fileKind === "xlsx"
        ? await parseXlsxBuffer(jobId, msg.buffer)
        : await parsePdfBuffer(jobId, msg.buffer);
    self.postMessage({ type: "result", jobId, payload });
  } catch (err) {
    self.postMessage({
      type: "error",
      jobId,
      error: err && err.message ? err.message : String(err),
    });
  }
};
