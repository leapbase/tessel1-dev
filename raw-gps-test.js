// Raw GPS check with NO module library, on port D (found by probing; the A2235-H streams SiRF binary at 115200 baud).
// Frames: A0 A2 <len16> <payload> <csum16> B0 B3. Payload[0] is the message ID.
// ID 0x29 = geodetic nav data (nav-valid == 0 means a good fix). ID 0x04 = tracker data (per-satellite C/N0).
var tessel = require('tessel');
var PORT = 'D';
var LISTEN_MS = 8000;

console.log('raw-gps: port ' + PORT + ' @115200, listening ' + (LISTEN_MS / 1000) + 's');
var uart = tessel.port[PORT].UART({ baudrate: 115200 });
var buf = [], frames = 0, ids = {}, navValid = null, maxCn0 = 0, sats = 0, bytes = 0;

function handle(p) {
  var id = p[0];
  ids[id] = (ids[id] || 0) + 1;
  if (id === 0x29 && p.length >= 3) navValid = p[1] * 256 + p[2];
  if (id === 0x04 && p.length >= 8) {
    var nch = p[7], base = 8, seen = 0;
    for (var c = 0; c < nch && base + 15 <= p.length; c++, base += 15) {
      var best = 0;
      for (var k = 0; k < 10; k++) if (p[base + 5 + k] > best) best = p[base + 5 + k];
      if (best > 0) seen++;
      if (best > maxCn0) maxCn0 = best;
    }
    if (seen > sats) sats = seen;
  }
}

uart.on('data', function (d) {
  bytes += d.length;
  for (var i = 0; i < d.length; i++) buf.push(d[i]);
  // extract complete frames
  for (;;) {
    var s = -1;
    for (var j = 0; j + 1 < buf.length; j++) if (buf[j] === 0xA0 && buf[j + 1] === 0xA2) { s = j; break; }
    if (s < 0) { if (buf.length > 1) buf = buf.slice(buf.length - 1); return; }
    if (s > 0) buf = buf.slice(s);
    if (buf.length < 4) return;
    var len = buf[2] * 256 + buf[3];
    if (buf.length < 8 + len) return;
    if (buf[6 + len] === 0xB0 && buf[7 + len] === 0xB3) { frames++; handle(buf.slice(4, 4 + len)); }
    buf = buf.slice(8 + len);
  }
});

setTimeout(function () {
  var idList = [];
  for (var k in ids) idList.push('0x' + Number(k).toString(16) + 'x' + ids[k]);
  console.log('raw-gps: bytes=' + bytes + ' valid frames=' + frames);
  console.log('raw-gps: message IDs: ' + (idList.join(', ') || 'none'));
  console.log('raw-gps: nav-valid=' + (navValid === null ? 'n/a' : navValid) + ' (0 = fix)');
  console.log('raw-gps: satellites with signal=' + sats + ', best C/N0=' + maxCn0);
  console.log('raw-gps: RESULT ' + (frames > 0 ? 'GPS CHIP ALIVE' : 'NO VALID SIRF FRAMES') +
              (frames > 0 ? (navValid === 0 ? ', HAS FIX' : ', no fix yet') : ''));
  process.exit(0);
}, LISTEN_MS);
