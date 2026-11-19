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
