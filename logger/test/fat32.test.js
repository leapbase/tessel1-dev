// FAT32 writer tests (ES5, plain assert). Run on the Mac: node logger/test/fat32.test.js
// Uses real FAT32 images made by make-image.sh and checks them with fsck_msdos and by mounting them in macOS.
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var memdev = require('./memdev');
var fat32 = require('../fat32');

var WORK = path.join(os.tmpdir(), 'fat32-test-' + process.pid);
fs.mkdirSync(WORK);
var BASE = path.join(WORK, 'base.img');
cp.execFileSync(path.join(__dirname, 'make-image.sh'), [BASE, '1', '64']);   // 512-byte clusters: many chain extensions

function copyImage() {
  var out = path.join(WORK, 'img' + (copyImage.n = (copyImage.n || 0) + 1) + '.img');
  cp.execFileSync('cp', ['-c', BASE, out]);
  return out;
}

function attach(img, nomount) {
  var args = ['attach'].concat(nomount ? ['-nomount'] : [], ['-imagekey', 'diskimage-class=CRawDiskImage', img]);
  var out = cp.execFileSync('hdiutil', args).toString();
  var lines = out.trim().split('\n');
  var dev = lines[0].split(/\s+/)[0];
  var mount = null;
  lines.forEach(function (l) { var m = l.match(/(\/Volumes\/.*)$/); if (m) mount = m[1]; });
  return { dev: dev, mount: mount };
}
function detach(a) { cp.execFileSync('hdiutil', ['detach', a.dev]); }

function fsckClean(img) {
  var a = attach(img, true);
  try { cp.execFileSync('fsck_msdos', ['-n', a.dev.replace('/dev/disk', '/dev/rdisk')]); }
  finally { detach(a); }
}

function pattern(n, seed) {
  var b = new Buffer(n);
  for (var i = 0; i < n; i++) b[i] = (i * 7 + seed) % 251;
  return b;
}

