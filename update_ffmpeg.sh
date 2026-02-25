#!/bin/bash
# update_ffmpeg.sh — Download latest FFmpeg win64 GPL build and update ffmpeg/bin/
# Source: https://github.com/BtbN/FFmpeg-Builds/releases

set -e

RELEASE_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FFMPEG_BIN="$SCRIPT_DIR/ffmpeg/bin"
TMP_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "==> Downloading latest FFmpeg win64 GPL build..."
curl -L --progress-bar -o "$TMP_DIR/ffmpeg.zip" "$RELEASE_URL"

echo "==> Extracting..."
unzip -q "$TMP_DIR/ffmpeg.zip" -d "$TMP_DIR"

# Find the extracted folder (named like ffmpeg-master-latest-win64-gpl)
EXTRACTED=$(find "$TMP_DIR" -maxdepth 1 -type d -name 'ffmpeg-*' | head -1)

if [ -z "$EXTRACTED" ] || [ ! -f "$EXTRACTED/bin/ffmpeg.exe" ]; then
  echo "ERROR: Could not find ffmpeg.exe in extracted archive"
  exit 1
fi

# Show old version
echo "==> Old version:"
"$FFMPEG_BIN/ffmpeg.exe" -version 2>/dev/null | head -1 || echo "  (none)"

# Back up old binaries
if [ -f "$FFMPEG_BIN/ffmpeg.exe" ]; then
  echo "==> Backing up old binaries to ffmpeg/bin/backup/"
  mkdir -p "$FFMPEG_BIN/backup"
  cp "$FFMPEG_BIN/ffmpeg.exe"  "$FFMPEG_BIN/backup/" 2>/dev/null || true
  cp "$FFMPEG_BIN/ffprobe.exe" "$FFMPEG_BIN/backup/" 2>/dev/null || true
  cp "$FFMPEG_BIN/ffplay.exe"  "$FFMPEG_BIN/backup/" 2>/dev/null || true
fi

# Copy new binaries
echo "==> Updating ffmpeg/bin/..."
cp "$EXTRACTED/bin/ffmpeg.exe"  "$FFMPEG_BIN/ffmpeg.exe"
cp "$EXTRACTED/bin/ffprobe.exe" "$FFMPEG_BIN/ffprobe.exe"
cp "$EXTRACTED/bin/ffplay.exe"  "$FFMPEG_BIN/ffplay.exe" 2>/dev/null || true

# Show new version
echo "==> New version:"
"$FFMPEG_BIN/ffmpeg.exe" -version 2>/dev/null | head -1

echo "==> Done! Old binaries backed up to ffmpeg/bin/backup/"
