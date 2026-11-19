// File-backed block device for the Mac tests. Presents a synthetic MBR at block 0 and the raw FAT32 image
// (boot sector first) starting at block PART_START, like the real SD card (partition 1 starts at sector 8192).
var fs = require('fs');

var PART_START = 8192;

function le32put(b, o, v) {
  b[o] = v % 256; b[o + 1] = Math.floor(v / 256) % 256; b[o + 2] = Math.floor(v / 65536) % 256; b[o + 3] = Math.floor(v / 16777216) % 256;
}

function mbr(sectors) {
  var b = new Buffer(512);
  b.fill(0);
  b[446 + 4] = 0x0C;
  le32put(b, 446 + 8, PART_START);
  le32put(b, 446 + 12, sectors);
  b[510] = 0x55; b[511] = 0xAA;
  return b;
}

// open(imagePath) -> dev; dev.path, dev.writes (count of block writes), dev.close()
exports.open = function (path) {
  var fd = fs.openSync(path, 'r+');
  var sectors = Math.floor(fs.fstatSync(fd).size / 512);
  var dev = { path: path, writes: 0, failAfter: -1 };
  dev.read = function (lba, cb) {
    var out = new Buffer(512);
    out.fill(0);
    if (lba === 0) out = mbr(sectors);
    else if (lba >= PART_START && lba < PART_START + sectors) fs.readSync(fd, out, 0, 512, (lba - PART_START) * 512);
    setImmediate(function () { cb(null, out); });
  };
  dev.write = function (lba, buf, cb) {
    if (dev.failAfter >= 0 && dev.writes >= dev.failAfter) return setImmediate(function () { cb(new Error('injected write failure')); });
    if (lba < PART_START || lba >= PART_START + sectors || buf.length !== 512) return setImmediate(function () { cb(new Error('bad write lba ' + lba)); });
    fs.writeSync(fd, buf, 0, 512, (lba - PART_START) * 512);
    dev.writes++;
    setImmediate(function () { cb(null); });
  };
  dev.close = function () { fs.closeSync(fd); };
  return dev;
};

// A device that reads as all zeros (not a FAT32 card).
exports.blank = function () {
  return {
    read: function (lba, cb) { var b = new Buffer(512); b.fill(0); setImmediate(function () { cb(null, b); }); },
    write: function (lba, buf, cb) { setImmediate(function () { cb(new Error('blank device is read-only')); }); }
  };
};

exports.PART_START = PART_START;
