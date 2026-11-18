// Probe one port for the accelerometer (MMA8452Q, I2C) and the SD card module (SPI). No libraries, no bitwise operators.
var tessel = require('tessel');
var PORT = 'B';
var port = tessel.port[PORT];
function say(m) { console.log('probe[' + PORT + ']: ' + m); }
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push(hex2(b[i])); return s.join(' '); }

function i2c(addr, tx, n, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 800);
  try { port.I2C(addr).transfer(new Buffer(tx), n, function (e, rx) { if (done) return; done = true; clearTimeout(t); cb(e, rx); }); }
  catch (e) { if (!done) { done = true; clearTimeout(t); cb(e); } }
}
function i2cSend(addr, bytes, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 800);
  try { port.I2C(addr).send(new Buffer(bytes), function (e) { if (done) return; done = true; clearTimeout(t); cb(e); }); }
  catch (e) { if (!done) { done = true; clearTimeout(t); cb(e); } }
}
function signed12(msb, lsb) { var v = Math.floor((msb * 256 + lsb) / 16); return v >= 2048 ? v - 4096 : v; }

function accel(next) {
  var addrs = [0x1D, 0x1C], ai = 0;
  (function tryAddr() {
    if (ai >= addrs.length) { say('accel: no WHO_AM_I reply at 0x1d or 0x1c'); return next(false); }
    var a = addrs[ai++];
    i2c(a, [0x0D], 1, function (err, rx) {
      if (err || !rx || !rx.length) return tryAddr();
      say('accel: @0x' + hex2(a) + ' WHO_AM_I = 0x' + hex2(rx[0]) + (rx[0] === 0x2A ? '  => MMA8452Q ACCELEROMETER' : '  (unexpected)'));
      if (rx[0] !== 0x2A) return next(false);
      i2cSend(a, [0x2A, 0x01], function () {                      // CTRL_REG1: active
        setTimeout(function () {
          i2c(a, [0x01], 6, function (err, d) {
            if (err || !d || d.length < 6) { say('accel: read failed ' + err); return next(true); }
            say('accel: x=' + (signed12(d[0], d[1]) / 1024).toFixed(3) + ' g  y=' + (signed12(d[2], d[3]) / 1024).toFixed(3) + ' g  z=' + (signed12(d[4], d[5]) / 1024).toFixed(3) + ' g');
            next(true);
          });
        }, 200);
      });
    });
  })();
}

function sd(next) {
  var spi;
  try { spi = new port.SPI({ clockSpeed: 200000 }); } catch (e) { say('sd: SPI unavailable ' + e); return next(false); }
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; say('sd: SPI timeout'); next(false); } }, 4000);
  var wake = new Buffer([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
  spi.transfer(wake, function (e1) {
    if (done) return;
    var cmd0 = new Buffer([0x40, 0x00, 0x00, 0x00, 0x00, 0x95, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    spi.transfer(cmd0, function (e2, rx) {
      if (done) return; done = true; clearTimeout(t);
      if (e1 || e2 || !rx) { say('sd: SPI error ' + (e1 || e2)); return next(false); }
      var r1 = -1;
      for (var i = 6; i < rx.length; i++) if (rx[i] !== 0xFF) { r1 = rx[i]; break; }
      say('sd: CMD0 response bytes ' + hex(rx));
      if (r1 === 0x01) { say('sd: R1=0x01 (idle) => SD CARD MODULE with a card present'); return next(true); }
      say('sd: no idle response (' + (r1 < 0 ? 'bus all 0xFF: no card or no SD module on this port' : 'R1=0x' + hex2(r1)) + ')');
      next(false);
    });
  });
}

accel(function (a) { sd(function (s) {
  say('RESULT ' + (a ? 'accelerometer ' : '') + (s ? 'sd-card ' : '') + ((a || s) ? '' : 'neither'));
  setTimeout(function () { process.exit(0); }, 300);
}); });
