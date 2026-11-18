// Si7005 climate module check, NO module library and NO bitwise operators.
// The chip ignores I2C until its active-low chip-select (digital[0] on the module) is pulled low.
// Reads the ID register, then one temperature and one humidity measurement.
var tessel = require('tessel');
var PORT = 'D';
var ADDR = 0x40;
function say(m) { console.log('climate: ' + m); }
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function die(m) { say('RESULT FAIL: ' + m); setTimeout(function () { process.exit(1); }, 300); }

var port = tessel.port[PORT];
port.digital[0].output().low();            // chip select, active low
var i2c = port.I2C(ADDR);

function read(tx, n, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 1500);
  i2c.transfer(new Buffer(tx), n, function (err, rx) { if (done) return; done = true; clearTimeout(t); cb(err, rx); });
}
function write(bytes, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 1500);
  i2c.send(new Buffer(bytes), function (err) { if (done) return; done = true; clearTimeout(t); cb(err); });
}

// Start a conversion (config reg 0x03: 0x01 = start humidity, 0x11 = start temperature), wait for ready, return raw 16-bit.
function measure(cfg, cb) {
  write([0x03, cfg], function (err) {
    if (err) return cb(err);
    var tries = 0;
    (function poll() {
      read([0x00], 1, function (err, st) {
        if (err) return cb(err);
        if (st[0] % 2 === 0) {             // bit 0 = /RDY, 0 means ready
          return read([0x01], 2, function (err, d) { cb(err, d && d[0] * 256 + d[1]); });
        }
        if (++tries > 40) return cb(new Error('conversion never became ready'));
        setTimeout(poll, 20);
      });
    })();
  });
}

setTimeout(function () {
  read([0x11], 1, function (err, id) {
    if (err) return die('no reply at 0x40 on port ' + PORT + ' even with chip select low: ' + err);
    say('ID register 0x11 = 0x' + hex2(id[0]) + ' (Si7005 reads 0x50)');
    if (id[0] !== 0x50) say('WARNING: unexpected ID, continuing anyway');
    measure(0x11, function (err, rawT) {
      if (err) return die('temperature: ' + err);
      var tC = (rawT / 4) / 32 - 50;
      say('temperature = ' + tC.toFixed(2) + ' C  (' + (tC * 9 / 5 + 32).toFixed(1) + ' F)  raw=' + rawT);
      measure(0x01, function (err, rawH) {
        if (err) return die('humidity: ' + err);
        var rh = (rawH / 16) / 16 - 24;
        var lin = rh - (rh * rh * -0.00393 + rh * 0.4008 + -4.7844);
        say('humidity = ' + lin.toFixed(1) + ' %RH  raw=' + rawH);
        say('RESULT OK');
        setTimeout(function () { process.exit(0); }, 300);
      });
    });
  });
}, 300);
