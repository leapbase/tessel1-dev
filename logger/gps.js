// GPS tracker for the A2235-H module on port C (the library's software UART only works there).
// start(port) -> { snapshot() }; snapshot() -> {fix: true, lat, lon, alt, sats} | {fix: false} | {err: true}.
// The library emits coordinates/altitude/fix every ~2 s while it has a fix; a fix older than STALE_MS counts as lost.
var gpsLib = require('gps-a2235h');
var STALE_MS = 120000;

exports.start = function (port) {
  gpsLib.debug = 0;
  var st = { lat: 0, lon: 0, alt: 0, sats: 0, at: 0, err: false };
  var g = gpsLib.use(port);
  g.on('error', function () { st.err = true; });                // e.g. "Could not find GPS module"
  g.on('ready', function () { st.err = false; });
  g.on('coordinates', function (c) { st.lat = Number(c.lat); st.lon = Number(c.lon); st.at = Date.now(); });
  g.on('altitude', function (a) { st.alt = Number(a.alt); });
  g.on('fix', function (f) { st.sats = Number(f.numSat); });
  return {
    snapshot: function () {
      if (st.at > 0 && Date.now() - st.at < STALE_MS) return { fix: true, lat: st.lat, lon: st.lon, alt: st.alt, sats: st.sats };
      return st.err ? { err: true } : { fix: false };
    }
  };
};
