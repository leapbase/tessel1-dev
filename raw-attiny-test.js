// READ-ONLY identity check for ATtiny-based Tessel 1 modules (ambient, IR, ...), NO module library, NO bitwise operators.
// Pins (as in attiny-common): digital[0]=chip select, digital[1]=ATtiny reset, digital[2]=IRQ.
// Resets the chip, reads firmware version (cmd 0x01) and module ID (cmd 0x08). Never sends ISP/programming commands,
// never transmits and never enables a receiver. A blank module reads all 0xFF; this script does NOT flash it.
// Known IDs: ambient 0x08 (fw 0x03), IR 0x0B (fw 0x04).
var tessel = require('tessel');
var PORT = 'D';
var NAME = 'ir';
var EXPECT_ID = 0x0B, EXPECT_FW = 0x04, REBOOT_MS = 500;
var port = tessel.port[PORT];
function say(m) { console.log(NAME + '[' + PORT + ']: ' + m); }
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push(hex2(b[i])); return s.join(' '); }
function finish(m) { say('RESULT ' + m); setTimeout(function () { process.exit(0); }, 300); }

var cs = port.digital[0], rst = port.digital[1], irq = port.digital[2];
cs.output(true); rst.output(true); irq.rawWrite(false);
var spi;
try { spi = port.SPI({ clockSpeed: 1000, chipSelect: cs, chipSelectDelayUs: 30 }); } catch (e) { finish('SPI unavailable: ' + e); }

function xfer(bytes, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 2000);
  spi.transfer(new Buffer(bytes), function (e, rx) { if (done) return; done = true; clearTimeout(t); cb(e, rx); });
}
function info(cmd, cb) {
  xfer([cmd, 0x00, 0x00], function (e, rx) {
    if (e || !rx) return cb(e || new Error('no data'));
    say('cmd 0x' + hex2(cmd) + ' -> ' + hex(rx));
    if (rx[0] === 0x55 && rx[1] === cmd) cb(null, rx[2]); else cb(new Error('bad reply (' + hex(rx) + ')'));
  });
}

say('pulsing reset, waiting ' + REBOOT_MS + ' ms');
rst.low(); rst.high();
setTimeout(function () {
  info(0x01, function (e, fw) {
    if (e) return finish('no valid reply (' + e + '): nothing answering on this port, or the module has no firmware yet, or not seated');
    say('firmware version = 0x' + hex2(fw) + ' (expected 0x' + hex2(EXPECT_FW) + ')');
    info(0x08, function (e2, id) {
      if (e2) return finish('module ID read failed: ' + e2);
      say('module ID = 0x' + hex2(id) + ' (expected 0x' + hex2(EXPECT_ID) + ' for ' + NAME + ')');
      if (id !== EXPECT_ID) return finish('a module answered with ID 0x' + hex2(id) + ', not the expected ' + NAME + ' module');
      finish(NAME.toUpperCase() + ' MODULE OK' + (fw === EXPECT_FW ? '' : ' (firmware differs from library, left alone)'));
    });
  });
}, REBOOT_MS);
