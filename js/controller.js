// SimpleCutter - Controller
// Handles UI interactions and segment management

// ──────────── Global State ────────────
const appState = {
  videoPath: null,
  videoDuration: 0,
  segments: [],
  isPlaying: false,
  gpuInfo: null,
  videoFps: 0,
  videoInfo: null   // { width, height, fps, videoBitrate, audioBitrate, hasAudioStream, rotation }
};

// ──────────── Zoom State ────────────
const zoomState = {
  activeSegId: null,
  selecting: false,
  startX: 0,
  startY: 0,
  pendingRect: null
};

// ──────────── Render Queue State ────────────
const renderQueue = [];
let queueRunning = false;

// ──────────── DOM refs (built after DOMContentLoaded) ────────────
let el = {};

function cacheDom() {
  el = {
    videoDropzone:    document.getElementById('videoDropzone'),
    dropzoneContent:  document.getElementById('dropzoneContent'),
    videoPlayer:      document.getElementById('videoPlayer'),
    videoControls:    document.getElementById('videoControls'),
    videoTimeline:    document.getElementById('videoTimeline'),
    timelineProgress: document.getElementById('timelineProgress'),
    timelineSecondIndicator: document.getElementById('timelineSecondIndicator'),
    segmentMarkers:   document.getElementById('segmentMarkers'),
    segmentList:      document.getElementById('segmentList'),
    addSegmentBtn:    document.getElementById('addSegmentBtn'),
    btnMarkFrom:      document.getElementById('btnMarkFrom'),
    btnMarkTo:        document.getElementById('btnMarkTo'),
    btnScreenshot:    document.getElementById('btnScreenshot'),
    processBtn:       document.getElementById('processBtn'),
    btnPlayPause:     document.getElementById('btnPlayPause'),
    btnRewind:        document.getElementById('btnRewind'),
    btnForward:       document.getElementById('btnForward'),
    currentTime:      document.getElementById('currentTime'),
    duration:         document.getElementById('duration'),
    playIcon:         document.getElementById('playIcon'),
    pauseIcon:        document.getElementById('pauseIcon'),
    createGifToggle:  document.getElementById('createGifToggle'),
    gifOptions:       document.getElementById('gifOptions'),
    gifWidth:         document.getElementById('gifWidth'),
    gifFps:           document.getElementById('gifFps'),
    hwEncodeToggle:   document.getElementById('hwEncodeToggle'),
    halfResToggle:    document.getElementById('halfResToggle'),
    fps30Toggle:      document.getElementById('fps30Toggle'),
    hwEncodeHint:     document.getElementById('hwEncodeHint'),
    qualitySelect:    document.getElementById('qualitySelect'),
    targetSizeRow:    document.getElementById('targetSizeRow'),
    targetSizeMB:     document.getElementById('targetSizeMB'),
    sizeEstimate:     document.getElementById('sizeEstimate'),
    sizeEstimateNote: document.getElementById('sizeEstimateNote'),
    gpuDot:           document.getElementById('gpuDot'),
    gpuStatusText:    document.getElementById('gpuStatusText'),
    appVersion:       document.getElementById('appVersion'),
    queueStatus:      document.getElementById('queueStatus'),
    zoomOverlay:      document.getElementById('zoomOverlay'),
    zoomCropBox:      document.getElementById('zoomCropBox'),
    zoomHint:         document.getElementById('zoomHint'),
    zoomToolbar:      document.getElementById('zoomToolbar'),
    zoomCancelBtn:    document.getElementById('zoomCancelBtn'),
    zoomConfirmBtn:   document.getElementById('zoomConfirmBtn')
  };
}

// ──────────── Init ────────────
async function init() {
  cacheDom();

  // GPU info: detection runs in the main process after the window is shown.
  // Subscribe first so we can't miss the result, then read the current state.
  window.electronAPI.onGPUInfo((info) => {
    appState.gpuInfo = info;
    updateGPUStatus();
  });
  try {
    appState.gpuInfo = await window.electronAPI.getGPUInfo();
  } catch (e) {
    console.warn('GPU detection failed:', e);
    appState.gpuInfo = { detecting: false, hasGPU: false, hardwareAcceleration: false };
  }
  updateGPUStatus();

  // App version
  try {
    const v = await window.electronAPI.getAppVersion();
    el.appVersion.textContent = `SimpleCutter v${v}`;
    const titleVer = document.getElementById('titleVersion');
    if (titleVer) titleVer.textContent = `v${v}`;
  } catch (_) { /* ignore */ }

  setupDragAndDrop();
  setupVideoControls();
  setupSegmentControls();
  setupOutputOptions();
  setupZoomOverlay();

  // Live progress updates for the active render job
  window.electronAPI.onFFmpegProgress((data) => {
    const job = renderQueue.find(j => j.status === 'rendering');
    if (!job || !data.currentTime) return;
    const totalDuration = job.params.segments.reduce(
      (sum, s) => sum + (s.endTime - s.startTime) / (s.speed || 1), 0
    );
    if (totalDuration > 0) {
      job.progress = Math.min(99, Math.round((data.currentTime / totalDuration) * 100));
      updateQueueStatus();
    }
  });
}

