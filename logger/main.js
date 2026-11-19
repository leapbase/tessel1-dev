// Tessel 1 standalone logger: temperature and humidity to LOG.CSV every minute, a photo to IMGnnnn.JPG every 5 minutes.
// Ports (board 1): SD card A, camera B, GPS C, climate D. Also GPS.CSV: lat/lon/alt/satellites every minute (nofix indoors).
// Push with logger/push.sh (it fills in START_EPOCH).
var tessel = require('tessel');
var sdcard = require('./sdcard');
var fat32 = require('./fat32');
var climate = require('./climate');
var camera = require('./camera');
var app = require('./app');
var runner = require('./runner');

var START_EPOCH = 0;   // PUSH_TIME_PLACEHOLDER (seconds since 1970, UTC; replaced at push time)
var bootMs = Date.now();

function say(m) { console.log('logger: ' + m); }

// A GPS problem must never keep the logger from starting: report it as gps_err rows instead.
var gps;
try { gps = require('./gps').start(tessel.port['C']); }
catch (e) { say('GPS start failed: ' + e); gps = { snapshot: function () { return { err: true }; } }; }

function blink() {
  var led = tessel.led[1], n = 0;
  (function step() {
    if (n >= 6) return led.low();
    led.output(n % 2 === 0 ? 1 : 0);
    n++;
    setTimeout(step, 150);
  })();
}

var logger = app.create({
  openCard: function (cb) { sdcard.open(tessel.port['A'], cb); },
  mount: fat32.mount,
  climateRead: function (cb) { climate.read(tessel.port['D'], cb); },
  capture: function (sink, cb) { camera.capture(tessel.port['B'], sink, cb); },
  gpsSnapshot: gps.snapshot,
  nowEpoch: function () { return START_EPOCH + Math.floor((Date.now() - bootMs) / 1000); },
  blink: blink,
  say: say
});

var run = runner.start({
  logger: logger,
  now: function () { return Date.now(); },
  setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
  clearTimeout: function (id) { clearTimeout(id); },
  say: say,
  watchdogMs: 600000                  // a cycle (a photo takes ~3 min) stuck for 10 minutes is abandoned
});

// A throw inside a driver callback would otherwise end the program (red LED on): restart the loop instead.
try { process.on('uncaughtException', function (e) { say('uncaught: ' + e); run.recover('uncaught exception'); }); }
catch (e) { say('uncaughtException handler unavailable: ' + e); }
