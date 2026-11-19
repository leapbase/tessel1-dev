// On-board regression test for the 2026-11-19 FAT corruption: a block returned by the SD driver must stay valid after the
// runtime reuses memory (the fat32 writer caches FAT sectors for minutes). READ-ONLY. Run: tessel run logger/spike-heldblock.js
// Prints HELDBLOCK PASS when a block held while ~2.4 MB are allocated and dropped keeps its contents.
var tessel = require('tessel');
var sdcard = require('./sdcard');
function say(m) { console.log('held: ' + m); }
function sum(b) { var x = 0; for (var i = 0; i < b.length; i++) x = (x * 31 + b[i]) % 1000003; return x; }
function finish(code, m) { say(m); setTimeout(function () { process.exit(code); }, 300); }

sdcard.open(tessel.port['A'], function (e, dev) {
  if (e) return finish(1, 'HELDBLOCK FAIL open ' + e.message);
  dev.read(0, function (e1, held) {                       // block 0: the MBR, never all zeros on a formatted card
    if (e1) return finish(1, 'HELDBLOCK FAIL read ' + e1.message);
    var want = sum(held), round = 0;
    say('held block sum ' + want);
    (function churn() {
      var junk = [];
      for (var k = 0; k < 40; k++) { var b = new Buffer(20000); b.fill(round % 250); junk.push(b); }
      junk = null;
      round++;
      if (sum(held) !== want) return finish(1, 'HELDBLOCK FAIL the block changed after ' + round + ' rounds (' + sum(held) + ' != ' + want + ')');
      if (round < 60) return setTimeout(churn, 20);
      finish(0, 'HELDBLOCK PASS (sum unchanged after 60 rounds of allocating 800 KB)');
    })();
  });
});
