# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run the app in development
npm run dist:win   # Build Windows installer (NSIS + ZIP)
npm run dist:linux # Build Linux packages (AppImage + DEB) — relies on a system ffmpeg, no binaries bundled
npm run dist:all   # Build both platforms
```

No test suite, linter, or transpilation step exists. Plain JavaScript runs directly in Electron.
Syntax-check a file with `node -e "new (require('vm').Script)(require('fs').readFileSync('main.js','utf8'))"`.

## Release Process

1. Update version in `package.json`
2. Commit and tag: `git tag v2.x.x`
3. `git push && git push --tags` — triggers GitHub Actions (`.github/workflows/build.yml`) to build and publish a Windows release

## Architecture

This is a single-page Electron desktop app for cutting video clips with FFmpeg. No framework, no bundler — vanilla JS, one HTML file with inline CSS.

**Process model:**
- `main.js` — Electron main process: window, GPU/encoder detection, ffprobe/FFmpeg spawning, IPC handlers, auto-updater
- `renderer.js` — Thin IPC bridge that exposes `window.electronAPI` to the renderer (`nodeIntegration: true`, no context isolation)
- `index.html` — Entire UI in one HTML file (markup + CSS); loads `renderer.js`, `js/quality.js`, `js/controller.js`
- `js/controller.js` — All UI logic: video playback, segment management, drag-drop, zoom overlay, render queue, size estimate
- `js/quality.js` — Shared bitrate model (UMD: `require()`d by main, global `SCQuality` in renderer). Quality presets → video/audio kbps, size estimate. Keep main and renderer using this one module so the estimate matches what FFmpeg is told.

`build.files` in `package.json` is an explicit allowlist — add new source files there or they won't ship. `dist/` is a stale local build output, not packaged.

**Core data flow:**
1. User loads a video → HTML5 `<video>` in `index.html`; renderer calls `get-video-info` (one ffprobe run: fps, dimensions, bitrates, rotation, audio presence)
2. `controller.js` manages segments (start/end/speed/mute/zoom) and recomputes the estimated output size on every change via `SCQuality`
3. On "Process" → job enters the render queue → `processVideo()` → IPC `process-video` to `main.js` with segments, options, and the computed `videoKbps`/`audioKbps`
4. `main.js` builds one FFmpeg command: per segment `-ss <start> -t <dur> -i <file>` (input seeking, never the `trim` filter — that decodes the whole file up to each segment), `setpts`/speed/rotation/zoom/scale filters, `concat`, then the chosen encoder in single-pass VBR at the given bitrate (`encoderRateArgs`)
5. Progress via `ffmpeg-progress` IPC; result via the resolved promise

**GPU / hardware encoding:**
- Detection runs *after* the window is shown (`detectGPU()`, not awaited) and pushes the result over the `gpu-info` channel; `get-gpu-info` returns the current state including `detecting: true`.
- The encoder probe (tiny real encode per candidate in `encoderCandidates()`, fixed preference order per platform) is the source of truth. OS adapter names (PowerShell CIM on Windows — `wmic` no longer exists on Win11 24H2+ — `lspci` on Linux) are only used for the label.
- VAAPI (Linux) needs `-vaapi_device` plus `format=nv12,hwupload` at the end of the filter graph; both the probe and the render path do this.

**FFmpeg binaries:** Windows builds ship `ffmpeg/bin/ffmpeg.exe` + `ffprobe.exe` (git LFS, refreshed with `update_ffmpeg.sh`; `ffplay.exe` is in the folder but excluded from packaging). Other platforms fall back to `ffmpeg`/`ffprobe` on `PATH`.

**Auto-updates** use `electron-updater` checking GitHub releases.
