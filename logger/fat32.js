// Minimal FAT32 writer over a 512-byte block device: find, create (root folder, 8.3 names), append, streaming append.
// ES5, no bitwise operators (the Tessel 1 runtime crashes on them): all packing uses * / % and Math.floor.
// Block device: dev.read(lba, cb(err, Buffer512)), dev.write(lba, Buffer512, cb(err)).
// Errors carry .code: NOT_FAT32, NO_SPACE, DIR_FULL, EXISTS, IO (device errors that already have a .code pass through).
var EOC = 0x0FFFFFFF;
var TOP = 0x10000000;            // FAT entries use the low 28 bits

function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
function ioErr(e) { return !e ? null : (e.code ? e : err('IO', e.message)); }
function le16(a, o) { return a[o] + a[o + 1] * 256; }
function le32(a, o) { return a[o] + a[o + 1] * 256 + a[o + 2] * 65536 + a[o + 3] * 16777216; }
function put16(a, o, v) { a[o] = v % 256; a[o + 1] = Math.floor(v / 256) % 256; }
function put32(a, o, v) { a[o] = v % 256; a[o + 1] = Math.floor(v / 256) % 256; a[o + 2] = Math.floor(v / 65536) % 256; a[o + 3] = Math.floor(v / 16777216) % 256; }

// 'LOG.CSV' -> 11-byte space-padded upper-case 8.3 name, or null if it does not fit 8.3.
function name11(name) {
  var parts = String(name).toUpperCase().split('.');
  if (parts.length > 2 || parts[0].length < 1 || parts[0].length > 8 || (parts[1] && parts[1].length > 3)) return null;
  var s = parts[0], ext = parts[1] || '';
  while (s.length < 8) s += ' ';
  while (ext.length < 3) ext += ' ';
  return s + ext;
}
function trimRight(s) { var n = s.length; while (n > 0 && s.charAt(n - 1) === ' ') n--; return s.slice(0, n); }
function showName(raw, o) {
  var base = trimRight(raw.slice(o, o + 8).toString('binary'));
  var ext = trimRight(raw.slice(o + 8, o + 11).toString('binary'));
  return ext ? base + '.' + ext : base;
}
// 'IMG0007.JPG' -> 7, anything else -> -1 (no regexes: the board's runtime may lack them)
function imageNumber(name) {
  if (name.length !== 11 || name.slice(0, 3) !== 'IMG' || name.slice(7) !== '.JPG') return -1;
  var digits = name.slice(3, 7);
  for (var i = 0; i < 4; i++) if (digits.charAt(i) < '0' || digits.charAt(i) > '9') return -1;
  return Number(digits);
}

exports.mount = function (dev, cb) {
  dev.read(0, function (e, b0) {
    if (e) return cb(ioErr(e));
    var part = 0;
    if (b0[510] === 0x55 && b0[511] === 0xAA && (b0[450] === 0x0C || b0[450] === 0x0B)) part = le32(b0, 454);
    dev.read(part, function (e2, bs) {
      if (e2) return cb(ioErr(e2));
      if (bs[510] !== 0x55 || bs[511] !== 0xAA) return cb(err('NOT_FAT32', 'no boot sector signature'));
      var bps = le16(bs, 11), spc = bs[13], rsv = le16(bs, 14), nfat = bs[16];
      var fatsz = le32(bs, 36), total = le32(bs, 32) || le16(bs, 19);
      if (bps !== 512 || spc === 0 || nfat < 1 || le16(bs, 17) !== 0 || le16(bs, 22) !== 0 || fatsz === 0) {
        return cb(err('NOT_FAT32', 'not a FAT32 volume (bytes/sector ' + bps + ')'));
      }
      cb(null, makeVolume(dev, {
        part: part, spc: spc, nfat: nfat, fatsz: fatsz, rootCl: le32(bs, 44),
        fat1: part + rsv, dataStart: part + rsv + nfat * fatsz,
        nClusters: Math.min(Math.floor((total - rsv - nfat * fatsz) / spc), fatsz * 128 - 2),
        fsinfo: le16(bs, 48) > 0 && le16(bs, 48) < 0xFFFF ? part + le16(bs, 48) : 0
      }));
    });
  });
};

