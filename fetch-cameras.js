const https = require('https');
const fs = require('fs');

// Ville de Montréal's public traffic-camera roster. ~250 fixed cameras,
// each with a "live" snapshot URL that always serves the latest frame
// (the city refreshes it in place roughly every 5 minutes) — so this
// script only needs to keep the camera roster (location + snapshot URL)
// in sync occasionally; freshness of the actual image comes from the
// viewer's browser cache-busting that URL at view time, not from this
// script running often.
const SOURCE_URL = 'https://ville.montreal.qc.ca/circulation/sites/ville.montreal.qc.ca.circulation/files/cameras-de-circulation.json';

function fetchJson(url) {
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

// The exact property names on this feed's features aren't documented
// anywhere public we could confirm from this environment — only the
// image-URL field name (URLImageEnDirect) is confirmed, via a working
// third-party tool that already parses this same feed. Camera name/ID
// field names are best-effort guesses across common French/English
// variants; this stays robust to whichever one is actually present,
// and falls back to a positional label rather than failing outright.
function pick(props, candidates) {
  for (const c of candidates) {
    if (props[c] != null && props[c] !== '') return props[c];
  }
  return null;
}

async function main() {
  const data = await fetchJson(SOURCE_URL);
  const features = data.features || [];

  const cameras = features.map((f, i) => {
    const props = f.properties || {};
    const coords = f.geometry && f.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    const [lon, lat] = coords;
    const imageUrl = pick(props, ['URLImageEnDirect', 'urlImageEnDirect', 'url_image_en_direct', 'image', 'Image', 'IMAGE']);
    if (!imageUrl) return null;
    const name = pick(props, ['Nom_Camera', 'nom_camera', 'NOM_CAM', 'nom', 'Nom', 'description', 'Description', 'name', 'Name']) || `Camera ${i + 1}`;
    const id = pick(props, ['ID_CAM', 'id_camera', 'CAM_ID', 'id', 'Id', 'ID']) || String(i + 1);
    return { id: String(id), name: String(name), lat, lon, imageUrl };
  }).filter(Boolean);

  if (!cameras.length) {
    console.error(`No cameras parsed from ${features.length} features — leaving existing cameras.json untouched (feed schema may have changed).`);
    return;
  }

  fs.writeFileSync('cameras.json', JSON.stringify({ timestamp: Date.now(), source: SOURCE_URL, cameras }));
  console.log(`Saved ${cameras.length} cameras (of ${features.length} features seen)`);
}

main().catch(e => {
  console.error('fetch-cameras failed:', e.message);
});
