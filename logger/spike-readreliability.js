// On-board reliability test for SD block reads (READ-ONLY): reads 200 distinct blocks and counts failures.
// Run: tessel run logger/spike-readreliability.js. Prints READS PASS when every read succeeded.
var tessel = require('tessel');
var sdcard = require('./sdcard');
function say(m) { console.log('reads: ' + m); }
function finish(code, m) { say(m); setTimeout(function () { process.exit(code); }, 300); }

sdcard.open(tessel.port['A'], function (e, dev) {
  if (e) return finish(1, 'READS FAIL open ' + e.message);
  var n = 0, errors = 0, firstErr = '', t0 = Date.now();
  (function next() {
    if (n === 200) {
      var retries = dev.stats && dev.stats.retries ? dev.stats.retries : 0;
      return finish(errors === 0 ? 0 : 1, (errors === 0 ? 'READS PASS' : 'READS FAIL') + ': 200 reads, ' + errors + ' errors' + (firstErr ? ' (first: ' + firstErr + ')' : '') + ', ' + retries + ' internal retries, ' + (Date.now() - t0) + ' ms');
    }
    dev.read(38000 + n * 7, function (re) {
      if (re) { errors++; if (!firstErr) firstErr = re.message; }
      n++; next();
    });
  })();
});
