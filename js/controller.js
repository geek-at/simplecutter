// SimpleCutter - Controller
// Handles UI interactions and segment management

// ──────────── Global State ────────────
const appState = {
  videoPath: null,
  videoDuration: 0,
  segments: [],
  isPlaying: false,
  gpuInfo: null
};

// ──────────── Zoom State ────────────
const zoomState = {
  activeSegId: null,
  selecting: false,
  startX: 0,
  startY: 0,
  pendingRect: null
};

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
    gpuDot:           document.getElementById('gpuDot'),
    gpuStatusText:    document.getElementById('gpuStatusText'),
    appVersion:       document.getElementById('appVersion'),
    processingModal:  document.getElementById('processingModal'),
    processingStatus: document.getElementById('processingStatus'),
    progressBar:      document.getElementById('progressBar'),
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

  // GPU info
  try {
    appState.gpuInfo = await window.electronAPI.getGPUInfo();
  } catch (e) {
    console.warn('GPU detection failed:', e);
    appState.gpuInfo = { hasGPU: false, hardwareAcceleration: false };
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
}

// ──────────── GPU Status ────────────
function updateGPUStatus() {
  const gpu = appState.gpuInfo;
  const hasHW = gpu && gpu.hardwareAcceleration;

  if (hasHW) {
    el.gpuDot.classList.remove('off');
    const vendor = (gpu.gpuVendor || 'GPU').charAt(0).toUpperCase() + (gpu.gpuVendor || 'gpu').slice(1);
    const encoder = gpu.hwEncoder ? ` (${gpu.hwEncoder})` : '';
    el.gpuStatusText.textContent = `${vendor}${encoder}`;
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

    // Detect FPS and disable 30fps toggle if already <= 30
    try {
      const fps = await window.electronAPI.getVideoFps(filePath);
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
      el.fps30Toggle.disabled = false;
    }

    // Auto-add first segment covering the full video duration
    addSegment(0, appState.videoDuration);
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
  });

  el.btnScreenshot.addEventListener('click', () => takeScreenshot());

  el.processBtn.addEventListener('click', processVideo);
}

function markFrom() {
  if (!appState.videoPath) return;
  const cur = el.videoPlayer.currentTime;

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
  const cur = el.videoPlayer.currentTime;

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
  });
}

// ──────────── Process Video ────────────
async function processVideo() {
  if (appState.segments.length === 0 || !appState.videoPath) return;

  el.processingModal.classList.add('active');
  el.processingStatus.textContent = 'Preparing...';
  el.progressBar.style.width = '0%';

  const isGif = el.createGifToggle.checked;
  const sourceDir = appState.videoPath ? appState.videoPath.replace(/[\\/][^\\/]+$/, '') : '';
  const outputPath = await window.electronAPI.selectOutputDir({ isGif, sourceDir });

  if (!outputPath) {
    el.processingModal.classList.remove('active');
    return;
  }

  let finalPath = outputPath;
  if (isGif && !outputPath.endsWith('.gif'))  finalPath += '.gif';
  else if (!isGif && !outputPath.endsWith('.mp4')) finalPath += '.mp4';

  el.processingStatus.textContent = 'Processing video segments...';

  const segments = appState.segments.map(s => ({
    inputPath: appState.videoPath,
    startTime: s.startTime,
    endTime:   s.endTime,
    speed:     s.speed,
    muted:     s.muted || false,
    hasAudio:  !isGif,
    zoom:      s.zoom || null
  }));

  const useHW = el.hwEncodeToggle.checked && !el.hwEncodeToggle.disabled;
  const halfRes = el.halfResToggle.checked;
  const limitFps30 = el.fps30Toggle.checked;

  try {
    await window.electronAPI.processVideo({
      segments,
      outputPath: finalPath,
      useHwAccel: useHW,
      halfResolution: halfRes,
      limitFps30,
      sourceFps: appState.videoFps || 0,
      createGif: isGif,
      gifOptions: {
        width: parseInt(el.gifWidth.value) || 480,
        fps:   parseInt(el.gifFps.value) || 15
      }
    });

    el.processingStatus.textContent = 'Done!';
    el.progressBar.style.width = '100%';
    setTimeout(() => el.processingModal.classList.remove('active'), 1500);
    // Reveal in file explorer
    window.electronAPI.showInFolder(finalPath);
  } catch (err) {
    console.error('Processing error:', err);
    // Show a concise error — extract the last meaningful line from FFmpeg stderr
    let msg = String(err.message || err);
    const lines = msg.split('\n').filter(l => l.trim());
    // Look for lines that describe the actual error (skip version/banner lines)
    const errorLine = lines.filter(l =>
      !/^\s*(ffmpeg version|Copyright|built with|configuration:|lib|\s*$)/i.test(l)
    ).reverse().find(l =>
      /error|invalid|failed|no such|cannot|unable|not found|unrecognized|does not|match|missing|denied/i.test(l)
    );
    // Fallback: last non-banner line, or first line
    const fallback = lines.filter(l =>
      !/^\s*(ffmpeg version|Copyright|built with|configuration:|lib)/i.test(l)
    ).pop();
    el.processingStatus.textContent = `Error: ${errorLine || fallback || lines[lines.length - 1] || 'Processing failed'}`;
    setTimeout(() => el.processingModal.classList.remove('active'), 6000);
  }
}

// ──────────── Helpers ────────────
function updateProcessButton() {
  const ok = appState.videoPath
    && appState.segments.length > 0
    && appState.segments.every(s => s.startTime < s.endTime && s.startTime >= 0 && s.endTime <= appState.videoDuration);
  el.processBtn.disabled = !ok;
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
    applyZoomCropBox(normalizeRect(zoomState.startX, zoomState.startY, curX, curY));
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!zoomState.selecting) return;
    zoomState.selecting = false;
    const rect = overlay.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    const box = normalizeRect(zoomState.startX, zoomState.startY, curX, curY);

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
  const videoRect    = el.videoPlayer.getBoundingClientRect();
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

// Boot
document.addEventListener('DOMContentLoaded', init);
