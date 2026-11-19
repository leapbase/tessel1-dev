#!/bin/sh
# Make a raw FAT32 image for the Mac-side tests (superfloppy: boot sector at block 0; the tests wrap it in an MBR).
# Usage: make-image.sh OUT.img SECTORS_PER_CLUSTER SIZE_MB   (FAT32 needs >= 65525 clusters: 64 MB at 1, 300 MB at 8)
set -e
OUT=$1; SPC=${2:-1}; MB=${3:-64}
rm -f "$OUT"
mkfile -n ${MB}m "$OUT"
DEV=$(hdiutil attach -nomount -imagekey diskimage-class=CRawDiskImage "$OUT" | head -1 | awk '{print $1}')
RDEV=$(echo "$DEV" | sed 's|/dev/disk|/dev/rdisk|')
/sbin/newfs_msdos -F 32 -c "$SPC" -v TESTSD "$RDEV" >/dev/null
hdiutil detach "$DEV" >/dev/null
echo "$OUT"
