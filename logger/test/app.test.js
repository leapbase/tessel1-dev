// app.js tests: boot and cycle logic against a real FAT32 image, with fake sensors and camera (ES5, plain assert).
var assert = require('assert');
var memdev = require('./memdev');
var img = require('./img');
var fat32 = require('../fat32');
var app = require('../app');

img.setup();
var JPEG = (function () { var b = new Buffer(3000); for (var i = 0; i < 3000; i++) b[i] = (i * 7) % 251; b[0] = 0xFF; b[1] = 0xD8; b[2998] = 0xFF; b[2999] = 0xD9; return b; })();

// Fake hardware. opts: noCard, climateFails, cameraFails; calls = ordered list of device calls.
function make(imagePath, opts) {
  opts = opts || {};
  var dev = memdev.open(imagePath), calls = [], notes = [], epoch = 1795046400;
  var deps = {
    openCard: function (cb) { calls.push('card'); if (opts.noCard) { var e = new Error('no card'); e.code = 'NO_CARD'; return cb(e); } cb(null, dev); },
    mount: fat32.mount,
    climateRead: function (cb) { calls.push('climate'); if (opts.climateFails) return cb(new Error('i2c')); cb(null, { tempC: 21.34, humidity: 40.06 }); },
    capture: function (sink, cb) {
      calls.push('capture');
      if (opts.cameraFails) { sink.abort(); return cb(new Error('camera timeout')); }
      (function next(off) {
        if (off >= JPEG.length) return cb(null, JPEG.length);
        sink.write(JPEG.slice(off, Math.min(off + 128, JPEG.length)), function () { next(off + 128); });
      })(0);
    },
    nowEpoch: function () { return epoch++; },
    blink: function () { calls.push('blink'); },
    say: function (m) { notes.push(m); }
  };
  return { dev: dev, deps: deps, calls: calls, notes: notes };
}
function mountImg(imagePath, cb) {
  var dev = memdev.open(imagePath);
  fat32.mount(dev, function (e, vol) { assert.ifError(e); cb(vol, dev); });
}
function readFile(vol, name, cb) {
  vol.find(name, function (e, ent) { assert.ifError(e); if (!ent) return cb(null); vol.readAll(ent, function (e2, b) { assert.ifError(e2); cb(b); }); });
}
function lines(b) { return b.toString().split('\r\n').filter(function (l) { return l.length > 0; }); }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('boot with no card reports NO_CARD, writes nothing, blinks', function (done) {
  var m = make(img.fresh(), { noCard: true }), a = app.create(m.deps);
  a.boot(false, function (e) {
    assert.ok(e); assert.strictEqual(e.code, 'NO_CARD'); assert.strictEqual(a.ready, false);
    assert.strictEqual(m.dev.writes, 0); assert.ok(m.calls.indexOf('blink') >= 0); done();
  });
});

test('boot creates LOG.CSV with header and a boot row; a second boot appends only a boot row', function (done) {
  var path = img.fresh(), m = make(path), a = app.create(m.deps);
  a.boot(false, function (e) {
    assert.ifError(e); assert.strictEqual(a.ready, true);
    var m2 = make(path), a2 = app.create(m2.deps);
    a2.boot(false, function (e2) {
      assert.ifError(e2);
      mountImg(path, function (vol) {
        readFile(vol, 'LOG.CSV', function (b) {
          var l = lines(b);
          assert.strictEqual(l.length, 3, b.toString()); assert.strictEqual(l[0], 'time,temp_c,humidity,note');
          assert.ok(/,,,boot$/.test(l[1])); assert.ok(/,,,boot$/.test(l[2])); done();
        });
      });
    });
  });
});

test('cycle at minute 3 writes one reading row and no photo; every row has four columns', function (done) {
  var path = img.fresh(), m = make(path), a = app.create(m.deps);
  a.boot(false, function () {
    a.cycle(3, function () {
      assert.strictEqual(m.calls.indexOf('capture'), -1);
      mountImg(path, function (vol) {
        readFile(vol, 'LOG.CSV', function (b) {
          var l = lines(b); assert.strictEqual(l.length, 3);
          assert.ok(/^2026-11-19 00:00:\d\d,21\.3,40\.1,$/.test(l[2]), l[2]);
          l.forEach(function (row) { assert.strictEqual(row.split(',').length, 4, row); });
          vol.highestImageNumber(function (e, n) { assert.strictEqual(n, 0); done(); });
        });
      });
    });
  });
});

test('minute 5 logs first, then takes IMG0001.JPG with exact bytes; minute 10 adds IMG0002.JPG', function (done) {
  var path = img.fresh(), m = make(path), a = app.create(m.deps);
  a.boot(false, function () {
    a.cycle(5, function () {
      assert.deepEqual(m.calls.slice(m.calls.indexOf('climate'), m.calls.indexOf('capture') + 1), ['climate', 'capture']);
      a.cycle(10, function () {
        mountImg(path, function (vol, dev) {
          readFile(vol, 'IMG0001.JPG', function (b1) {
            assert.ok(b1.equals(JPEG));
            readFile(vol, 'IMG0002.JPG', function (b2) { assert.ok(b2.equals(JPEG)); dev.close(); img.fsckClean(path); done(); });
          });
        });
      });
    });
  });
});

