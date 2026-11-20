// Status web server for Tessel 1 (board 2 layout: BLE113A on port A). Read-only, no controls, no secrets.
//   /             HTML status page, refreshes every 10 s
//   /status.json  the same data as JSON
// Needs node_modules: ble-ble113a@0.2.0, bglib@0.0.6, async@0.9.0, bleadvertise@0.1.1. Join Wi-Fi first (README).
// BLE: scans 6 s every 30 s. Only a count and signal strength are kept, never device addresses.
var tessel = require('tessel');
var http = require('http');
var wifi = require('wifi-cc3000');
var ENABLE_BLE = false; // true: BLE scan summary on the page. On board 2 this made the web server stop answering (see board-2.md).
var BLE_PORT = 'A';
var startedAt = Date.now();
var hits = 0;
var ble = { state: 'starting', lastScanSecondsAgo: null, devices: 0, strongestRssi: null, scans: 0 };
var lastScanAt = null;

var serverStarted = false;
var bt = !ENABLE_BLE ? null : require('ble-ble113a').use(tessel.port[BLE_PORT], function (err) {
  if (err) ble.state = 'error: ' + err;
});
if (bt) {
// The library only sets filteredUUIDs inside startScanning(); a discovery before that (module left scanning by an earlier run) would crash it.
bt.filteredUUIDs = [];
// The library emits 'error' if the module misses its start-up handshake. Without a handler that kills the script.
bt.on('error', function (err) {
  ble.state = 'error: ' + (err && err.message ? err.message : err);
  console.log('ble: ' + ble.state);
  beginServer();
});
var seen = {}, count = 0, strongest = null, scanning = false;
bt.on('ready', function () { ble.state = 'ready'; console.log('ble: ready'); scan(); setInterval(scan, 30000); beginServer(); });
bt.on('discover', function (p) {
  if (!scanning) return;
  var id = String(p.address || p.toString());
  if (!seen[id]) { seen[id] = 1; count++; }
  if (typeof p.rssi === 'number' && (strongest === null || p.rssi > strongest)) strongest = p.rssi;
});
function scan() {
  seen = {}; count = 0; strongest = null; scanning = true;
  try { bt.startScanning(); } catch (e) { ble.state = 'scan error: ' + e; return; }
  setTimeout(function () {
    scanning = false;
    try { bt.stopScanning(); } catch (e) {}
    ble.devices = count; ble.strongestRssi = strongest; ble.scans++; lastScanAt = Date.now();
  }, 6000);
}
} else {
  ble.state = 'disabled';
  setTimeout(beginServer, 100);
}

function status() {
  var c = wifi.isConnected() ? wifi.connection() : null;
  ble.lastScanSecondsAgo = lastScanAt ? Math.round((Date.now() - lastScanAt) / 1000) : null;
  return {
    board: 'Tessel 1',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    requests: hits,
    wifi: { connected: !!c, ip: c ? c.ip : null },
    ble: ble
  };
}

function page(s) {
  var rows = [
    ['Board', s.board],
    ['Uptime', s.uptimeSeconds + ' s'],
    ['Requests served', s.requests],
    ['Wi-Fi', s.wifi.connected ? 'connected, ' + s.wifi.ip : 'not connected'],
    ['BLE module', s.ble.state],
    ['BLE devices nearby', s.ble.scans ? s.ble.devices + ' (strongest signal ' + s.ble.strongestRssi + ' dBm, scan ' + s.ble.lastScanSecondsAgo + ' s ago)' : 'no scan finished yet']
  ];
  var h = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="10"><title>Tessel status</title>' +
    '<style>body{font-family:system-ui,sans-serif;max-width:32em;margin:2em auto;padding:0 1em}td{padding:.35em .8em .35em 0}td:first-child{color:#666}</style></head><body>' +
    '<h1>Tessel 1 status</h1><table>';
  for (var i = 0; i < rows.length; i++) h += '<tr><td>' + rows[i][0] + '</td><td>' + rows[i][1] + '</td></tr>';
  return h + '</table><p><a href="/status.json">status.json</a></p></body></html>\n';
}

function send(res, type, body) {
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function start() {
  http.createServer(function (req, res) {
    hits++;
    tessel.led[2].high(); setTimeout(function () { tessel.led[2].low(); }, 100);
    console.log('request #' + hits + ': ' + req.method + ' ' + req.url);
    var s = status();
    if (req.url === '/status.json') return send(res, 'application/json', JSON.stringify(s) + '\n');
    if (req.url === '/' || req.url === '/index.html') return send(res, 'text/html; charset=utf-8', page(s));
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found\n');
  }).listen(80);
  console.log('status server up: http://' + wifi.connection().ip + '/');
}
// Start the web server once BLE has either come up or failed, and Wi-Fi is connected (BLE first: its handshake is timing sensitive).
function beginServer() {
  if (serverStarted) return;
  serverStarted = true;
  if (wifi.isConnected()) start(); else { console.log('waiting for Wi-Fi...'); wifi.on('connect', start); }
}
setTimeout(beginServer, 15000);
