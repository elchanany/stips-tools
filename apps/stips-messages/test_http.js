const http = require('http');
const https = require('https');

const httpUrl = 'http://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=%7B%22objType%22:%22user%22,%22data%22:%7B%22id%22:123%7D%7D';
const httpsUrl = 'https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=%7B%22objType%22:%22user%22,%22data%22:%7B%22id%22:123%7D%7D';

console.log('Testing HTTP...');
http.get(httpUrl, {
  headers: {
    'User-Agent': 'Mozilla/5.0'
  }
}, (res) => {
  console.log('HTTP Status:', res.statusCode);
  console.log('HTTP Headers:', res.headers);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('HTTP Body Length:', data.length);
    console.log('HTTP Body (truncated):', data.substring(0, 300));
  });
}).on('error', err => console.error('HTTP Error:', err));

console.log('Testing HTTPS...');
https.get(httpsUrl, {
  headers: {
    'User-Agent': 'Mozilla/5.0'
  }
}, (res) => {
  console.log('HTTPS Status:', res.statusCode);
  console.log('HTTPS Headers:', res.headers);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('HTTPS Body Length:', data.length);
    console.log('HTTPS Body (truncated):', data.substring(0, 300));
  });
}).on('error', err => console.error('HTTPS Error:', err));
