// List one folder of a FAT32 SD card and (GET = true) print its JPEG files as hex. READ-ONLY on the card.
// Run:  tessel run raw-sd-get.js > out.log, then rebuild the JPEGs from the HEX lines (see the commit that added it).  NO module library, NO bitwise operators.
// Wiring (SD module): chip select = pin G1 (driven by hand), SPI on the module port. Port set below.
var tessel = require('tessel');
var PORT = 'A';
var MAX_ENTRIES = 100;
var port = tessel.port[PORT];
function say(m) { console.log('sdls: ' + m); }
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function finish(m) { say(m); setTimeout(function () { process.exit(0); }, 300); }
function fail(m) { say('ERROR ' + m); try { csn.output(true); } catch (e) {} setTimeout(function () { process.exit(1); }, 300); }

var csn = port.pin['G1'];
csn.output(true);
var spi = new port.SPI({ clockSpeed: 200000 });
var sdhc = false;

function toArr(b) { var a = []; for (var i = 0; i < b.length; i++) a.push(b[i]); return a; }
function ff(n) { var a = []; for (var i = 0; i < n; i++) a.push(0xFF); return a; }
function le16(a, o) { return a[o] + a[o + 1] * 256; }
function le32(a, o) { return a[o] + a[o + 1] * 256 + a[o + 2] * 65536 + a[o + 3] * 16777216; }
function argBytes(v) { return [Math.floor(v / 16777216) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256]; }
function xfer(bytes, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('SPI timeout')); } }, 3000);
  spi.transfer(new Buffer(bytes), function (e, rx) { if (done) return; done = true; clearTimeout(t); cb(e, rx ? toArr(rx) : null); });
}

// Send one command with CS handled by hand. Returns R1 and the bytes after it (for R3/R7).
function command(idx, arg, crc, cb) {
  csn.output(true);
  xfer([0xFF], function () {
    csn.output(false);
    xfer([0x40 + idx].concat(argBytes(arg), [crc], ff(14)), function (e, rx) {
      if (e || !rx) return cb(e || new Error('no data'));
      var i = 6; while (i < rx.length && rx[i] === 0xFF) i++;
      if (i >= rx.length) return cb(new Error('no response to CMD' + idx));
      cb(null, rx[i], rx.slice(i + 1));
    });
  });
}

function init(cb) {
  csn.output(true);
  xfer(ff(10), function () {
    command(0, 0, 0x95, function (e, r1) {
      if (e || r1 !== 0x01) return cb(new Error('CMD0 failed (R1=' + r1 + ' ' + (e || '') + '): no card or not an SD module on this port'));
      command(8, 0x1AA, 0x87, function (e, r1b) {
        if (e) return cb(e);
        var tries = 0;
        (function acmd41() {
          command(55, 0, 0xFF, function (e, r) {
            if (e) return cb(e);
            command(41, 0x40000000, 0xFF, function (e, r) {
              if (e) return cb(e);
              if (r === 0x00) return ocr();
              if (++tries > 60) return cb(new Error('card never left idle (ACMD41 R1=0x' + hex2(r) + ')'));
              setTimeout(acmd41, 30);
            });
          });
        })();
        function ocr() {
          command(58, 0, 0xFF, function (e, r, rest) {
            if (e) return cb(e);
            sdhc = rest[0] >= 0xC0;                     // OCR bits 31 (ready) and 30 (CCS): top byte 0xC0 or more
            say('card ready, ' + (sdhc ? 'SDHC/SDXC (block addressing)' : 'standard capacity (byte addressing)') + ', OCR=' + hex2(rest[0]) + hex2(rest[1]) + hex2(rest[2]) + hex2(rest[3]));
            cb(null);
          });
        }
      });
    });
  });
}