// ──────────── GPU Status ────────────
function updateGPUStatus() {
  const gpu = appState.gpuInfo;
  const hasHW = gpu && gpu.hardwareAcceleration;

  if (gpu && gpu.detecting) {
    el.gpuDot.classList.add('off');
    el.gpuStatusText.textContent = 'Detecting GPU...';
    el.hwEncodeToggle.checked = false;
    el.hwEncodeToggle.disabled = true;
    el.hwEncodeHint.style.display = 'none';
    return;
  }

  if (hasHW) {
    el.gpuDot.classList.remove('off');
    const vendor = (gpu.gpuVendor || 'GPU').charAt(0).toUpperCase() + (gpu.gpuVendor || 'gpu').slice(1);
    const encoder = gpu.hwEncoder ? ` (${gpu.hwEncoder})` : '';
    el.gpuStatusText.textContent = `${vendor}${encoder}`;
    el.gpuStatusText.title = gpu.gpuModel || '';
    el.hwEncodeToggle.checked = true;
    el.hwEncodeToggle.disabled = false;
    el.hwEncodeHint.style.display = 'none';
  } else {
    el.gpuDot.classList.add('off');
    el.gpuStatusText.textContent = 'CPU only';
    el.hwEncodeToggle.checked = false;
    el.hwEncodeToggle.disabled = true;
    el.hwEncodeHint.style.display = 'block';
  }
}

// ──────────── Drag & Drop + Click-to-browse ────────────
function setupDragAndDrop() {
  const dz = el.videoDropzone;

  // Click to browse — only when no video loaded
  dz.addEventListener('click', async (e) => {
    // Don't trigger if user clicked on the <video> controls
    if (appState.videoPath) return;

    const filePath = await window.electronAPI.selectVideo();
    if (filePath) loadVideo(filePath);
  });

  // Drag over — MUST preventDefault to allow drop
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    dz.classList.add('drag-over');
  });

  dz.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove('drag-over');
  });

  // Also handle body-level dragover to keep drop effect
  document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  // The actual drop handler on the dropzone
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Electron 12+ removed File.path; use webUtils.getPathForFile instead
      let filePath = '';
      try {
        const { webUtils } = require('electron');
        filePath = webUtils.getPathForFile(files[0]);
      } catch (_) {
        // Fallback for older Electron versions
        filePath = files[0].path || '';
      }
      if (filePath) loadVideo(filePath);
    }
  });
}

// ──────────── Load Video ────────────
function loadVideo(filePath) {
  appState.videoPath = filePath;

  // Clear old segments when loading a new file
  appState.segments = [];

  el.dropzoneContent.style.display = 'none';
  el.videoPlayer.style.display = 'block';
  el.videoControls.style.display = 'block';
  el.videoDropzone.classList.add('has-video');

  // Enable mark buttons
  el.btnMarkFrom.disabled = false;
  el.btnMarkTo.disabled = false;
  el.btnScreenshot.disabled = false;

  // Use file:// protocol — works because webSecurity:true but nodeIntegration is on
  el.videoPlayer.src = `file://${filePath}`;

  el.videoPlayer.onloadedmetadata = async () => {
    appState.videoDuration = el.videoPlayer.duration;
    el.duration.textContent = formatTime(appState.videoDuration);
    updateTimelineSecondIndicator(el.videoPlayer.currentTime, appState.videoDuration);

    // Probe source once: fps, dimensions, bitrates (drives the size estimate)
    try {
      const info = await window.electronAPI.getVideoInfo(filePath);
      appState.videoInfo = info;
      const fps = info.fps || 0;
      appState.videoFps = fps;
      if (fps > 0 && fps <= 30) {
        el.fps30Toggle.checked = false;
        el.fps30Toggle.disabled = true;
        el.fps30Toggle.parentElement.title = `Video is already ${Math.round(fps)} fps`;
      } else {
        el.fps30Toggle.disabled = false;
        el.fps30Toggle.parentElement.title = '';
      }
    } catch (_) {
      appState.videoInfo = null;
      el.fps30Toggle.disabled = false;
    }

    // Auto-add first segment covering the full video duration
    addSegment(0, appState.videoDuration);
    updateEstimate();
  };

  el.videoPlayer.ontimeupdate = () => {
    const cur = el.videoPlayer.currentTime;
    const dur = el.videoPlayer.duration;
    el.currentTime.textContent = formatTime(cur);
    updateTimelineSecondIndicator(cur, dur);
    if (dur > 0) {
      el.timelineProgress.style.width = `${(cur / dur) * 100}%`;
    }
  };

  el.videoPlayer.onended = () => {
    appState.isPlaying = false;
    el.playIcon.style.display = '';
    el.pauseIcon.style.display = 'none';
  };

  updateProcessButton();
}

