const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { extractPayload } = require("../fivepercent.js");

const documentsDir = path.join(__dirname, "..", "documents");

const expected = {
  "fivepercenttest.pdf": {
    schemaCount: 32,
    summary: {
      groups: 43,
      rows: 101,
      tickers: 39,
      changed_rows: 54,
      total_rows: 3052,
    },
    verify(payload) {
      const arci = findGroup(payload, "ARCI", "PT. RAJAWALI CORPORA");
      assert.strictEqual(arci.entries.length, 5);
      assert.deepStrictEqual(arci.total, {
        shares_owned: 18142375000,
        shares_change: 0,
        pct_owned: 71.89,
        pct_change: 0,
      });
    },
  },
  "fivepercenttestfixes.pdf": {
    schemaCount: 19,
    summary: {
      groups: 54,
      rows: 133,
      tickers: 47,
      changed_rows: 75,
      total_rows: 3043,
    },
    verify(payload) {
      const asli = findGroup(payload, "ASLI", "PT WAHANA KONSTRUKSI MANDIRI");
      assert.strictEqual(asli.entries[0].shares_change, 3920000000);
      assert.strictEqual(asli.entries[1].shares_change, -3920000000);
      assert.strictEqual(asli.total.shares_change, 0);

      const bapi = findGroup(payload, "BAPI", "HIMAWAN SUTANTO");
      assert.strictEqual(bapi.entries[0].shares_owned, 2);
      assert.strictEqual(bapi.total.shares_owned, 588767002);
    },
  },
  "fivepercenttestfixesagain.pdf": {
    schemaCount: 36,
    summary: {
      groups: 47,
      rows: 122,
      tickers: 42,
      changed_rows: 70,
      total_rows: 3039,
    },
    verify(payload) {
      const abda = findGroup(payload, "ABDA", "OONA INDONESIA PTE LTD");
      assert.strictEqual(abda.entries[0].shares_change, 2800);
      assert.strictEqual(abda.entries[0].pct_owned, 86.75);

      const bcip = findGroup(payload, "BCIP", "PT BUMI CITRA INVESTINDO");
      assert.strictEqual(bcip.total.shares_owned, 539267200);
      assert.strictEqual(bcip.total.shares_change, -2930000);
    },
  },
  "fivepercenttestfixesagainagain.pdf": {
    schemaCount: 21,
    summary: {
      groups: 42,
      rows: 108,
      tickers: 37,
      changed_rows: 61,
      total_rows: 3153,
    },
    verify(payload) {
      const amar = findGroup(payload, "AMAR", "TOLARAM PTE. LTD.");
      assert.strictEqual(amar.entries.length, 2);
      assert.strictEqual(amar.total.shares_owned, 13832054873);
      assert.strictEqual(amar.total.shares_change, 10579066007);
      assert.strictEqual(amar.total.pct_owned, 75.25);

      const brms = findGroup(
        payload,
        "BRMS",
        "EMIRATES TARIAN GLOBAL VENTURES SPC",
      );
      assert.strictEqual(brms.entries.length, 4);
      assert.strictEqual(brms.total.shares_change, 1300000000);
      assert(!payload.groups.some((group) => group.owner === "SCB SG PVB"));
    },
  },
  "peng-06-17-00012-lima-persen.xlsx": {
    schemaCount: 1,
    summary: {
      groups: 44,
      rows: 106,
      tickers: 34,
      changed_rows: 91,
      total_rows: 3057,
    },
    verify(payload) {
      const bapi = findGroup(payload, "BAPI", "HIMAWAN SUTANTO");
      assert.strictEqual(bapi.entries.length, 2);
      assert.strictEqual(bapi.entries[0].shares_owned, 2);
      assert.strictEqual(bapi.total.shares_owned, 318808102);
      assert.strictEqual(bapi.total.shares_change, -6336300);

      const enrg = findGroup(payload, "ENRG", "PT MAYBANK SEKURITAS INDONESIA - REGISTRAR");
      assert.strictEqual(enrg.total.shares_change, -42900);
    },
  },
  "peng-06-18-00013-lima-persen.xlsx": {
    schemaCount: 1,
    summary: {
      groups: 63,
      rows: 157,
      tickers: 54,
      changed_rows: 124,
      total_rows: 3059,
    },
    verify(payload) {
      const ahap = findGroup(payload, "AHAP", "SENDRA GUNAWAN");
      assert.strictEqual(ahap.entries[0].shares_change, 12000000);

      const ceka = findGroup(payload, "CEKA", "SENTRATAMA NIAGA INDONESIA, PT");
      assert.strictEqual(ceka.entries[0].shares_owned, 17600);
      assert.strictEqual(ceka.total.shares_owned, 511771100);
      assert.strictEqual(ceka.total.shares_change, 0);
    },
  },
  "peng-06-19-00014-lima-persen.xlsx": {
    schemaCount: 1,
    summary: {
      groups: 49,
      rows: 148,
      tickers: 42,
      changed_rows: 100,
      total_rows: 3061,
    },
    verify(payload) {
      const abda = findGroup(payload, "ABDA", "OONA INDONESIA PTE LTD");
      assert.strictEqual(abda.entries[0].shares_change, 400);
      assert.strictEqual(abda.entries[0].pct_owned, 86.75);

      const ceka = findGroup(payload, "CEKA", "SENTRATAMA NIAGA INDONESIA, PT");
      assert.strictEqual(ceka.entries[0].shares_change, -17600);
      assert.strictEqual(ceka.total.shares_change, -17600);
    },
  },
  "peng-06-22-00015-lima-persen.xlsx": {
    schemaCount: 1,
    summary: {
      groups: 41,
      rows: 101,
      tickers: 38,
      changed_rows: 79,
      total_rows: 3060,
    },
    verify(payload) {
      const aisa = findGroup(payload, "AISA", "PT PANGAN SEJAHTERA INVESTAMA");
      assert.strictEqual(aisa.entries[0].shares_change, 73300);

      const enrg = findGroup(payload, "ENRG", "PT MAYBANK SEKURITAS INDONESIA - REGISTRAR");
      assert.strictEqual(enrg.total.shares_owned, 1918260900);
      assert.strictEqual(enrg.total.shares_change, -42);
    },
  },
  "peng-06-23-00016-lima-persen.xlsx": {
    schemaCount: 1,
    summary: {
      groups: 59,
      rows: 186,
      tickers: 48,
      changed_rows: 111,
      total_rows: 3166,
    },
    verify(payload) {
      const arci = findGroup(payload, "ARCI", "PT RAJAWALI KAPITAL EMAS");
      assert.strictEqual(arci.entries.length, 5);
      assert.strictEqual(arci.total.shares_owned, 21109750000);
      assert.strictEqual(arci.total.shares_change, 16605550000);
      assert.strictEqual(arci.total.pct_owned, 83.64999999999999);

      const aisa = findGroup(payload, "AISA", "PT PANGAN SEJAHTERA INVESTAMA");
      assert.strictEqual(aisa.entries[0].shares_change, 1151300);
    },
  },
};

