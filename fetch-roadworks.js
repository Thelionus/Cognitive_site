const https = require('https');
const fs = require('fs');

// Québec transport ministry's (MTMD) live roadwork/closures WFS catalogue —
// same infrastructure (ws.mapserver.transports.gouv.qc.ca) already confirmed
// reachable for the traffic-camera feed. Province-wide; filtered to the same
// greater-Montréal bounding box used there to match what the UI advertises.
const ROADWORKS_URL = 'https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:chantiers_mtmdet&outfile=TravauxRoutiers&srsname=EPSG:4326&outputformat=geojson';
const MTL_BBOX = { minLat: 45.2, maxLat: 45.75, minLon: -74.1, maxLon: -73.2 };

// Same redirect-following fetch as fetch-cameras.js — this government
// infrastructure has already changed URLs on us once for the camera feed,
// so treating a redirect as a failure would just repeat that surprise.
function fetchJson(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: 20000,
        headers: {
          'User-Agent': 'CognitiveGroupTacticalDemo/1.0 (+https://www.cognitivegroup.com; contact: info@cognitivegroup.com)'
        }
      },
      res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
          const next = new URL(res.headers.location, url).toString();
          return resolve(fetchJson(next, redirectsLeft - 1));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(new Error(`parse error: ${e.message}`)); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// This dataset's exact field names aren't confirmed from this environment
// (same reachability limits as the camera feed), so — same approach that
// got that feed's real schema diagnosed in one round — this tries several
// plausible French/English variants per field and logs the first raw
// feature if nothing matches, rather than guessing blind across many runs.
function pick(props, candidates) {
  for (const c of candidates) {
    if (props[c] != null && props[c] !== '') return props[c];
  }
  return null;
}

// A work zone can be a Point or span a road segment (LineString/
// MultiLineString) — either way, the first vertex is used as the marker
// location rather than rendering the full extent.
function firstCoord(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  let c = geometry.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number') return c;
  return null;
}

async function main() {
  const data = await fetchJson(ROADWORKS_URL);
  const features = data.features || [];

  const roadworks = features.map((f, i) => {
    const props = f.properties || {};
    const coord = firstCoord(f.geometry);
    if (!coord) return null;
    const [lon, lat] = coord;
    if (lat < MTL_BBOX.minLat || lat > MTL_BBOX.maxLat || lon < MTL_BBOX.minLon || lon > MTL_BBOX.maxLon) return null;
    const description = pick(props, ['DescriptionLocalisationFr', 'DescriptionLocalisationEn', 'Description', 'description', 'Localisation']) || `Roadwork ${i + 1}`;
    const route = pick(props, ['NumeroRoute', 'NomRoute', 'Route', 'route']);
    const nature = pick(props, ['NatureTravaux', 'TypeTravaux', 'Nature', 'Type', 'type']);
    const dateDebut = pick(props, ['DateDebut', 'DateDebutTravaux', 'DateDebutDiffusion']);
    const dateFin = pick(props, ['DateFin', 'DateFinTravaux', 'DateFinDiffusion']);
    const id = pick(props, ['IDChantier', 'NoChantier', 'ID_Chantier', 'IdChantier', 'id']) || String(i + 1);
    return { id: String(id), description: String(description), route, nature, dateDebut, dateFin, lat, lon };
  }).filter(Boolean);

  if (!roadworks.length) {
    console.error(`No roadworks parsed from ${features.length} features (after the Montréal-area filter) — leaving existing roadworks.json untouched (feed schema may have changed).`);
    if (features[0]) console.error('First feature for schema debugging:', JSON.stringify(features[0]));
    return;
  }

  fs.writeFileSync('roadworks.json', JSON.stringify({ timestamp: Date.now(), source: ROADWORKS_URL, roadworks }));
  console.log(`Saved ${roadworks.length} Montréal-area roadworks (of ${features.length} features seen)`);
}

main().catch(e => {
  console.error('fetch-roadworks failed:', e.message);
});