function mountVol(dev, cb) {
  fat32.mount(dev, function (err, vol) { assert.ifError(err); cb(vol); });
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('mount fails with NOT_FAT32 on a blank device', function (done) {
  fat32.mount(memdev.blank(), function (err, vol) {
    assert.ok(err); assert.strictEqual(err.code, 'NOT_FAT32'); assert.ok(!vol); done();
  });
});

test('create LOG.CSV then find returns it', function (done) {
  var img = copyImage(), dev = memdev.open(img);
  mountVol(dev, function (vol) {
    vol.find('LOG.CSV', function (e, none) {
      assert.ifError(e); assert.strictEqual(none, null);
      vol.create('LOG.CSV', function (e2, entry) {
        assert.ifError(e2); assert.strictEqual(entry.size, 0);
        vol.find('LOG.CSV', function (e3, found) {
          assert.ifError(e3); assert.strictEqual(found.name, 'LOG.CSV'); assert.strictEqual(found.size, 0);
          vol.create('LOG.CSV', function (e4) { assert.ok(e4); assert.strictEqual(e4.code, 'EXISTS'); dev.close(); fsckClean(img); done(); });
        });
      });
    });
  });
});

test('three appends read back exactly', function (done) {
  var img = copyImage(), dev = memdev.open(img);
  mountVol(dev, function (vol) {
    vol.create('LOG.CSV', function (e, entry) {
      assert.ifError(e);
      var parts = [new Buffer('a,b\r\n'), new Buffer('c,d\r\n'), new Buffer('e,f\r\n')];
      (function step(i, ent) {
        if (i === parts.length) {
          return vol.readAll(ent, function (er, all) {
            assert.ifError(er); assert.strictEqual(all.toString(), 'a,b\r\nc,d\r\ne,f\r\n'); assert.strictEqual(ent.size, 15);
            dev.close(); fsckClean(img); done();
          });
        }
        vol.append(ent, parts[i], function (er, ent2) { assert.ifError(er); step(i + 1, ent2); });
      })(0, entry);
    });
  });
});

test('append across many cluster boundaries (40 KB in 600-byte pieces)', function (done) {
  var img = copyImage(), dev = memdev.open(img), data = pattern(40000, 3);
  mountVol(dev, function (vol) {
    vol.create('BIG.BIN', function (e, entry) {
      assert.ifError(e);
      (function step(off, ent) {
        if (off >= data.length) {
          return vol.readAll(ent, function (er, all) {
            assert.ifError(er); assert.strictEqual(ent.size, 40000); assert.ok(all.equals(data)); dev.close(); fsckClean(img); done();
          });
        }
        vol.append(ent, data.slice(off, Math.min(off + 600, data.length)), function (er, ent2) { assert.ifError(er); step(off + 600, ent2); });
      })(0, entry);
    });
  });
});

test('appendStream of 47000 bytes in 128-byte chunks; size set only at close', function (done) {
  var img = copyImage(), dev = memdev.open(img), data = pattern(47000, 9);
  mountVol(dev, function (vol) {
    vol.create('IMG0001.JPG', function (e, entry) {
      assert.ifError(e);
      var s = vol.appendStream(entry);
      (function step(off) {
        if (off >= data.length) {
          return vol.find('IMG0001.JPG', function (e1, mid) {
            assert.ifError(e1); assert.strictEqual(mid.size, 0, 'size must stay 0 until close');
            s.close(function (er, fin) {
              assert.ifError(er); assert.strictEqual(fin.size, 47000);
              vol.readAll(fin, function (er2, all) {
                assert.ifError(er2); assert.ok(all.equals(data)); dev.close(); fsckClean(img);
                var a = attach(img, false);
                try { assert.ok(fs.readFileSync(path.join(a.mount, 'IMG0001.JPG')).equals(data), 'macOS reads identical bytes'); }
                finally { detach(a); }
                done();
              });
            });
          });
        }
        s.write(data.slice(off, Math.min(off + 128, data.length)), function (er) { assert.ifError(er); step(off + 128); });
      })(0);
    });
  });
});

test('highestImageNumber sees IMG0001 and IMG0007 and ignores other names', function (done) {
  var img = copyImage(), dev = memdev.open(img);
  mountVol(dev, function (vol) {
    vol.highestImageNumber(function (e0, n0) {
      assert.ifError(e0); assert.strictEqual(n0, 0);
      var names = ['IMG0001.JPG', 'IMG0007.JPG', 'IMGX0009.JPG', 'LOG.CSV'];
      (function mk(i) {
        if (i === names.length) return vol.highestImageNumber(function (e, n) { assert.ifError(e); assert.strictEqual(n, 7); dev.close(); done(); });
        vol.create(names[i], function (e) { assert.ifError(e); mk(i + 1); });
      })(0);
    });
  });
});

test('append to a pre-existing LOG.CSV keeps old content (new mount) and leaves macOS files byte-identical', function (done) {
  var img = copyImage();
  var a = attach(img, false);                                    // macOS writes a long-named file (LFN entries) and a plain one
  var keep1 = pattern(5000, 1), keep2 = new Buffer('keep me\n');
  fs.writeFileSync(path.join(a.mount, 'a long file name for macOS.txt'), keep1);
  fs.writeFileSync(path.join(a.mount, 'OLD.TXT'), keep2);
  fs.writeFileSync(path.join(a.mount, 'LOG.CSV'), 'time,temp_c,humidity,note\r\nold,1.0,2.0,\r\n');
  detach(a);
  var dev = memdev.open(img);
  mountVol(dev, function (vol) {
    vol.find('LOG.CSV', function (e, entry) {
      assert.ifError(e); assert.ok(entry, 'macOS-created LOG.CSV found past the LFN entries');
      vol.append(entry, new Buffer('new,3.0,4.0,\r\n'), function (er, ent2) {
        assert.ifError(er);
        vol.readAll(ent2, function (er2, all) {
          assert.ifError(er2); assert.strictEqual(all.toString(), 'time,temp_c,humidity,note\r\nold,1.0,2.0,\r\nnew,3.0,4.0,\r\n');
          dev.close(); fsckClean(img);
          var b = attach(img, false);
          try {
            assert.ok(fs.readFileSync(path.join(b.mount, 'a long file name for macOS.txt')).equals(keep1));
            assert.ok(fs.readFileSync(path.join(b.mount, 'OLD.TXT')).equals(keep2));
            assert.strictEqual(fs.readFileSync(path.join(b.mount, 'LOG.CSV')).toString(), 'time,temp_c,humidity,note\r\nold,1.0,2.0,\r\nnew,3.0,4.0,\r\n');
          } finally { detach(b); }
          done();
        });
      });
    });
  });
});

test('DIR_FULL when the root directory has no free slot, existing files untouched', function (done) {
  var img = copyImage(), dev = memdev.open(img), made = [];
  mountVol(dev, function (vol) {
    (function mk(i) {
      vol.create('F' + (1000 + i) + '.TXT', function (e, entry) {
        if (e) {
          assert.strictEqual(e.code, 'DIR_FULL'); assert.ok(made.length >= 10 && made.length <= 16, 'made ' + made.length);
          return vol.readAll(made[0], function (er, all) { assert.ifError(er); assert.strictEqual(all.length, 0); dev.close(); fsckClean(img); done(); });
        }
        made.push(entry); mk(i + 1);
      });
    })(0);
  });
});

test('allocation starts at the FSInfo next-free hint', function (done) {
  var img = copyImage(), dev = memdev.open(img);
  var fsinfoLba = memdev.PART_START + 1;                          // newfs_msdos puts FSInfo at sector 1
  dev.read(fsinfoLba, function (e, b) {
    assert.ifError(e);
    assert.strictEqual(b[0], 0x52, 'FSInfo present');
    b[492] = 5000 % 256; b[493] = Math.floor(5000 / 256); b[494] = 0; b[495] = 0;   // next-free hint = 5000
    dev.write(fsinfoLba, b, function (we) {
      assert.ifError(we);
      mountVol(dev, function (vol) {
        vol.create('HINT.BIN', function (ce, entry) {
          assert.ifError(ce);
          vol.append(entry, new Buffer('x'), function (ae, ent2) {
            assert.ifError(ae); assert.strictEqual(ent2.firstCluster, 5000); dev.close(); fsckClean(img); done();
          });
        });
      });
    });
  });
});

test('a failed write surfaces an IO error instead of hanging', function (done) {
  var img = copyImage(), dev = memdev.open(img);
  mountVol(dev, function (vol) {
    vol.create('LOG.CSV', function (e, entry) {
      assert.ifError(e);
      dev.failAfter = dev.writes;                                // every later write fails
      vol.append(entry, new Buffer('x\r\n'), function (er) { assert.ok(er); assert.strictEqual(er.code, 'IO'); dev.close(); done(); });
    });
  });
});

process.on('uncaughtException', function (e) {
  console.log('FAIL\n' + (e && e.stack));
  try { cp.execFileSync('rm', ['-rf', WORK]); } catch (x) {}
  process.exit(1);
});

(function run(i) {
  if (i === tests.length) {
    cp.execFileSync('rm', ['-rf', WORK]);
    console.log('fat32.test: ' + tests.length + ' passed');
    return;
  }
  var t = tests[i];
  var timer = setTimeout(function () { console.log('TIMEOUT ' + t.name); process.exit(1); }, 60000);
  try { t.fn(function () { clearTimeout(timer); console.log('ok - ' + t.name); run(i + 1); }); }
  catch (e) { console.log('FAIL - ' + t.name + '\n' + (e && e.stack)); cp.execFileSync('rm', ['-rf', WORK]); process.exit(1); }
})(0);
