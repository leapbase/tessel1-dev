// Write ONE small text file (TESSTEST.TXT) into the ROOT folder of a FAT32 SD card. NO module library, NO bitwise operators.
// SAFETY: WRITE=false is a dry run (reads only, plus sends backups of the sectors it would change to the host).
//   Run with an upload dir so backups are kept:  tessel run raw-sd-write.js -u backups
// Write order: file data, then FAT (both copies), then directory entry, then FSInfo. Refuses to overwrite an existing file.
var tessel = require('tessel');
var PORT = 'C';
var WRITE = false;                                   // set true for the real write
var NAME8 = 'TESSTEST', EXT3 = 'TXT';
var CONTENT = 'Hello from Tessel 1 (board 2).\r\nThis test file was written over SPI by raw-sd-write.js on 2026-11-18.\r\n';
var port = tessel.port[PORT];
function say(m) { console.log('sdw: ' + m); }
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function finish(m) { say(m); setTimeout(function () { process.exit(0); }, 600); }
function fail(m) { say('ERROR ' + m + (WRITE ? '  (STOPPED; check what was written before retrying)' : '')); try { csn.output(true); } catch (e) {} setTimeout(function () { process.exit(1); }, 600); }

var csn = port.pin['G1']; csn.output(true);
var spi = new port.SPI({ clockSpeed: 200000 });
var sdhc = false;

