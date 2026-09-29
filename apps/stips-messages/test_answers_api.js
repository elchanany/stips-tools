const https = require('https');

// We use question ID 19457133 which the user mentioned
const url = 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ans.for_item%22,%22itemid%22:19457133%7D';

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
    try {
      const parsed = JSON.parse(data);
      console.log('Response status:', parsed.status);
      if (parsed.status === 'ok') {
        console.log(`Found ${parsed.data?.length} answers.`);
        if (parsed.data && parsed.data.length > 0) {
          console.log('Sample answer structure:');
          console.log(JSON.stringify(parsed.data[0], null, 2));
        }
      } else {
        console.log('Error response:', parsed);
      }
    } catch (e) {
      console.log('Failed to parse:', e.message, '\nRaw data:', data.substring(0, 500));
    }
  });
}).on('error', (err) => {
  console.error('Error:', err);
});