// ──────────── Video Playback Controls ────────────
function setupVideoControls() {
  el.btnPlayPause.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!appState.videoPath) return;
    if (el.videoPlayer.paused) {
      el.videoPlayer.play();
      appState.isPlaying = true;
      el.playIcon.style.display = 'none';
      el.pauseIcon.style.display = '';
    } else {
      el.videoPlayer.pause();
      appState.isPlaying = false;
      el.playIcon.style.display = '';
      el.pauseIcon.style.display = 'none';
    }
  });

  el.btnRewind.addEventListener('click', (e) => {
    e.stopPropagation();
    el.videoPlayer.currentTime = Math.max(0, el.videoPlayer.currentTime - 5);
  });

  el.btnForward.addEventListener('click', (e) => {
    e.stopPropagation();
    el.videoPlayer.currentTime = Math.min(appState.videoDuration, el.videoPlayer.currentTime + 5);
  });

  el.videoTimeline.addEventListener('click', (e) => {
    const rect = el.videoTimeline.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    el.videoPlayer.currentTime = pos * appState.videoDuration;
  });
}

function updateTimelineSecondIndicator(currentTime, duration) {
  if (!el.timelineSecondIndicator) return;

  const cur = Number.isFinite(currentTime) ? currentTime : 0;
  const dur = Number.isFinite(duration) ? duration : 0;
  const clampedCur = Math.max(0, Math.min(cur, dur > 0 ? dur : cur));

  el.timelineSecondIndicator.textContent = clampedCur.toFixed(2);

  let percent = 0;
  if (dur > 0) {
    percent = (clampedCur / dur) * 100;
  }
  percent = Math.max(0, Math.min(percent, 100));
  el.timelineSecondIndicator.style.left = `${percent}%`;
}

// ──────────── Segment Management ────────────
function setupSegmentControls() {
  el.addSegmentBtn.addEventListener('click', () => {
    if (!appState.videoPath) return;
    // If segments exist, start new segment at the end of the last one
    let start;
    if (appState.segments.length > 0) {
      start = appState.segments[appState.segments.length - 1].endTime;
    } else {
      start = el.videoPlayer.currentTime || 0;
    }
    const end = Math.min(start + 10, appState.videoDuration);
    addSegment(start, end, 1);
  });

  // "From Here" — sets start of last segment (or creates one) to current time
  el.btnMarkFrom.addEventListener('click', () => markFrom());
  // "To Here" — sets end of last segment to current time
  el.btnMarkTo.addEventListener('click', () => markTo());

  // Keyboard shortcuts: I = mark from, O = mark to, S = screenshot
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'i' || e.key === 'I') { e.preventDefault(); markFrom(); }
    if (e.key === 'o' || e.key === 'O') { e.preventDefault(); markTo(); }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); takeScreenshot(); }

    // Frame stepping: A / ArrowLeft = back, D / ArrowRight = forward.
    // Hold Shift to jump one second instead of one frame.
    const k = e.key.toLowerCase();
    if (k === 'a' || k === 'arrowleft')  { e.preventDefault(); stepFrames(e.shiftKey ? -getStepFps() : -1); }
    if (k === 'd' || k === 'arrowright') { e.preventDefault(); stepFrames(e.shiftKey ?  getStepFps() :  1); }
  });

  el.btnScreenshot.addEventListener('click', () => takeScreenshot());

  el.processBtn.addEventListener('click', processVideo);
}

// ──────────── Frame Stepping ────────────
function getStepFps() {
  const fps = appState.videoFps;
  return (fps > 0 && isFinite(fps)) ? fps : 30;
}

/** Index of the frame currently on screen. */
function currentFrameIndex() {
  // +0.01 absorbs float error when currentTime sits exactly on a frame boundary
  return Math.floor(el.videoPlayer.currentTime * getStepFps() + 0.01);
}

