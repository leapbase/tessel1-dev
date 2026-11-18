# Tessel 1 firmware

`tessel-firmware-v0.2.0.bin` is the prebuilt Tessel 1 firmware from the **v0.2.0** release (2016-02-18) of Tessel's firmware repository, which is now named `tessel/t1-firmware` (it used to be `tessel/firmware`). Download: https://github.com/tessel/t1-firmware/releases/download/v0.2.0/tessel-firmware.bin

| Item | Value |
| --- | --- |
| Size | 1,183,776 bytes |
| SHA-256 | `d75d6b8615204902e311a84b50bd6d1ebc0071a6c2087b6f06f011ab418888a6` |
| License | Apache-2.0 or MIT, as stated by the upstream repository |
| Release notes | Adds async capability to `pin` methods for compatibility with T2. Fixes bug in GPS date setting |

The SHA-256 was computed on the file downloaded over HTTPS from that release. Upstream publishes no checksum, so it only proves this copy has not changed since.

## Flashing

`tessel update` normally fetches firmware from `builds.tessel.io`, which no longer exists. The CLI can flash a local file instead. With the Tessel CLI 0.3.25 under Node 0.12 (see the main README):

1. Connect only the board you want to flash, and check `tessel list` shows the ID you expect.
2. Put the board in bootloader mode: hold **Config**, press and release **Reset**, release Config. The red and orange LEDs blink, and the board shows in USB as "Tessel DFU".
3. Run `tessel update --dfu firmware/tessel-firmware-v0.2.0.bin`.
4. The board resets itself. Check with `tessel version --board`.

The bootloader lives in separate flash and is not overwritten, so a bad firmware flash can be retried by re-entering bootloader mode. `tessel erase` in bootloader mode erases the saved-code area only.

## What was flashed

| Board | Firmware before | Firmware after |
| --- | --- | --- |
| Board 1 | `e59e352` (v0.1.8, 2014-07-19), runtime `2396b5a` | not changed |
| Board 2 | `e59e352` (v0.1.8, 2014-07-19), runtime `2396b5a` | not changed |
| Board 3 | `e59e352` (v0.1.8, 2014-07-19), runtime `2396b5a` | `3b8c922`, runtime `dd434be` (v0.2.0), flashed 2026-11-18 |

Board 3 still could not hold a USB session after the flash, so it is unknown whether v0.2.0 fixes the crash in module libraries (bitwise operators compile to a `tointegervalue` call that the v0.1.8 runtime lacks).
