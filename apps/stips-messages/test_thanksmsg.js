const https = require('https');

const url = 'https://stips.co.il/api?name=objectlist&api_params=%7B%22page%22:1,%22objType%22:%22thanksmsg%22,%22userid%22:429329%7D';

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Error parsing JSON:', e.message);
      console.log(data);
    }
  });
}).on('error', (err) => {
  console.error(err);
});
