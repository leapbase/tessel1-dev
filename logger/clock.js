// Time for a board with no clock: START_EPOCH (set at push time) plus uptime. UTC, ES5, no bitwise operators.
function pad(n, w) {
  var s = String(n);
  while (s.length < w) s = '0' + s;
  return s;
}

// Days since 1970-01-01 -> [year, month, day] (civil-from-days, integer arithmetic only).
function civil(days) {
  var z = days + 719468;
  var era = Math.floor(z / 146097);
  var doe = z - era * 146097;
  var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  var y = yoe + era * 400;
  var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  var mp = Math.floor((5 * doy + 2) / 153);
  var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  var m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? y + 1 : y, m, d];
}

exports.format = function (epochSeconds) {
  var days = Math.floor(epochSeconds / 86400);
  var rem = epochSeconds - days * 86400;
  var c = civil(days);
  var h = Math.floor(rem / 3600);
  var mi = Math.floor((rem - h * 3600) / 60);
  var s = rem - h * 3600 - mi * 60;
  return pad(c[0], 4) + '-' + pad(c[1], 2) + '-' + pad(c[2], 2) + ' ' + pad(h, 2) + ':' + pad(mi, 2) + ':' + pad(s, 2);
};

exports.now = function (startEpoch, uptimeSeconds) {
  return startEpoch + uptimeSeconds;
};
