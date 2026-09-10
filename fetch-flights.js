const https = require('https');
const fs = require('fs');

const ZONES = [
  [42,   -74, 250],
  [51,   -20, 250],
  [52,     8, 250],
  [35,   140, 250],
  [45.5, -73.7, 200],
];

const MAX_ATTEMPTS   = 5;
const RETRY_DELAY_MS = 1500;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fetchZoneOnce(lat, lon, dist) {
  return new Promise(resolve => {
    let settled = false;
    const settle = v => { if (!settled) { settled = true; resolve(v); } };

    const req = https.get(
      `https://api.adsb.lol/v2/point/${lat}/${lon}/${dist}`,
      { timeout: 12000 },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          if (res.statusCode !== 200) {
            return settle({ ok: false, reason: `HTTP ${res.statusCode}: ${body.slice(0, 200)}` });
          }
          try {
            const parsed = JSON.parse(body);
            if (!Array.isArray(parsed.ac)) {
              return settle({ ok: false, reason: `unexpected response shape: ${body.slice(0, 200)}` });
            }
            settle({ ok: true, ac: parsed.ac });
          } catch (e) {
            settle({ ok: false, reason: `parse error: ${e.message}` });
          }
        });
        res.on('error', e => settle({ ok: false, reason: `response error: ${e.message}` }));
      }
    );
    req.on('error',   e => settle({ ok: false, reason: `request error: ${e.message}` }));
    req.on('timeout', () => { req.destroy(); settle({ ok: false, reason: 'timeout' }); });
  });
}

// Verify a zone's feed up to MAX_ATTEMPTS times (e.g. transient auth/rate-limit
// errors from the upstream API) before giving up on it for this run.
// Returns null (distinct from an empty array) when verification never succeeds,
// so callers can tell "zone had no aircraft" apart from "zone fetch failed".
async function fetchZone(lat, lon, dist) {
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await fetchZoneOnce(lat, lon, dist);
    if (result.ok) return result.ac;
    lastReason = result.reason;
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }
  console.warn(`Zone [${lat}, ${lon}] failed verification after ${MAX_ATTEMPTS} attempts: ${lastReason}`);
  return null;
}

// US ICAO24 range: A00000–AFFFFF
function classify(ac, whitelist) {
  const hex    = (ac.hex || '').toLowerCase();
  const squawk = ac.squawk || '';
  const entry  = whitelist[hex];

  // Emergency squawk — always Level 2
  if (['7500', '7600', '7700'].includes(squawk)) {
    return { threat_level: 2, threat_reason: `Squawk ${squawk}` };
  }

  // FAA PIA — aircraft deliberately obscured its ICAO identity — Level 2
  if (entry?.pia) {
    return { threat_level: 2, threat_reason: 'FAA Privacy ICAO Address (identity obscured)' };
  }

  // FAA LADD — operator requested data suppression — Level 1
  if (entry?.ladd) {
    return { threat_level: 1, threat_reason: 'FAA LADD (data display blocked)' };
  }

  const isUS = hex.length === 6 && hex[0] === 'a';

  if (isUS) {
    if (!entry) {
      return { threat_level: 2, threat_reason: 'ICAO24 not in FAA registry' };
    }
    if (entry.status && entry.status !== 'V') {
      return { threat_level: 1, threat_reason: `Registration ${entry.status}` };
    }
    if (!(ac.flight || '').trim()) {
      return { threat_level: 1, threat_reason: 'No callsign' };
    }
    return { threat_level: 0, threat_reason: '' };
  }

  // Non-US: flag missing callsign as watch only
  if (!(ac.flight || '').trim()) {
    return { threat_level: 1, threat_reason: 'No callsign' };
  }
  return { threat_level: 0, threat_reason: '' };
}

async function main() {
  let whitelist = {};
  try {
    whitelist = JSON.parse(fs.readFileSync('whitelist.json', 'utf8'));
    console.log(`Whitelist loaded: ${Object.keys(whitelist).length} entries`);
  } catch {
    console.warn('whitelist.json not found — threat classification limited');
  }

  const results = await Promise.allSettled(ZONES.map(([la, lo, d]) => fetchZone(la, lo, d)));
  const byHex = {};
  let zonesOk = 0;
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value !== null) {
      zonesOk++;
      r.value.forEach(ac => { if (ac.hex) byHex[ac.hex] = ac; });
    }
  });

  if (zonesOk === 0) {
    console.error(`All ${ZONES.length} zones failed verification — leaving existing flights.json untouched.`);
    return;
  }

  Object.values(byHex).forEach(ac => {
    const { threat_level, threat_reason } = classify(ac, whitelist);
    ac.threat_level  = threat_level;
    ac.threat_reason = threat_reason;
  });

  const result = { timestamp: Date.now(), ac: Object.values(byHex) };
  fs.writeFileSync('flights.json', JSON.stringify(result));
  console.log(`Saved ${result.ac.length} aircraft (${zonesOk}/${ZONES.length} zones verified)`);
}

main();
