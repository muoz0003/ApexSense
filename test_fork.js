// Minimal test: fork a child that loads irsdk-node
const { fork } = require('child_process');
const path = require('path');

const child = fork(path.join(__dirname, 'test_worker.js'), [], {
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
});

child.stdout.on('data', (d) => process.stdout.write('OUT: ' + d));
child.stderr.on('data', (d) => process.stdout.write('ERR: ' + d));
child.on('exit', (code) => {
  console.log('EXIT:', code);
  process.exit();
});