/** Move the playhead by a number of frames (negative = backwards). Pauses playback. */
function stepFrames(count) {
  if (!appState.videoPath || !(appState.videoDuration > 0)) return;
  const v = el.videoPlayer;
  if (!v.paused) {
    v.pause();
    appState.isPlaying = false;
    el.playIcon.style.display = '';
    el.pauseIcon.style.display = 'none';
  }
  const fps = getStepFps();
  const maxFrame = Math.max(0, Math.ceil(appState.videoDuration * fps) - 1);
  const target = Math.min(maxFrame, Math.max(0, currentFrameIndex() + Math.round(count)));
  // Land a hair inside the frame so the player shows this frame, not the previous one
  v.currentTime = Math.min(appState.videoDuration, target / fps + 0.0001);
}

/** Start time of the frame on screen — a cut starting here includes that frame. */
function frameStartTime() {
  return Math.max(0, currentFrameIndex() / getStepFps());
}

/** End time of the frame on screen — a cut ending here includes that frame. */
function frameEndTime() {
  return Math.min(appState.videoDuration, (currentFrameIndex() + 1) / getStepFps());
}

function markFrom() {
  if (!appState.videoPath) return;
  const cur = frameStartTime();

  if (appState.segments.length === 0) {
    // Create a new segment starting here, ending 10s later (or at video end)
    addSegment(cur, Math.min(cur + 10, appState.videoDuration), 1);
  } else {
    // Update the last segment's start time
    const last = appState.segments[appState.segments.length - 1];
    last.startTime = cur;
    if (last.endTime <= cur) last.endTime = Math.min(cur + 1, appState.videoDuration);
    renderSegments();
    updateProcessButton();
  }
}

function markTo() {
  if (!appState.videoPath) return;
  const cur = frameEndTime();

  if (appState.segments.length === 0) {
    // Create a segment from 0 to here
    addSegment(0, cur, 1);
  } else {
    // Update the last segment's end time
    const last = appState.segments[appState.segments.length - 1];
    last.endTime = cur;
    if (last.startTime >= cur) last.startTime = Math.max(cur - 1, 0);
    renderSegments();
    updateProcessButton();
  }
}

async function takeScreenshot() {
  if (!appState.videoPath) return;
  const timestamp = el.videoPlayer.currentTime;

  // Brief visual feedback
  const origText = el.btnScreenshot.innerHTML;
  el.btnScreenshot.disabled = true;

  // Find the segment whose range contains the current position and use its zoom
  const activeSeg = appState.segments.find(s => timestamp >= s.startTime && timestamp <= s.endTime);
  const zoom = activeSeg?.zoom || null;

  try {
    const result = await window.electronAPI.saveScreenshot({
      videoPath: appState.videoPath,
      timestamp,
      zoom
    });
    // Flash green feedback
    el.btnScreenshot.innerHTML = '&#10003; Saved!';
    setTimeout(() => { el.btnScreenshot.innerHTML = origText; el.btnScreenshot.disabled = false; }, 1500);
    // Reveal in file explorer
    if (result.path) window.electronAPI.showInFolder(result.path);
  } catch (err) {
    console.error('Screenshot error:', err);
    el.btnScreenshot.innerHTML = '&#10007; Failed';
    setTimeout(() => { el.btnScreenshot.innerHTML = origText; el.btnScreenshot.disabled = false; }, 2000);
  }
}

function addSegment(startTime, endTime, speed = 1) {
  appState.segments.push({
    id: Date.now() + Math.random(),
    startTime,
    endTime,
    speed,
    muted: false,
    hasAudio: true,
    zoom: null
  });
  renderSegments();
  updateProcessButton();
}

function removeSegment(segmentId) {
  appState.segments = appState.segments.filter(s => s.id !== segmentId);
  renderSegments();
  updateProcessButton();
}

function updateSegment(segmentId, field, value) {
  const seg = appState.segments.find(s => s.id === segmentId);
  if (seg) {
    seg[field] = value;
    updateTimelineMarkers();
    updateProcessButton();
  }
}

