// Probe ports A-D for the camera module (VC0706), take one photo, send it to the host.
// Run with: tessel run camera-test.js
var tessel = require('tessel');
var cameralib = require('camera-vc0706');

var PORTS = ['A', 'B', 'C', 'D'];
var READY_TIMEOUT = 6000;

function tryPort(i) {
  if (i >= PORTS.length) {
    console.log('camera: RESULT no camera module answered on ports ' + PORTS.join(','));
    return;
  }
  var name = PORTS[i];
  console.log('camera: trying port ' + name);
  var camera = cameralib.use(tessel.port[name]);
  var settled = false;

  var timer = setTimeout(function () {
    if (settled) return;
    settled = true;
    console.log('camera: port ' + name + ' no ready event');
    tryPort(i + 1);
  }, READY_TIMEOUT);

  camera.on('error', function (err) {
    console.log('camera: port ' + name + ' error: ' + err);
  });

  camera.on('ready', function () {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    console.log('camera: RESULT module READY on port ' + name);
    camera.takePicture(function (err, image) {
      if (err) {
        console.log('camera: takePicture failed: ' + err);
        return process.exit(1);
      }
      console.log('camera: picture taken, ' + image.length + ' bytes');
      process.sendfile('camera-test.jpg', image);
      console.log('camera: sent camera-test.jpg to host');
      setTimeout(function () { process.exit(0); }, 1500);
    });
  });
}

tryPort(0);
