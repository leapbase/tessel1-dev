// Logger logic with its hardware injected, so it runs against a FAT32 image on the Mac and against the board alike.
// DATA.CSV lives in the tessel-log folder and the photos (IMGnnnn.JPG) in the tessel-image folder; nothing is written to the root.
// One DATA.CSV row per minute carries temperature, humidity and the GPS state together; a photo follows every 5th minute.
// create(deps) -> app with app.ready, app.boot(recovering, cb(err)), app.cycle(minute, cb()). cycle never reports errors:
// it logs them, blinks, and clears app.ready so the caller re-boots (re-mounts) before the next cycle.
// deps: openCard(cb(err, dev)), mount(dev, cb(err, vol)), climateRead(cb(err, {tempC, humidity})),
//       capture(sink, cb(err, n)), gpsSnapshot() -> {fix, lat, lon, alt, sats} | {err} (optional), nowEpoch() -> seconds,
//       blink(), say(msg).
// ES5, no bitwise operators.
var clock = require('./clock');
var rows = require('./rows');

var CARD_ERRORS = ['IO', 'NO_CARD', 'INIT', 'NOT_FAT32'];     // the card or filesystem is unusable; anything else is a per-file problem

var LOG_DIR = 'tessel-log';
var IMAGE_DIR = 'tessel-image';

function pad4(n) { return ('000' + n).slice(-4); }

exports.create = function (deps) {
  var app = { ready: false };
  var vol = null, imgVol = null, logEntry = null, imgNo = 0;   // vol: the log folder, imgVol: the photo folder

  function stamp() { return clock.format(deps.nowEpoch()); }
  function cardFailed(e) {
    app.ready = false;
    deps.blink();
    deps.say('card error: ' + (e.code || '') + ' ' + e.message);
  }
  function logAppend(text, cb) {
    vol.append(logEntry, new Buffer(text), function (e, ent) {
      if (e) return cb(e);
      logEntry = ent;
      cb(null);
    });
  }

  // Find or create the log file `name` with `header` as its first line. Calls back with code DAMAGED for an entry
  // whose chain does not match its size (the caller then uses the fallback file and leaves this one untouched).
  function openLog(name, header, cb) {
    vol.find(name, function (e, entry) {
      if (e) return cb(e);
      if (!entry) {
        return vol.create(name, function (e2, created) {
          if (e2) return cb(e2);
          vol.append(created, new Buffer(header), cb);
        });
      }
      vol.checkChain(entry, function (ce) {                       // DAMAGED: size beyond the chain, cluster outside the volume, ...
        if (ce) return cb(ce);
        if (entry.size === 0) return vol.append(entry, new Buffer(header), cb);
        cb(null, entry);
      });
    });
  }

  app.boot = function (recovering, cb) {
    app.ready = false;
    function bad(e) { cardFailed(e); cb(e); }
    deps.openCard(function (e, dev) {
      if (e) return bad(e);
      deps.mount(dev, function (e2, rootVol) {
        if (e2) return bad(e2);
        rootVol.ensureDir(LOG_DIR, function (e2b, dir) {          // everything the logger writes goes in this folder
          if (e2b) return bad(e2b);
          vol = dir;
          rootVol.ensureDir(IMAGE_DIR, function (e2c, imgDir) {   // photos get their own folder
            if (e2c) return bad(e2c);
            imgVol = imgDir;
            openLog('DATA.CSV', rows.header(), function (e3, entry) {
              if (e3 && e3.code === 'DAMAGED') return openLog('DATA2.CSV', rows.header(), gotLog);
              gotLog(e3, entry);
            });
          });
        });
        function gotLog(le, entry) {
          if (le) return bad(le);
          logEntry = entry;
          imgVol.highestImageNumber(function (e4, n) {
            if (e4) return bad(e4);
            imgNo = n;
            function ready() { app.ready = true; cb(null); }
            if (recovering) return ready();
            logAppend(rows.note(stamp(), 'boot'), function (e5) { if (e5) return bad(e5); ready(); });
          });
        }
      });
    });
  };

  // Record a failed photo. A card-level error ends the cycle with the card marked unusable.
  function photoFailed(e, cb) {
    deps.say('photo failed: ' + (e.code || '') + ' ' + e.message);
    if (e.code && CARD_ERRORS.indexOf(e.code) >= 0) { cardFailed(e); return cb(); }
    logAppend(rows.note(stamp(), 'photo_err'), function (le) { if (le) cardFailed(le); cb(); });
  }

  function photo(cb) {
    var chunks = [];
    var sink = { write: function (c, d) { chunks.push(new Buffer(c)); d(null); }, abort: function () { chunks = []; } };
    deps.capture(sink, function (e) {
      if (e) return photoFailed(e, cb);
      var jpeg = Buffer.concat(chunks);                          // the whole JPEG is in RAM before any file exists: no partial files
      var name = 'IMG' + pad4(imgNo + 1) + '.JPG';
      imgVol.create(name, function (ce, entry) {
        if (ce) return photoFailed(ce, cb);
        imgVol.append(entry, jpeg, function (ae) {
          if (ae) return photoFailed(ae, cb);
          imgNo++;
          deps.say('saved ' + name + ' (' + jpeg.length + ' bytes)');
          cb();
        });
      });
    });
  }

  function gpsNow() {
    if (!deps.gpsSnapshot) return undefined;
    try { return deps.gpsSnapshot(); } catch (e) { deps.say('gps snapshot failed: ' + e); return { err: true }; }
  }

  app.cycle = function (minute, cb) {
    deps.climateRead(function (e, r) {
      logAppend(rows.reading(stamp(), e ? null : r, gpsNow()), function (le) {
        if (le) { cardFailed(le); return cb(); }
        if (!rows.isPhotoMinute(minute)) return cb();
        photo(cb);
      });
    });
  };

  return app;
};
