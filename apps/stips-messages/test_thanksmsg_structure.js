const https = require('https');

const url = 'https://stips.co.il/api?name=objectlist&api_params=%7B%22page%22:1,%22objType%22:%22thanksmsg%22,%22userid%22:429329%7D';

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      console.log('Parsed thanksmsg sample (first 2 items):');
      if (parsed.data && parsed.data.length > 0) {
        console.log(JSON.stringify(parsed.data.slice(0, 2), null, 2));
      } else {
        console.log('No thanksmsg data found or empty array.', parsed);
      }
    } catch (e) {
      console.log('Failed to parse:', e.message, '\nRaw data:', data.substring(0, 800));
    }
  });
}).on('error', (err) => {
  console.error(err);
});
