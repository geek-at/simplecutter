# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run the app in development
npm run dist:win   # Build Windows installer (NSIS + ZIP)
npm run dist:linux # Build Linux packages (AppImage + DEB)
npm run dist:all   # Build both platforms
```

No test suite, linter, or transpilation step exists. Plain JavaScript runs directly in Electron.

## Release Process

1. Update version in `package.json`
2. Commit and tag: `git tag v2.x.x`
3. `git push && git push --tags` — triggers GitHub Actions to build and publish a release

## Architecture

This is a single-page Electron desktop app for cutting video clips with FFmpeg. No React/Vue/TypeScript — vanilla JS + Bootstrap 3 + jQuery.

**Process model:**
- `main.js` — Electron main process: GPU detection, FFmpeg spawning via `fluent-ffmpeg`, IPC handlers, auto-updater
- `renderer.js` — Thin IPC bridge that exposes `window.electronAPI` to the renderer
- `preload.js` — Context bridge (currently not active; `renderer.js` is used instead via `nodeIntegration: true`)
- `index.html` — Entire UI in one HTML file; loads Bootstrap, jQuery, and app scripts
- `js/controller.js` — All UI logic: video playback, segment management, drag-drop, processing modal
- `js/core_functions.js` — Shared utilities: time formatting, validation, file helpers

**Core data flow:**
1. User loads a video → HTML5 `<video>` element in `index.html`
2. `controller.js` manages the segment list (start/end timestamps per segment)
3. On "Process" → `window.electronAPI.processVideo()` → IPC to `main.js`
4. `main.js` spawns FFmpeg to cut/merge segments or produce GIF
5. Progress events returned via `ffmpeg-progress` IPC channel back to the renderer

**FFmpeg binaries** are bundled at build time via `ffmpeg-installer` and `ffprobe-installer` npm packages; `main.js` resolves the correct binary path at runtime.

**Auto-updates** use `electron-updater` checking GitHub releases.