function findGroup(payload, ticker, owner) {
  const group = payload.groups.find(
    (candidate) => candidate.ticker === ticker && candidate.owner === owner,
  );
  assert(group, `Missing group ${ticker} / ${owner}`);
  return group;
}

function validatePayload(name, payload) {
  assert(payload.groups.length > 0, `${name}: no changed groups`);
  assert(payload.summary.total_rows > 0, `${name}: no extracted rows`);

  for (const group of payload.groups) {
    assert(/^[A-Z]{4}$/.test(group.ticker), `${name}: invalid ticker ${group.ticker}`);
    assert(group.owner, `${name}: blank owner for ${group.ticker}`);
    for (const entry of group.entries) {
      assert(entry.sekuritas, `${name}: blank account for ${group.ticker}`);
      assert(Number.isFinite(entry.shares_owned), `${name}: invalid shares owned`);
      assert(Number.isInteger(entry.shares_owned), `${name}: non-integer shares owned`);
      assert(entry.shares_owned >= 0, `${name}: negative shares owned`);
      assert(
        entry.shares_change === null || Number.isFinite(entry.shares_change),
        `${name}: invalid shares change`,
      );
      assert(
        entry.shares_change === null || Number.isInteger(entry.shares_change),
        `${name}: non-integer shares change`,
      );
      assert(
        entry.pct_owned === null ||
          (Number.isFinite(entry.pct_owned) &&
            entry.pct_owned >= 0 &&
            entry.pct_owned <= 100),
        `${name}: invalid ownership percentage`,
      );
    }
  }
}

async function main() {
  assert(fs.existsSync(documentsDir), "documents directory is missing");
  const files = fs
    .readdirSync(documentsDir)
    .filter((name) => /\.(pdf|xlsx)$/i.test(name))
    .sort();
  assert(files.length > 0, "No PDF or XLSX regression fixtures found in documents");

  for (const name of files) {
    const result = await extractPayload(path.join(documentsDir, name));
    validatePayload(name, result.payload);

    const fixture = expected[name];
    if (fixture) {
      assert.strictEqual(result.schemaCount, fixture.schemaCount, `${name}: schema count`);
      assert.deepStrictEqual(result.payload.summary, fixture.summary, `${name}: summary`);
      fixture.verify(result.payload);
    }

    process.stdout.write(
      `PASS ${name}: ${result.payload.summary.groups} groups, ` +
        `${result.payload.summary.total_rows} rows\n`,
    );
  }

  for (const name of Object.keys(expected)) {
    assert(files.includes(name), `Missing expected regression fixture ${name}`);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
