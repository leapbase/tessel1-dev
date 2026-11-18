// Smoke test for the Tessel 1 toolchain: blink onboard LEDs a few times, then exit.
// Run with: tessel run blink.js
var tessel = require('tessel');

var led1 = tessel.led[0].output(1);
var led2 = tessel.led[1].output(0);
var count = 0;

console.log('blink: start');

var timer = setInterval(function () {
  led1.toggle();
  led2.toggle();
  count++;
  console.log('blink: tick ' + count);
  if (count >= 10) {
    clearInterval(timer);
    led1.output(0);
    led2.output(0);
    console.log('blink: done');
  }
}, 300);
