// On-board spike for the SD driver + FAT32 writer. Run: tessel run logger/spike-sd.js
// WRITE=false (default): READ-ONLY. Mounts the card and prints geometry, file lookups and the highest IMG number. Safe on any card.
// WRITE=true: creates SPIKE.TXT and appends two lines. ONLY use on the spare / freshly formatted FAT32 card (spec).
var tessel = require('tessel');
var sdcard = require('./sdcard');
var fat32 = require('./fat32');

var PORT = 'A';
var WRITE = false;

function say(m) { console.log('spike: ' + m); }
function finish(m) { say(m); setTimeout(function () { process.exit(0); }, 400); }
function fail(m) { say('SPIKE FAIL: ' + m); setTimeout(function () { process.exit(1); }, 400); }

sdcard.open(tessel.port[PORT], function (e, dev) {
  if (e) return fail('open: ' + e.code + ' ' + e.message);
  say('card ready, ' + (dev.sdhc ? 'SDHC' : 'SDSC'));
  fat32.mount(dev, function (e2, vol) {
    if (e2) return fail('mount: ' + e2.code + ' ' + e2.message);
    say('FAT32 mounted');
    vol.highestImageNumber(function (e3, n) {
      if (e3) return fail('highestImageNumber: ' + e3.code + ' ' + e3.message);
      say('highest IMG number: ' + n);
      vol.find('TESSTEST.TXT', function (e4, f) {
        if (e4) return fail('find: ' + e4.code + ' ' + e4.message);
        say('TESSTEST.TXT: ' + (f ? 'found, ' + f.size + ' bytes, first cluster ' + f.firstCluster : 'not present'));
        if (!WRITE) return finish('SPIKE READ-ONLY PASS');
        vol.create('SPIKE.TXT', function (e5, entry) {
          if (e5) return fail('create: ' + e5.code + ' ' + e5.message);
          vol.append(entry, new Buffer('hello\r\n'), function (e6, ent2) {
            if (e6) return fail('append 1: ' + e6.code + ' ' + e6.message);
            vol.append(ent2, new Buffer('hello\r\n'), function (e7, ent3) {
              if (e7) return fail('append 2: ' + e7.code + ' ' + e7.message);
              vol.find('SPIKE.TXT', function (e8, back) {
                if (e8 || !back) return fail('find SPIKE.TXT after write');
                vol.readAll(back, function (e9, all) {
                  if (e9) return fail('readAll: ' + e9.code + ' ' + e9.message);
                  if (back.size === 14 && all.toString() === 'hello\r\nhello\r\n') finish('SPIKE PASS size=14');
                  else fail('read back size=' + back.size + ' content=' + JSON.stringify(all.toString()));
                });
              });
            });
          });
        });
      });
    });
  });
});
