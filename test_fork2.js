const { fork } = require('child_process');
const path = require('path');

const child = fork(path.join(__dirname, 'dist', 'telemetryWorker.js'), [], {
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
});

child.stdout.on('data', (d) => process.stdout.write('OUT: ' + d));
child.stderr.on('data', (d) => process.stdout.write('ERR: ' + d));
child.on('message', (msg) => console.log('MSG:', JSON.stringify(msg).substring(0, 300)));
child.on('exit', (code) => {
  console.log('EXIT:', code);
  process.exit();
});

child.send({ type: 'start', pollIntervalMs: 200, radarRange: 40 });

setTimeout(() => {
  console.log('Stopping after 5s...');
  try { child.send({ type: 'stop' }); } catch(e) { process.exit(); }
}, 5000);
