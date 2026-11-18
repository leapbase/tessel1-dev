// Raw VC0706 camera check with NO module library: power on, send "get version", print the reply.
// Healthy camera replies 76 00 11 00 <len> then ASCII text such as "VC0703 1.00".
var tessel = require('tessel');
var PORT = 'A';
function hex(b) { var s = []; for (var i = 0; i < b.length; i++) s.push((b[i] < 16 ? '0' : '') + b[i].toString(16)); return s.join(' '); }

console.log('raw-camera: port ' + PORT);
var port = tessel.port[PORT];
var got = new Buffer(0);
try {
  var uart = port.UART({ baudrate: 115200 });
  port.digital[2].output().high();          // camera power
  console.log('raw-camera: UART open, power pin high');
  uart.on('data', function (d) {
    got = Buffer.concat([got, d]);
    console.log('raw-camera: rx ' + hex(d));
  });
  setTimeout(function () {
    console.log('raw-camera: tx 56 00 11 00 (get version)');
    uart.write(new Buffer([0x56, 0x00, 0x11, 0x00]));
  }, 1500);
  setTimeout(function () {
    if (got.length === 0) console.log('raw-camera: RESULT no reply (nothing on this port, or wrong baud)');
    else if (got[0] === 0x76) console.log('raw-camera: RESULT CAMERA RESPONDED, text="' + got.slice(5).toString() + '"');
    else console.log('raw-camera: RESULT got data but not a VC0706 frame');
    process.exit(0);
  }, 5000);
} catch (e) {
  console.log('raw-camera: RESULT exception: ' + e);
}
