const https = require('https');

function testApi(url, callback) {
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`\n=== URL: ${url} ===`);
      console.log(`Status: ${res.statusCode}`);
      try {
        const parsed = JSON.parse(data);
        console.log('Response JSON (truncated):', JSON.stringify(parsed).substring(0, 800));
      } catch (e) {
        console.log('Response text (truncated):', data.substring(0, 500));
      }
      callback();
    });
  }).on('error', (err) => {
    console.error('Error:', err.message);
    callback();
  });
}

const urls = [
  'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329%7D',
  'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329,%22filter%22:%22asked%22%7D',
  'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329,%22filter%22:%22ansed%22%7D',
  'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329,%22type%22:%22asked%22%7D'
];

let index = 0;
function runNext() {
  if (index < urls.length) {
    testApi(urls[index++], runNext);
  }
}
runNext();
