const https = require('https');

// One-off probe (removed after use, same pattern as the earlier Cloudflare-
// wall check for Québec 511's camera viewer page): a user reported a NYC
// camera image not rendering in the popup. Checking whether this is one
// offline camera, a systemic hotlink/CORS block, or something else, by
// fetching the exact URLs the frontend uses and logging status + headers.
const URLS = [
  'https://webcams.nyctmc.org/api/cameras/bcb706e6-135a-4981-8a06-7545f6e05ddd/image', // C3-SIE-11-EB_at_Renwick_Ave, the one the user reported
  'https://webcams.nyctmc.org/api/cameras/8a6bc417-4877-4ebe-8052-88c1b261baf1/image', // Central Park West @ 86 St, a different camera as a control
];

function probe(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CognitiveGroupTacticalDemo/1.0)',
        'Referer': 'https://thelionus.github.io/'
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          url,
          status: res.statusCode,
          headers: res.headers,
          bodyLength: Buffer.concat(chunks).length
        });
      });
    });
    req.on('error', e => resolve({ url, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ url, error: 'timeout' }); });
  });
}

async function main() {
  for (const url of URLS) {
    const result = await probe(url);
    console.log(JSON.stringify(result, null, 2));
  }
}

main();
