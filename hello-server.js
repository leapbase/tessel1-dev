// Hello web server for Tessel 1 over Wi-Fi (join a network first: tessel wifi -n <ssid> -p <password> -s wpa2).
// Serves a hello page on port 80 and blinks the green LED on each request. No module libraries needed.
var tessel = require('tessel');
var http = require('http');
var wifi = require('wifi-cc3000');
var hits = 0;

function start() {
  var ip = wifi.connection().ip;
  var server = http.createServer(function (req, res) {
    hits++;
    tessel.led[2].high();
    setTimeout(function () { tessel.led[2].low(); }, 100);
    var body = 'Hello from Tessel 1! Request #' + hits + ' for ' + req.url + '\n';
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': body.length });
    res.end(body);
    console.log('request #' + hits + ': ' + req.method + ' ' + req.url);
  });
  server.listen(80);
  console.log('hello server up: http://' + ip + '/');
}

if (wifi.isConnected()) start();
else {
  console.log('waiting for Wi-Fi...');
  wifi.on('connect', start);
}
wifi.on('disconnect', function () { console.log('wifi disconnected'); });
