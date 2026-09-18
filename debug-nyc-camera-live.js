const https = require('https');

// Temporary follow-up probe (removed after use) — the previous probe fetched
// a camera image URL directly with a fake Referer and got a clean 200, but
// the user reports the image is STILL not rendering in production after the
// onerror/loading="lazy" fix deployed. Checking two things a synthetic
// server-side fetch can't: (1) whether the fix actually deployed to the real
// page, and (2) whether the real production page's Referer/Origin (rather
// than a guessed one) changes the camera server's response.
const PAGE_URL = 'https://www.cognitivegroup.com/tactical.html';
const IMAGE_URL = 'https://webcams.nyctmc.org/api/cameras/bcb706e6-135a-4981-8a06-7545f6e05ddd/image';

function fetchText(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        const next = new URL(res.headers.location, url).toString();
        console.log(`  redirect: ${url} -> ${next}`);
        return resolve(fetchText(next, redirectsLeft - 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ finalUrl: url, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

function probeImage(referer) {
  return new Promise((resolve) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Origin': 'https://www.cognitivegroup.com',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site'
    };
    if (referer) headers['Referer'] = referer;
    const req = https.get(IMAGE_URL, { timeout: 15000, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ referer: referer || '(none)', status: res.statusCode, headers: res.headers, bodyLength: Buffer.concat(chunks).length }));
    });
    req.on('error', e => resolve({ referer: referer || '(none)', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ referer, error: 'timeout' }); });
  });
}

async function main() {
  console.log('--- LIVE PAGE CHECK (following redirects) ---');
  const page = await fetchText(PAGE_URL);
  console.log('final URL:', page.finalUrl);
  console.log('status:', page.status);
  console.log('page length:', page.body.length);
  console.log('caching-relevant headers:', JSON.stringify({
    'cache-control': page.headers['cache-control'],
    'age': page.headers['age'],
    'etag': page.headers['etag'],
    'last-modified': page.headers['last-modified'],
    'x-cache': page.headers['x-cache'],
    'cf-cache-status': page.headers['cf-cache-status'],
    'server': page.headers['server'],
    'via': page.headers['via']
  }, null, 2));
  console.log('contains onerror fallback:', page.body.includes('Camera image unavailable right now'));
  console.log('contains loading="lazy" near camera img:', /imageUrl[\s\S]{0,80}loading="lazy"/.test(page.body));
  const cameraLineMatch = page.body.match(/const body=cam\.imageUrl[\s\S]*?openPopup\(\);/);
  console.log('actual camera-popup code on live page:');
  console.log(cameraLineMatch ? cameraLineMatch[0] : '(not found)');

  console.log('\n--- IMAGE PROBE WITH REAL PAGE AS REFERER ---');
  const result1 = await probeImage(PAGE_URL);
  console.log(JSON.stringify(result1, null, 2));

  console.log('\n--- IMAGE PROBE WITH NO REFERER (simulating some browser privacy settings) ---');
  const result2 = await probeImage('');
  console.log(JSON.stringify(result2, null, 2));
}

main().catch(e => console.error('probe failed:', e.message));