function renderSegments() {
  if (appState.segments.length === 0) {
    el.segmentList.innerHTML = '<p class="empty-text">Load a video to add segments</p>';
    return;
  }

  el.segmentList.innerHTML = appState.segments.map((seg, i) => `
    <div class="segment-item" data-id="${seg.id}">
      <div class="segment-header">
        <span class="segment-number">Segment ${i + 1}</span>
        <button class="segment-remove" onclick="removeSegment(${seg.id})" title="Remove">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="segment-times">
        <div class="time-input-group">
          <label>Start (sec)</label>
          <input type="number" value="${seg.startTime.toFixed(2)}"
            onchange="updateSegment(${seg.id}, 'startTime', parseFloat(this.value))"
            min="0" max="${appState.videoDuration}" step="0.1">
        </div>
        <div class="time-input-group">
          <label>End (sec)</label>
          <input type="number" value="${seg.endTime.toFixed(2)}"
            onchange="updateSegment(${seg.id}, 'endTime', parseFloat(this.value))"
            min="0" max="${appState.videoDuration}" step="0.1">
        </div>
      </div>
      <div class="segment-options">
        <label style="font-size:11px; color:var(--text-secondary);">Speed:</label>
        <select class="speed-select" onchange="updateSegment(${seg.id}, 'speed', parseFloat(this.value))">
          <option value="0.25" ${seg.speed === 0.25 ? 'selected' : ''}>0.25x (Quarter)</option>
          <option value="0.5"  ${seg.speed === 0.5  ? 'selected' : ''}>0.5x (Half)</option>
          <option value="0.75" ${seg.speed === 0.75 ? 'selected' : ''}>0.75x</option>
          <option value="1"    ${seg.speed === 1    ? 'selected' : ''}>1x (Normal)</option>
          <option value="1.5"  ${seg.speed === 1.5  ? 'selected' : ''}>1.5x</option>
          <option value="2"    ${seg.speed === 2    ? 'selected' : ''}>2x</option>
        </select>
        <label style="font-size:11px; color:var(--text-secondary); margin-left:auto; display:flex; align-items:center; gap:4px; cursor:pointer;">
          <input type="checkbox" ${seg.muted ? 'checked' : ''}
            onchange="updateSegment(${seg.id}, 'muted', this.checked); renderSegments();"
            style="accent-color:var(--primary); cursor:pointer;">
          Mute
        </label>
      </div>
      <div class="segment-zoom-row">
        ${seg.zoom
          ? `<div class="zoom-badge">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
               Zoom&thinsp;${Math.round(seg.zoom.w * 100)}&thinsp;&times;&thinsp;${Math.round(seg.zoom.h * 100)}%
             </div>
             <button class="zoom-badge-edit" onclick="openZoomOverlay(${seg.id})">edit</button>
             <button class="zoom-badge-clear" onclick="clearSegmentZoom(${seg.id})" title="Remove zoom">&times;</button>`
          : `<button class="btn-zoom" onclick="openZoomOverlay(${seg.id})" title="Draw a region to zoom into for this segment">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
               Set Zoom
             </button>`
        }
      </div>
    </div>
  `).join('');

  updateTimelineMarkers();
}

function updateTimelineMarkers() {
  if (appState.videoDuration <= 0) return;
  el.segmentMarkers.innerHTML = appState.segments.map(seg => {
    const left  = (seg.startTime / appState.videoDuration) * 100;
    const width = ((seg.endTime - seg.startTime) / appState.videoDuration) * 100;
    return `<div class="segment-marker" style="left:${left}%;width:${width}%"></div>`;
  }).join('');
}

// ──────────── Output Options ────────────
function setupOutputOptions() {
  el.createGifToggle.addEventListener('change', (e) => {
    el.gifOptions.style.display = e.target.checked ? 'block' : 'none';
    updateEstimate();
  });

  el.qualitySelect.addEventListener('change', () => {
    el.targetSizeRow.style.display = el.qualitySelect.value === 'size' ? 'flex' : 'none';
    updateEstimate();
  });

  // Every option that changes output size re-runs the estimate
  for (const input of [el.targetSizeMB, el.halfResToggle, el.fps30Toggle, el.gifWidth, el.gifFps]) {
    input.addEventListener('input', updateEstimate);
    input.addEventListener('change', updateEstimate);
  }
}

// ──────────── Size Estimate ────────────

/** Output geometry/duration for the current segments + options. */
function getOutputParams() {
  const info = appState.videoInfo || {};
  const isGif = el.createGifToggle.checked;
  const rotated = info.rotation === 90 || info.rotation === 270;
  let width  = (rotated ? info.height : info.width)  || el.videoPlayer.videoWidth  || 0;
  let height = (rotated ? info.width  : info.height) || el.videoPlayer.videoHeight || 0;
  let fps = appState.videoFps || 30;

  const durationSec = appState.segments.reduce(
    (sum, s) => sum + Math.max(0, s.endTime - s.startTime) / (s.speed || 1), 0
  );

  if (isGif) {
    const gifW = parseInt(el.gifWidth.value) || 480;
    height = width > 0 ? Math.round(height * gifW / width) : 0;
    width = gifW;
    fps = parseInt(el.gifFps.value) || 15;
  } else {
    if (el.halfResToggle.checked) { width = Math.round(width / 2); height = Math.round(height / 2); }
    if (el.fps30Toggle.checked && fps > 30) fps = 30;
  }

  const hasAudio = !isGif && info.hasAudioStream !== false;
  return { isGif, width, height, fps, durationSec, hasAudio };
}

