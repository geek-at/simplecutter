// SimpleCutter - Quality / bitrate model
// Shared by the main process (encoder args) and the renderer (size estimate),
// so the number shown in the UI is derived from the exact bitrates FFmpeg is given.

(function (root, factory) {
  const api = factory();
  // Electron renderer with nodeIntegration has `module` defined too, so always
  // expose the global; CommonJS export is for the main process.
  if (root) root.SCQuality = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {

  const MB = 1024 * 1024;

  // Bits per pixel per frame. Tuned for h264 on screen-recorded / gaming content.
  const PRESETS = {
    original: { label: 'Original (match source)', bpp: null,  audioKbps: null },
    high:     { label: 'High',                    bpp: 0.09,  audioKbps: 160 },
    medium:   { label: 'Medium',                  bpp: 0.055, audioKbps: 128 },
    low:      { label: 'Low',                     bpp: 0.03,  audioKbps: 96 },
    size:     { label: 'Fit to size',             bpp: null,  audioKbps: 128 }
  };

  const MIN_VIDEO_KBPS = 150;
  const MIN_AUDIO_KBPS = 48;
  // Single-pass VBR overshoots a little; leave headroom so "fit to size" lands under the target.
  const SIZE_SAFETY = 0.93;
  // MP4 container / muxing overhead on top of raw stream bitrates.
  const CONTAINER_OVERHEAD = 1.02;

  function clamp(n, lo, hi) { return Math.min(Math.max(n, lo), hi); }

  /**
   * Compute target video/audio bitrates for a render.
   * @param {object} o
   * @param {string} o.quality       preset key (see PRESETS)
   * @param {number} o.width         output width in px (after half-res)
   * @param {number} o.height        output height in px
   * @param {number} o.fps           output fps (after 30fps cap)
   * @param {number} o.durationSec   total output duration (after speed changes)
   * @param {number} [o.targetMB]    for quality === 'size'
   * @param {number} [o.sourceVideoKbps]
   * @param {number} [o.sourceAudioKbps]
   * @param {boolean} [o.hasAudio]
   * @returns {{videoKbps:number, audioKbps:number}}
   */
  function computeBitrates(o) {
    const preset = PRESETS[o.quality] || PRESETS.high;
    const w = o.width > 0 ? o.width : 1920;
    const h = o.height > 0 ? o.height : 1080;
    const fps = o.fps > 0 ? o.fps : 30;
    const srcV = o.sourceVideoKbps > 0 ? o.sourceVideoKbps : 0;
    const srcA = o.sourceAudioKbps > 0 ? o.sourceAudioKbps : 0;
    const hasAudio = o.hasAudio !== false;

    let audioKbps = 0;
    if (hasAudio) {
      audioKbps = preset.audioKbps != null ? preset.audioKbps : (srcA || 192);
      audioKbps = clamp(Math.round(audioKbps), MIN_AUDIO_KBPS, 320);
    }

    let videoKbps;
    if (o.quality === 'size') {
      const dur = o.durationSec > 0 ? o.durationSec : 1;
      const budgetKbps = (Math.max(1, o.targetMB || 100) * MB * 8 * SIZE_SAFETY) / dur / 1000 / CONTAINER_OVERHEAD;
      videoKbps = budgetKbps - audioKbps;
      if (videoKbps < 300 && hasAudio) {
        // Very tight budget: sacrifice audio first
        audioKbps = MIN_AUDIO_KBPS;
        videoKbps = budgetKbps - audioKbps;
      }
      videoKbps = Math.max(MIN_VIDEO_KBPS, Math.floor(videoKbps));
      // A generous budget still shouldn't exceed the source — no detail to spend it on
      if (srcV > 0) videoKbps = Math.min(videoKbps, srcV);
    } else if (o.quality === 'original') {
      videoKbps = srcV || Math.round(w * h * fps * PRESETS.high.bpp / 1000);
    } else {
      videoKbps = Math.round(w * h * fps * preset.bpp / 1000);
      // Never spend more than the source had — it can't add detail that isn't there
      if (srcV > 0) videoKbps = Math.min(videoKbps, srcV);
    }
    videoKbps = Math.max(MIN_VIDEO_KBPS, Math.round(videoKbps));

    return { videoKbps, audioKbps };
  }

  /** Estimated MP4 size in bytes for given bitrates and duration. */
  function estimateBytes(videoKbps, audioKbps, durationSec) {
    if (!(durationSec > 0)) return 0;
    return Math.round(((videoKbps + audioKbps) * 1000 / 8) * durationSec * CONTAINER_OVERHEAD);
  }

  /**
   * Very rough GIF estimate. 128-colour bayer-dithered GIF of moving content
   * compresses to roughly a third of a byte per pixel; real results vary ±50%.
   */
  function estimateGifBytes(width, height, fps, durationSec) {
    if (!(width > 0) || !(height > 0) || !(fps > 0) || !(durationSec > 0)) return 0;
    return Math.round(width * height * fps * durationSec * 0.35);
  }

  function formatMB(bytes) {
    const mb = bytes / MB;
    if (mb >= 100) return `${Math.round(mb)} MB`;
    if (mb >= 10) return `${mb.toFixed(1)} MB`;
    return `${mb.toFixed(2)} MB`;
  }

  return { PRESETS, MB, computeBitrates, estimateBytes, estimateGifBytes, formatMB };
});
