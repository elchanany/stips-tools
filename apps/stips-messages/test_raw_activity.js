const https = require('https');

const url = 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329%7D';

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status code:', res.statusCode);
    console.log('Response content:', data);
  });
}).on('error', (err) => {
  console.error('Error:', err);
});
