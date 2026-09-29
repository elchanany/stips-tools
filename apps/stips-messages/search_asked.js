const fs = require('fs');
const content = fs.readFileSync('main_stips_real.js', 'utf8');

const targets = ['asked', 'ansed', 'pinned'];
targets.forEach(target => {
  console.log(`\n================ TARGET: ${target} ================`);
  let index = 0;
  while (true) {
    index = content.indexOf(target, index);
    if (index === -1) break;
    console.log(`\n--- Match at index ${index} ---`);
    console.log(content.substring(index - 150, index + 250));
    index += 1;
  }
});
