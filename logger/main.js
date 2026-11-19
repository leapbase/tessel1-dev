// Tessel 1 standalone logger: temperature and humidity to LOG.CSV every minute, a photo to IMGnnnn.JPG every 5 minutes.
// Ports (board 1): SD card A, camera B, GPS C, climate D. Also GPS.CSV: lat/lon/alt/satellites every minute (nofix indoors). Push with logger/push.sh (it fills in START_EPOCH).
var tessel = require('tessel');
var sdcard = require('./sdcard');
var fat32 = require('./fat32');
var climate = require('./climate');
var camera = require('./camera');
var gps = require('./gps').start(tessel.port['C']);
var app = require('./app');
var schedule = require('./schedule');

var START_EPOCH = 0;   // PUSH_TIME_PLACEHOLDER (seconds since 1970, UTC; replaced at push time)
var bootMs = Date.now();

function say(m) { console.log('logger: ' + m); }

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

var last = -1, booted = false;

function runOnce(done) {
  function go() { logger.cycle(last, function () { say('minute ' + last + ' done, ready=' + logger.ready); done(); }); }
  if (logger.ready) return go();
  logger.boot(booted, function (e) {
    if (e) { say('boot failed (' + (e.code || '') + ' ' + e.message + '), retry next minute'); return done(); }
    booted = true;
    say('booted');
    go();
  });
}

(function loop() {
  var n = schedule.next(bootMs, Date.now(), last);
  setTimeout(function () {
    last = n.minute;
    try { runOnce(loop); }
    catch (e) { say('unexpected error: ' + e); logger.ready = false; loop(); }   // never stop: a crashed cycle must not leave the red LED on
  }, n.delayMs);
})();
