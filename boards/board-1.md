# Board 1

Tessel 1, recorded 2026-11-18. Board 2 gets its own file in this folder.

## Identity

| Item | Value |
| --- | --- |
| Board ID / USB serial | `TM-00-04-f0009a30-00674745-667045c2` |
| USB vendor / product | `Technical Machine` `0x1D50` / `Tessel` `0x6097` |
| Firmware commit | `3b8c922` (v0.2.0), flashed 2026-11-18 from [firmware/](../firmware/README.md). Was `e59e352` (v0.1.8) |
| Runtime commit | `dd434be`. Was `2396b5a` |
| Wi-Fi firmware | 1.26 |
| CLI used | `tessel` 0.3.25 on Node 0.12.18 (see the README for setup) |

Find it again with `tessel list`, which prints the board ID.

## Modules and ports

| Port | Module | Chip | Status |
| --- | --- | --- | --- |
| A | Servo | PCA9685 at I2C `0x70` | Detected. Registers read their reset values (MODE1 `0x11`, MODE2 `0x04`, PRESCALE `0x1e`). Servo output not driven, no servo attached |
| B | Camera | VC0706 (`VC0703 1.00`) | Working. 640x480 JPEG captured with `raw-camera-photo.js` |
| C | GPS | A2235-H (SiRF binary at 115200 baud over the hardware UART; NMEA via the library's software UART) | Chip alive and streaming (raw test, on port D, v0.1.8). The `gps-a2235h` library now works here: it reports `ready` within 1 s on port C (v0.2.0). No fix in 5 minutes with the library, and none in a 10 minute raw run: best 5 satellites at peak C/N0 23, 0 used |
| D | Climate | Si7005 (ID `0x50`) | Working on port C before the swap (raw: 27.2 C, 27.4 %RH; `climate-si7005` library on v0.2.0: 21.3 C, 37.6 %RH). Retested on port D (v0.2.0, `raw-climate-test.js`): ID `0x50`, 24.3 C, 32.9 %RH. Chip select `digital[0]` must be low |

## Known limits on this board

- **Firmware v0.2.0 fixed the library crash (flashed 2026-11-18).** On v0.1.8, bitwise operators crashed with `tointegervalue (a nil value)`, so `gps-a2235h` and `camera-vc0706` could not run. After the flash a bitwise test script runs correctly. Library results on this board, v0.2.0: `climate-si7005` on C works (ready, 21.3 C, 37.6 %RH); `camera-vc0706` on B works (ready, took a 640x480 JPEG, 46,952 bytes); `gps-a2235h` works on port C (`ready` in 1 s) but reports `Could not find GPS module` on port D. `climate-si7005` was retested on port D with the raw script.
- Port C cannot do UART (`Software UART not yet functional for this port`). Use A, B or D.
- `tessel update` with no file does not work: the build server `builds.tessel.io` no longer resolves. Flash a local file instead: `tessel update firmware/tessel-firmware-v0.2.0.bin` (see [firmware/](../firmware/README.md)).
- `process.sendfile` saves files only with `tessel run <file> -u <dir>`.

## Scripts that work on this board

`blink.js`, `raw-camera-test.js`, `raw-camera-photo.js`, `raw-gps-test.js`, `raw-gps-monitor.js`, `raw-i2c-scan.js`, `raw-i2c-modules-test.js`, `raw-climate-test.js`. Port letters at the top of each script match the table above, so edit them if a module sits elsewhere on another board.

## GPS library needs port C

The `gps-a2235h` library uses the firmware's software UART, which on Tessel 1 exists only on **port C** (its own README says so). With the GPS on port D the library reported `Could not find GPS module` even though the raw SiRF test proved the module alive. After swapping the GPS and climate modules (GPS now on C), the library reported `ready` within 1 second. A 5 minute run printed no `coordinates`, `altitude` or `fix` events, so there was no position fix: the antenna needs a clear view of the sky, and in every run so far (raw 10 minute run, library 5 minute run) it saw at most 5 satellites at weak signal. The raw scripts (`raw-gps-test.js`, `raw-gps-monitor.js`) use the hardware UART and work on port D, not C.
