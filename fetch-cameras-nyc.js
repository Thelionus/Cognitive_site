const https = require('https');
const fs = require('fs');

// NYC DOT's Real Time Traffic Information system — a public, keyless API
// (unlike Québec 511's viewer page, this one is not behind a Cloudflare
// bot-challenge). Removing "/image" from a camera's URL returns its full
// record (id, lat/lon, name, a direct imageUrl) rather than just the
// snapshot itself, so this fetches the full list once instead of pulling
// hundreds of individual per-camera JSON documents.
const CAMERAS_URL = 'https://webcams.nyctmc.org/api/cameras';

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

// Field names guessed from public documentation of this API (id, latitude,
// longitude, name, imageUrl / area/roadway descriptors) — same
// defensive multi-candidate pattern as the Québec feeds, in case the real
// response uses different casing or naming than documented.
function pick(props, candidates) {
  for (const c of candidates) {
    if (props[c] != null && props[c] !== '') return props[c];
  }
  return null;
}

async function main() {
  const data = await fetchJson(CAMERAS_URL);
  const list = Array.isArray(data) ? data : (data.cameras || data.data || []);

  let anyFieldMatched = false;
  const cameras = list.map((c, i) => {
    const lat = pick(c, ['latitude', 'lat', 'Latitude']);
    const lon = pick(c, ['longitude', 'lon', 'lng', 'Longitude']);
    if (lat == null || lon == null) return null;
    const idFound = pick(c, ['id', 'Id', 'cameraId', 'ID']);
    const nameFound = pick(c, ['name', 'Name', 'roadwayName', 'area']);
    const imageUrlFound = pick(c, ['imageUrl', 'ImageUrl', 'image', 'imageUrlPath']);
    if (idFound || nameFound || imageUrlFound) anyFieldMatched = true;
    const id = idFound || String(i + 1);
    const name = nameFound || `NYC Camera ${i + 1}`;
    // Some deployments of this API return a full URL, others a path
    // relative to the same host — normalize so the frontend can always
    // just <img src>.
    let imageUrl = imageUrlFound;
    if (imageUrl && !/^https?:\/\//.test(imageUrl)) {
      imageUrl = new URL(imageUrl, CAMERAS_URL).toString();
    }
    if (!imageUrl && idFound) imageUrl = `https://webcams.nyctmc.org/api/cameras/${idFound}/image`;
    return { id: String(id), name: String(name), imageUrl, lat: Number(lat), lon: Number(lon) };
  }).filter(Boolean);

  if (!cameras.length) {
    console.error(`No cameras parsed from ${list.length} entries — leaving existing cameras-nyc.json untouched (feed schema may have changed).`);
    if (list[0]) console.error('First entry for schema debugging:', JSON.stringify(list[0]));
    return;
  }

  if (!anyFieldMatched) {
    console.error(`Coordinates parsed for ${cameras.length} cameras, but no descriptive field guess matched anything — every entry fell back to a generic label. Raw entry for schema debugging:`, JSON.stringify(list[0]));
  }

  fs.writeFileSync('cameras-nyc.json', JSON.stringify({ timestamp: Date.now(), source: CAMERAS_URL, cameras }));
  console.log(`Saved ${cameras.length} NYC DOT traffic cameras (of ${list.length} entries seen)`);
}

main().catch(e => {
  console.error('fetch-cameras-nyc failed:', e.message);
});
