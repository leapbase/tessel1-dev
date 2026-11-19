// SPI SD card driver for a Tessel 1 module port: block device for fat32.js. Lifted from the working raw-sd-write.js.
// Chip select = pin G1 (driven by hand), card detect = pin G2 (low = card present). SDHC/SDXC and SDSC cards.
// ES5, no bitwise operators. Errors carry .code: NO_CARD, INIT, IO.
function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
function toArr(b) { var a = []; for (var i = 0; i < b.length; i++) a.push(b[i]); return a; }
function ff(n) { var a = []; for (var i = 0; i < n; i++) a.push(0xFF); return a; }
function argBytes(v) { return [Math.floor(v / 16777216) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256]; }

// open(port, cb(err, dev)); dev.read(lba, cb(err, Buffer512)), dev.write(lba, Buffer512, cb(err)), dev.sdhc
exports.open = function (port, cb) {
  var csn = port.pin['G1'], ppn = port.pin['G2'];
  csn.output(true);
  ppn.input();
  var spi = null, sdhc = false;

  function xfer(bytes, done) {
    var finished = false;
    var t = setTimeout(function () { if (!finished) { finished = true; done(err('IO', 'SPI timeout')); } }, 3000);
    spi.transfer(new Buffer(bytes), function (e, rx) {
      if (finished) return;
      finished = true; clearTimeout(t);
      done(e ? err('IO', String(e.message || e)) : null, rx ? toArr(rx) : null);
    });
  }

  function command(idx, arg, crc, done) {
    csn.output(true);
    xfer([0xFF], function () {
      csn.output(false);
      xfer([0x40 + idx].concat(argBytes(arg), [crc], ff(14)), function (e, rx) {
        if (e || !rx) return done(e || err('IO', 'no data'));
        var i = 6; while (i < rx.length && rx[i] === 0xFF) i++;
        if (i >= rx.length) return done(err('IO', 'no response to CMD' + idx));
        done(null, rx[i], rx.slice(i + 1));
      });
    });
  }

  function init(done) {
    csn.output(true);
    xfer(ff(20), function () {                                   // >= 74 clocks with CS high
      command(0, 0, 0x95, function (e, r1) {
        if (e || r1 !== 0x01) return done(err('INIT', 'CMD0 failed'));
        command(8, 0x1AA, 0x87, function (e8) {
          if (e8) return done(err('INIT', 'CMD8 failed'));
          var tries = 0;
          (function acmd41() {
            command(55, 0, 0xFF, function (e55) {
              if (e55) return done(err('INIT', 'CMD55 failed'));
              command(41, 0x40000000, 0xFF, function (e41, r) {
                if (e41) return done(err('INIT', 'ACMD41 failed'));
                if (r === 0x00) {
                  return command(58, 0, 0xFF, function (e58, r58, rest) {
                    if (e58) return done(err('INIT', 'CMD58 failed'));
                    sdhc = rest[0] >= 0xC0;
                    done(null);
                  });
                }
                if (++tries > 100) return done(err('INIT', 'card never left idle'));
                setTimeout(acmd41, 30);
              });
            });
          })();
        });
      });
    });
  }

  function readBlock(lba, done) {
    var addr = sdhc ? lba : lba * 512;
    csn.output(true);
    xfer([0xFF], function () {
      csn.output(false);
      xfer([0x51].concat(argBytes(addr), [0xFF], ff(10)), function (e, rx) {
        if (e || !rx) return done(e || err('IO', 'no data'));
        var i = 6; while (i < rx.length && rx[i] === 0xFF) i++;
        if (i >= rx.length || rx[i] !== 0x00) { csn.output(true); return done(err('IO', 'CMD17 failed at block ' + lba)); }
        var stream = rx.slice(i + 1), polls = 0;
        (function pump() {
          var p = -1;
          for (var k = 0; k < stream.length; k++) if (stream[k] === 0xFE) { p = k; break; }
          if (p >= 0 && stream.length >= p + 1 + 514) { csn.output(true); return done(null, new Buffer(stream.slice(p + 1, p + 513))); }
          if (++polls > 40) { csn.output(true); return done(err('IO', 'no data token for block ' + lba)); }
          xfer(ff(64), function (e2, more) {
            if (e2 || !more) { csn.output(true); return done(e2 || err('IO', 'no data')); }
            stream = stream.concat(more); pump();
          });
        })();
      });
    });
  }

  function writeBlock(lba, data, done) {
    if (data.length !== 512) return done(err('IO', 'block must be 512 bytes'));
    var addr = sdhc ? lba : lba * 512;
    csn.output(true);
    xfer([0xFF], function () {
      csn.output(false);
      xfer([0x58].concat(argBytes(addr), [0xFF], ff(10)), function (e, rx) {
        if (e || !rx) return done(e || err('IO', 'no data'));
        var i = 6; while (i < rx.length && rx[i] === 0xFF) i++;
        if (i >= rx.length || rx[i] !== 0x00) { csn.output(true); return done(err('IO', 'CMD24 rejected at block ' + lba)); }
        xfer([0xFF, 0xFE].concat(toArr(data), [0xFF, 0xFF], ff(2)), function (e2, rx2) {
          if (e2 || !rx2) { csn.output(true); return done(e2 || err('IO', 'no data')); }
          if (rx2[516] % 32 !== 5) { csn.output(true); return done(err('IO', 'write rejected, data response ' + rx2[516])); }
          var polls = 0;
          (function busy() {
            xfer(ff(8), function (e3, r3) {
              if (e3 || !r3) { csn.output(true); return done(e3 || err('IO', 'no data')); }
              if (r3[r3.length - 1] === 0xFF) { csn.output(true); return xfer([0xFF], function () { done(null); }); }
              if (++polls > 60) { csn.output(true); return done(err('IO', 'card stayed busy after write to block ' + lba)); }
              busy();
            });
          })();
        });
      });
    });
  }

  // Card detect: low = present.
  var finished = false;
  var dt = setTimeout(function () { if (!finished) { finished = true; cb(err('IO', 'card detect timeout')); } }, 1000);
  ppn.read(function (e, v) {
    if (finished) return;
    finished = true; clearTimeout(dt);
    if (e) return cb(err('IO', 'card detect failed'));
    if (v !== 0) return cb(err('NO_CARD', 'no card in the SD module'));
    try { spi = new port.SPI({ clockSpeed: 200000 }); } catch (ex) { return cb(err('IO', 'SPI unavailable: ' + ex)); }
    init(function (ie) {
      if (ie) return cb(ie);
      cb(null, { read: readBlock, write: writeBlock, sdhc: sdhc });
    });
  });
};