function readBlock(lba, cb) {
  var addr = sdhc ? lba : lba * 512;
  csn.output(true);
  xfer([0xFF], function () {
    csn.output(false);
    xfer([0x51].concat(argBytes(addr), [0xFF], ff(10)), function (e, rx) {
      if (e || !rx) return cb(e || new Error('no data'));
      var i = 6; while (i < rx.length && rx[i] === 0xFF) i++;
      if (i >= rx.length || rx[i] !== 0x00) return cb(new Error('CMD17 failed at block ' + lba + ' (R1=' + (i < rx.length ? '0x' + hex2(rx[i]) : 'none') + ')'));
      var stream = rx.slice(i + 1), polls = 0;
      (function pump() {
        var p = -1;
        for (var k = 0; k < stream.length; k++) if (stream[k] === 0xFE) { p = k; break; }
        if (p >= 0 && stream.length >= p + 1 + 514) { csn.output(true); return cb(null, stream.slice(p + 1, p + 513)); }
        if (++polls > 40) { csn.output(true); return cb(new Error('data token never arrived for block ' + lba)); }
        xfer(ff(64), function (e2, more) { if (e2 || !more) return cb(e2 || new Error('no data')); stream = stream.concat(more); pump(); });
      })();
    });
  });
}

function text(a, from, to) { var s = ''; for (var i = from; i < to; i++) s += String.fromCharCode(a[i]); return s; }
function trim(s) { return s.replace(/\s+$/, ''); }

function readSectors(first, count, cb) {          // returns array of 512-byte arrays
  var out = [];
  (function next(i) {
    if (i >= count) return cb(null, out);
    readBlock(first + i, function (e, d) { if (e) return cb(e); out.push(d); next(i + 1); });
  })(0);
}


var DIR_NAME = 'TESSEL~1';   // 8.3 short name of the folder (the logger's tessel-log)
var GET = true;              // false = list only
var MAX_FILES = 30;

function fatNext(bootLba, rsv, cl, cb) {
  var sector = bootLba + rsv + Math.floor(cl * 4 / 512), off = (cl * 4) % 512;
  readBlock(sector, function (e, b) { if (e) return cb(e); cb(null, le32(b, off) % 268435456); });
}
function readChain(ctx, cl, maxBytes, cb) {        // returns array of byte values, up to maxBytes
  var out = [];
  (function nextCl(c) {
    if (c < 2 || c >= 268435448 || out.length >= maxBytes) return cb(null, out);
    var first = ctx.dataStart + (c - 2) * ctx.spc;
    (function sec(i) {
      if (i >= ctx.spc) { return fatNext(ctx.bootLba, ctx.rsv, c, function (e, n) { if (e) return cb(e); nextCl(n); }); }
      readBlock(first + i, function (e, d) {
        if (e) return cb(e);
        for (var k = 0; k < 512 && out.length < maxBytes; k++) out.push(d[k]);
        sec(i + 1);
      });
    })(0);
  })(cl);
}
function readChainBuf(ctx, cl, size, cb) {        // fills one preallocated Buffer (a plain array of 47k numbers is too heavy)
  var buf = new Buffer(size), pos = 0;
  (function nextCl(c) {
    if (c < 2 || c >= 268435448 || pos >= size) return cb(null, buf);
    var first = ctx.dataStart + (c - 2) * ctx.spc;
    (function sec(i) {
      if (i >= ctx.spc) { return fatNext(ctx.bootLba, ctx.rsv, c, function (e, n) { if (e) return cb(e); nextCl(n); }); }
      readBlock(first + i, function (e, d) {
        if (e) return cb(e);
        for (var k = 0; k < 512 && pos < size; k++) { buf[pos] = d[k]; pos++; }
        sec(i + 1);
      });
    })(0);
  })(cl);
}
function parseDir(bytes) {                         // -> [{name, short, isDir, size, cl}]
  var res = [], lfn = [];
  for (var o = 0; o + 32 <= bytes.length; o += 32) {
    var d = bytes.slice(o, o + 32);
    if (d[0] === 0x00) break;
    if (d[0] === 0xE5) { lfn = []; continue; }
    var attr = d[11];
    if (attr === 0x0F) {
      var part = '', offs = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
      for (var q = 0; q < offs.length; q++) { var c = le16(d, offs[q]); if (c === 0 || c === 0xFFFF) break; part += c < 128 ? String.fromCharCode(c) : '?'; }
      lfn.unshift(part); continue;
    }
    if (attr === 0x08) { lfn = []; continue; }
    var base = trim(text(d, 0, 8)), ext = trim(text(d, 8, 11));
    var short = ext ? base + '.' + ext : base;
    var cl = le16(d, 20) * 65536 + le16(d, 26);
    if (short !== '.' && short !== '..') res.push({ name: lfn.length ? lfn.join('') : short, short: short, isDir: Math.floor(attr / 16) % 2 === 1, size: le32(d, 28), cl: cl });
    lfn = [];
  }
  return res;
}

