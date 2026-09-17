const https = require('https');

const arg = process.argv[2] || 'iJxeutc3QCI';

if (arg === '--channel') {
  const handle = process.argv[3];
  const url = `https://www.youtube.com/${handle}`;
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('STATUS', res.statusCode);
      const m = data.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,30})"/);
      console.log('channelId match:', m ? m[1] : 'NOT FOUND');
      // Also check if any videos are currently marked live
      const liveMatch = data.match(/"style":"LIVE"/g);
      console.log('LIVE badge occurrences on channel page:', liveMatch ? liveMatch.length : 0);
    });
  }).on('error', e => console.error('ERR', e.message));
} else {
  const videoId = arg;
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  https.get(url, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('STATUS', res.statusCode);
      console.log(data);
    });
  }).on('error', e => console.error('ERR', e.message));
}
