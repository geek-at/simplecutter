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
    hwEncodeHint:     document.getElementById('hwEncodeHint'),
    gpuDot:           document.getElementById('gpuDot'),
    gpuStatusText:    document.getElementById('gpuStatusText'),
    appVersion:       document.getElementById('appVersion'),
    processingModal:  document.getElementById('processingModal'),
    processingStatus: document.getElementById('processingStatus'),
    progressBar:      document.getElementById('progressBar')
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
  } catch (_) { /* ignore */ }

  setupDragAndDrop();
  setupVideoControls();
  setupSegmentControls();
  setupOutputOptions();
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
      const filePath = files[0].path;
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

  el.videoPlayer.onloadedmetadata = () => {
    appState.videoDuration = el.videoPlayer.duration;
    el.duration.textContent = formatTime(appState.videoDuration);

    // Auto-add first segment (first 10s or full duration)
    addSegment(0, Math.min(10, appState.videoDuration), 1);
  };

  el.videoPlayer.ontimeupdate = () => {
    const cur = el.videoPlayer.currentTime;
    const dur = el.videoPlayer.duration;
    el.currentTime.textContent = formatTime(cur);
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

// ──────────── Segment Management ────────────
function setupSegmentControls() {
  el.addSegmentBtn.addEventListener('click', () => {
    if (!appState.videoPath) return;
    // Default new segment starts at current playback position
    const cur = el.videoPlayer.currentTime || 0;
    const end = Math.min(cur + 10, appState.videoDuration);
    addSegment(cur, end, 1);
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

  try {
    const result = await window.electronAPI.saveScreenshot({
      videoPath: appState.videoPath,
      timestamp
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

function addSegment(startTime, endTime, speed) {
  appState.segments.push({
    id: Date.now() + Math.random(),
    startTime,
    endTime,
    speed,
    hasAudio: true
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
    hasAudio:  !isGif
  }));

  const useHW = el.hwEncodeToggle.checked && !el.hwEncodeToggle.disabled;

  try {
    await window.electronAPI.processVideo({
      segments,
      outputPath: finalPath,
      useHwAccel: useHW,
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
    // Look for lines that describe the actual error (not just stream info)
    const errorLine = lines.reverse().find(l =>
      /error|invalid|failed|no such|cannot|unable|not found|unrecognized|does not/i.test(l)
    );
    el.processingStatus.textContent = `Error: ${errorLine || lines[0] || 'Processing failed'}`;
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

// Expose to inline handlers
window.removeSegment = removeSegment;
window.updateSegment = updateSegment;

// Boot
document.addEventListener('DOMContentLoaded', init);
