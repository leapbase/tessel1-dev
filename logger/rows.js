// CSV rows for LOG.CSV: always four columns (time,temp_c,humidity,note), CRLF line ends.
exports.header = function () {
  return 'time,temp_c,humidity,note\r\n';
};

exports.reading = function (ts, tempC, humidity) {
  return ts + ',' + tempC.toFixed(1) + ',' + humidity.toFixed(1) + ',\r\n';
};

exports.note = function (ts, note) {
  return ts + ',,,' + note + '\r\n';
};

exports.isPhotoMinute = function (minuteIndex) {
  return minuteIndex % 5 === 0;
};

// GPS.CSV rows: time,lat,lon,alt_m,sats,note (always six columns)
exports.gpsHeader = function () {
  return 'time,lat,lon,alt_m,sats,note\r\n';
};

exports.gpsFix = function (ts, g) {
  return ts + ',' + g.lat.toFixed(6) + ',' + g.lon.toFixed(6) + ',' + g.alt.toFixed(1) + ',' + g.sats + ',\r\n';
};

exports.gpsNote = function (ts, note) {
  return ts + ',,,,,' + note + '\r\n';
};
