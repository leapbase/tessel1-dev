// 15 s BLE scan with the ble-ble113a library (port A). Needs node_modules: ble-ble113a@0.2.0, bglib@0.0.6, async@0.9.0, bleadvertise@0.1.1.
// Nearby device addresses are printed but should not be committed.
var tessel = require('tessel');
var ble = require('ble-ble113a').use(tessel.port['A'], function (err) {
  if (err) { console.log('lib: use() error: ' + err); process.exit(0); }
});
var seen = {}, n = 0;
ble.on('ready', function (err) {
  console.log('lib: READY ' + (err || ''));
  ble.startScanning();
  setTimeout(function () {
    console.log('lib: RESULT scanned 15 s, ' + n + ' advertisements from ' + Object.keys(seen).length + ' devices');
    process.exit(0);
  }, 15000);
});
ble.on('discover', function (p) {
  n++;
  var id = String(p.address || p.toString());
  if (!seen[id]) { seen[id] = 1; console.log('lib: device ' + (Object.keys(seen).length) + ' ' + id + ' rssi ' + p.rssi); }
});
setTimeout(function () { console.log('lib: RESULT no ready event in 30 s'); process.exit(0); }, 30000);
