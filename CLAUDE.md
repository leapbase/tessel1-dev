# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Standalone scripts that run **on a physical Tessel 1 board** (connected over USB), plus dev notes in `README.md`. There is no app, build step, linter, or test runner. "Running a test" means deploying a script to the board and reading the log output it streams back. `README.md` is the source of truth for setup workarounds, board/firmware details, and recorded hardware test results; update it when you verify something new on the board.

## Commands

The Tessel 1 CLI only exists under Node 0.12, so every shell needs `nvm use 0.12` first.

```sh
nvm use 0.12
tessel list                          # confirm the board is connected
tessel run blink.js                  # toolchain smoke test (LEDs + 10 log lines)
tessel run raw-gps-test.js           # GPS on port D, listens 8 s
tessel run raw-camera-test.js        # camera version check (edit PORT first, see below)
tessel run raw-camera-photo.js -u .  # capture JPEG; -u <dir> is required or the file is discarded
```

`tessel run` streams output and does not persist; `tessel push` writes to flash. Each script ends by printing a `RESULT ...` line and calling `process.exit`, so look for that line when checking whether a run passed.

## Runtime constraints (critical when writing board code)

The scripts run on Tessel 1's **Colony runtime** (JS compiled to Lua), not Node.js:

- **No bitwise operators.** `<<`, `>>`, `|`, `&`, `^` compile to a call this firmware lacks and crash with `attempt to call field 'tointegervalue' (a nil value)`. Use arithmetic instead (`Math.floor(n / 256) % 256`, `a * 256 + b`); see the `hi()`/`lo()` helpers in `raw-camera-photo.js`.
- Write ES5 only: `var`, `function`, `new Buffer(...)`. No arrow functions, `let`/`const`, classes, or template strings.
- Most npm packages won't run on the board. The module libraries in `package.json` (`gps-a2235h`, `camera-vc0706`) **crash here** because they use bitwise ops; `gps-test.js` and `camera-test.js` depend on them and are kept only for reference. New hardware code should talk to modules directly over `port.UART(...)`, as the `raw-*` scripts do.
- Files come back to the host through `process.sendfile(name, buffer)`, which only saves when the run has `-u <dir>` or `TESSEL_UPLOAD_DIR` set.

## Hardware layout

- Camera (VC0706) on **port B**, GPS (A2235-H) on **port D**. Port C can't do UART on this firmware (use A, B, or D).
- `raw-camera-test.js` currently has `PORT = 'A'`; change it to `'B'` for the camera as wired.
- The camera is powered by setting `port.digital[2]` high before sending commands. VC0706 commands start with `56 00`, replies with `76 00 <cmd> 00`, at 115200 baud.
- The GPS outputs **SiRF binary** at 115200 baud (`A0 A2 <len16> <payload> <csum16> B0 B3`), not NMEA. `raw-gps-test.js` decodes message IDs `0x29` (nav-valid, 0 = fix) and `0x04` (per-satellite C/N0). Getting a fix requires a view of the sky.
- Firmware can't be updated (`builds.tessel.io` no longer resolves). Don't try `tessel update`.

## Repo conventions

- `.gitignore` excludes all `*.jpg`, since captured photos may show the surroundings. Don't commit images.
- Commit subjects are short and imperative (e.g. `Add Tessel 1 dev notes, hardware tests and camera capture`).
- A Tessel 2 CLI (`t2`, under Node 24) is also installed, but no Tessel 2 is connected. It runs full Node.js, so the constraints above don't apply to it.
