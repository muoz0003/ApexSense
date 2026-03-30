const { IRacingSDK } = require('irsdk-node');
console.log('SDK loaded');
const sdk = new IRacingSDK();
console.log('SDK created');
const started = sdk.startSDK();
console.log('started:', started);
if (started) {
  const data = sdk.waitForData(100);
  console.log('data:', data);
}
sdk.stopSDK();
console.log('done');
process.exit(0);