function makeVolume(dev, g) {
  var clusterBytes = g.spc * 512;
  var fatCache = { lba: -1, buf: null };
  var hint = 2, allocated = 0;
  var vol = {};

  function clusterLba(c) { return g.dataStart + (c - 2) * g.spc; }
  function readFatSector(lba, cb) {
    if (fatCache.lba === lba) return cb(null, fatCache.buf);
    dev.read(lba, function (e, b) { if (e) return cb(ioErr(e)); fatCache = { lba: lba, buf: b }; cb(null, b); });
  }
  // Cluster numbers from the card are untrusted: refuse anything outside the data area before any block is read or written.
  function validCluster(c) { return c >= 2 && c <= g.nClusters + 1; }
  function getFat(c, cb) {
    if (!validCluster(c)) return cb(err('DAMAGED', 'cluster ' + c + ' is outside the volume'));
    readFatSector(g.fat1 + Math.floor(c * 4 / 512), function (e, b) { cb(e, e ? 0 : le32(b, (c * 4) % 512) % TOP); });
  }
  function setFat(c, v, cb) {
    var rel = Math.floor(c * 4 / 512), off = (c * 4) % 512;
    if (!validCluster(c) || rel >= g.fatsz) return cb(err('DAMAGED', 'refusing to write FAT entry ' + c));
    readFatSector(g.fat1 + rel, function (e, b) {
      if (e) return cb(e);
      put32(b, off, v + (le32(b, off) - le32(b, off) % TOP));    // keep the reserved top 4 bits
      fatCache = { lba: -1, buf: null };                         // never trust the cache across a write
      (function copy(i) {
        if (i === g.nfat) { fatCache = { lba: g.fat1 + rel, buf: b }; return cb(null); }
        dev.write(g.fat1 + i * g.fatsz + rel, b, function (we) { if (we) return cb(ioErr(we)); copy(i + 1); });
      })(0);
    });
  }

  // The FSInfo next-free hint is advisory: use it once per mount when valid so a big, mostly-full card is not rescanned from cluster 2.
  var hintLoaded = !g.fsinfo;
  function loadHint(cb) {
    if (hintLoaded) return cb();
    hintLoaded = true;
    dev.read(g.fsinfo, function (e, b) {
      if (!e && le32(b, 0) === 0x41615252 && le32(b, 484) === 0x61417272) {
        var h = le32(b, 492);
        if (h >= 2 && h <= g.nClusters + 1) hint = h;
      }
      cb();
    });
  }

  // Find a free cluster from the hint (wrapping), mark it end-of-chain, return its number.
  function allocCluster(cb) {
    loadHint(function () { scanFree(cb); });
  }
  function scanFree(cb) {
    var last = g.nClusters + 1, start = hint >= 2 && hint <= last ? hint : 2, scanned = 0;
    (function sector(c) {
      if (scanned >= g.nClusters) return cb(err('NO_SPACE', 'no free cluster'));
      readFatSector(g.fat1 + Math.floor(c * 4 / 512), function (e, b) {
        if (e) return cb(e);
        while (true) {
          if (scanned >= g.nClusters) return cb(err('NO_SPACE', 'no free cluster'));
          if (le32(b, (c * 4) % 512) % TOP === 0) {
            return setFat(c, EOC, function (se) { if (se) return cb(se); hint = c + 1; allocated++; cb(null, c); });
          }
          c++; scanned++;
          if (c > last) return sector(2);                          // wrap to the start of the FAT
          if ((c * 4) % 512 === 0) return sector(c);
        }
      });
    })(start);
  }

  // Visit root directory entries. visit(info) with info = {free, end, raw, lba, off}; return true to stop.
  function scanRoot(visit, cb) {
    var hops = 0;
    (function cluster(c) {
      if (c < 2 || c >= 0x0FFFFFF8) return cb(null, false);
      if (!validCluster(c) || ++hops > g.nClusters) return cb(err('NOT_FAT32', 'root directory chain is damaged'));
      (function sec(s) {
        if (s === g.spc) { return getFat(c, function (e, next) { if (e) return cb(e); cluster(next); }); }
        var lba = clusterLba(c) + s;
        dev.read(lba, function (e, b) {
          if (e) return cb(ioErr(e));
          for (var o = 0; o < 512; o += 32) {
            var first = b[o];
            var stop = visit({ free: first === 0x00 || first === 0xE5, end: first === 0x00, raw: b, lba: lba, off: o });
            if (stop) return cb(null, true);
            if (first === 0x00) return cb(null, false);
          }
          sec(s + 1);
        });
      })(0);
    })(g.rootCl);
  }

  function entryOf(info) {
    var b = info.raw, o = info.off;
    return {
      name: showName(b, o), size: le32(b, o + 28), firstCluster: (le16(b, o + 20) % 4096) * 65536 + le16(b, o + 26),   // top 4 bits of the high word are reserved
      dirLba: info.lba, dirOffset: o
    };
  }
  // A plain file entry: not free, and neither volume-label (0x08, also set on LFN entries) nor directory (0x10) bit.
  function isFile(info) { var a = info.raw[info.off + 11]; return !info.free && Math.floor(a / 8) % 2 === 0 && Math.floor(a / 16) % 2 === 0; }

  vol.find = function (name, cb) {
    var want = name11(name), found = null;
    if (!want) return cb(err('NOT_FAT32', 'name not 8.3: ' + name));
    scanRoot(function (info) {
      if (info.free || !isFile(info)) return false;
      if (info.raw.slice(info.off, info.off + 11).toString('binary') === want) { found = entryOf(info); return true; }
      return false;
    }, function (e) { cb(e, e ? null : found); });
  };

  vol.highestImageNumber = function (cb) {
    var best = 0;
    scanRoot(function (info) {
      if (info.free || !isFile(info)) return false;
      var n = imageNumber(showName(info.raw, info.off));
      if (n > best) best = n;
      return false;
    }, function (e) { cb(e, e ? 0 : best); });
  };

  vol.create = function (name, cb) {
    var want = name11(name), slot = null, exists = false;
    if (!want) return cb(err('NOT_FAT32', 'name not 8.3: ' + name));
    scanRoot(function (info) {
      if (info.free) { if (!slot) slot = info; return info.end; }
      if (isFile(info) && info.raw.slice(info.off, info.off + 11).toString('binary') === want) { exists = true; return true; }
      return false;
    }, function (e) {
      if (e) return cb(e);
      if (exists) return cb(err('EXISTS', name + ' exists'));
      if (!slot) return cb(err('DIR_FULL', 'no free root directory slot'));
      var b = slot.raw, o = slot.off;
      for (var i = 0; i < 32; i++) b[o + i] = 0;
      b.write(want, o, 11, 'binary');
      b[o + 11] = 0x20;                                            // archive
      put16(b, o + 16, 0x21); put16(b, o + 18, 0x21); put16(b, o + 24, 0x21);   // dates 1980-01-01
      dev.write(slot.lba, b, function (we) {
        if (we) return cb(ioErr(we));
        cb(null, { name: showName(b, o), size: 0, firstCluster: 0, dirLba: slot.lba, dirOffset: o });
      });
    });
  };

  function writeFsInfo(cb) {
    if (!g.fsinfo || allocated === 0) return cb(null);
    dev.read(g.fsinfo, function (e, b) {
      if (e) return cb(ioErr(e));
      if (le32(b, 0) !== 0x41615252 || le32(b, 484) !== 0x61417272) return cb(null);
      var free = le32(b, 488);
      if (free !== 0xFFFFFFFF) put32(b, 488, Math.max(0, free - allocated));
      put32(b, 492, hint);
      allocated = 0;
      dev.write(g.fsinfo, b, function (we) { cb(ioErr(we)); });
    });
  }

  // Walk the chain of a file of `size` bytes and call back with its last cluster; DAMAGED if the chain is shorter than the
  // size says, leaves the volume, or ends early. (A chain longer than the size is harmless: lost clusters.)
  function walkChain(first, size, cb) {
    if (!validCluster(first)) return cb(err('DAMAGED', 'first cluster ' + first + ' is outside the volume'));
    var n = Math.ceil(size / clusterBytes), c = first;
    (function walk(i) {
      if (i === n) return cb(null, c, n);
      getFat(c, function (e, next) {
        if (e) return cb(e);
        if (!validCluster(next)) return cb(err('DAMAGED', 'cluster chain ends before the ' + size + ' bytes the entry claims'));
        c = next; walk(i + 1);
      });
    })(1);
  }
  vol.checkChain = function (entry, cb) {
    if (entry.size === 0) return cb(entry.firstCluster === 0 || validCluster(entry.firstCluster) ? null : err('DAMAGED', 'first cluster out of range'));
    walkChain(entry.firstCluster, entry.size, function (e) { cb(e || null); });
  };

  vol.appendStream = function (entry) {
    var size = entry.size, first = entry.firstCluster, last = 0;
    var buf = new Buffer(512), bufLen = 0, inited = false, nClu = 0;   // nClu = clusters already in the chain

    function init(cb) {
      if (inited) return cb(null);
      inited = true;
      if (size === 0 || first === 0) { size = 0; return cb(null); }
      walkChain(first, size, function (we, lastCluster, n) {
        if (we) { inited = false; return cb(we); }
        nClu = n;
        last = lastCluster;
        if (size % 512 === 0) return cb(null);
        bufLen = size % 512;
        dev.read(clusterLba(last) + Math.floor(((size - 1) % clusterBytes) / 512), function (e, b) {
          if (e) return cb(ioErr(e));
          b.copy(buf, 0, 0, 512); cb(null);
        });
      });
    }

    // Write the buffered block, allocating and linking a new cluster when the block starts one.
    function flushBlock(cb) {
      var blockStart = size - bufLen;
      function put() {
        dev.write(clusterLba(last) + Math.floor((blockStart % clusterBytes) / 512), buf, function (e) {
          if (e) return cb(ioErr(e));
          bufLen = 0; cb(null);
        });
      }
      if (Math.floor(blockStart / clusterBytes) < nClu) return put();   // block lies in a cluster we already have
      allocCluster(function (e, c) {
        if (e) return cb(e);
        nClu++;
        if (last === 0) { first = c; last = c; return put(); }
        setFat(last, c, function (le) { if (le) return cb(le); last = c; put(); });
      });
    }

    var s = {};
    s.write = function (chunk, cb) {
      init(function (e) {
        if (e) return cb(e);
        (function loop(pos) {
          if (pos >= chunk.length) return cb(null);
          var n = Math.min(512 - bufLen, chunk.length - pos);
          chunk.copy(buf, bufLen, pos, pos + n);
          bufLen += n; size += n;
          if (bufLen < 512) return loop(pos + n);
          flushBlock(function (fe) { if (fe) return cb(fe); loop(pos + n); });
        })(0);
      });
    };
    s.close = function (cb) {
      init(function (e) {
        if (e) return cb(e);
        function finish() {
          dev.read(entry.dirLba, function (re, d) {
            if (re) return cb(ioErr(re));
            var o = entry.dirOffset;
            put16(d, o + 20, Math.floor(first / 65536)); put16(d, o + 26, first % 65536); put32(d, o + 28, size);
            dev.write(entry.dirLba, d, function (we) {
              if (we) return cb(ioErr(we));
              writeFsInfo(function (fe) {
                if (fe) return cb(fe);
                cb(null, { name: entry.name, size: size, firstCluster: first, dirLba: entry.dirLba, dirOffset: o });
              });
            });
          });
        }
        if (bufLen === 0) return finish();
        buf.fill(0, bufLen);
        flushBlock(function (fe) { if (fe) return cb(fe); finish(); });
      });
    };
    return s;
  };

  vol.append = function (entry, bytes, cb) {
    var s = vol.appendStream(entry);
    s.write(bytes, function (e) { if (e) return cb(e); s.close(cb); });
  };

  // Delete a file: mark its directory entry deleted FIRST (the file disappears), then free its cluster chain in every FAT
  // copy, then fix FSInfo. A power cut in between leaves lost clusters, never an entry that points at free space.
  // A chain that leaves the volume, loops, or hits a free cluster is refused (DAMAGED) before anything is written.
  vol.remove = function (entry, cb) {
    var clusters = [];
    function collect(done) {
      if (entry.firstCluster === 0) return done(null);                      // empty file: no chain
      if (!validCluster(entry.firstCluster)) return done(err('DAMAGED', 'first cluster ' + entry.firstCluster + ' is outside the volume'));
      var c = entry.firstCluster;
      (function next() {
        clusters.push(c);
        if (clusters.length > g.nClusters) return done(err('DAMAGED', 'cluster chain loops'));
        getFat(c, function (e, v) {
          if (e) return done(e);
          if (v >= 0x0FFFFFF8) return done(null);                           // end of chain
          if (!validCluster(v)) return done(err('DAMAGED', 'cluster chain leaves the volume or hits a free cluster'));
          c = v; next();
        });
      })();
    }
    collect(function (ce) {
      if (ce) return cb(ce);
      dev.read(entry.dirLba, function (re, d) {
        if (re) return cb(ioErr(re));
        d[entry.dirOffset] = 0xE5;
        dev.write(entry.dirLba, d, function (we) {
          if (we) return cb(ioErr(we));
          (function free(i) {
            if (i === clusters.length) {
              if (clusters.length === 0) return cb(null);
              var lowest = clusters[0];
              for (var k = 1; k < clusters.length; k++) if (clusters[k] < lowest) lowest = clusters[k];
              if (lowest < hint) hint = lowest;                             // the next allocation reuses the freed space
              allocated -= clusters.length;                                 // negative: FSInfo free count goes up
              return writeFsInfo(function (fe) { cb(fe || null); });
            }
            setFat(clusters[i], 0, function (se) { if (se) return cb(se); free(i + 1); });
          })(0);
        });
      });
    });
  };

  vol.readAll = function (entry, cb) {
    var out = new Buffer(entry.size), got = 0;
    if (entry.size === 0) return cb(null, out);
    (function cluster(c) {
      if (!validCluster(c)) return cb(err('DAMAGED', 'cluster ' + c + ' is outside the volume'));
      (function sec(s) {
        if (got >= entry.size) return cb(null, out);
        if (s === g.spc) return getFat(c, function (e, next) { if (e) return cb(e); cluster(next); });
        dev.read(clusterLba(c) + s, function (e, b) {
          if (e) return cb(ioErr(e));
          var n = Math.min(512, entry.size - got);
          b.copy(out, got, 0, n); got += n; sec(s + 1);
        });
      })(0);
    })(entry.firstCluster);
  };

  return vol;
}
