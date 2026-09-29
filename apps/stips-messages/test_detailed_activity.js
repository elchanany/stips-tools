const https = require('https');

const url = 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329%7D';

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log('Total items in activity:', parsed.data?.length);
      if (parsed.data && parsed.data.length > 0) {
        console.log('Sample item structure:');
        console.log(JSON.stringify(parsed.data[0], null, 2));
      }
    } catch (e) {
      console.log('Error parsing JSON:', e.message);
    }
  });
}).on('error', (err) => {
  console.error(err);
});
