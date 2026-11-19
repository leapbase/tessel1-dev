// DATA.CSV rows: one line per minute with everything together. Always eight columns, CRLF line ends:
//   time,temp_c,humidity,lat,lon,alt_m,sats,note
// note is empty for a normal row, otherwise ';'-joined flags: sensor_err (climate read failed), nofix (GPS has no fix),
// gps_err (GPS module problem); standalone rows use boot or photo_err.
exports.header = function () {
  return 'time,temp_c,humidity,lat,lon,alt_m,sats,note\r\n';
};

// climate: {tempC, humidity} or null when the read failed. gps: undefined (no GPS wired in), {err: true},
// {fix: false} or {fix: true, lat, lon, alt, sats}.
exports.reading = function (ts, climate, gps) {
  var notes = [];
  if (!climate) notes.push('sensor_err');
  var lat = '', lon = '', alt = '', sats = '';
  if (gps) {
    if (gps.err) notes.push('gps_err');
    else if (!gps.fix) notes.push('nofix');
    else { lat = gps.lat.toFixed(6); lon = gps.lon.toFixed(6); alt = gps.alt.toFixed(1); sats = String(gps.sats); }
  }
  var temp = climate ? climate.tempC.toFixed(1) : '';
  var hum = climate ? climate.humidity.toFixed(1) : '';
  return [ts, temp, hum, lat, lon, alt, sats, notes.join(';')].join(',') + '\r\n';
};

exports.note = function (ts, note) {
  return ts + ',,,,,,,' + note + '\r\n';
};

exports.isPhotoMinute = function (minuteIndex) {
  return minuteIndex % 5 === 0;
};
