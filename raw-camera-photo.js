// Take a JPEG with the VC0706 camera over UART, with NO module library and NO bitwise operators
// (this board's runtime crashes on them). Camera is on port B. Run: tessel run raw-camera-photo.js
var tessel = require('tessel');
var PORT = 'B';
var CHUNK = 128;                 // bytes requested per read
var DELAY = 10;                  // read delay field (units of 0.01 ms), as in the VC0706 protocol

function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push((b[i] < 16 ? '0' : '') + b[i].toString(16)); return s.join(' '); }
function hi(n) { return Math.floor(n / 256) % 256; }
function lo(n) { return n % 256; }
function say(m) { console.log('photo: ' + m); }
function fail(m) { say('RESULT FAIL: ' + m); setTimeout(function () { process.exit(1); }, 300); }

var port = tessel.port[PORT];
var uart = port.UART({ baudrate: 115200 });
port.digital[2].output().high();           // camera power
var rx = new Buffer(0);
uart.on('data', function (d) { rx = Buffer.concat([rx, d]); });

// Send a command and wait for `n` reply bytes (or time out).
function cmd(bytes, n, cb) {
  rx = new Buffer(0);
  uart.write(new Buffer(bytes));
  var t0 = Date.now();
  var poll = setInterval(function () {
    if (rx.length >= n) { clearInterval(poll); var out = rx.slice(0, n); cb(null, out); }
    else if (Date.now() - t0 > 3000) { clearInterval(poll); cb(new Error('timeout, got ' + rx.length + '/' + n + ' bytes: ' + hex(rx))); }
  }, 20);
}
function ok(r, id) { return r.length >= 4 && r[0] === 0x76 && r[1] === 0x00 && r[2] === id && r[3] === 0x00; }

setTimeout(function () {
  say('version check');
  cmd([0x56, 0x00, 0x11, 0x00], 16, function (err, r) {
    if (err || !ok(r, 0x11)) return fail('no version reply: ' + (err || hex(r)));
    say('camera: ' + r.slice(5).toString());

    say('stop frame (freeze current image)');
    cmd([0x56, 0x00, 0x36, 0x01, 0x00], 5, function (err, r) {
      if (err || !ok(r, 0x36)) return fail('stop frame: ' + (err || hex(r)));

      say('get JPEG length');
      cmd([0x56, 0x00, 0x34, 0x01, 0x00], 9, function (err, r) {
        if (err || !ok(r, 0x34)) return fail('get length: ' + (err || hex(r)));
        var total = ((r[5] * 256 + r[6]) * 256 + r[7]) * 256 + r[8];
        say('JPEG length = ' + total + ' bytes');
        if (total < 100 || total > 200000) return fail('implausible length ' + total);

        var jpeg = new Buffer(total), got = 0;
        (function next() {
          if (got >= total) return done();
          var n = Math.min(CHUNK, total - got);
          // 56 00 32 0C 00 0A 00 00 <addr hi> <addr lo> 00 00 <len hi> <len lo> <delay hi> <delay lo>
          var c = [0x56, 0x00, 0x32, 0x0C, 0x00, 0x0A, 0x00, 0x00, hi(got), lo(got), 0x00, 0x00, hi(n), lo(n), hi(DELAY), lo(DELAY)];
          cmd(c, n + 10, function (err, r) {
            if (err || !ok(r, 0x32)) return fail('read at ' + got + ': ' + (err || hex(r.slice(0, 12))));
            r.copy(jpeg, got, 5, 5 + n);
            got += n;
            next();
          });
        })();

        function done() {
          var startOk = jpeg[0] === 0xFF && jpeg[1] === 0xD8;
          var endOk = jpeg[total - 2] === 0xFF && jpeg[total - 1] === 0xD9;
          say('read ' + got + ' bytes; JPEG start marker ' + (startOk ? 'OK' : 'BAD') + ', end marker ' + (endOk ? 'OK' : 'BAD'));
          cmd([0x56, 0x00, 0x36, 0x01, 0x03], 5, function () {      // resume frame capture
            if (!startOk) return fail('data is not a JPEG: first bytes ' + hex(jpeg.slice(0, 8)));
            process.sendfile('camera-photo.jpg', jpeg);
            say('RESULT OK: sent camera-photo.jpg (' + total + ' bytes) to host');
            setTimeout(function () { process.exit(0); }, 2000);
          });
        }
      });
    });
  });
}, 1500);
