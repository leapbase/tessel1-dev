// Minute scheduler anchored to the start time, so a slow cycle (a photo takes ~35 s) does not push later minutes back.
// next(startMs, nowMs, lastMinute) -> { minute, delayMs }: the next minute index to run and how long to wait for it.
// A tick less than a minute late runs immediately under its own index; a whole minute or more late jumps to the current
// minute (no burst of catch-up rows).
exports.next = function (startMs, nowMs, lastMinute) {
  var minute = lastMinute + 1;
  var due = startMs + minute * 60000;
  if (nowMs - due >= 60000) {
    minute = Math.floor((nowMs - startMs) / 60000);
    due = startMs + minute * 60000;
  }
  return { minute: minute, delayMs: Math.max(0, due - nowMs) };
};
