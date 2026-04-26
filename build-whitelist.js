// Builds whitelist.json from three sources:
//   1. FAA Releasable Aircraft Registry  — ICAO24 → registration + status
//   2. FCC ULS Aircraft Service          — active radio station licenses
//   3. ADSBexchange basic-ac-db          — operator, military, FAA PIA/LADD flags
// Run by GitHub Actions weekly; output committed to the data branch.
const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const zlib     = require('zlib');
const path     = require('path');
const { execSync } = require('child_process');
const readline     = require('readline');

const FAA_URL   = 'https://registry.faa.gov/database/ReleasableAircraft.zip';
const FCC_URL   = 'https://data.fcc.gov/download/pub/uls/complete/l_aircr.zip';
const ADSBX_URL = 'https://downloads.adsbexchange.com/downloads/basic-ac-db.json.gz';

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

// FAA MASTER.txt: comma-delimited
// Field 0  = N-NUMBER, Field 6 = NAME, Field 20 = STATUS, Field 21 = MODE S CODE (decimal → hex)
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
// Field 4 = call_sign, Field 5 = radio_service_code (AC=aircraft), Field 12 = license_status (A=active)
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

// ADSBexchange basic-ac-db.json.gz
// Keys: ICAO24 hex (lowercase)
// Fields: r=registration, t=type, ownOp=operator, mil=military, pia=FAA PIA, ladd=FAA LADD
async function parseADSBx(gzFile) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    fs.createReadStream(gzFile)
      .pipe(zlib.createGunzip())
      .on('data', chunk => chunks.push(chunk))
      .on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      })
      .on('error', reject);
  });
}

async function main() {
  fs.mkdirSync('_tmp_faa',   { recursive: true });
  fs.mkdirSync('_tmp_fcc',   { recursive: true });
  fs.mkdirSync('_tmp_adsbx', { recursive: true });

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
  } catch (e) {
    console.warn('FCC download failed (non-fatal):', e.message);
    fccOk = false;
  }

  // ── ADSBexchange ──────────────────────────────────────────────────────────
  console.log('Downloading ADSBexchange basic-ac-db.json.gz …');
  let adsbxOk = true;
  let adsbxDb = {};
  try {
    await download(ADSBX_URL, '_tmp_adsbx/basic-ac-db.json.gz');
    console.log('Parsing basic-ac-db …');
    adsbxDb = await parseADSBx('_tmp_adsbx/basic-ac-db.json.gz');
    console.log(`ADSBx: ${Object.keys(adsbxDb).length} entries loaded`);

    // Merge ADSBx fields into existing FAA entries
    let enriched = 0;
    for (const [hex, entry] of Object.entries(whitelist)) {
      const ax = adsbxDb[hex];
      if (ax) {
        entry.operator = ax.ownOp || '';
        entry.mil      = !!ax.mil;
        entry.pia      = !!ax.pia;
        entry.ladd     = !!ax.ladd;
        entry.type     = ax.t   || '';
        enriched++;
      }
    }
    console.log(`ADSBx: enriched ${enriched} FAA entries`);

    // Add non-FAA aircraft that carry notable flags (PIA, LADD, military)
    let added = 0;
    for (const [hex, ax] of Object.entries(adsbxDb)) {
      if (!whitelist[hex] && (ax.pia || ax.ladd || ax.mil)) {
        whitelist[hex] = {
          n:        ax.r     || '',
          owner:    ax.ownOp || '',
          status:   '',
          operator: ax.ownOp || '',
          mil:      !!ax.mil,
          pia:      !!ax.pia,
          ladd:     !!ax.ladd,
          type:     ax.t || ''
        };
        added++;
      }
    }
    console.log(`ADSBx: added ${added} non-FAA flagged entries (PIA/LADD/mil)`);
  } catch (e) {
    console.warn('ADSBx download failed (non-fatal):', e.message);
    adsbxOk = false;
  }

  // ── Write output ──────────────────────────────────────────────────────────
  fs.writeFileSync('whitelist.json', JSON.stringify(whitelist));
  console.log(`whitelist.json written — ${Object.keys(whitelist).length} entries | FAA=ok FCC=${fccOk} ADSBx=${adsbxOk}`);

  // Cleanup
  execSync('rm -rf _tmp_faa _tmp_fcc _tmp_adsbx');
}

main().catch(err => { console.error(err); process.exit(1); });
