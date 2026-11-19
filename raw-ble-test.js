// Read-only check of a BLE113A module (BGAPI over UART, 9600 8N1, reset pin digital[2]; same wiring the
// ble-ble113a library uses). No libraries, no flashing. Pulses reset, listens for the boot event, then sends
// system_hello (00 00 00 01, expects 80 00 00 01) and system_get_info (00 00 00 08, expects 80 0c 00 08 ...).
// UART needs port A, B or D on Tessel 1 (not C). Set PORT below.
var tessel = require('tessel');
var PORT = 'A';
var port = tessel.port[PORT];
function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push(hex2(b[i])); return s.join(' '); }
function say(m) { console.log('ble[' + PORT + ']: ' + m); }
var uart;
try { uart = port.UART({ baudrate: 9600 }); } catch (e) { say('RESULT UART unavailable: ' + e); process.exit(0); }
var rx = [];
uart.on('data', function (d) { for (var i = 0; i < d.length; i++) rx.push(d[i]); });
uart.on('error', function (e) { say('uart error: ' + e); });
function send(name, bytes, wait, next) {
  rx = [];
  uart.write(new Buffer(bytes));
  setTimeout(function () { say(name + ': ' + (rx.length ? hex(rx) : 'no reply')); next(rx.slice()); }, wait);
}
var reset = port.digital[2];
reset.output(false);
setTimeout(function () {
  reset.output(true);
  setTimeout(function () {
    var boot = rx.slice();
    say('after reset: ' + (boot.length ? hex(boot) : 'nothing') + ' (boot event starts 80 0c 00 00)');
    send('hello (want 80 00 00 01)', [0, 0, 0, 1], 700, function (r1) {
      send('get_info (want 80 0c 00 08 ...)', [0, 0, 0, 8], 700, function (r2) {
        var ok = r1.length >= 4 && r1[0] === 0x80 && r1[3] === 1;
        var anyBytes = boot.length || r1.length || r2.length;
        say('RESULT ' + (ok ? 'BLE113A answered BGAPI hello' : (anyBytes ? 'got bytes but not a BGAPI hello reply' : 'no reply')));
        if (r2.length >= 12 && r2[0] === 0x80) say('info: major ' + (r2[4] + r2[5] * 256) + ' minor ' + (r2[6] + r2[7] * 256) + ' patch ' + (r2[8] + r2[9] * 256) + ' build ' + (r2[10] + r2[11] * 256));
        process.exit(0);
      });
    });
  }, 1500);
}, 300);
