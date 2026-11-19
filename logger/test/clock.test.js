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

assert.strictEqual(rows.header(), 'time,temp_c,humidity,note\r\n');
assert.strictEqual(rows.reading('t', 21.34, 40.06), 't,21.3,40.1,\r\n');
assert.strictEqual(rows.note('t', 'boot'), 't,,,boot\r\n');
assert.strictEqual(commas(rows.reading('t', 1, 2)), 3);
assert.strictEqual(commas(rows.note('t', 'sensor_err')), 3);
assert.strictEqual(commas(rows.header()), 3);
assert.strictEqual(rows.isPhotoMinute(0), true);
assert.strictEqual(rows.isPhotoMinute(5), true);
assert.strictEqual(rows.isPhotoMinute(3), false);

console.log('clock.test: all passed');
