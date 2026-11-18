# Tessel

Notes and projects for the Tessel microcontroller family and its hardware modules.
The board connected to this machine is a **Tessel 1**. Tessel 2 notes are kept at the end.

## Connected board

Verified on 2026-11-18 from the USB registry (`ioreg`) and the Tessel 1 CLI (`tessel list`).

| Item | Value |
| --- | --- |
| Board | Tessel 1 |
| USB product name | `Tessel` |
| USB vendor name | `Technical Machine` |
| USB vendor ID | `0x1D50` (7504) |
| USB product ID | `0x6097` (24727) |
| Board ID / USB serial | `TM-00-04-f0009a30-00674745-667045c2` |
| CLI | `tessel` v0.3.25 (`tessel list` finds the board) |

Other USB devices on this machine are not Tessels. The `/dev/cu.usbmodem14301` serial port belongs to an Espressif "USB JTAG/serial debug unit" and has nothing to do with the Tessel.

Check the connection at any time:

```sh
nvm use 0.12
tessel list          # prints the board ID when connected
ioreg -p IOUSB -l -w0 | grep -B2 -A12 '"Tessel"'   # raw USB view
```

## Tessel 1 specs

These come from Tessel's published hardware documentation, not from reading the board. Check them against [tessel.io](https://tessel.io) and the board's own markings.

| Item | Spec |
| --- | --- |
| Microcontroller | NXP LPC1830, ARM Cortex-M3, 180 MHz |
| RAM | 32 MB SDRAM |
| Flash | 32 MB |
| Wi-Fi | TI CC3000 (802.11 b/g) |
| Module ports | 4 (labeled A, B, C, D) |
| Other I/O | A GPIO bank with digital and analog pins |
| Host connection | Micro-USB (power, programming, and logs) |
| Runtime | JavaScript on the Colony runtime. It follows Node-style conventions but is not full Node.js, so many npm packages will not run on the board. |

## Setup (Tessel 1 CLI)

The Tessel 1 CLI dates from 2014 and does not run on current Node. This machine is an Intel Mac, and the setup that works is:

- **Node 0.12.18**, installed with `nvm install 0.12`. Run `nvm use 0.12` in each new shell before using `tessel`.
- **Python 2.7.18** through pyenv (`pyenv install 2.7.18`), needed by the old `node-gyp`.
- The CLI is installed globally under that Node: `npm install -g tessel --ignore-scripts`.

Four workarounds were needed to get it running. If you reinstall, you will probably need them again:

1. **`node-gyp` and the Command Line Tools version.** The `node-gyp` bundled with npm 2 cannot parse a two-digit CLT major version (`26.x`). In `~/.nvm/versions/node/v0.12.18/lib/node_modules/npm/node_modules/node-gyp/gyp/pylib/gyp/xcode_emulation.py`, line 1265, the regex `(\d\.\d\.?\d*)` was changed to `(\d+\.\d+\.?\d*)`. The original is saved next to it as `xcode_emulation.py.orig`.
2. **`usb` native module.** Compiling `usb@1.2.0` from source fails against Node 0.12's V8 headers under modern clang. Instead, install it with `npm install -g usb@1.2.0 --ignore-scripts`. Then download the prebuilt binary from the `tessel/node-usb` GitHub release `1.2.0` (`usb_bindings-v1.2.0-node-v14-darwin-x64.tar.gz`) and extract it into `<global node_modules>/usb/src/`. Node 0.12 cannot fetch it itself because its TLS is too old for GitHub.
3. **Nested `usb`.** The CLI installs its own `usb@1.9.2`, which uses modern syntax and fails on Node 0.12. That nested copy was deleted from `tessel/node_modules/usb` so the CLI uses the global `usb@1.2.0`.
4. **`tough-cookie`.** The `request` package pulled in `tough-cookie@6`, which also fails on Node 0.12. `tough-cookie@2.3.4` was installed in its place under `tessel/node_modules/request/node_modules`.

## Using the board

```sh
nvm use 0.12
tessel list                       # connected boards
tessel run index.js               # run a script on the board, streaming output (not saved)
tessel push index.js              # write to flash so it runs on boot
tessel erase                      # remove a pushed script
tessel wifi <ssid> <password> <security>   # e.g. wpa2
tessel logs                       # stream logs from the board
tessel update                     # update firmware (check the CLI's help first)
```

Run `tessel --help` for the commands your CLI version supports. `tessel run` has been verified on this board with `blink.js` (connected, bundled 4 KB, ran, and streamed 10 log lines). The other commands come from the 0.3.x CLI's documented usage and have not been run against this board yet.

## Modules

Modules plug into the module ports. Each has an npm package that you install in your project and require. Tessel 1 and Tessel 2 share many module libraries, but check each module's own docs, since older module versions were written for the Tessel 1 runtime.

