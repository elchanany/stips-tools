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
        console.log('Response JSON (truncated):', JSON.stringify(parsed).substring(0, 500));
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
  'https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=%7B%22objType%22:%22user%22,%22data%22:%7B%22id%22:429329%7D%7D',
  'https://stips.co.il/api?name=profile.page_data&api_params=%7B%22userid%22:429329%7D',
  'https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=%7B%22objType%22:%22user%22,%22data%22:%7B%22id%22:424885%7D%7D',
  'https://stips.co.il/api?name=profile.page_data&api_params=%7B%22userid%22:424885%7D'
];

let index = 0;
function runNext() {
  if (index < urls.length) {
    testApi(urls[index++], runNext);
  }
}
runNext();