/** Bitrates FFmpeg will be told to use for the current settings. */
function computeCurrentBitrates(params) {
  const p = params || getOutputParams();
  const info = appState.videoInfo || {};
  return SCQuality.computeBitrates({
    quality: el.qualitySelect.value,
    width: p.width,
    height: p.height,
    fps: p.fps,
    durationSec: p.durationSec,
    targetMB: parseFloat(el.targetSizeMB.value) || 100,
    sourceVideoKbps: Math.round((info.videoBitrate || 0) / 1000),
    sourceAudioKbps: Math.round((info.audioBitrate || 0) / 1000),
    hasAudio: p.hasAudio
  });
}

function updateEstimate() {
  if (!el.sizeEstimate) return;

  if (!appState.videoPath || appState.segments.length === 0) {
    el.sizeEstimate.textContent = '—';
    el.sizeEstimate.className = 'size-estimate';
    el.sizeEstimateNote.textContent = '';
    return;
  }

  const p = getOutputParams();
  if (!(p.durationSec > 0)) {
    el.sizeEstimate.textContent = '—';
    el.sizeEstimate.className = 'size-estimate';
    el.sizeEstimateNote.textContent = '';
    return;
  }

  let bytes;
  let note = '';
  let cls = 'size-estimate';

  if (p.isGif) {
    bytes = SCQuality.estimateGifBytes(p.width, p.height, p.fps, p.durationSec);
    note = 'rough guess — GIF size depends heavily on content';
  } else {
    const br = computeCurrentBitrates(p);
    bytes = SCQuality.estimateBytes(br.videoKbps, br.audioKbps, p.durationSec);
    const kbpsText = `${p.width}×${p.height} @ ${Math.round(p.fps)} fps · ${(br.videoKbps / 1000).toFixed(1)} Mbit/s video`;
    if (el.qualitySelect.value === 'size') {
      const target = parseFloat(el.targetSizeMB.value) || 100;
      if (bytes > target * SCQuality.MB) {
        note = `${kbpsText} — can't fit in ${target} MB even at minimum bitrate; shorten the clip or enable half resolution`;
        cls += ' warn';
      } else if (br.videoKbps <= 500) {
        note = `${kbpsText} — very low bitrate, expect visible artifacts`;
        cls += ' warn';
      } else {
        note = `${kbpsText} — should land under ${target} MB`;
        cls += ' ok';
      }
    } else {
      note = kbpsText;
    }
  }

  el.sizeEstimate.textContent = bytes > 0 ? `≈ ${SCQuality.formatMB(bytes)}` : '—';
  el.sizeEstimate.className = cls;
  el.sizeEstimateNote.textContent = note;
}

// ──────────── Process Video (enqueue) ────────────
async function processVideo() {
  if (appState.segments.length === 0 || !appState.videoPath) return;

  const isGif = el.createGifToggle.checked;
  const sourceDir = appState.videoPath.replace(/[\\/][^\\/]+$/, '');
  const outputPath = await window.electronAPI.selectOutputDir({ isGif, sourceDir });
  if (!outputPath) return;

  let finalPath = outputPath;
  if (isGif && !outputPath.endsWith('.gif'))  finalPath += '.gif';
  else if (!isGif && !outputPath.endsWith('.mp4')) finalPath += '.mp4';

  const segments = appState.segments.map(s => ({
    inputPath: appState.videoPath,
    startTime: s.startTime,
    endTime:   s.endTime,
    speed:     s.speed,
    muted:     s.muted || false,
    zoom:      s.zoom || null
  }));

  const useHW = el.hwEncodeToggle.checked && !el.hwEncodeToggle.disabled;
  const quality = el.qualitySelect.value;
  const targetMB = parseFloat(el.targetSizeMB.value) || 100;
  const bitrates = isGif ? { videoKbps: 0, audioKbps: 0 } : computeCurrentBitrates();

  enqueueRender({
    status: 'pending',
    outputPath: finalPath,
    label: finalPath.split(/[\\/]/).pop(),
    progress: null,
    params: {
      segments,
      outputPath: finalPath,
      useHwAccel: useHW,
      halfResolution: el.halfResToggle.checked,
      limitFps30:     el.fps30Toggle.checked,
      sourceFps:      appState.videoFps || 0,
      quality,
      targetMB,
      videoKbps:      bitrates.videoKbps,
      audioKbps:      bitrates.audioKbps,
      createGif:      isGif,
      gifOptions: {
        width: parseInt(el.gifWidth.value) || 480,
        fps:   parseInt(el.gifFps.value)   || 15
      }
    }
  });
}

