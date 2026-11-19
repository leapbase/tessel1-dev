// Scheduler timing tests (ES5, plain assert). next(startMs, nowMs, lastMinute) -> { minute, delayMs }
var assert = require('assert');
var schedule = require('../schedule');

function eq(actual, minute, delayMs) { assert.strictEqual(actual.minute, minute); assert.strictEqual(actual.delayMs, delayMs); }

eq(schedule.next(0, 0, -1), 0, 0);                  // first tick runs immediately
eq(schedule.next(0, 30000, 0), 1, 30000);           // on time: wait for the next minute boundary
eq(schedule.next(0, 61000, 0), 1, 0);               // a cycle ran 1 s over: minute 1 runs now, not skipped
eq(schedule.next(1000, 61000, 0), 1, 0);            // start offset respected (due at 61000)
eq(schedule.next(0, 119999, 0), 1, 0);              // still within minute 1's slack
eq(schedule.next(0, 130000, 0), 2, 0);              // a whole minute missed: jump to the current minute, no catch-up burst
eq(schedule.next(0, 600000, 4), 10, 0);             // long stall (card retry): minute index follows the clock

console.log('schedule.test: all passed');
