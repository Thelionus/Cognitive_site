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

async function main() {
  const all = await Promise.all(ZONES.map(([la, lo, d]) => fetchZone(la, lo, d)));
  const byHex = {};
  all.flat().forEach(ac => { if (ac.hex) byHex[ac.hex] = ac; });
  const result = { timestamp: Date.now(), ac: Object.values(byHex) };
  fs.writeFileSync('flights.json', JSON.stringify(result));
  console.log(`Saved ${result.ac.length} aircraft`);
}

main();
