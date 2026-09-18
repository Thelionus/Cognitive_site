const https = require('https');
const fs = require('fs');

// Publicly documented military installations only — OpenStreetMap's own
// `military=*` tagging convention, which only ever reflects what's already
// public knowledge (contributors tag what's visible/documented, not
// anything classified). Same greater-Montréal bounding box as the other
// live layers. Overpass is a free, public, keyless API over OSM data.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MTL_BBOX = { minLat: 45.2, maxLat: 45.75, minLon: -74.1, maxLon: -73.2 };
const BBOX_STR = `${MTL_BBOX.minLat},${MTL_BBOX.minLon},${MTL_BBOX.maxLat},${MTL_BBOX.maxLon}`;

const QUERY = `[out:json][timeout:25];
(
  node["military"](${BBOX_STR});
  way["military"](${BBOX_STR});
  relation["military"](${BBOX_STR});
);
out center tags;`;

function postOverpass(query) {
  return new Promise((resolve, reject) => {
    const body = 'data=' + encodeURIComponent(query);
    const req = https.request(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'CognitiveGroupTacticalDemo/1.0 (+https://www.cognitivegroup.com; contact: info@cognitivegroup.com)'
      },
      timeout: 30000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error(`parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function pick(tags, candidates) {
  for (const c of candidates) {
    if (tags[c] != null && tags[c] !== '') return tags[c];
  }
  return null;
}

async function main() {
  const data = await postOverpass(QUERY);
  const elements = data.elements || [];

  const sites = elements.map(el => {
    const tags = el.tags || {};
    const lat = el.type === 'node' ? el.lat : (el.center && el.center.lat);
    const lon = el.type === 'node' ? el.lon : (el.center && el.center.lon);
    if (lat == null || lon == null) return null;
    const name = pick(tags, ['name', 'name:en', 'name:fr', 'official_name']) || 'Unnamed military site';
    const kind = tags.military || null;
    const operator = pick(tags, ['operator', 'operator:en', 'operator:fr']);
    return { id: `${el.type}/${el.id}`, name, kind, operator, lat, lon };
  }).filter(Boolean);

  if (!sites.length) {
    console.error(`No military sites parsed from ${elements.length} elements — leaving existing military.json untouched (query or area may have changed).`);
    if (elements[0]) console.error('First element for schema debugging:', JSON.stringify(elements[0]));
    return;
  }

  fs.writeFileSync('military.json', JSON.stringify({ timestamp: Date.now(), source: 'OpenStreetMap via Overpass API (military=* tag, public data only)', sites }));
  console.log(`Saved ${sites.length} publicly-tagged military sites (of ${elements.length} elements seen)`);
}

main().catch(e => {
  console.error('fetch-military failed:', e.message);
});
