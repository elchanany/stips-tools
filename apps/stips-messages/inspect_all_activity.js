const https = require('https');

const url = 'https://stips.co.il/api?name=objectlist&api_params=%7B%22method%22:%22ask.user_activity%22,%22userid%22:429329%7D';

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log('Total items:', parsed.data?.length);
      (parsed.data || []).forEach((item, i) => {
        const id = item.data?.id;
        const q = item.data?.q;
        const nickname = item.extra?.item_profile?.nickname;
        const userid = item.extra?.item_profile?.userid;
        console.log(`[${i}] ID: ${id} | Title: "${q}" | Profile Nickname: "${nickname}" | UserID: ${userid}`);
      });
    } catch (e) {
      console.log('Error parsing:', e.message);
    }
  });
}).on('error', (err) => {
  console.error(err);
});
