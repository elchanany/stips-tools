const https = require('https');

function testUrl(url) {
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`URL: ${url}`);
      console.log(`Status: ${res.statusCode}`);
      console.log(`Response: ${data}`);
    });
  }).on('error', (err) => {
    console.error(err);
  });
}

testUrl('https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=%7B%22objType%22:%22user%22,%22data%22:%7B%22id%22:999999%7D%7D');
testUrl('https://stips.co.il/api?name=profile.page_data&api_params=%7B%22userid%22:999999%7D');
