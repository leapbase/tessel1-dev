// nRF24L01(+) radio module check, NO module library, NO bitwise operators.
// Pins (as in the rf-nrf24 library): digital[0]=CSN (active low), digital[1]=CE, digital[2]=IRQ.
// Reads registers and compares to the chip's power-on defaults, then writes RF_CH, reads it back and restores it.
var tessel = require('tessel');
var PORT = 'A';
var port = tessel.port[PORT];
function say(m) { console.log('nrf24[' + PORT + ']: ' + m); }
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push(hex2(b[i])); return s.join(' '); }
function finish(m) { say('RESULT ' + m); setTimeout(function () { process.exit(0); }, 300); }

port.digital[1].output(false);                                   // CE low: standby, no transmit/receive
var spi;
try { spi = port.SPI({ chipSelect: port.digital[0], chipSelectActive: 0 }); } catch (e) { finish('SPI unavailable: ' + e); }

function cmd(bytes, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 1500);
  spi.transfer(new Buffer(bytes), function (e, rx) { if (done) return; done = true; clearTimeout(t); cb(e, rx); });
}
function fill(n) { var a = []; for (var i = 0; i < n; i++) a.push(0xFF); return a; }
function readReg(reg, n, cb) { cmd([reg].concat(fill(n)), function (e, rx) { cb(e, rx ? rx.slice(1) : null); }); }
function writeReg(reg, bytes, cb) { cmd([0x20 + reg].concat(bytes), cb); }

var regs = [
  { name: 'CONFIG',       reg: 0x00, n: 1, def: '08' },
  { name: 'EN_AA',        reg: 0x01, n: 1, def: '3f' },
  { name: 'SETUP_AW',     reg: 0x03, n: 1, def: '03' },
  { name: 'SETUP_RETR',   reg: 0x04, n: 1, def: '03' },
  { name: 'RF_CH',        reg: 0x05, n: 1, def: '02' },
  { name: 'RF_SETUP',     reg: 0x06, n: 1, def: '0e', alt: '0f' },        // 0e = nRF24L01+, 0f = nRF24L01
  { name: 'STATUS',       reg: 0x07, n: 1, def: '0e' },
  { name: 'RX_ADDR_P0',   reg: 0x0A, n: 5, def: 'e7 e7 e7 e7 e7' },
  { name: 'FIFO_STATUS',  reg: 0x17, n: 1, def: '11' }
];
var matches = 0, allFF = true, allZero = true, rfch = null;

(function step(i) {
  if (i >= regs.length) return write();
  var r = regs[i];
  readReg(r.reg, r.n, function (e, d) {
    if (e || !d) { say(r.name + ' read error ' + e); return step(i + 1); }
    var s = hex(d);
    var isDef = (s === r.def || s === r.alt);
    for (var k = 0; k < d.length; k++) { if (d[k] !== 0xFF) allFF = false; if (d[k] !== 0x00) allZero = false; }
    if (isDef) matches++;
    if (r.name === 'RF_CH') rfch = d[0];
    say(r.name + ' (0x' + hex2(r.reg) + ') = ' + s + '   default ' + r.def + (r.alt ? ' or ' + r.alt : '') + (isDef ? '   MATCH' : ''));
    step(i + 1);
  });
})(0);

function write() {
  if (rfch === null) return verdict(false, 'RF_CH not read');
  var test = rfch === 0x4C ? 0x2A : 0x4C;
  writeReg(0x05, [test], function (e1) {
    readReg(0x05, 1, function (e2, d) {
      var got = d ? d[0] : -1;
      writeReg(0x05, [rfch], function () {                           // restore
        readReg(0x05, 1, function (e3, d2) {
          say('write test: wrote 0x' + hex2(test) + ', read back 0x' + (got < 0 ? '??' : hex2(got)) + '; restored to 0x' + hex2(rfch) + ', now 0x' + (d2 ? hex2(d2[0]) : '??'));
          verdict(got === test, '');
        });
      });
    });
  });
}
function verdict(writeOk, note) {
  if (allFF) return finish('all reads 0xFF: no nRF24 on this port (or not seated, or no power)');
  if (allZero) return finish('all reads 0x00: bus is stuck low, no nRF24 answering');
  if (matches >= 6 && writeOk) return finish('nRF24 RADIO MODULE OK (' + matches + ' of ' + regs.length + ' registers at power-on defaults, write/readback works)');
  if (writeOk) return finish('nRF24 likely present: write/readback works, ' + matches + ' of ' + regs.length + ' registers at defaults (others may have been configured earlier)');
  finish('inconclusive: ' + matches + ' registers match defaults, write/readback ' + (writeOk ? 'ok' : 'failed') + ' ' + note);
}
