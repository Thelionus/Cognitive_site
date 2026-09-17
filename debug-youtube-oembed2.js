const https = require('https');

const videoId = process.argv[2] || 'iJxeutc3QCI';
const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

https.get(url, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log(data);
  });
}).on('error', e => console.error('ERR', e.message));
