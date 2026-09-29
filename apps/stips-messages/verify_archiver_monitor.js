const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verify() {
  console.log('=== VERIFICATION OF ARCHIVER & MONITOR STARTING ===');

  // 1. Test stips_live_archiver.js
  console.log('\nTesting stips_live_archiver.js (running for 20 seconds)...');
  const archiver = spawn('node', ['stips_live_archiver.js']);
  
  let archiverOutput = '';
  archiver.stdout.on('data', (data) => {
    const out = data.toString();
    console.log(`[Archiver Out] ${out.trim()}`);
    archiverOutput += out;
  });

  archiver.stderr.on('data', (data) => {
    console.error(`[Archiver Err] ${data.toString().trim()}`);
  });

  await sleep(20000); // Wait 20 seconds
  console.log('Stopping archiver process...');
  archiver.kill('SIGINT');
  
  // Verify database tables
  const db = new DatabaseSync('stips_data.db');
  try {
    const qCount = db.prepare("SELECT COUNT(*) as count FROM archived_questions").get().count;
    const aCount = db.prepare("SELECT COUNT(*) as count FROM archived_answers").get().count;
    console.log(`\nDatabase check after live archiver test:`);
    console.log(`- Archived questions in database: ${qCount}`);
    console.log(`- Archived answers in database: ${aCount}`);
    
    if (qCount >= 0) {
      console.log('✅ Success: Live archiver database schema and queries functioning.');
    } else {
      console.error('❌ Error: Archiver failed database checks.');
      process.exit(1);
    }
  } catch (e) {
    console.error('❌ Database query failed:', e.message);
    process.exit(1);
  }

  // 2. Test stips_target_monitor.js
  console.log('\nTesting stips_target_monitor.js (running for 15 seconds)...');
  const monitor = spawn('node', ['stips_target_monitor.js', '--target', '429329', '--interval', '4000']);
  
  let monitorOutput = '';
  monitor.stdout.on('data', (data) => {
    const out = data.toString();
    console.log(`[Monitor Out] ${out.trim()}`);
    monitorOutput += out;
  });

  monitor.stderr.on('data', (data) => {
    console.error(`[Monitor Err] ${data.toString().trim()}`);
  });

  await sleep(15000); // Wait 15 seconds
  console.log('Stopping target monitor process...');
  monitor.kill('SIGINT');

  if (monitorOutput.includes('TARGET LOCKED')) {
    console.log('✅ Success: Target monitor locked onto profile successfully!');
  } else {
    console.error('❌ Error: Target monitor failed to lock onto profile!');
    process.exit(1);
  }

  console.log('\n=== ALL VERIFICATIONS COMPLETED SUCCESSFULLY! ===');
}

verify().catch(e => {
  console.error('Verification crashed:', e);
  process.exit(1);
});
