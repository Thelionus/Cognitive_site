const https = require('https');

const url = 'https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=3394';

https.get(url, { headers: { 'User-Agent': 'CognitiveGroupTacticalDemo/1.0 (+https://www.cognitivegroup.com; contact: info@cognitivegroup.com)' } }, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log(data);
  });
}).on('error', e => console.error('ERR', e.message));
