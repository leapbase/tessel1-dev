// On-board check of the climate (port D) and camera (port B) modules. Run: tessel run logger/spike-sensors.js
// Prints SENSORS PASS when temperature is -20..60 C, humidity 0..100 %RH and the photo is > 5000 bytes starting FF D8.
var tessel = require('tessel');
var climate = require('./climate');
var camera = require('./camera');

function say(m) { console.log('sensors: ' + m); }
function finish(code, m) { say(m); setTimeout(function () { process.exit(code); }, 400); }

var count = 0, head = [], aborted = false;
var sink = {
  write: function (chunk, cb) { if (head.length < 2) for (var i = 0; i < chunk.length && head.length < 2; i++) head.push(chunk[i]); count += chunk.length; cb(null); },
  abort: function () { aborted = true; }
};

climate.read(tessel.port['D'], function (e, r) {
  if (e) return finish(1, 'SENSORS FAIL climate: ' + e.message);
  say('temp ' + r.tempC.toFixed(1) + ' C, humidity ' + r.humidity.toFixed(1) + ' %RH');
  var t0 = Date.now();
  camera.capture(tessel.port['B'], sink, function (e2, n) {
    if (e2) return finish(1, 'SENSORS FAIL camera after ' + (Date.now() - t0) + ' ms: ' + e2.message + ' (sink aborted: ' + aborted + ')');
    say('photo ' + n + ' bytes (sink saw ' + count + '), starts ' + head[0].toString(16) + ' ' + head[1].toString(16) + ', ' + (Date.now() - t0) + ' ms');
    var ok = r.tempC > -20 && r.tempC < 60 && r.humidity >= 0 && r.humidity <= 100 && n > 5000 && n === count && head[0] === 0xFF && head[1] === 0xD8;
    finish(ok ? 0 : 1, ok ? 'SENSORS PASS' : 'SENSORS FAIL values out of range');
  });
});