// ──────────── Render Queue ────────────
function enqueueRender(job) {
  renderQueue.push(job);
  updateQueueStatus();
  if (!queueRunning) runNextQueueJob();
}

async function runNextQueueJob() {
  const job = renderQueue.find(j => j.status === 'pending');
  if (!job) {
    queueRunning = false;
    updateQueueStatus();
    return;
  }

  queueRunning = true;
  job.status = 'rendering';
  job.progress = null;
  updateQueueStatus();

  try {
    await window.electronAPI.processVideo(job.params);
    job.status = 'done';
    window.electronAPI.showInFolder(job.outputPath);
  } catch (err) {
    job.status = 'error';
    console.error('Render job failed:', err);
  }

  updateQueueStatus();

  // Remove finished job after a short pause, then pick up the next one
  const delay = job.status === 'error' ? 5000 : 2000;
  setTimeout(() => {
    const idx = renderQueue.indexOf(job);
    if (idx !== -1) renderQueue.splice(idx, 1);
    updateQueueStatus();
    runNextQueueJob();
  }, delay);
}

function updateQueueStatus() {
  const el_q = el.queueStatus;
  if (!el_q) return;

  const rendering = renderQueue.find(j => j.status === 'rendering');
  const pending   = renderQueue.filter(j => j.status === 'pending');
  const errored   = renderQueue.find(j => j.status === 'error');

  if (rendering) {
    const queuedText = pending.length > 0 ? ` · ${pending.length} queued` : '';
    const pctText    = rendering.progress != null ? ` · ${rendering.progress}%` : '';
    el_q.innerHTML   = `<span class="queue-spinner"></span>Rendering${queuedText}${pctText}`;
    el_q.className   = 'footer-right queue-active';
  } else if (errored) {
    el_q.innerHTML = '&#9888; Render failed';
    el_q.className = 'footer-right queue-error';
  } else if (renderQueue.some(j => j.status === 'done')) {
    el_q.innerHTML = '&#10003; Done';
    el_q.className = 'footer-right queue-done';
  } else {
    el_q.innerHTML = 'Powered by FFmpeg';
    el_q.className = 'footer-right';
  }
}

// ──────────── Helpers ────────────
function updateProcessButton() {
  const ok = appState.videoPath
    && appState.segments.length > 0
    && appState.segments.every(s => s.startTime < s.endTime && s.startTime >= 0 && s.endTime <= appState.videoDuration);
  el.processBtn.disabled = !ok;
  updateEstimate();
}

function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ──────────── Zoom Overlay ────────────
function setupZoomOverlay() {
  const overlay = el.zoomOverlay;

  overlay.addEventListener('mousedown', (e) => {
    if (e.target.closest('#zoomToolbar')) return;
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    zoomState.selecting = true;
    zoomState.startX = e.clientX - rect.left;
    zoomState.startY = e.clientY - rect.top;
    el.zoomCropBox.style.display = 'none';
    el.zoomToolbar.classList.remove('visible');
    el.zoomHint.style.display = 'none';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!zoomState.selecting) return;
    const rect = overlay.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    applyZoomCropBox(selectionRect(zoomState.startX, zoomState.startY, curX, curY, rect.width, rect.height, !e.shiftKey));
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!zoomState.selecting) return;
    zoomState.selecting = false;
    const rect = overlay.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    const box = selectionRect(zoomState.startX, zoomState.startY, curX, curY, rect.width, rect.height, !e.shiftKey);

    if (box.width < 8 || box.height < 8) {
      el.zoomCropBox.style.display = 'none';
      el.zoomHint.style.display = 'block';
      return;
    }

    applyZoomCropBox(box);

    const ow = rect.width;
    const oh = rect.height;
    let px = box.left / ow;
    let py = box.top / oh;
    let pw = box.width / ow;
    let ph = box.height / oh;
    // Clamp to [0,1]
    px = Math.max(0, Math.min(px, 1));
    py = Math.max(0, Math.min(py, 1));
    pw = Math.min(pw, 1 - px);
    ph = Math.min(ph, 1 - py);

    zoomState.pendingRect = { x: px, y: py, w: pw, h: ph };
    el.zoomToolbar.classList.add('visible');
  });

  el.zoomCancelBtn.addEventListener('click', closeZoomOverlay);

  el.zoomConfirmBtn.addEventListener('click', () => {
    if (zoomState.pendingRect && zoomState.activeSegId != null) {
      const seg = appState.segments.find(s => s.id === zoomState.activeSegId);
      if (seg) {
        seg.zoom = { ...zoomState.pendingRect };
        renderSegments();
        updateProcessButton();
      }
    }
    closeZoomOverlay();
  });
}