function toArr(b) { var a = []; for (var i = 0; i < b.length; i++) a.push(b[i]); return a; }
function ff(n) { var a = []; for (var i = 0; i < n; i++) a.push(0xFF); return a; }
function le16(a, o) { return a[o] + a[o + 1] * 256; }
function le32(a, o) { return a[o] + a[o + 1] * 256 + a[o + 2] * 65536 + a[o + 3] * 16777216; }
function put16(a, o, v) { a[o] = v % 256; a[o + 1] = Math.floor(v / 256) % 256; }
function put32(a, o, v) { a[o] = v % 256; a[o + 1] = Math.floor(v / 256) % 256; a[o + 2] = Math.floor(v / 65536) % 256; a[o + 3] = Math.floor(v / 16777216) % 256; }
function argBytes(v) { return [Math.floor(v / 16777216) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256]; }
function text(a, from, to) { var s = ''; for (var i = from; i < to; i++) s += String.fromCharCode(a[i]); return s; }
function xfer(bytes, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('SPI timeout')); } }, 3000);
  spi.transfer(new Buffer(bytes), function (e, rx) { if (done) return; done = true; clearTimeout(t); cb(e, rx ? toArr(rx) : null); });
}

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
  xfer(ff(20), function () {
    command(0, 0, 0x95, function (e, r1) {
      if (e || r1 !== 0x01) return cb(new Error('CMD0 failed'));
      command(8, 0x1AA, 0x87, function (e) {
        if (e) return cb(e);
        var tries = 0;
        (function acmd41() {
          command(55, 0, 0xFF, function (e) {
            if (e) return cb(e);
            command(41, 0x40000000, 0xFF, function (e, r) {
              if (e) return cb(e);
              if (r === 0x00) return ocr();
              if (++tries > 100) return cb(new Error('card never left idle'));
              setTimeout(acmd41, 30);
            });
          });
        })();
        function ocr() {
          command(58, 0, 0xFF, function (e, r, rest) {
            if (e) return cb(e);
            sdhc = rest[0] >= 0xC0;
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
      if (i >= rx.length || rx[i] !== 0x00) return cb(new Error('CMD17 failed at block ' + lba));
      var stream = rx.slice(i + 1), polls = 0;
      (function pump() {
        var p = -1;
        for (var k = 0; k < stream.length; k++) if (stream[k] === 0xFE) { p = k; break; }
        if (p >= 0 && stream.length >= p + 1 + 514) { csn.output(true); return cb(null, stream.slice(p + 1, p + 513)); }
        if (++polls > 40) { csn.output(true); return cb(new Error('no data token for block ' + lba)); }
        xfer(ff(64), function (e2, more) { if (e2 || !more) return cb(e2 || new Error('no data')); stream = stream.concat(more); pump(); });
      })();
    });
  });
}
function writeBlock(lba, data, cb) {
  if (!WRITE) return cb(new Error('writeBlock called in dry-run mode'));
  if (data.length !== 512) return cb(new Error('block must be 512 bytes'));
  var addr = sdhc ? lba : lba * 512;
  csn.output(true);
  xfer([0xFF], function () {
    csn.output(false);
    xfer([0x58].concat(argBytes(addr), [0xFF], ff(10)), function (e, rx) {
      if (e || !rx) return cb(e || new Error('no data'));
      var i = 6; while (i < rx.length && rx[i] === 0xFF) i++;
      if (i >= rx.length || rx[i] !== 0x00) { csn.output(true); return cb(new Error('CMD24 rejected at block ' + lba)); }
      xfer([0xFF, 0xFE].concat(data, [0xFF, 0xFF], ff(2)), function (e2, rx2) {
        if (e2 || !rx2) { csn.output(true); return cb(e2 || new Error('no data')); }
        var token = rx2[516];
        if (token % 32 !== 5) { csn.output(true); return cb(new Error('write rejected, data response 0x' + hex2(token))); }
        var polls = 0;
        (function busy() {
          xfer(ff(8), function (e3, r3) {
            if (e3 || !r3) { csn.output(true); return cb(e3 || new Error('no data')); }
            if (r3[r3.length - 1] === 0xFF) { csn.output(true); return xfer([0xFF], function () { cb(null); }); }
            if (++polls > 60) { csn.output(true); return cb(new Error('card stayed busy after write to block ' + lba)); }
            busy();
          });
        })();
      });
    });
  });
}

function backup(name, lba, data, cb) {
  process.sendfile(name + '-lba' + lba + '.bin', new Buffer(data));
  say('backup sent: ' + name + '-lba' + lba + '.bin');
  setTimeout(cb, 700);
}

say((WRITE ? 'REAL WRITE' : 'DRY RUN (no writes)') + ' on port ' + PORT);
init(function (e) {
  if (e) return fail('card init: ' + e.message);
  say('card ready, ' + (sdhc ? 'SDHC (block addressing)' : 'standard capacity (byte addressing)'));
  readBlock(0, function (e, b0) {
    if (e) return fail(e.message);
    if (b0[510] !== 0x55 || b0[511] !== 0xAA) return fail('block 0 has no 55AA signature');
    var part = le32(b0, 446 + 8);
    if (b0[446 + 4] !== 0x0C && b0[446 + 4] !== 0x0B) return fail('partition 1 type 0x' + hex2(b0[446 + 4]) + ' is not FAT32');
    readBlock(part, function (e, bs) {
      if (e) return fail(e.message);
      var bps = le16(bs, 11), spc = bs[13], rsv = le16(bs, 14), nfat = bs[16], fatsz = le32(bs, 36);
      var rootCl = le32(bs, 44), fsiSec = le16(bs, 48), total = le32(bs, 32);
      if (bps !== 512 || le16(bs, 22) !== 0 || nfat !== 2 || spc === 0) return fail('not a standard FAT32 volume (bps=' + bps + ' nfat=' + nfat + ')');
      var fat1 = part + rsv, fat2 = fat1 + fatsz, dataStart = fat1 + nfat * fatsz;
      var nClusters = Math.floor((total - rsv - nfat * fatsz) / spc);
      say('FAT32: ' + spc + ' sectors/cluster, FAT1 at ' + fat1 + ', FAT2 at ' + fat2 + ', data at ' + dataStart + ', ' + nClusters + ' clusters, root cluster ' + rootCl);
      var rootLba = dataStart + (rootCl - 2) * spc;

      // 1) find a free directory slot (and make sure the file does not already exist)
      var slot = null, secIdx = 0;
      (function scanDir() {
        if (secIdx >= spc) return fail('no free directory slot in the first root cluster');
        readBlock(rootLba + secIdx, function (e, sec) {
          if (e) return fail(e.message);
          for (var o = 0; o < 512; o += 32) {
            var d = sec.slice(o, o + 32);
            if (d[0] !== 0xE5 && d[0] !== 0x00 && d[11] !== 0x0F && text(d, 0, 8) === (NAME8 + '        ').substring(0, 8) && text(d, 8, 11) === EXT3) {
              return fail(NAME8 + '.' + EXT3 + ' already exists in the root folder; refusing to overwrite');
            }
            if (d[0] === 0x00) { slot = { lba: rootLba + secIdx, off: o, sec: sec, end: true }; return havSlot(); }   // end-of-directory slot only: never reuse deleted entries (keeps undelete possible)
          }
          secIdx++; scanDir();
        });
      })();

      function havSlot() {
        say('free directory slot: sector ' + slot.lba + ', entry offset ' + slot.off + (slot.end ? ' (end-of-directory marker)' : ' (deleted entry)'));
        // 2) find a free cluster: use the FSInfo hint, else scan from cluster 2
        readBlock(part + fsiSec, function (e, fsi) {
          if (e) return fail(e.message);
          var fsiOk = le32(fsi, 0) === 0x41615252 && le32(fsi, 484) === 0x61417272;
          var hint = fsiOk ? le32(fsi, 492) : 2;
          if (!(hint >= 2 && hint < nClusters + 2)) hint = 2;
          say('FSInfo ' + (fsiOk ? 'valid: free clusters ' + le32(fsi, 488) + ', next-free hint ' + le32(fsi, 492) : 'not valid, scanning from cluster 2'));
          var cl = hint, scanned = 0;
          (function findFree() {
            var fsec = Math.floor(cl / 128);
            readBlock(fat1 + fsec, function (e, fb) {
              if (e) return fail(e.message);
              for (var c = cl; Math.floor(c / 128) === fsec && c < nClusters + 2; c++) {
                if (le32(fb, (c % 128) * 4) === 0) { return havCluster(c, fsec, fb, fsi, fsiOk); }
              }
              cl = (fsec + 1) * 128; scanned++;
              if (cl >= nClusters + 2) cl = 2;
              if (scanned > 300) return fail('no free cluster found in 300 FAT sectors');
              findFree();
            });
          })();
        });
      }

      function havCluster(cluster, fsec, fatSector, fsi, fsiOk) {
        var dataLba = dataStart + (cluster - 2) * spc;
        say('free cluster ' + cluster + ' -> data sector ' + dataLba + ', FAT sector ' + (fat1 + fsec) + ' (and copy at ' + (fat2 + fsec) + ')');
        // confirm FAT2 agrees that this cluster is free
        readBlock(fat2 + fsec, function (e, fb2) {
          if (e) return fail(e.message);
          if (le32(fb2, (cluster % 128) * 4) !== 0) return fail('FAT copies disagree about cluster ' + cluster + '; refusing to write');
          readBlock(dataLba, function (e, oldData) {
            if (e) return fail(e.message);
            var plan = 'plan: ' + NAME8 + '.' + EXT3 + ', ' + CONTENT.length + ' bytes, cluster ' + cluster + ', dir sector ' + slot.lba + '+' + slot.off;
            say(plan);
            // backups of everything we might modify
            backup('root-dir', slot.lba, slot.sec, function () {
              backup('fat1', fat1 + fsec, fatSector, function () {
                backup('fat2', fat2 + fsec, fb2, function () {
                  backup('fsinfo', part + fsiSec, fsi, function () {
                    backup('data-cluster-first-sector', dataLba, oldData, function () {
                      if (!WRITE) return finish('RESULT dry run complete: nothing was written. Backups sent with -u. Set WRITE=true to write.');
                      doWrite(cluster, fsec, fatSector, fb2, dataLba, fsi, fsiOk);
                    });
                  });
                });
              });
            });
          });
        });
      }

      function doWrite(cluster, fsec, fatSector, fb2, dataLba, fsi, fsiOk) {
        // (a) file data
        var data = []; for (var i = 0; i < 512; i++) data.push(i < CONTENT.length ? CONTENT.charCodeAt(i) : 0);
        writeBlock(dataLba, data, function (e) {
          if (e) return fail('data write: ' + e.message);
          say('wrote file data');
          // (b) FAT entry -> end of chain, both copies
          var f1 = fatSector.slice(0), f2 = fb2.slice(0), eo = (cluster % 128) * 4;
          put32(f1, eo, 0x0FFFFFFF); put32(f2, eo, 0x0FFFFFFF);
          writeBlock(fat1 + fsec, f1, function (e) {
            if (e) return fail('FAT1 write: ' + e.message);
            writeBlock(fat2 + fsec, f2, function (e) {
              if (e) return fail('FAT2 write: ' + e.message);
              say('wrote FAT entries (both copies)');
              // (c) directory entry
              var date = (2026 - 1980) * 512 + 11 * 32 + 18, time = 14 * 2048 + 35 * 32;
              var ent = []; for (var j = 0; j < 32; j++) ent.push(0);
              var nm = (NAME8 + '        ').substring(0, 8) + EXT3;
              for (var k = 0; k < 11; k++) ent[k] = nm.charCodeAt(k);
              ent[11] = 0x20;                                    // archive attribute
              put16(ent, 14, time); put16(ent, 16, date); put16(ent, 18, date);
              put16(ent, 20, Math.floor(cluster / 65536)); put16(ent, 22, time); put16(ent, 24, date);
              put16(ent, 26, cluster % 65536); put32(ent, 28, CONTENT.length);
              var ds = slot.sec.slice(0);
              for (var m = 0; m < 32; m++) ds[slot.off + m] = ent[m];
              writeBlock(slot.lba, ds, function (e) {
                if (e) return fail('directory write: ' + e.message);
                say('wrote directory entry');
                // (d) FSInfo
                var step = function () { verify(cluster, fsec, dataLba); };
                if (!fsiOk || le32(fsi, 488) === 0xFFFFFFFF) return step();
                var nf = fsi.slice(0);
                put32(nf, 488, le32(fsi, 488) - 1); put32(nf, 492, cluster + 1);
                writeBlock(part + fsiSec, nf, function (e) { if (e) say('WARNING FSInfo update failed: ' + e.message); else say('updated FSInfo'); step(); });
              });
            });
          });
        });
      }

      function verify(cluster, fsec, dataLba) {
        readBlock(dataLba, function (e, d) {
          if (e) return fail('verify data: ' + e.message);
          var got = text(d, 0, CONTENT.length);
          say('verify data: ' + (got === CONTENT ? 'MATCHES what was written' : 'DIFFERS'));
          readBlock(fat1 + fsec, function (e, a) {
            readBlock(fat2 + fsec, function (e2, b) {
              if (e || e2) return fail('verify FAT read failed');
              var eo = (cluster % 128) * 4;
              say('verify FAT1 entry = 0x' + le32(a, eo).toString(16) + ', FAT2 entry = 0x' + le32(b, eo).toString(16));
              readBlock(slot.lba, function (e, r) {
                if (e) return fail('verify dir read failed');
                var x = r.slice(slot.off, slot.off + 32);
                say('verify dir entry: "' + text(x, 0, 8) + '.' + text(x, 8, 11) + '" size ' + le32(x, 28) + ' first cluster ' + (le16(x, 20) * 65536 + le16(x, 26)));
                finish('RESULT WRITE DONE. Read back: ' + (got === CONTENT ? 'content matches' : 'CONTENT MISMATCH'));
              });
            });
          });
        });
      }
    });
  });
});
