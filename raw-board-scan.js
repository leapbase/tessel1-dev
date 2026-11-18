// Identify what is plugged into one Tessel 1 port. No module libraries, no bitwise operators.
// Checks: (1) I2C address scan, (2) Si7005 climate with chip select low, (3) UART @115200: GPS (SiRF frames A0 A2)
// and camera (VC0706 version reply 76 00 11 00). Edit PORT, or use the loop in the README to run A-D.
var tessel = require('tessel');
var PORT = 'A';
var port = tessel.port[PORT];
var found = [];
function say(m) { console.log('scan[' + PORT + ']: ' + m); }
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push(hex2(b[i])); return s.join(' '); }

function i2cRead(addr, tx, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 250);
  try {
    port.I2C(addr).transfer(new Buffer(tx), 1, function (err, rx) {
      if (done) return; done = true; clearTimeout(t); cb(err, rx && rx.length ? rx[0] : null);
    });
  } catch (e) { if (!done) { done = true; clearTimeout(t); cb(e); } }
}

function stepI2C(next) {
  var hits = [];
  (function probe(a) {
    if (a > 0x77) { say('I2C devices: ' + (hits.length ? hits.join(' ') : 'none')); return next(hits); }
    i2cRead(a, [0x00], function (err, v) {
      if (!err && v !== null) hits.push('0x' + hex2(a) + '(=0x' + hex2(v) + ')');
      probe(a + 1);
    });
  })(0x08);
}

function stepClimate(next) {
  try { port.digital[0].output().low(); } catch (e) { say('climate: pin exception ' + e); return next(); }
  setTimeout(function () {
    i2cRead(0x40, [0x11], function (err, v) {
      if (!err && v !== null) {
        say('climate: @0x40 ID reg 0x11 = 0x' + hex2(v) + (v === 0x50 ? '  => Si7005 CLIMATE MODULE' : '  (not Si7005)'));
        if (v === 0x50) found.push('climate');
      } else say('climate: no reply at 0x40 with CS low');
      next();
    });
  }, 200);
}

function stepUART(next) {
  var uart, got = [], text = new Buffer(0);
  try { uart = port.UART({ baudrate: 115200 }); } catch (e) { say('uart: unavailable (' + e + ')'); return next(); }
  try { port.digital[2].output().high(); } catch (e) {}
  uart.on('data', function (d) { text = Buffer.concat([text, d]); });
  setTimeout(function () {                              // passive listen: GPS streams on its own
    var sirf = 0;
    for (var i = 0; i + 1 < text.length; i++) if (text[i] === 0xA0 && text[i + 1] === 0xA2) sirf++;
    say('uart: passive listen got ' + text.length + ' bytes, ' + sirf + ' SiRF frame starts');
    if (sirf > 3) { say('uart: => A2235-H GPS MODULE (SiRF binary)'); found.push('gps'); }
    text = new Buffer(0);
    uart.write(new Buffer([0x56, 0x00, 0x11, 0x00]));   // camera "get version"
    setTimeout(function () {
      if (text.length >= 5 && text[0] === 0x76 && text[1] === 0x00 && text[2] === 0x11) {
        say('uart: camera reply ' + hex(text.slice(0, 5)) + ' text="' + text.slice(5).toString() + '"  => VC0706 CAMERA MODULE');
        found.push('camera');
      } else if (sirf <= 3) say('uart: no camera reply (' + text.length + ' bytes)');
      next();
    }, 1500);
  }, 2000);
}

stepI2C(function (hits) {
  var servo = false;
  for (var i = 0; i < hits.length; i++) if (hits[i].indexOf('0x70') === 0) servo = true;
  if (servo) found.push('servo? (0x70 all-call)');
  stepClimate(function () {
    stepUART(function () {
      say('RESULT ' + (found.length ? found.join(', ') : 'nothing recognized') );
      setTimeout(function () { process.exit(0); }, 300);
    });
  });
});
