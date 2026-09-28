# Simple cutter or DTA-Cutter

A simple ffmpeg powered video cutter for Windows.

Made for small gaming video clips.

[Usage Demo](https://pictshare.net/ovtjkb.mp4)

https://github.com/user-attachments/assets/bb0d3ec2-8665-4c2b-9019-aa424ff73cf2

## Features

- Multiple segments per clip, each with its own speed, mute and zoom region
- Hardware encoding (NVENC / AMD AMF / Intel QSV, VAAPI on Linux) with automatic detection
- Quality presets plus **Fit to size** — enter a maximum file size (e.g. 95 MB for Signal) and the bitrate is chosen to land under it
- Live estimate of the output file size while you edit
- GIF export with palette generation
- Frame-accurate navigation: `A` / `←` and `D` / `→` step one frame (hold `Shift` for one second); `I` / `O` mark start and end, `S` saves a screenshot
- Render queue, screenshots, auto-update

```bash
npm install

# Run the app
npm start

# build it
npm run dist:win
```

Windows builds bundle FFmpeg (`ffmpeg/bin`, stored in git LFS; refresh with `update_ffmpeg.sh`).
Linux builds do not bundle FFmpeg and use `ffmpeg`/`ffprobe` from `PATH`.

### Version upgrade

0. Replace current version strings with new one in `package.json`
1. Commit with the new version number `git commit -m "v1.0.0"`
2. Tag the commit with the new version number `git tag v1.0.0`
3. Push the commit and the tag `git push && git push --tags`
