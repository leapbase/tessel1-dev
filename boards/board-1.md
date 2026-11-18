# Board 1

Tessel 1, recorded 2026-11-18. Board 2 gets its own file in this folder.

## Identity

| Item | Value |
| --- | --- |
| Board ID / USB serial | `TM-00-04-f0009a30-00674745-667045c2` |
| USB vendor / product | `Technical Machine` `0x1D50` / `Tessel` `0x6097` |
| Firmware commit | `e59e352` |
| Runtime commit | `2396b5a` |
| Wi-Fi firmware | 1.26 |
| CLI used | `tessel` 0.3.25 on Node 0.12.18 (see the README for setup) |

Find it again with `tessel list`, which prints the board ID.

## Modules and ports

| Port | Module | Chip | Status |
| --- | --- | --- | --- |
| A | Servo | PCA9685 at I2C `0x70` | Detected. Registers read their reset values (MODE1 `0x11`, MODE2 `0x04`, PRESCALE `0x1e`). Servo output not driven, no servo attached |
| B | Camera | VC0706 (`VC0703 1.00`) | Working. 640x480 JPEG captured with `raw-camera-photo.js` |
| C | Climate | Si7005 (ID `0x50`) | Working. 27.2 C, 27.4 %RH. Chip select `digital[0]` must be low |
| D | GPS | A2235-H (SiRF binary, 115200 baud) | Chip alive and streaming. No fix in a 10 minute run: best 5 satellites with peak C/N0 23, 0 used |

## Known limits on this board

- The npm module libraries (`gps-a2235h`, `camera-vc0706` and likely the others) crash on this firmware. The compiler turns bitwise operators into a `tointegervalue` call that the runtime does not have. Raw scripts that avoid `<<`, `>>`, `|`, `&` and `^` work.
- Port C cannot do UART (`Software UART not yet functional for this port`). Use A, B or D.
- `tessel update` does not work: the build server `builds.tessel.io` no longer resolves. Firmware was never changed.
- `process.sendfile` saves files only with `tessel run <file> -u <dir>`.

## Scripts that work on this board

`blink.js`, `raw-camera-test.js`, `raw-camera-photo.js`, `raw-gps-test.js`, `raw-gps-monitor.js`, `raw-i2c-scan.js`, `raw-i2c-modules-test.js`, `raw-climate-test.js`. Port letters at the top of each script match the table above, so edit them if a module sits elsewhere on another board.
