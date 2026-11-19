// The minute loop, with timers injected so it can be tested. It must never stop: a throw, a stalled cycle, or an
// uncaught exception inside a callback restarts the loop instead of leaving the board with the red error LED on.
// start({logger, now, setTimeout, clearTimeout, say, watchdogMs}) -> { recover(reason) }
// Each restart bumps a generation number, so callbacks left over from an abandoned cycle are ignored (one chain only).
var schedule = require('./schedule');

exports.start = function (o) {
  var logger = o.logger, gen = 0, last = -1, booted = false, startMs = o.now(), timer = null, dog = null;

  function clearTimers() {
    if (timer !== null) o.clearTimeout(timer);
    if (dog !== null) o.clearTimeout(dog);
    timer = null; dog = null;
  }

  function runOnce(g, done) {
    function go() {
      logger.cycle(last, function () {
        if (g === gen) o.say('minute ' + last + ' done, ready=' + logger.ready);
        done();
      });
    }
    if (logger.ready) return go();
    logger.boot(booted, function (e) {
      if (g !== gen) return;
      if (e) { o.say('boot failed (' + (e.code || '') + ' ' + e.message + '), retry next minute'); return done(); }
      booted = true;
      o.say('booted');
      go();
    });
  }

  function loop(g) {
    if (g !== gen) return;
    var n = schedule.next(startMs, o.now(), last);
    timer = o.setTimeout(function () {
      timer = null;
      if (g !== gen) return;
      last = n.minute;
      var finished = false;
      function finish() {
        if (finished || g !== gen) return;
        finished = true;
        if (dog !== null) { o.clearTimeout(dog); dog = null; }
        loop(g);
      }
      dog = o.setTimeout(function () { dog = null; recover('cycle stalled for ' + o.watchdogMs + ' ms'); }, o.watchdogMs);
      try { runOnce(g, finish); }
      catch (e) { o.say('unexpected error: ' + e); logger.ready = false; finish(); }
    }, n.delayMs);
  }

  function recover(reason) {
    gen++;
    clearTimers();
    logger.ready = false;                 // re-mount the card before the next cycle
    o.say('recovering: ' + reason);
    loop(gen);
  }

  loop(gen);
  return { recover: recover };
};
