// runner.js tests with fake timers (ES5, plain assert): the minute loop must survive throws, stalls and stale callbacks.
var assert = require('assert');
var runner = require('../runner');

function fakeClock() {
  var t = 0, q = [], id = 0;
  return {
    now: function () { return t; },
    setTimeout: function (fn, ms) { q.push({ id: ++id, at: t + ms, fn: fn }); return id; },
    clearTimeout: function (i) { q = q.filter(function (x) { return x.id !== i; }); },
    advance: function (ms) {
      var end = t + ms;
      while (true) {
        q.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
        if (!q.length || q[0].at > end) break;
        var e = q.shift(); t = e.at; e.fn();
      }
      t = end;
    }
  };
}
function fakeLogger(behaviour) {
  var l = { ready: false, boots: [], cycles: [], pending: [] };
  l.boot = function (recovering, cb) { l.boots.push(recovering); l.ready = true; cb(null); };
  l.cycle = function (minute, cb) { l.cycles.push(minute); if (behaviour) return behaviour(minute, cb, l); cb(); };
  return l;
}
function start(l, clock) {
  return runner.start({ logger: l, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, say: function () {}, watchdogMs: 600000 });
}
var MIN = 60000;

// 1. normal operation: boot once (not recovering), then one cycle per minute
(function () {
  var c = fakeClock(), l = fakeLogger();
  start(l, c); c.advance(2 * MIN + 100);
  assert.deepEqual(l.cycles, [0, 1, 2]); assert.deepEqual(l.boots, [false]);
})();

// 2. a cycle that throws synchronously does not stop the loop; the logger is re-booted as "recovering"
(function () {
  var c = fakeClock(), l = fakeLogger(function (m, cb) { if (m === 1) throw new Error('boom'); cb(); });
  start(l, c); c.advance(3 * MIN + 100);
  assert.deepEqual(l.cycles, [0, 1, 2, 3]); assert.deepEqual(l.boots, [false, true]);
})();

// 3. recover() (called from an uncaughtException handler) starts a fresh chain; the stale callback cannot start a second one
(function () {
  var c = fakeClock(), stuck = null, l = fakeLogger(function (m, cb) { if (m === 1 && !stuck) { stuck = cb; return; } cb(); });
  var r = start(l, c); c.advance(MIN + 100);                    // minute 1 started and never calls back
  r.recover('uncaught');
  c.advance(3 * MIN);
  stuck();                                                      // the old callback finally fires
  c.advance(3 * MIN);
  var seen = {};
  l.cycles.forEach(function (m) { seen[m] = (seen[m] || 0) + 1; });
  Object.keys(seen).forEach(function (m) { assert.ok(seen[m] <= 2, 'minute ' + m + ' ran ' + seen[m] + ' times'); });
  assert.ok(l.cycles.length <= 10, 'only one loop chain may run: ' + l.cycles.join(','));
})();

// 4. watchdog: a cycle that never calls back is abandoned after watchdogMs and the loop carries on
(function () {
  var c = fakeClock(), first = true, l = fakeLogger(function (m, cb) { if (first) { first = false; return; } cb(); });
  start(l, c); c.advance(10 * MIN + MIN);
  assert.ok(l.cycles.length >= 2, 'loop restarted after the watchdog: ' + l.cycles.join(','));
  assert.ok(l.boots.length >= 2 && l.boots[1] === true, 'logger re-booted after the stall');
})();

console.log('runner.test: all passed');