test('photo numbering continues after the highest existing IMGnnnn.JPG', function (done) {
  var path = img.fresh();
  mountImg(path, function (vol, dev) {
    vol.create('IMG0007.JPG', function (e) {
      assert.ifError(e); dev.close();
      var m = make(path), a = app.create(m.deps);
      a.boot(false, function () {
        a.cycle(5, function () {
          mountImg(path, function (v2) { v2.find('IMG0008.JPG', function (e2, f) { assert.ifError(e2); assert.ok(f && f.size === 3000); done(); }); });
        });
      });
    });
  });
});

test('camera failure: photo_err row, no IMG file, log keeps going', function (done) {
  var path = img.fresh(), m = make(path, { cameraFails: true }), a = app.create(m.deps);
  a.boot(false, function () {
    a.cycle(5, function () {
      assert.strictEqual(a.ready, true);
      mountImg(path, function (vol) {
        readFile(vol, 'LOG.CSV', function (b) {
          var l = lines(b); assert.strictEqual(l.length, 4);
          assert.ok(/,,,photo_err$/.test(l[3]), l[3]);
          vol.highestImageNumber(function (e, n) {
            assert.strictEqual(n, 0); vol.find('IMG0001.JPG', function (e2, f) { assert.strictEqual(f, null); done(); });
          });
        });
      });
    });
  });
});

test('sensor failure: sensor_err row with empty value fields', function (done) {
  var path = img.fresh(), m = make(path, { climateFails: true }), a = app.create(m.deps);
  a.boot(false, function () {
    a.cycle(2, function () {
      mountImg(path, function (vol) {
        readFile(vol, 'LOG.CSV', function (b) { var l = lines(b); assert.ok(/,,,sensor_err$/.test(l[2]), l[2]); done(); });
      });
    });
  });
});

test('root directory full: photo_err, the log row is still written', function (done) {
  var path = img.fresh(), m = make(path), a = app.create(m.deps);
  a.boot(false, function () {
    mountImg(path, function (vol, dev) {
      (function fill(i) {
        vol.create('F' + (1000 + i) + '.TXT', function (e) {
          if (!e) return fill(i + 1);
          assert.strictEqual(e.code, 'DIR_FULL'); dev.close();
          a.cycle(5, function () {
            mountImg(path, function (v2) {
              readFile(v2, 'LOG.CSV', function (b) {
                var l = lines(b); assert.ok(/,21\.3,40\.1,$/.test(l[2]), l[2]); assert.ok(/,,,photo_err$/.test(l[3]), l[3]); done();
              });
            });
          });
        });
      })(0);
    });
  });
});

test('existing LOG.CSV with a damaged entry is left alone and LOG2.CSV is used', function (done) {
  var path = img.fresh();
  mountImg(path, function (vol, dev) {
    vol.create('LOG.CSV', function (e, ent) {
      assert.ifError(e);
      dev.read(ent.dirLba, function (re, d) {                      // size 100 but no first cluster
        d[ent.dirOffset + 28] = 100;
        dev.write(ent.dirLba, d, function () {
          dev.close();
          var m = make(path), a = app.create(m.deps);
          a.boot(false, function (e2) {
            assert.ifError(e2);
            mountImg(path, function (v2) {
              v2.find('LOG.CSV', function (e3, old) {
                assert.strictEqual(old.size, 100);
                readFile(v2, 'LOG2.CSV', function (b) { assert.ok(b && lines(b)[0] === 'time,temp_c,humidity,note'); done(); });
              });
            });
          });
        });
      });
    });
  });
});

test('card write failure mid-cycle: cycle still calls back, app is not ready, recovery boot works', function (done) {
  var path = img.fresh(), m = make(path), a = app.create(m.deps);
  a.boot(false, function () {
    m.dev.failAfter = m.dev.writes;
    a.cycle(3, function () {
      assert.strictEqual(a.ready, false); assert.ok(m.calls.indexOf('blink') >= 0);
      m.dev.failAfter = -1;
      a.boot(true, function (e) {
        assert.ifError(e); assert.strictEqual(a.ready, true);
        a.cycle(4, function () {
          m.dev.close(); img.fsckClean(path);
          mountImg(path, function (vol) {
            readFile(vol, 'LOG.CSV', function (b) { var l = lines(b); assert.ok(l.length >= 3 && /,21\.3,40\.1,$/.test(l[l.length - 1])); done(); });
          });
        });
      });
    });
  });
});

process.on('uncaughtException', function (e) { console.log('FAIL\n' + (e && e.stack)); try { img.cleanup(); } catch (x) {} process.exit(1); });
(function run(i) {
  if (i === tests.length) { img.cleanup(); console.log('app.test: ' + tests.length + ' passed'); return; }
  var t = tests[i];
  var timer = setTimeout(function () { console.log('TIMEOUT ' + t.name); process.exit(1); }, 60000);
  t.fn(function () { clearTimeout(timer); console.log('ok - ' + t.name); run(i + 1); });
})(0);
