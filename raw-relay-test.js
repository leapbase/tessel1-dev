// Relay module click test, NO module library, NO bitwise operators.
// Channel 1 = digital[0], channel 2 = digital[1] (as in relay-mono). Pulses each channel ON for ON_MS, OFF for OFF_MS, PULSES times.
// WARNING: this really switches whatever is wired to the relay terminals. Both channels are left OFF at the end.
var tessel = require('tessel');
var PORT = 'B';
var PULSES = 3, ON_MS = 500, OFF_MS = 500;
var port = tessel.port[PORT];
function say(m) { console.log('relay[' + PORT + ']: ' + m); }

var ch = { 1: port.digital[0], 2: port.digital[1] };
port.digital[0].output(false);
port.digital[1].output(false);
port.digital[2].output(false);                    // the library also drives this pin low at start-up
say('both channels OFF at start');

function allOff() { ch[1].output(false); ch[2].output(false); }

function pulse(channel, n, cb) {
  if (n > PULSES) return cb();
  ch[channel].write(1);
  say('channel ' + channel + ' ON  (pulse ' + n + ' of ' + PULSES + ')');
  setTimeout(function () {
    ch[channel].write(0);
    say('channel ' + channel + ' OFF');
    setTimeout(function () { pulse(channel, n + 1, cb); }, OFF_MS);
  }, ON_MS);
}

setTimeout(function () {
  pulse(1, 1, function () {
    setTimeout(function () {
      pulse(2, 1, function () {
        allOff();
        say('RESULT done, both channels OFF. Did you hear/see 3 clicks on channel 1 then 3 on channel 2?');
        setTimeout(function () { process.exit(0); }, 300);
      });
    }, 800);
  });
}, 500);

// safety: if anything goes wrong, make sure the relays end up off
setTimeout(function () { allOff(); process.exit(0); }, 20000);
