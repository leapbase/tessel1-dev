// Read-only checks for the servo (PCA9685) and climate (Si7005/Si7020) modules.
// No module libraries, no bitwise operators. Ports are set below.
var tessel = require('tessel');
var SERVO_PORT = 'A', CLIMATE_PORT = 'C';
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }

// Do one I2C register read with a timeout; cb(err, byte).
function readReg(portName, addr, txBytes, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 1500);
  try {
    tessel.port[portName].I2C(addr).transfer(new Buffer(txBytes), 1, function (err, rx) {
      if (done) return; done = true; clearTimeout(t);
      cb(err, rx && rx.length ? rx[0] : null);
    });
  } catch (e) { if (!done) { done = true; clearTimeout(t); cb(e); } }
}

function steps(list, i) {
  if (i >= list.length) { console.log('mods: done'); return process.exit(0); }
  var s = list[i];
  readReg(s.port, s.addr, s.tx, function (err, v) {
    console.log('mods: ' + s.label + ' -> ' + (err ? 'ERR ' + err : '0x' + hex2(v)) + (s.expect ? '   (expect ' + s.expect + ')' : ''));
    steps(list, i + 1);
  });
}

steps([
  { label: 'servo  port ' + SERVO_PORT + ' @0x70 MODE1 reg 0x00', port: SERVO_PORT, addr: 0x70, tx: [0x00], expect: '0x11 at reset' },
  { label: 'servo  port ' + SERVO_PORT + ' @0x70 MODE2 reg 0x01', port: SERVO_PORT, addr: 0x70, tx: [0x01], expect: '0x04 at reset' },
  { label: 'servo  port ' + SERVO_PORT + ' @0x70 PRESCALE reg 0xFE', port: SERVO_PORT, addr: 0x70, tx: [0xFE], expect: '0x1e at reset' },
  { label: 'climate port ' + CLIMATE_PORT + ' @0x40 Si7005 ID reg 0x11', port: CLIMATE_PORT, addr: 0x40, tx: [0x11], expect: '0x50 = Si7005' },
  { label: 'climate port ' + CLIMATE_PORT + ' @0x40 Si7020 ID cmd FC C9', port: CLIMATE_PORT, addr: 0x40, tx: [0xFC, 0xC9], expect: '0x14 = Si7020' },
  { label: 'climate port ' + CLIMATE_PORT + ' @0x40 status reg 0x00', port: CLIMATE_PORT, addr: 0x40, tx: [0x00] }
], 0);
