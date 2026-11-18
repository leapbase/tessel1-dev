// Scan Tessel 1 ports for I2C devices (no module libraries, no bitwise operators).
// Camera is on B and GPS on D, so only scan the ports given in PORTS.
var tessel = require('tessel');
var PORTS = ['A', 'C'];
var FIRST = 0x08, LAST = 0x77, TIMEOUT = 250;

function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }

function scanPort(pi) {
  if (pi >= PORTS.length) { console.log('i2c: scan complete'); return process.exit(0); }
  var name = PORTS[pi], found = [];
  console.log('i2c: scanning port ' + name);
  var port = tessel.port[name];
  (function probe(addr) {
    if (addr > LAST) {
      console.log('i2c: port ' + name + ' RESULT ' + (found.length ? 'devices at ' + found.join(' ') : 'no I2C devices'));
      return scanPort(pi + 1);
    }
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; probe(addr + 1); } }, TIMEOUT);
    try {
      var i2c = port.I2C(addr);
      i2c.transfer(new Buffer([0x00]), 1, function (err, rx) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (!err && rx && rx.length) { found.push('0x' + hex2(addr)); console.log('i2c: port ' + name + ' ACK at 0x' + hex2(addr) + ' data=0x' + hex2(rx[0])); }
        probe(addr + 1);
      });
    } catch (e) {
      if (!done) { done = true; clearTimeout(timer); console.log('i2c: port ' + name + ' exception: ' + e); scanPort(pi + 1); }
    }
  })(FIRST);
}
scanPort(0);