| Module | npm package | Purpose |
| --- | --- | --- |
| Accelerometer | `accel-mma84` | 3-axis acceleration |
| Ambient | `ambient-attx4` | Light and sound sensing |
| Audio | `audio-vs1053b` | Audio playback and recording |
| BLE | `ble-ble113a` | Bluetooth Low Energy |
| Camera | `camera-vc0706` | Photo capture |
| Climate | `climate-si7020` | Temperature and humidity |
| GPS | `gps-a2235h` | Location |
| Relay | `relay-mono` | Switch high-power loads |
| RFID | `rfid-pn532` | NFC and RFID reading |
| Servo | `servo-pca9685` | Servo motor control |

Example, reading the climate module on port A:

```js
var tessel = require('tessel');
var climatelib = require('climate-si7020');

var climate = climatelib.use(tessel.port['A']);

climate.on('ready', function () {
  climate.readTemperature('c', function (err, temp) {
    if (err) throw err;
    console.log('Temperature: ' + temp.toFixed(1) + ' C');
  });
});
```

## Module test results (2026-11-18)

A GPS module and a camera module are plugged into the board.

| Module | Port | Hardware check | Using the npm library |
| --- | --- | --- | --- |
| Camera (VC0706) | **B** | Working. Replied `76 00 11 00 0b` + `VC0703 1.00` to the get-version command | Crashes |
| GPS (A2235-H) | **D** | Working. 73 valid SiRF binary frames in 8 s; 2 satellites seen, best C/N0 13, no fix yet (indoors) | Crashes |

Port C is not usable for UART on this firmware (`Software UART not yet functional for this port. You must use module port A, B, or D.`).

**Raw hardware tests (these work).** They use no module library: `raw-camera-test.js` (set `PORT` at the top; B for this camera) and `raw-gps-test.js` (port D, decodes the module's SiRF binary stream).

```sh
nvm use 0.12
tessel run raw-camera-test.js
tessel run raw-gps-test.js
```

- The GPS streams **SiRF binary** at 115200 baud (frames `A0 A2 ... B0 B3`), not NMEA text. The library switches it to NMEA through firmware-level calls that this board's firmware does not have.
- A fix needs a clear view of the sky and can take several minutes on a cold start. Run the GPS test near a window or outdoors and watch `satellites with signal` and `nav-valid` (0 means a fix).

**Taking a photo (works).** `raw-camera-photo.js` captures a 640x480 JPEG from the camera on port B over UART, using no bitwise operators. Run it with an upload directory, or the photo is discarded:

```sh
nvm use 0.12
tessel run raw-camera-photo.js -u .    # saves camera-photo.jpg in the current folder
```

`process.sendfile` only saves files when `-u <dir>` (or the `TESSEL_UPLOAD_DIR` environment variable) is set. Verified on 2026-11-18: a 49,004-byte file, valid JPEG start and end markers, readable image. It takes a few seconds, since a frame is read in 128-byte chunks at 115200 baud.

**Why the npm libraries crash.** `gps-a2235h` and `camera-vc0706` fail with `attempt to call field 'tointegervalue' (a nil value)` (or `attempt to call local '_f'`). The same error appeared in a plain script of ours at a line using `<<` and `|`, and went away when those were rewritten as arithmetic. So the compiler turns **bitwise operators into a call that this board's runtime does not provide**. Anything using `<<`, `>>`, `|`, `&` or `^` crashes on this firmware, and the libraries use them. Library version does not matter (tested the latest and 2014 releases), and neither does the port.

Board firmware (`tessel version --board`): firmware commit `e59e352`, runtime commit `2396b5a`, Wi-Fi 1.26. `tessel update --list` fails with "There was an error getting build information" because `builds.tessel.io` no longer resolves in DNS, so a firmware update through the CLI is not possible. No firmware was changed.

The two library-based scripts (`gps-test.js`, `camera-test.js`) are kept but will crash on this board; use the raw tests instead.

## Troubleshooting

- **`tessel: command not found`**: run `nvm use 0.12`. The CLI is installed only under Node 0.12.
- **`tessel list` shows nothing**: check that the USB cable carries data, and check that the board shows up with `ioreg` (above).
- **`SyntaxError: Unexpected token =>` or similar**: a dependency that is too new for Node 0.12 got installed. See the workarounds above.
- **`node-gyp` errors during install**: use `--ignore-scripts` and the prebuilt `usb` binary as described above.

## Tessel 2 (not currently connected)

Tessel 2 is a separate, Linux-based board that runs full Node.js. It has two module ports (A and B), USB ports, Ethernet, and built-in Wi-Fi.

Its CLI, `t2-cli` 0.1.23, is installed globally under Node 24 (`npm install -g t2-cli`). It runs, but `t2 list` finds no board. The CLI's postinstall steps (USB drivers and the `usb` native build) were skipped by npm. If you connect a Tessel 2, run `t2 install drivers`, or reinstall with `npm install -g --allow-scripts=t2-cli,usb t2-cli`.

```sh
t2 list              # find Tessels
t2 provision         # authorize this computer
t2 init              # scaffold a project
t2 run index.js      # run on the board
t2 push index.js     # deploy to flash
```
