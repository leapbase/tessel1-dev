// Long-running GPS monitor, NO module library and NO bitwise operators (this board's runtime can't run them).
// Port D, SiRF binary @115200. Prints a status line every STATUS_MS; on a valid fix, prints position and exits.
// Run: tessel run raw-gps-monitor.js
var tessel = require('tessel');
var PORT = 'D';
var STATUS_MS = 5000;
var MAX_MS = 600000;
var FIX_READINGS = 5;       // coordinate lines to print after the first fix, then exit
var fixCount = 0, peakCn0 = 0, peakSats = 0;

var uart = tessel.port[PORT].UART({ baudrate: 115200 });
var buf = [], frames = 0, navValid = null, sats = 0, maxCn0 = 0, usedSats = 0, pos = null;
var started = Date.now();

function u(p, i, n) { var v = 0; for (var k = 0; k < n; k++) v = v * 256 + p[i + k]; return v; }
function s32(p, i) { var v = u(p, i, 4); return v >= 2147483648 ? v - 4294967296 : v; }
function pop(v) { var c = 0; while (v > 0) { c += v % 2; v = Math.floor(v / 2); } return c; }

function handle(p) {
  var id = p[0];
  if (id === 0x29 && p.length >= 39) {                // geodetic navigation data
    navValid = u(p, 1, 2);
    usedSats = pop(u(p, 19, 4));
    if (navValid === 0) {
      pos = { lat: s32(p, 23) / 1e7, lon: s32(p, 27) / 1e7, altMSL: s32(p, 35) / 100,
              utc: u(p, 11, 2) + '-' + u(p, 13, 1) + '-' + u(p, 14, 1) + ' ' + u(p, 15, 1) + ':' + u(p, 16, 1) + ':' + (u(p, 17, 2) / 1000) };
    }
  }
  if (id === 0x04 && p.length >= 8) {                 // measured tracker data: 12 channels x 15 bytes
    var nch = p[7], base = 8, seen = 0, best = 0;
    for (var c = 0; c < nch && base + 15 <= p.length; c++, base += 15) {
      var b = 0;
      for (var k = 0; k < 10; k++) if (p[base + 5 + k] > b) b = p[base + 5 + k];
      if (b > 0) seen++;
      if (b > best) best = b;
    }
    sats = seen; maxCn0 = best;
    if (best > peakCn0) peakCn0 = best;
    if (seen > peakSats) peakSats = seen;
  }
}

uart.on('data', function (d) {
  for (var i = 0; i < d.length; i++) buf.push(d[i]);
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

console.log('gpsmon: started, up to ' + (MAX_MS / 1000) + 's, status every ' + (STATUS_MS / 1000) + 's');
var timer = setInterval(function () {
  var t = Math.round((Date.now() - started) / 1000);
  console.log('gpsmon: t=' + t + 's frames=' + frames + ' sats_with_signal=' + sats + ' best_CN0=' + maxCn0 +
              ' sats_used=' + usedSats + ' nav_valid=' + (navValid === null ? 'n/a' : navValid));
  if (pos && navValid === 0) {
    fixCount++;
    console.log('gpsmon: COORDINATES lat=' + pos.lat + ' lon=' + pos.lon + ' alt_msl=' + pos.altMSL + 'm utc=' + pos.utc +
                '  maps: https://maps.google.com/?q=' + pos.lat + ',' + pos.lon);
    if (fixCount >= FIX_READINGS) {
      clearInterval(timer);
      console.log('gpsmon: RESULT FIX, ' + fixCount + ' coordinate readings printed');
      setTimeout(function () { process.exit(0); }, 500);
    }
  } else if (Date.now() - started > MAX_MS) {
    clearInterval(timer);
    console.log('gpsmon: RESULT no fix within ' + (MAX_MS / 1000) + 's; peak satellites ' + peakSats + ', peak C/N0 ' + peakCn0);
    setTimeout(function () { process.exit(0); }, 500);
  }
}, STATUS_MS);
