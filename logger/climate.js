// Si7005 climate module over I2C (raw-climate-test.js, no module library, no bitwise operators).
// The chip ignores I2C until its active-low chip select (digital[0] on the module) is held low.
var ADDR = 0x40;
var units = [];            // [{port, i2c}] cache: the I2C object is created once per port

function unit(port) {
  for (var i = 0; i < units.length; i++) if (units[i].port === port) return units[i];
  port.digital[0].output().low();
  var u = { port: port, i2c: port.I2C(ADDR) };
  units.push(u);
  return u;
}

function guarded(start, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 1500);
  start(function (e, v) { if (done) return; done = true; clearTimeout(t); cb(e, v); });
}
function readReg(u, tx, n, cb) { guarded(function (d) { u.i2c.transfer(new Buffer(tx), n, d); }, cb); }
function writeReg(u, bytes, cb) { guarded(function (d) { u.i2c.send(new Buffer(bytes), d); }, cb); }

// Start a conversion (config reg 0x03: 0x01 humidity, 0x11 temperature), wait until ready, return the raw 16-bit value.
function measure(u, cfg, cb) {
  writeReg(u, [0x03, cfg], function (e) {
    if (e) return cb(e);
    var tries = 0;
    (function poll() {
      readReg(u, [0x00], 1, function (e2, st) {
        if (e2) return cb(e2);
        if (st[0] % 2 === 0) return readReg(u, [0x01], 2, function (e3, d) { cb(e3, d && d[0] * 256 + d[1]); });
        if (++tries > 40) return cb(new Error('conversion never became ready'));
        setTimeout(poll, 20);
      });
    })();
  });
}

// read(port, cb(err, {tempC, humidity}))
exports.read = function (port, cb) {
  var u;
  try { u = unit(port); } catch (e) { return cb(e); }
  setTimeout(function () {                                   // chip select needs a moment to take effect
    measure(u, 0x11, function (e, rawT) {
      if (e) return cb(e);
      measure(u, 0x01, function (e2, rawH) {
        if (e2) return cb(e2);
        var tempC = (rawT / 4) / 32 - 50;
        var rh = (rawH / 16) / 16 - 24;
        var humidity = rh - (rh * rh * -0.00393 + rh * 0.4008 + -4.7844);   // datasheet linearisation, no temperature compensation
        cb(null, { tempC: tempC, humidity: humidity });
      });
    });
  }, 300);
};
