// SD card module check, NO module library and NO bitwise operators.
// The module wires chip select to pin G1 (driven by hand) and card-detect to G2 (low = card present).
// Sequence per the SD spec: CS high + >=74 clocks, then CS low and CMD0 (expect R1=0x01), then CMD8 (expect echo 01 AA).
var tessel = require('tessel');
var PORT = 'B';
var port = tessel.port[PORT];
function say(m) { console.log('sd[' + PORT + ']: ' + m); }
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push(hex2(b[i])); return s.join(' '); }
function finish(msg) { say('RESULT ' + msg); setTimeout(function () { process.exit(0); }, 300); }

var csn = port.pin['G1'];
var ppn = port.pin['G2'];
csn.output(true);                         // CS high (deselected)
ppn.input();

function firstNon(rx, from) { for (var i = from; i < rx.length; i++) if (rx[i] !== 0xFF) return i; return -1; }

function detect(cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; say('card-detect read timeout'); cb(null); } }, 1000);
  try { ppn.read(function (err, v) { if (done) return; done = true; clearTimeout(t); cb(err ? null : v); }); }
  catch (e) { if (!done) { done = true; clearTimeout(t); say('card-detect exception ' + e); cb(null); } }
}

detect(function (v) {
  say('card-detect G2 = ' + v + (v === 0 ? ' (LOW: card present)' : v === 1 ? ' (HIGH: no card / no SD module)' : ' (unreadable)'));
  var spi;
  try { spi = new port.SPI({ clockSpeed: 200000 }); } catch (e) { return finish('SPI unavailable: ' + e); }
  var guard = setTimeout(function () { finish('SPI timeout'); }, 6000);
  var wake = new Buffer([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
  csn.output(true);
  spi.transfer(wake, function () {
    csn.output(false);                                              // select card
    var cmd0 = new Buffer([0x40, 0x00, 0x00, 0x00, 0x00, 0x95, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    spi.transfer(cmd0, function (e, rx) {
      csn.output(true);
      if (e || !rx) { clearTimeout(guard); return finish('CMD0 error ' + e); }
      say('CMD0 bytes ' + hex(rx));
      var i = firstNon(rx, 6), r1 = i < 0 ? -1 : rx[i];
      if (r1 !== 0x01) { clearTimeout(guard); return finish(r1 < 0 ? 'no response to CMD0 (bus all FF)' : 'unexpected R1=0x' + hex2(r1)); }
      say('CMD0 R1=0x01 (card is in idle state)');
      spi.transfer(new Buffer([0xFF]), function () {
        csn.output(false);
        var cmd8 = new Buffer([0x48, 0x00, 0x00, 0x01, 0xAA, 0x87, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
        spi.transfer(cmd8, function (e2, rx2) {
          csn.output(true); clearTimeout(guard);
          if (e2 || !rx2) return finish('SD CARD RESPONDED to CMD0 (CMD8 error ' + e2 + ')');
          say('CMD8 bytes ' + hex(rx2));
          var j = firstNon(rx2, 6);
          if (j >= 0 && rx2[j] === 0x01 && rx2[j + 3] === 0x01 && rx2[j + 4] === 0xAA) finish('SD CARD MODULE OK (CMD8 echoed 01 AA: SD v2 card, 3.3V)');
          else if (j >= 0 && rx2[j] === 0x05) finish('SD CARD MODULE OK (CMD8 rejected as illegal: older v1 card)');
          else finish('SD CARD RESPONDED to CMD0 (CMD8 reply unclear)');
        });
      });
    });
  });
});
