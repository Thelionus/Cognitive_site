const https = require('https');
const fs = require('fs');

const ZONES = [
  [42,   -74, 250],
  [51,   -20, 250],
  [52,     8, 250],
  [35,   140, 250],
  [45.5, -73.7, 200],
];

function fetchZone(lat, lon, dist) {
  return new Promise(resolve => {
    const url = `https://api.adsb.lol/v2/point/${lat}/${lon}/${dist}`;
    const req = https.get(url, { timeout: 10000 }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw).ac || []); } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// US ICAO24 range: A00000–AFFFFF
function classify(ac, whitelist) {
  const hex    = (ac.hex || '').toLowerCase();
  const squawk = ac.squawk || '';

  if (['7500', '7600', '7700'].includes(squawk)) {
    return { threat_level: 2, threat_reason: `Squawk ${squawk}` };
  }

  const isUS = hex.length === 6 && hex[0] === 'a';

  if (isUS) {
    const entry = whitelist[hex];
    if (!entry) {
      return { threat_level: 2, threat_reason: 'ICAO24 not in FAA registry' };
    }
    if (entry.status !== 'V') {
      return { threat_level: 1, threat_reason: `Registration ${entry.status || 'unknown'}` };
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

  const all = await Promise.all(ZONES.map(([la, lo, d]) => fetchZone(la, lo, d)));
  const byHex = {};
  all.flat().forEach(ac => { if (ac.hex) byHex[ac.hex] = ac; });

  Object.values(byHex).forEach(ac => {
    const { threat_level, threat_reason } = classify(ac, whitelist);
    ac.threat_level  = threat_level;
    ac.threat_reason = threat_reason;
  });

  const result = { timestamp: Date.now(), ac: Object.values(byHex) };
  fs.writeFileSync('flights.json', JSON.stringify(result));
  console.log(`Saved ${result.ac.length} aircraft`);
}

main();
