// SPI SD card driver for a Tessel 1 module port: block device for fat32.js. Lifted from the working raw-sd-write.js.
// Chip select = pin G1 (driven by hand), card detect = pin G2 (low = card present). SDHC/SDXC and SDSC cards.
// ES5, no bitwise operators. Errors carry .code: NO_CARD, INIT, IO.
// Speed: on the board the JavaScript between SPI transfers costs far more than the transfers themselves (profiled:
// ~83% of a block read), so read/write use Buffers and a few large transfers instead of arrays and many small ones.
function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
function ff(n) { var a = []; for (var i = 0; i < n; i++) a.push(0xFF); return a; }
function argBytes(v) { return [Math.floor(v / 16777216) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256]; }
// Buffer of n bytes, all 0xFF
function ffBuf(n) { var b = new Buffer(n); b.fill(0xFF); return b; }
// First index in [from, to) of buf that is not 0xFF, or -1
function firstNonFF(buf, from, to) { for (var i = from; i < to && i < buf.length; i++) if (buf[i] !== 0xFF) return i; return -1; }

var spiCache = [];   // [{port, spi}]: one SPI object per port, reused when the card is re-opened after an error

// open(port, cb(err, dev)); dev.read(lba, cb(err, Buffer512)), dev.write(lba, Buffer512, cb(err)), dev.sdhc, dev.stats
exports.open = function (port, cb) {
  var csn = port.pin['G1'], ppn = port.pin['G2'];
  csn.output(true);
  ppn.input();
  var spi = null, sdhc = false;
  var stats = { xfers: 0, xferMs: 0 };         // diagnostics: SPI transfers made and time spent waiting for them

  // tx: Buffer or array of bytes. Calls back with the received Buffer.
  function xfer(tx, done) {
    var finished = false;
    var t = setTimeout(function () { if (!finished) { finished = true; done(err('IO', 'SPI timeout')); } }, 3000);
    var t0 = Date.now();
    spi.transfer(typeof tx.copy === 'function' ? tx : new Buffer(tx), function (e, rx) {
      if (finished) return;
      finished = true; clearTimeout(t);
      stats.xfers++; stats.xferMs += Date.now() - t0;
      done(e ? err('IO', String(e.message || e)) : null, rx || null);
    });
  }

  function command(idx, arg, crc, done) {
    csn.output(true);
    xfer([0xFF], function () {
      csn.output(false);
      xfer([0x40 + idx].concat(argBytes(arg), [crc], ff(14)), function (e, rx) {
        if (e || !rx) return done(e || err('IO', 'no data'));
        var i = firstNonFF(rx, 6, rx.length);
        if (i < 0) return done(err('IO', 'no response to CMD' + idx));
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

  // One transfer carries the command, the R1 response, the data token and the 512 data bytes: the response comes within
  // 8 bytes of the command and the token within ~64, so 6 + 64 + 514 bytes always contain the whole block.
  var READ_WINDOW = 6 + 64 + 514;
  function readBlock(lba, done) {
    var addr = sdhc ? lba : lba * 512;
    csn.output(true);
    xfer([0xFF], function () {
      csn.output(false);
      var tx = ffBuf(READ_WINDOW), a = argBytes(addr);
      tx[0] = 0x51; tx[1] = a[0]; tx[2] = a[1]; tx[3] = a[2]; tx[4] = a[3]; tx[5] = 0xFF;
      xfer(tx, function (e, rx) {
        if (e || !rx) { csn.output(true); return done(e || err('IO', 'no data')); }
        var r = firstNonFF(rx, 6, 6 + 10);
        if (r < 0 || rx[r] !== 0x00) { csn.output(true); return done(err('IO', 'CMD17 failed at block ' + lba)); }
        var token = -1;
        for (var k = r + 1; k < 6 + 64 && k < rx.length; k++) if (rx[k] === 0xFE) { token = k; break; }
        if (token < 0 || rx.length < token + 1 + 514) {
          // The card is slow to start the block: drain it with clocks, then report the failure (the caller re-mounts).
          return xfer(ffBuf(600), function () { csn.output(true); done(err('IO', 'no data token for block ' + lba)); });
        }
        csn.output(true);
        // A PRIVATE copy: rx.slice() is a view of the transfer buffer, which the runtime reclaims and reuses. The fat32 writer
        // caches FAT sectors for minutes, and a cached view turned into garbage that was written back over both FATs.
        var block = new Buffer(512);
        rx.copy(block, 0, token + 1, token + 513);
        done(null, block);
      });
    });
  }

  // Data, CRC and the first bytes of busy polling go out in one transfer; the card holds the line low while it programs.
  function writeBlock(lba, data, done) {
    if (data.length !== 512) return done(err('IO', 'block must be 512 bytes'));
    var addr = sdhc ? lba : lba * 512;
    csn.output(true);
    xfer([0xFF], function () {
      csn.output(false);
      xfer([0x58].concat(argBytes(addr), [0xFF], ff(10)), function (e, rx) {
        if (e || !rx) { csn.output(true); return done(e || err('IO', 'no data')); }
        var i = firstNonFF(rx, 6, rx.length);
        if (i < 0 || rx[i] !== 0x00) { csn.output(true); return done(err('IO', 'CMD24 rejected at block ' + lba)); }
        var tx = ffBuf(2 + 512 + 2 + 2 + 32);                   // FF FE, data, CRC, response slot, busy-poll bytes
        tx[1] = 0xFE;
        data.copy(tx, 2, 0, 512);
        xfer(tx, function (e2, rx2) {
          if (e2 || !rx2) { csn.output(true); return done(e2 || err('IO', 'no data')); }
          if (rx2[516] % 32 !== 5) { csn.output(true); return done(err('IO', 'write rejected, data response ' + rx2[516])); }
          var polls = 0;
          (function busy(last) {
            if (last === 0xFF) { csn.output(true); return done(null); }
            if (++polls > 60) { csn.output(true); return done(err('IO', 'card stayed busy after write to block ' + lba)); }
            xfer(ffBuf(32), function (e3, r3) {
              if (e3 || !r3) { csn.output(true); return done(e3 || err('IO', 'no data')); }
              busy(r3[r3.length - 1]);
            });
          })(rx2[rx2.length - 1]);
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
    for (var i = 0; i < spiCache.length; i++) if (spiCache[i].port === port) spi = spiCache[i].spi;
    if (!spi) {
      try { spi = new port.SPI({ clockSpeed: 200000 }); } catch (ex) { return cb(err('IO', 'SPI unavailable: ' + ex)); }
      spiCache.push({ port: port, spi: spi });
    }
    init(function (ie) {
      if (ie) return cb(ie);
      cb(null, { read: readBlock, write: writeBlock, sdhc: sdhc, stats: stats });
    });
  });
};