/**
 * Selection rectangle from a drag. With lockAspect the box keeps the overlay's
 * (= the video's) aspect ratio, so the zoomed region fills the output frame
 * without stretching. Anchored at the drag start, clamped to the overlay.
 */
function selectionRect(x1, y1, x2, y2, ow, oh, lockAspect) {
  x2 = Math.max(0, Math.min(x2, ow));
  y2 = Math.max(0, Math.min(y2, oh));
  if (!lockAspect || !(ow > 0) || !(oh > 0)) return normalizeRect(x1, y1, x2, y2);

  const dirX = x2 >= x1 ? 1 : -1;
  const dirY = y2 >= y1 ? 1 : -1;
  const aspect = ow / oh;
  // Follow whichever axis the user dragged further (in aspect-corrected terms)
  let w = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1) * aspect);
  // Shrink to stay inside the overlay in the drag direction
  const maxW = dirX > 0 ? ow - x1 : x1;
  const maxH = dirY > 0 ? oh - y1 : y1;
  w = Math.min(w, maxW, maxH * aspect);
  const h = w / aspect;
  return normalizeRect(x1, y1, x1 + dirX * w, y1 + dirY * h);
}

/** Area of the <video> element actually covered by picture (excludes letterbox bars). */
function getVideoContentRect() {
  const v = el.videoPlayer;
  const r = v.getBoundingClientRect();
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!(vw > 0) || !(vh > 0) || !(r.width > 0) || !(r.height > 0)) return r;
  const scale = Math.min(r.width / vw, r.height / vh);
  const width = vw * scale, height = vh * scale;
  return { left: r.left + (r.width - width) / 2, top: r.top + (r.height - height) / 2, width, height };
}

function normalizeRect(x1, y1, x2, y2) {
  return {
    left:   Math.min(x1, x2),
    top:    Math.min(y1, y2),
    width:  Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

function applyZoomCropBox(box) {
  const cb = el.zoomCropBox;
  cb.style.display = 'block';
  cb.style.left   = `${box.left}px`;
  cb.style.top    = `${box.top}px`;
  cb.style.width  = `${box.width}px`;
  cb.style.height = `${box.height}px`;
}

function openZoomOverlay(segId) {
  if (!appState.videoPath) return;

  // Size the overlay to cover exactly the rendered video area
  const dropzoneRect = el.videoDropzone.getBoundingClientRect();
  const videoRect    = getVideoContentRect();
  el.zoomOverlay.style.left   = `${videoRect.left - dropzoneRect.left}px`;
  el.zoomOverlay.style.top    = `${videoRect.top  - dropzoneRect.top}px`;
  el.zoomOverlay.style.width  = `${videoRect.width}px`;
  el.zoomOverlay.style.height = `${videoRect.height}px`;

  zoomState.activeSegId = segId;
  zoomState.selecting   = false;
  zoomState.pendingRect = null;

  el.zoomCropBox.style.display = 'none';
  el.zoomToolbar.classList.remove('visible');
  el.zoomHint.style.display = 'block';
  el.zoomOverlay.classList.add('active');

  // Pre-draw existing zoom region if any
  const seg = appState.segments.find(s => s.id === segId);
  if (seg && seg.zoom) {
    const ow = videoRect.width;
    const oh = videoRect.height;
    applyZoomCropBox({
      left:   seg.zoom.x * ow,
      top:    seg.zoom.y * oh,
      width:  seg.zoom.w * ow,
      height: seg.zoom.h * oh
    });
    zoomState.pendingRect = { ...seg.zoom };
    el.zoomHint.style.display = 'none';
    el.zoomToolbar.classList.add('visible');
  }
}

function closeZoomOverlay() {
  el.zoomOverlay.classList.remove('active');
  zoomState.activeSegId = null;
  zoomState.pendingRect = null;
}

function clearSegmentZoom(segId) {
  const seg = appState.segments.find(s => s.id === segId);
  if (seg) {
    seg.zoom = null;
    renderSegments();
  }
}

// Expose to inline handlers
window.removeSegment = removeSegment;
window.updateSegment = updateSegment;
window.openZoomOverlay = openZoomOverlay;
window.clearSegmentZoom = clearSegmentZoom;

// Expose rendering state so the main process can check before allowing window close
window.isRenderingActive = () => renderQueue.some(j => j.status === 'rendering' || j.status === 'pending');

// Boot
document.addEventListener('DOMContentLoaded', init);
