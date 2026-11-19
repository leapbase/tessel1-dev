// VC0706 camera over UART (raw-camera-photo.js, no module library, no bitwise operators).
// capture(port, sink, cb): powers the camera, grabs one JPEG, streams it to sink.write(chunk, cb(err)) in 128-byte chunks,
// powers the camera off again. On any error: sink.abort() is called and cb(err) follows. A hung camera times out (3 s per command).
var CHUNK = 128;
var DELAY = 10;                      // read delay field, units of 0.01 ms
var uarts = [];                      // [{port, uart, rx}]: one UART object per port, its data handler installed once

function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push((b[i] < 16 ? '0' : '') + b[i].toString(16)); return s.join(' '); }
function hi(n) { return Math.floor(n / 256) % 256; }
function lo(n) { return n % 256; }
function okReply(r, id) { return r.length >= 4 && r[0] === 0x76 && r[1] === 0x00 && r[2] === id && r[3] === 0x00; }

function unit(port) {
  for (var i = 0; i < uarts.length; i++) if (uarts[i].port === port) return uarts[i];
  var u = { port: port, uart: port.UART({ baudrate: 115200 }), rx: new Buffer(0) };
  u.uart.on('data', function (d) { u.rx = Buffer.concat([u.rx, d]); });
  uarts.push(u);
  return u;
}

// Send a command and wait for n reply bytes.
function cmd(u, bytes, n, cb) {
  u.rx = new Buffer(0);
  u.uart.write(new Buffer(bytes));
  var t0 = Date.now();
  var poll = setInterval(function () {
    if (u.rx.length >= n) { clearInterval(poll); cb(null, u.rx.slice(0, n)); }
    else if (Date.now() - t0 > 3000) { clearInterval(poll); cb(new Error('camera timeout, got ' + u.rx.length + '/' + n + ' bytes: ' + hex(u.rx))); }
  }, 20);
}

exports.capture = function (port, sink, cb) {
  var u;
  try { u = unit(port); port.digital[2].output().high(); } catch (e) { sink.abort(); return cb(e); }

  function done(e, total) {
    cmd(u, [0x56, 0x00, 0x36, 0x01, 0x03], 5, function () {          // resume frame capture
      try { port.digital[2].output().low(); } catch (x) {}           // camera power off
      if (e) { sink.abort(); return cb(e); }
      cb(null, total);
    });
  }

  setTimeout(function () {                                           // camera boot time
    cmd(u, [0x56, 0x00, 0x11, 0x00], 16, function (e, r) {
      if (e || !okReply(r, 0x11)) return done(e || new Error('no version reply: ' + hex(r)));
      cmd(u, [0x56, 0x00, 0x36, 0x01, 0x00], 5, function (e2, r2) {            // freeze the image
        if (e2 || !okReply(r2, 0x36)) return done(e2 || new Error('stop frame: ' + hex(r2)));
        cmd(u, [0x56, 0x00, 0x34, 0x01, 0x00], 9, function (e3, r3) {         // JPEG length
          if (e3 || !okReply(r3, 0x34)) return done(e3 || new Error('get length: ' + hex(r3)));
          var total = ((r3[5] * 256 + r3[6]) * 256 + r3[7]) * 256 + r3[8];
          if (total < 100 || total > 200000) return done(new Error('implausible JPEG length ' + total));
          var got = 0;
          (function next() {
            if (got >= total) return done(null, total);
            var n = Math.min(CHUNK, total - got);
            var c = [0x56, 0x00, 0x32, 0x0C, 0x00, 0x0A, 0x00, 0x00, hi(got), lo(got), 0x00, 0x00, hi(n), lo(n), hi(DELAY), lo(DELAY)];
            cmd(u, c, n + 10, function (e4, r4) {
              if (e4 || !okReply(r4, 0x32)) return done(e4 || new Error('read at ' + got + ': ' + hex(r4.slice(0, 12))));
              sink.write(r4.slice(5, 5 + n), function (we) {
                if (we) return done(we);
                got += n;
                next();
              });
            });
          })();
        });
      });
    });
  }, 1500);
};
