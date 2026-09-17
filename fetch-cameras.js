const https = require('https');
const fs = require('fs');

// Live traffic-camera roster for the tactical page's Montréal-area map.
// Primary source: the Québec transport ministry's (MTMD) public WFS
// catalogue — confirmed reachable and its schema confirmed via a live run
// (see the field names in the QUEBEC511 branch of pick() below). It's
// province-wide (~680 cameras), so results are filtered to a bounding box
// around greater Montréal to match what the UI actually advertises.
//
// Unlike the original Ville de Montréal feed (a raw image URL that always
// serves the latest frame), Québec 511's URL_FLUX_DONNEE points to a small
// HTML viewer page, not an embeddable image — so cameras.json exposes a
// generic `viewUrl` and the UI links out to it instead of embedding an
// <img>. That also means the site doesn't need to worry about image
// staleness/cache-busting here at all; the viewer page handles its own feed.
const QUEBEC511_URL = 'https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson';
// Greater Montréal bounding box (lat/lon), generous enough to include the
// island, Laval and the nearer South Shore without pulling in the rest of
// the province's cameras.
const MTL_BBOX = { minLat: 45.2, maxLat: 45.75, minLon: -74.1, maxLon: -73.2 };

// Every ville.montreal.qc.ca / donnees.montreal.ca path below was confirmed
// (via live runs of this workflow) to 403 behind the city's own WAF,
// city-wide — not just on one path. Kept only as a last-resort fallback in
// case that ever changes; Québec 511 above is tried first.
const DIRECT_URL = 'https://ville.montreal.qc.ca/circulation/sites/ville.montreal.qc.ca.circulation/files/cameras-de-circulation.json';
const CKAN_PACKAGE_URL = 'https://donnees.montreal.ca/api/3/action/package_show?id=cameras-observation-routiere';
// A community-run OpenDataSoft mirror of the same Montréal dataset, on
// OpenDataSoft's own SaaS infrastructure rather than a city-owned host —
// reachable (confirmed via a live run), but its field names don't match
// any of our guesses; kept as a last resort pending that diagnosis.
const OPENDATASOFT_URL = 'https://do101mtl.opendatasoft.com/api/records/1.0/search/?dataset=cameras-de-circulation-ville-de-montreal&rows=1000';

// The city has redirected this feed before (e.g. a path move or https
// upgrade) without warning, so redirects are followed rather than treated
// as failures — a hardcoded URL would otherwise silently break on the next
// one too.
function fetchJson(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: 15000,
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
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(new Error(`parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Québec 511's WFS field names (IDEcamera, DescriptionLocalisationFr/En,
// URL_FLUX_DONNEE) are confirmed directly from a live response. The
// Montréal-specific fallbacks' field names were never confirmed live before
// their sources started 403'ing, so those stay as best-effort guesses
// across common French/English/kebab-case variants — harmless since they
// only run if Québec 511 itself is unreachable.
function pick(props, candidates) {
  for (const c of candidates) {
    if (props[c] != null && props[c] !== '') return props[c];
  }
  return null;
}

async function resolveFeatures() {
  try {
    const data = await fetchJson(QUEBEC511_URL);
    return { sourceUrl: QUEBEC511_URL, features: data.features || [] };
  } catch (e) {
    console.error(`Québec 511 WFS failed (${e.message}) — falling back to the Montréal direct feed`);
  }
  try {
    const data = await fetchJson(DIRECT_URL);
    return { sourceUrl: DIRECT_URL, features: data.features || [] };
  } catch (e) {
    console.error(`direct feed failed (${e.message}) — falling back to the open-data catalogue`);
  }
  try {
    const pkg = await fetchJson(CKAN_PACKAGE_URL);
    const resources = (pkg.result && pkg.result.resources) || [];
    const resource = resources.find(r => /json/i.test(r.format || '')) || resources[0];
    if (!resource || !resource.url) throw new Error('CKAN package has no usable resource');
    const data = await fetchJson(resource.url);
    return { sourceUrl: resource.url, features: data.features || [] };
  } catch (e) {
    console.error(`open-data catalogue failed (${e.message}) — falling back to the OpenDataSoft mirror`);
  }
  // OpenDataSoft's fixed response envelope wraps each record's properties in
  // `fields` and its position in `geometry.coordinates` (GeoJSON [lon,lat])
  // or, lacking that, `fields.geo_point_2d` ([lat,lon] — reversed). Normalize
  // both into the same {properties, geometry} shape the other two sources
  // already produce so the rest of this script doesn't need to care which
  // source actually answered.
  const ods = await fetchJson(OPENDATASOFT_URL);
  const records = ods.records || [];
  const features = records.map(r => {
    const fields = r.fields || {};
    let coords = r.geometry && r.geometry.coordinates;
    if ((!coords || coords.length < 2) && Array.isArray(fields.geo_point_2d)) {
      coords = [fields.geo_point_2d[1], fields.geo_point_2d[0]];
    }
    return { properties: fields, geometry: { coordinates: coords } };
  });
  return { sourceUrl: OPENDATASOFT_URL, features };
}

async function main() {
  const { sourceUrl, features } = await resolveFeatures();

  const cameras = features.map((f, i) => {
    const props = f.properties || {};
    const coords = f.geometry && f.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    const [lon, lat] = coords;
    if (lat < MTL_BBOX.minLat || lat > MTL_BBOX.maxLat || lon < MTL_BBOX.minLon || lon > MTL_BBOX.maxLon) return null;
    const viewUrl = pick(props, ['URL_FLUX_DONNEE', 'URLImageEnDirect', 'urlImageEnDirect', 'url_image_en_direct', 'url-image-en-direct', 'url_image', 'urlImage', 'lien_image', 'image_url', 'camera_url', 'url_camera', 'image', 'Image', 'IMAGE']);
    if (!viewUrl) return null;
    const name = pick(props, ['DescriptionLocalisationFr', 'DescriptionLocalisationEn', 'Nom_Camera', 'nom_camera', 'NOM_CAM', 'nom', 'Nom', 'titre', 'Titre', 'nom_route', 'route', 'localisation', 'description', 'Description', 'name', 'Name']) || `Camera ${i + 1}`;
    const id = pick(props, ['IDEcamera', 'NumeroCamera', 'ID_CAM', 'id_camera', 'CAM_ID', 'id-camera', 'no_camera', 'numero_camera', 'id', 'Id', 'ID']) || String(i + 1);
    return { id: String(id), name: String(name), lat, lon, viewUrl };
  }).filter(Boolean);

  if (!cameras.length) {
    console.error(`No cameras parsed from ${features.length} features (after the Montréal-area filter) — leaving existing cameras.json untouched (feed schema may have changed).`);
    if (features[0]) console.error('First feature for schema debugging:', JSON.stringify(features[0]));
    return;
  }

  fs.writeFileSync('cameras.json', JSON.stringify({ timestamp: Date.now(), source: sourceUrl, cameras }));
  console.log(`Saved ${cameras.length} Montréal-area cameras (of ${features.length} features seen) from ${sourceUrl}`);
}

main().catch(e => {
  console.error('fetch-cameras failed:', e.message);
});
