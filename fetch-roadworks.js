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

// Confirmed live via the diagnostic log below (chantiers_mtmdet uses its own
// camelCase French field names, unrelated to infos_cameras' PascalCase):
// identifiantChantier, identificationDesTravaux, localisation, routeAutoroute,
// entraveType, debut, fin. Older PascalCase guesses stay as a fallback in
// case a future schema revision reintroduces that convention.
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

  let anyFieldMatched = false;
  const roadworks = features.map((f, i) => {
    const props = f.properties || {};
    const coord = firstCoord(f.geometry);
    if (!coord) return null;
    const [lon, lat] = coord;
    if (lat < MTL_BBOX.minLat || lat > MTL_BBOX.maxLat || lon < MTL_BBOX.minLon || lon > MTL_BBOX.maxLon) return null;
    const descriptionFound = pick(props, ['identificationDesTravaux', 'DescriptionLocalisationFr', 'DescriptionLocalisationEn', 'Description', 'description']);
    const location = pick(props, ['localisation', 'Localisation']);
    const route = pick(props, ['routeAutoroute', 'NumeroRoute', 'NomRoute', 'Route', 'route']);
    const nature = pick(props, ['entraveType', 'entrave', 'NatureTravaux', 'TypeTravaux', 'Nature', 'Type', 'type']);
    const dateDebut = pick(props, ['debut', 'DateDebut', 'DateDebutTravaux', 'DateDebutDiffusion']);
    const dateFin = pick(props, ['fin', 'DateFin', 'DateFinTravaux', 'DateFinDiffusion']);
    const idFound = pick(props, ['identifiantChantier', 'identifiant', 'IDChantier', 'NoChantier', 'ID_Chantier', 'IdChantier', 'id']);
    if (descriptionFound || location || route || nature || dateDebut || dateFin || idFound) anyFieldMatched = true;
    const description = descriptionFound || `Roadwork ${i + 1}`;
    const id = idFound || String(i + 1);
    return { id: String(id), description: String(description), location, route, nature, dateDebut, dateFin, lat, lon };
  }).filter(Boolean);

  if (!roadworks.length) {
    console.error(`No roadworks parsed from ${features.length} features (after the Montréal-area filter) — leaving existing roadworks.json untouched (feed schema may have changed).`);
    if (features[0]) console.error('First feature for schema debugging:', JSON.stringify(features[0]));
    return;
  }

  // Coordinates can parse fine while every descriptive field guess misses —
  // that's not an empty result (so the guard above won't catch it), but it's
  // just as much a schema mismatch worth surfacing immediately.
  if (!anyFieldMatched) {
    const sample = features.find(f => f.properties) || features[0];
    console.error(`Coordinates parsed for ${roadworks.length} roadworks, but no descriptive field guess matched anything — every entry fell back to a generic label. Raw feature for schema debugging:`, JSON.stringify(sample));
  }

  fs.writeFileSync('roadworks.json', JSON.stringify({ timestamp: Date.now(), source: ROADWORKS_URL, roadworks }));
  console.log(`Saved ${roadworks.length} Montréal-area roadworks (of ${features.length} features seen)`);
}

main().catch(e => {
  console.error('fetch-roadworks failed:', e.message);
});
