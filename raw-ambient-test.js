// Ambient module (ATtiny44 + light/sound sensors) READ-ONLY check, NO module library, NO bitwise operators.
// Mirrors the library's pin roles: digital[0]=chip select, digital[1]=ATtiny reset, digital[2]=IRQ.
// Does a normal chip reset, then reads firmware version (expect 0x03), module ID (expect 0x08), light and sound.
// It never sends any firmware-programming (ISP) commands.
var tessel = require('tessel');
var PORT = 'D';
var port = tessel.port[PORT];
function say(m) { console.log('ambient[' + PORT + ']: ' + m); }
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push(hex2(b[i])); return s.join(' '); }
function finish(m) { say('RESULT ' + m); setTimeout(function () { process.exit(0); }, 300); }

var cs = port.digital[0], rst = port.digital[1], irq = port.digital[2];
cs.output(true);
rst.output(true);
irq.rawWrite(false);
var spi;
try { spi = port.SPI({ clockSpeed: 1000, chipSelect: cs, chipSelectDelayUs: 30 }); } catch (e) { finish('SPI unavailable: ' + e); }

function xfer(bytes, cb) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; cb(new Error('timeout')); } }, 2000);
  spi.transfer(new Buffer(bytes), function (e, rx) { if (done) return; done = true; clearTimeout(t); cb(e, rx); });
}
function info(cmd, cb) {                                   // reply: 55 <cmd> <value>
  xfer([cmd, 0x00, 0x00], function (e, rx) {
    if (e || !rx) return cb(e || new Error('no data'));
    say('cmd 0x' + hex2(cmd) + ' -> ' + hex(rx));
    if (rx[0] === 0x55 && rx[1] === cmd) cb(null, rx[2]); else cb(new Error('bad reply'));
  });
}
function sensor(cmd, name, cb) {                           // header [cmd, 1, 0], 2 data bytes, stop 0x16; reply 55 cmd 01 hi lo 16
  xfer([cmd, 0x01, 0x00, 0x00, 0x00, 0x16], function (e, rx) {
    if (e || !rx) return cb(e || new Error('no data'));
    say(name + ' raw frame ' + hex(rx));
    if (rx[0] === 0x55 && rx[1] === cmd && rx[5] === 0x16) { var v = rx[3] * 256 + rx[4]; cb(null, v); }
    else cb(new Error('bad ' + name + ' reply'));
  });
}

say('pulsing reset, then waiting 300 ms');
rst.low();
rst.high();
(function () {
  setTimeout(function () {
    info(0x01, function (e, fw) {
      if (e) return finish('no valid reply to firmware-version command (' + e + '): no ambient module on this port, or not seated');
      say('firmware version = 0x' + hex2(fw) + ' (library expects 0x03)');
      info(0x08, function (e2, id) {
        if (e2) return finish('module ID read failed: ' + e2);
        say('module ID = 0x' + hex2(id) + ' (ambient module is 0x08)');
        if (id !== 0x08) return finish('a module answered but its ID is not the ambient module');
        sensor(0x02, 'light', function (e3, light) {
          if (e3) return finish('AMBIENT MODULE FOUND, light read failed: ' + e3);
          sensor(0x03, 'sound', function (e4, sound) {
            if (e4) return finish('AMBIENT MODULE FOUND, sound read failed: ' + e4);
            say('light = ' + (light / 1024).toFixed(3) + ' (raw ' + light + ' of 1024)   sound = ' + (sound / 1024).toFixed(3) + ' (raw ' + sound + ' of 1024)');
            finish('AMBIENT MODULE OK' + (fw === 0x03 ? '' : ' (firmware version differs from the library, not updated)'));
          });
        });
      });
    });
  }, 300);
})();