say('starting card on port ' + PORT);
init(function (e) {
  if (e) return fail(e.message);
  readBlock(0, function (e, b0) {
    if (e) return fail(e.message);
    var bootLba = le32(b0, 446 + 8);
    readBlock(bootLba, function (e, bs) {
      if (e) return fail(e.message);
      var spc = bs[13], rsv = le16(bs, 14), nfat = bs[16], fatsz = le32(bs, 36), rootCl = le32(bs, 44);
      if (le16(bs, 22) !== 0 || le16(bs, 11) !== 512) return fail('this script needs FAT32 with 512-byte sectors');
      var ctx = { bootLba: bootLba, rsv: rsv, spc: spc, dataStart: bootLba + rsv + nfat * fatsz };
      readChain(ctx, rootCl, 16384, function (e, rootBytes) {
        if (e) return fail(e.message);
        var rootEntries = parseDir(rootBytes), dir = null;
        for (var i = 0; i < rootEntries.length; i++) if (rootEntries[i].isDir && rootEntries[i].short === DIR_NAME) dir = rootEntries[i];
        if (!dir) return fail('no folder with short name ' + DIR_NAME + ' in the root');
        readChain(ctx, dir.cl, 65536, function (e, dirBytes) {
          if (e) return fail(e.message);
          var files = parseDir(dirBytes);
          say('folder ' + dir.name + ': ' + files.length + ' entries');
          for (var j = 0; j < files.length; j++) say('  ' + (files[j].isDir ? '[DIR] ' : '') + files[j].name + '  ' + files[j].size + ' bytes');
          if (!GET) return finish('RESULT listed ' + files.length + ' entries');
          var todo = files.filter(function (f) { return !f.isDir && f.size > 0 && /\.JPG$/.test(f.name); }).slice(0, MAX_FILES);
          (function copy(k) {
            if (k >= todo.length) return finish('RESULT copied ' + todo.length + ' files');
            var f = todo[k];
            readChainBuf(ctx, f.cl, f.size, function (e, bytes) {
              if (e) return fail('read ' + f.name + ': ' + e.message);
              // process.sendfile proved unreliable here, so print the bytes as hex lines: 'HEX <name> <offset> <hex>'.
              var off = 0;
              (function emit() {
                var n = 0;
                while (off < bytes.length && n < 20) {
                  var end = Math.min(off + 256, bytes.length), line = [];
                  for (var b = off; b < end; b++) line.push((bytes[b] < 16 ? '0' : '') + bytes[b].toString(16));
                  console.log('HEX ' + f.name + ' ' + off + ' ' + line.join(''));
                  off = end; n++;
                }
                if (off < bytes.length) return setTimeout(emit, 50);
                say('printed ' + f.name + ' (' + bytes.length + ' bytes)');
                setTimeout(function () { copy(k + 1); }, 200);
              })();
            });
          })(0);
        });
      });
    });
  });
});
