// List the ROOT directory of the SD card (FAT16/FAT32), READ-ONLY, NO module library, NO bitwise operators.
// Wiring (SD module): chip select = pin G1 (driven by hand), SPI on the module port. Port set below.
var tessel = require('tessel');
var PORT = 'C';
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

function listDir(sectors) {
  var lfn = [], shown = 0, label = '';
  for (var s = 0; s < sectors.length; s++) {
    for (var o = 0; o < 512; o += 32) {
      var d = sectors[s].slice(o, o + 32);
      if (d[0] === 0x00) { return summary(shown, label, true); }
      if (d[0] === 0xE5) { lfn = []; continue; }
      var attr = d[11];
      if (attr === 0x0F) {                          // long-name fragment
        var part = '';
        var offs = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
        for (var q = 0; q < offs.length; q++) {
          var c = le16(d, offs[q]);
          if (c === 0 || c === 0xFFFF) break;
          part += c < 128 ? String.fromCharCode(c) : '?';
        }
        lfn.unshift(part);
        continue;
      }
      if (attr === 0x08) { label = trim(text(d, 0, 11)); lfn = []; continue; }
      var base = trim(text(d, 0, 8)), ext = trim(text(d, 8, 11));
      var short = ext ? base + '.' + ext : base;
      var name = lfn.length ? lfn.join('') : short;
      var isDir = Math.floor(attr / 16) % 2 === 1;
      var size = le32(d, 28);
      if (short !== '.' && short !== '..') {
        say((isDir ? '[DIR]  ' : '       ') + name + (isDir ? '' : '   ' + size + ' bytes') + (lfn.length ? '   (8.3: ' + short + ')' : ''));
        shown++;
        if (shown >= MAX_ENTRIES) { return summary(shown, label, false); }
      }
      lfn = [];
    }
  }
  summary(shown, label, false);
}
function summary(n, label, ended) {
  finish('RESULT ' + n + ' entr' + (n === 1 ? 'y' : 'ies') + ' in the root folder' + (label ? ', volume label "' + label + '"' : '') + (ended ? '' : ' (stopped at the end of the sectors read; more may exist)'));
}

say('starting card on port ' + PORT);
init(function (e) {
  if (e) return fail(e.message);
  readBlock(0, function (e, b0) {
    if (e) return fail(e.message);
    say('block 0: signature ' + hex2(b0[510]) + hex2(b0[511]) + (b0[510] === 0x55 && b0[511] === 0xAA ? ' (valid)' : ' (NOT 55aa)'));
    var bootLba = 0, boot;
    var isBoot = b0[0] === 0xEB || b0[0] === 0xE9;
    if (!isBoot) {
      var ptype = b0[446 + 4];
      bootLba = le32(b0, 446 + 8);
      say('partition 1: type 0x' + hex2(ptype) + ', starts at sector ' + bootLba + ', ' + le32(b0, 446 + 12) + ' sectors');
      if (ptype === 0 || bootLba === 0) return fail('no usable partition in the partition table (card may be unformatted)');
    } else say('no partition table: boot sector is block 0 (superfloppy format)');
    readBlock(bootLba, function (e, bs) {
      if (e) return fail(e.message);
      var bps = le16(bs, 11), spc = bs[13], rsv = le16(bs, 14), nfat = bs[16], rootEnt = le16(bs, 17);
      var fatsz = le16(bs, 22) !== 0 ? le16(bs, 22) : le32(bs, 36);
      var total = le16(bs, 19) !== 0 ? le16(bs, 19) : le32(bs, 32);
      var isFat32 = le16(bs, 22) === 0;
      var fsName = trim(text(bs, isFat32 ? 82 : 54, isFat32 ? 90 : 62));
      say('filesystem "' + fsName + '": ' + bps + ' bytes/sector, ' + spc + ' sectors/cluster, ' + nfat + ' FATs, ' + total + ' sectors (~' + Math.round(total * bps / 1048576) + ' MB)');
      if (bps !== 512 || spc === 0) return fail('unsupported or unreadable boot sector (bytes/sector=' + bps + ')');
      var first, count;
      if (isFat32) {
        var rootCl = le32(bs, 44);
        first = bootLba + rsv + nfat * fatsz + (rootCl - 2) * spc;
        count = Math.min(spc, 8);
      } else {
        first = bootLba + rsv + nfat * fatsz;
        count = Math.min(Math.ceil(rootEnt * 32 / 512), 8);
      }
      say('root directory at sector ' + first + ', reading ' + count + ' sector(s)');
      readSectors(first, count, function (e, secs) {
        if (e) return fail(e.message);
        listDir(secs);
      });
    });
  });
});
