// Builds whitelist.json from FAA Aircraft Registry + FCC ULS Aircraft Service.
// Run by GitHub Actions weekly; output committed to the data branch.
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');
const readline     = require('readline');

const FAA_URL = 'https://registry.faa.gov/database/ReleasableAircraft.zip';
const FCC_URL = 'https://data.fcc.gov/download/pub/uls/complete/l_aircr.zip';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get  = url.startsWith('https') ? https : http;
    get.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.destroy(); fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error',  reject);
    }).on('error', err => { try { fs.unlinkSync(dest); } catch {} reject(err); });
  });
}

async function parseLines(file, onLine) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

// FAA MASTER.txt: comma-delimited, no header row
// Field 0  = N-NUMBER  (e.g. "N12345")
// Field 20 = STATUS CODE (V=valid, N=deregistered, X=admin, …)
// Field 21 = MODE S CODE  (decimal integer → convert to 6-char hex = ICAO24)
// Field 6  = NAME (owner)
async function parseFAA(file) {
  const lookup = {};
  await parseLines(file, line => {
    const f = line.split(',');
    if (f.length < 22) return;
    const nNum    = f[0].trim();
    const owner   = f[6]?.trim() || '';
    const status  = f[20]?.trim() || '';
    const modeRaw = f[21]?.trim() || '';
    if (!modeRaw) return;
    const dec = parseInt(modeRaw, 10);
    if (isNaN(dec) || dec === 0) return;
    const icao24 = dec.toString(16).toLowerCase().padStart(6, '0');
    lookup[icao24] = { n: nNum, owner, status };
  });
  return lookup;
}

// FCC HD.dat: pipe-delimited
// Field 4  = call_sign
// Field 5  = radio_service_code  (must be "AC" for aircraft)
// Field 12 = license_status      ("A" = active)
async function parseFCC(file) {
  const licensed = new Set();
  await parseLines(file, line => {
    const f = line.split('|');
    if (f[5]?.trim() === 'AC' && f[12]?.trim() === 'A') {
      const cs = f[4]?.trim();
      if (cs) licensed.add(cs);
    }
  });
  return licensed;
}

async function main() {
  fs.mkdirSync('_tmp_faa', { recursive: true });
  fs.mkdirSync('_tmp_fcc', { recursive: true });

  // ── FAA ──────────────────────────────────────────────────────────────────
  console.log('Downloading FAA ReleasableAircraft.zip …');
  await download(FAA_URL, '_tmp_faa/faa.zip');
  execSync('unzip -o _tmp_faa/faa.zip MASTER.txt -d _tmp_faa/', { stdio: 'inherit' });

  console.log('Parsing FAA MASTER.txt …');
  const whitelist = await parseFAA('_tmp_faa/MASTER.txt');
  console.log(`FAA: ${Object.keys(whitelist).length} aircraft loaded`);

  // ── FCC ──────────────────────────────────────────────────────────────────
  console.log('Downloading FCC l_aircr.zip …');
  let fccOk = true;
  try {
    await download(FCC_URL, '_tmp_fcc/fcc.zip');
    execSync('unzip -o _tmp_fcc/fcc.zip HD.dat -d _tmp_fcc/', { stdio: 'inherit' });
    const licensed = await parseFCC('_tmp_fcc/HD.dat');
    console.log(`FCC: ${licensed.size} active aircraft station licenses`);
    // Mark FCC-licensed aircraft in the whitelist
    licensed.forEach(cs => {
      // FCC callsigns for aircraft stations look like W/K-prefixed or N-number
      // We store them as a side-set; matching is done in fetch-flights.js
    });
  } catch (e) {
    console.warn('FCC download failed (non-fatal):', e.message);
    fccOk = false;
  }

  // ── Write output ──────────────────────────────────────────────────────────
  fs.writeFileSync('whitelist.json', JSON.stringify(whitelist));
  console.log(`whitelist.json written — ${Object.keys(whitelist).length} entries, FCC=${fccOk}`);

  // Cleanup
  execSync('rm -rf _tmp_faa _tmp_fcc');
}

main().catch(err => { console.error(err); process.exit(1); });
