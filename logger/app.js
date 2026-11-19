// Logger logic with its hardware injected, so it runs against a FAT32 image on the Mac and against the board alike.
// create(deps) -> app with app.ready, app.boot(recovering, cb(err)), app.cycle(minute, cb()). cycle never reports errors:
// it logs them, blinks, and clears app.ready so the caller re-boots (re-mounts) before the next cycle.
// deps: openCard(cb(err, dev)), mount(dev, cb(err, vol)), climateRead(cb(err, {tempC, humidity})),
//       capture(sink, cb(err, n)), nowEpoch() -> seconds, blink(), say(msg).
// ES5, no bitwise operators.
var clock = require('./clock');
var rows = require('./rows');

var CARD_ERRORS = ['IO', 'NO_CARD', 'INIT', 'NOT_FAT32'];     // the card or filesystem is unusable; anything else is a per-file problem

function pad4(n) { return ('000' + n).slice(-4); }

exports.create = function (deps) {
  var app = { ready: false };
  var vol = null, logEntry = null, gpsEntry = null, imgNo = 0;

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

  function gpsAppend(text, cb) {
    vol.append(gpsEntry, new Buffer(text), function (e, ent) {
      if (e) return cb(e);
      gpsEntry = ent;
      cb(null);
    });
  }

  // Find or create the log file `name` with `header` as its first line. Calls back with code DAMAGED for an entry
  // that claims data but has no clusters.
  function openLog(name, header, cb) {
    vol.find(name, function (e, entry) {
      if (e) return cb(e);
      if (!entry) {
        return vol.create(name, function (e2, created) {
          if (e2) return cb(e2);
          vol.append(created, new Buffer(header), cb);
        });
      }
      if (entry.size > 0 && entry.firstCluster < 2) { var d = new Error(name + ' entry is damaged'); d.code = 'DAMAGED'; return cb(d); }
      if (entry.size === 0) return vol.append(entry, new Buffer(header), cb);
      cb(null, entry);
    });
  }

  app.boot = function (recovering, cb) {
    app.ready = false;
    function bad(e) { cardFailed(e); cb(e); }
    deps.openCard(function (e, dev) {
      if (e) return bad(e);
      deps.mount(dev, function (e2, v) {
        if (e2) return bad(e2);
        vol = v;
        openLog('LOG.CSV', rows.header(), function (e3, entry) {
          if (e3 && e3.code === 'DAMAGED') return openLog('LOG2.CSV', rows.header(), function (e4, e5) { gotLog(e4, e5); });
          gotLog(e3, entry);
        });
        function gotLog(le, entry) {
          if (le) return bad(le);
          logEntry = entry;
          if (!deps.gpsSnapshot) return afterGps();
          openLog('GPS.CSV', rows.gpsHeader(), function (ge, gentry) {
            if (ge && ge.code === 'DAMAGED') return openLog('GPS2.CSV', rows.gpsHeader(), gotGps);
            gotGps(ge, gentry);
          });
          function gotGps(ge2, gentry2) {
            if (ge2) return bad(ge2);
            gpsEntry = gentry2;
            afterGps();
          }
        }
        function afterGps() {
          vol.highestImageNumber(function (e6, n) {
            if (e6) return bad(e6);
            imgNo = n;
            function ready() { app.ready = true; cb(null); }
            if (recovering) return ready();
            logAppend(rows.note(stamp(), 'boot'), function (e7) { if (e7) return bad(e7); ready(); });
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
      vol.create(name, function (ce, entry) {
        if (ce) return photoFailed(ce, cb);
        vol.append(entry, jpeg, function (ae) {
          if (ae) return photoFailed(ae, cb);
          imgNo++;
          deps.say('saved ' + name + ' (' + jpeg.length + ' bytes)');
          cb();
        });
      });
    });
  }

  // One GPS.CSV row per cycle from the latest GPS snapshot ({fix, lat, lon, alt, sats} or {err}); skipped when no GPS is wired in.
  function gpsRow(cb) {
    if (!deps.gpsSnapshot) return cb(null);
    var g = deps.gpsSnapshot();
    var text = g.err ? rows.gpsNote(stamp(), 'gps_err') : g.fix ? rows.gpsFix(stamp(), g) : rows.gpsNote(stamp(), 'nofix');
    gpsAppend(text, cb);
  }

  app.cycle = function (minute, cb) {
    deps.climateRead(function (e, r) {
      var row = e ? rows.note(stamp(), 'sensor_err') : rows.reading(stamp(), r.tempC, r.humidity);
      logAppend(row, function (le) {
        if (le) { cardFailed(le); return cb(); }
        gpsRow(function (ge) {
          if (ge) { cardFailed(ge); return cb(); }
          if (!rows.isPhotoMinute(minute)) return cb();
          photo(cb);
        });
      });
    });
  };

  return app;
};
