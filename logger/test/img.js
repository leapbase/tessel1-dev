// Test helpers: FAT32 image copies and fsck_msdos (macOS). Used by app.test.js.
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var WORK = path.join(os.tmpdir(), 'app-test-' + process.pid);
var BASE = path.join(WORK, 'base.img');
var n = 0;

exports.setup = function () {
  fs.mkdirSync(WORK);
  cp.execFileSync(path.join(__dirname, 'make-image.sh'), [BASE, '1', '64']);
};
exports.fresh = function () {
  var out = path.join(WORK, 'img' + (++n) + '.img');
  cp.execFileSync('cp', ['-c', BASE, out]);
  return out;
};
exports.fsckClean = function (img) {
  var out = cp.execFileSync('hdiutil', ['attach', '-nomount', '-imagekey', 'diskimage-class=CRawDiskImage', img]).toString();
  var dev = out.trim().split('\n')[0].split(/\s+/)[0];
  try { cp.execFileSync('fsck_msdos', ['-n', dev.replace('/dev/disk', '/dev/rdisk')]); }
  finally { cp.execFileSync('hdiutil', ['detach', dev]); }
};
exports.cleanup = function () { cp.execFileSync('rm', ['-rf', WORK]); };
