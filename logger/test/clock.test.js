// Plain-assert tests (ES5) so they run on Node 24 and on the Node 0.12 used for the Tessel CLI.
var assert = require('assert');
var clock = require('../clock');
var rows = require('../rows');

function commas(s) { return s.split(',').length - 1; }

assert.strictEqual(clock.format(0), '1970-01-01 00:00:00');
assert.strictEqual(clock.format(1795046400), '2026-11-19 00:00:00');
assert.strictEqual(clock.format(86399), '1970-01-01 23:59:59');
assert.strictEqual(clock.format(86400), '1970-01-02 00:00:00');
assert.strictEqual(clock.format(951782400), '2000-02-29 00:00:00');
assert.strictEqual(clock.format(951782400 + 86400), '2000-03-01 00:00:00');
assert.strictEqual(clock.now(1000, 61), 1061);

// One combined CSV row per minute: time,temp_c,humidity,lat,lon,alt_m,sats,note (always 8 columns = 7 commas)
var C = { tempC: 21.34, humidity: 40.06 };
var FIX = { fix: true, lat: 42.3601234, lon: -71.0589, alt: 12.34, sats: 7 };
assert.strictEqual(rows.header(), 'time,temp_c,humidity,lat,lon,alt_m,sats,note\r\n');
assert.strictEqual(rows.reading('t', C), 't,21.3,40.1,,,,,\r\n');                           // no GPS wired in
assert.strictEqual(rows.reading('t', C, { fix: false }), 't,21.3,40.1,,,,,nofix\r\n');
assert.strictEqual(rows.reading('t', C, FIX), 't,21.3,40.1,42.360123,-71.058900,12.3,7,\r\n');
assert.strictEqual(rows.reading('t', C, { err: true }), 't,21.3,40.1,,,,,gps_err\r\n');
assert.strictEqual(rows.reading('t', null, FIX), 't,,,42.360123,-71.058900,12.3,7,sensor_err\r\n');
assert.strictEqual(rows.reading('t', null, { fix: false }), 't,,,,,,,sensor_err;nofix\r\n');
assert.strictEqual(rows.reading('t', null, { err: true }), 't,,,,,,,sensor_err;gps_err\r\n');
assert.strictEqual(rows.note('t', 'boot'), 't,,,,,,,boot\r\n');
assert.strictEqual(rows.note('t', 'photo_err'), 't,,,,,,,photo_err\r\n');
[rows.header(), rows.reading('t', C), rows.reading('t', C, FIX), rows.reading('t', null, { err: true }), rows.note('t', 'boot')].forEach(function (r) {
  assert.strictEqual(commas(r), 7, r);
});
assert.strictEqual(rows.isPhotoMinute(0), true);
assert.strictEqual(rows.isPhotoMinute(5), true);
assert.strictEqual(rows.isPhotoMinute(3), false);

console.log('clock.test: all passed');
