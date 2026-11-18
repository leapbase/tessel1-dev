// Probe ports A-D for the GPS module (A2235-H), report readiness, then listen for data.
// Run with: tessel run gps-test.js
var tessel = require('tessel');
var gpslib = require('gps-a2235h');

var PORTS = ['A', 'B', 'C', 'D'];
var READY_TIMEOUT = 6000;   // ms to wait for 'ready' on each port
var LISTEN_TIME = 25000;    // ms to listen for fixes once ready

function tryPort(i) {
  if (i >= PORTS.length) {
    console.log('gps: RESULT no GPS module answered on ports ' + PORTS.join(','));
    return;
  }
  var name = PORTS[i];
  console.log('gps: trying port ' + name);
  var gps = gpslib.use(tessel.port[name]);
  var settled = false;

  var timer = setTimeout(function () {
    if (settled) return;
    settled = true;
    console.log('gps: port ' + name + ' no ready event');
    tryPort(i + 1);
  }, READY_TIMEOUT);

  gps.on('error', function (err) {
    console.log('gps: port ' + name + ' error: ' + err);
  });

  gps.on('ready', function () {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    console.log('gps: RESULT module READY on port ' + name);

    ['coordinates', 'fix', 'altitude', 'dropped-signal'].forEach(function (evt) {
      gps.on(evt, function (data) {
        console.log('gps: ' + evt + ' ' + JSON.stringify(data));
      });
    });

    setTimeout(function () {
      console.log('gps: listen window over (no output above means no satellite fix yet)');
      process.exit(0);
    }, LISTEN_TIME);
  });
}

tryPort(0);
