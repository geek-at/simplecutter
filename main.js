const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const SCQuality = require('./js/quality');

// Keep a global reference of the window object
let mainWindow = null;
let updateDownloaded = false;
let isForceQuitting = false;

// ── Random filename generator ──
const WORDS = [
  // adjectives
  'quick','bright','calm','bold','warm','cool','swift','keen','fair','wild',
  'brave','crisp','dark','deep','dry','fast','fine','firm','flat','free',
  'fresh','full','glad','gold','grand','great','green','happy','high','hot',
  'kind','large','late','lean','light','long','loud','mild','neat','new',
  'nice','old','open','pale','plain','prime','proud','pure','rare','raw',
  'real','red','rich','ripe','round','safe','sharp','short','shy','slim',
  'slow','small','smart','soft','solid','still','strong','sweet','tall','thin',
  'tiny','tough','true','vast','warm','wide','wise','young','blue','pink',
  // nouns
  'fox','owl','bear','wolf','hawk','deer','hare','dove','swan','crow',
  'lake','rain','snow','wind','moon','star','dawn','dusk','tree','leaf',
  'rock','sand','wave','fire','rose','hill','peak','cave','song','drum',
  'bell','path','gate','road','ship','sail','fish','frog','moth','wren',
  'sky','sun','bay','oak','elm','ash','ivy','gem','orb','key',
  // verbs
  'runs','leaps','flies','dives','roams','sings','plays','drifts','rests','grows',
  'falls','rises','turns','jumps','moves','flows','rides','calls','finds','holds',
  'lifts','pulls','waits','works','reads','draws','walks','talks','hides','dances'
];

function generateRandomFilename() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${pick()}-${pick()}-${pick()}`;
}

// GPU detection results (filled in asynchronously after the window is shown)
let gpuInfo = {
  detecting: true,
  hasGPU: false,
  gpuVendor: null,
  gpuModel: null,
  hardwareAcceleration: false,
  hwEncoder: null,
  vaapiDevice: null
};

// h264 hardware encoders to probe, in preference order, per platform.
// The probe result is the source of truth — OS-reported GPU names are only used
// for the label shown in the UI, because a machine can have several GPUs
// (e.g. laptop iGPU + dGPU) and the OS lists them in arbitrary order.
const ENCODER_VENDOR = {
  h264_nvenc: 'nvidia',
  h264_amf: 'amd',
  h264_qsv: 'intel',
  h264_vaapi: null,        // vendor comes from the OS name (AMD or Intel)
  h264_videotoolbox: 'apple'
};

function encoderCandidates() {
  switch (process.platform) {
    case 'win32':  return ['h264_nvenc', 'h264_amf', 'h264_qsv'];
    case 'linux':  return ['h264_nvenc', 'h264_vaapi', 'h264_qsv'];
    case 'darwin': return ['h264_videotoolbox'];
    default:       return [];
  }
}

function vendorFromName(name) {
  const n = String(name || '').toLowerCase();
  if (/microsoft basic|llvmpipe|vmware|virtualbox/.test(n)) return null;
  if (/nvidia|geforce|quadro|\brtx\b|\bgtx\b/.test(n)) return 'nvidia';
  if (/\bamd\b|radeon|advanced micro|\brx\s?\d/.test(n)) return 'amd';
  if (/intel|\buhd\b|\biris\b|\barc\b/.test(n)) return 'intel';
  if (/apple/.test(n)) return 'apple';
  return null;
}

function findVaapiDevice() {
  try {
    const nodes = fs.readdirSync('/dev/dri').filter(n => n.startsWith('renderD')).sort();
    return nodes.length ? path.join('/dev/dri', nodes[0]) : null;
  } catch (_) {
    return null;
  }
}

/** Ask the OS for display adapter names (cosmetic only). Never throws. */
async function detectOsGpuNames() {
  try {
    if (process.platform === 'win32') {
      // wmic was removed in Windows 11 24H2; CIM via PowerShell is the supported path
      const out = await runCmd('powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"');
      return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
    if (process.platform === 'linux') {
      const out = await runCmd('lspci 2>/dev/null');
      return out.split('\n')
        .filter(l => /vga|3d|display/i.test(l))
        .map(l => l.replace(/^.*?:\s*/, '').trim())
        .filter(Boolean);
    }
    if (process.platform === 'darwin') {
      const out = await runCmd('system_profiler SPDisplaysDataType 2>/dev/null');
      const m = out.match(/Chipset Model:\s*(.+)/);
      return m ? [m[1].trim()] : [];
    }
  } catch (_) { /* ignore */ }
  return [];
}

/** Fallback when the OS gave us nothing: Chromium's view of the active GPU. */
async function detectElectronGpuNames() {
  try {
    const info = await app.getGPUInfo('complete');
    const names = [];
    for (const d of (info && info.gpuDevice) || []) {
      if (d.vendorId === 0x1414) continue; // Microsoft Basic Render Driver
      let vendor = null;
      if (d.vendorId === 0x10DE) vendor = 'NVIDIA';
      else if (d.vendorId === 0x1002) vendor = 'AMD';
      else if (d.vendorId === 0x8086) vendor = 'Intel';
      const desc = d.deviceString || `0x${(d.deviceId || 0).toString(16)}`;
      names.push(vendor && !vendorFromName(desc) ? `${vendor} ${desc}` : desc);
    }
    return names;
  } catch (_) {
    return [];
  }
}

// Probe FFmpeg encoders (real tiny encode) and pick the first that works.
// Runs after the window is visible so startup isn't blocked; the renderer is
// notified via the 'gpu-info' channel when done.
async function detectGPU() {
  const osNamesPromise = detectOsGpuNames();
  const ffmpegPath = getFFmpegPath();
  const vaapiDevice = process.platform === 'linux' ? findVaapiDevice() : null;

  for (const encoder of encoderCandidates()) {
    if (encoder === 'h264_vaapi' && !vaapiDevice) continue;
    if (await testEncoder(ffmpegPath, encoder, vaapiDevice)) {
      gpuInfo.hwEncoder = encoder;
      gpuInfo.hasGPU = true;
      gpuInfo.hardwareAcceleration = true;
      gpuInfo.gpuVendor = ENCODER_VENDOR[encoder];
      if (encoder === 'h264_vaapi') gpuInfo.vaapiDevice = vaapiDevice;
      break;
    }
  }

  let names = await osNamesPromise;
  if (names.length === 0) names = await detectElectronGpuNames();
  const named = names.map(n => ({ name: n, vendor: vendorFromName(n) }));

  // Label the GPU that actually won the probe; otherwise the first real adapter
  const match = (gpuInfo.gpuVendor && named.find(n => n.vendor === gpuInfo.gpuVendor))
    || named.find(n => n.vendor)
    || named[0];
  if (match) {
    gpuInfo.gpuModel = match.name;
    if (!gpuInfo.gpuVendor) gpuInfo.gpuVendor = match.vendor;
    if (!gpuInfo.hwEncoder && match.vendor) gpuInfo.hasGPU = true;
  }

  gpuInfo.detecting = false;
  console.log('GPU Detection:', gpuInfo);
  mainWindow?.webContents.send('gpu-info', gpuInfo);
  return gpuInfo;
}

/**
 * Test if an FFmpeg encoder actually works by encoding 1 black frame.
 * Returns true if the encoder ran successfully, false otherwise.
 */
function testEncoder(ffmpegPath, encoder, vaapiDevice) {
  return new Promise((resolve) => {
    const tmpOut = path.join(app.getPath('temp'), `_sc_test_${encoder}.mp4`);
    // NOTE: Use 256x256 — GPU encoders (AMF, NVENC, QSV) reject very small
    //       resolutions (e.g. 64x64) and fail even when the hardware is fine.
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (encoder === 'h264_vaapi') args.push('-vaapi_device', vaapiDevice);
    args.push('-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1:rate=25');
    // VAAPI encoders only accept frames already uploaded to the GPU
    if (encoder === 'h264_vaapi') args.push('-vf', 'format=nv12,hwupload');
    args.push('-c:v', encoder, '-frames:v', '1', '-y', tmpOut);

    let timedOut = false;
    const proc = spawn(ffmpegPath, args);
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, 8000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpOut); } catch (_) {}
      resolve(!timedOut && code === 0);
    });

    proc.on('error', () => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpOut); } catch (_) {}
      resolve(false);
    });
  });
}

/** Run a shell command and return stdout */
function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf8', timeout: 5000 }, (err, stdout) => {
      resolve(stdout || '');
    });
  });
}

// Get FFmpeg path based on platform
function getFFmpegPath() {
  const platform = process.platform;
  let ffmpegDir = path.join(__dirname, 'ffmpeg', 'bin');
  
  // Check if bundled FFmpeg exists
  if (app.isPackaged) {
    ffmpegDir = path.join(process.resourcesPath, 'ffmpeg', 'bin');
  }
  
  const ext = platform === 'win32' ? '.exe' : '';
  const ffmpegPath = path.join(ffmpegDir, `ffmpeg${ext}`);
  
  // Fallback to system FFmpeg if bundled doesn't exist
  if (!fs.existsSync(ffmpegPath)) {
    return platform === 'win32' ? 'ffmpeg' : 'ffmpeg';
  }
  
  return ffmpegPath;
}

// Get FFprobe path (same dir as FFmpeg)
function getFFprobePath() {
  const platform = process.platform;
  let dir = path.join(__dirname, 'ffmpeg', 'bin');
  if (app.isPackaged) {
    dir = path.join(process.resourcesPath, 'ffmpeg', 'bin');
  }
  const ext = platform === 'win32' ? '.exe' : '';
  const p = path.join(dir, `ffprobe${ext}`);
  if (!fs.existsSync(p)) return 'ffprobe';
  return p;
}

// Detect video rotation and audio presence using ffprobe
function getVideoInfo(filePath) {
  return new Promise((resolve) => {
    const probePath = getFFprobePath();
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,avg_frame_rate,r_frame_rate,bit_rate,width,height:stream_tags=rotate:stream_side_data=rotation:format=bit_rate',
      '-of', 'json',
      filePath
    ];
    const proc = spawn(probePath, args, { timeout: 10000 });
    let stdout = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.on('close', () => {
      try {
        const data = JSON.parse(stdout);
        const streams = data.streams || [];
        const videoStream = streams.find(s => s.codec_type === 'video');
        const hasAudioStream = streams.some(s => s.codec_type === 'audio');

        const parseRate = (rate) => {
          const parts = String(rate || '').trim().split('/');
          if (parts.length !== 2) return 0;
          const n = Number(parts[0]);
          const d = Number(parts[1]);
          if (!isFinite(n) || !isFinite(d) || d === 0) return 0;
          return n / d;
        };

        let fps = 0;
        let videoBitrate = 0;
        let audioBitrate = 0;
        if (videoStream) {
          const avg = parseRate(videoStream.avg_frame_rate);
          const r = parseRate(videoStream.r_frame_rate);
          const parsedFps = avg > 0 ? avg : r;
          if (isFinite(parsedFps) && parsedFps >= 1 && parsedFps <= 240) {
            fps = parsedFps;
          }

          videoBitrate = Number(videoStream.bit_rate) || 0;
        }

        const audioStream = streams.find(s => s.codec_type === 'audio');
        if (audioStream) {
          audioBitrate = Number(audioStream.bit_rate) || 0;
        }

        // Fallback to container bitrate when stream bitrate is unavailable
        // (container bitrate covers all streams, so take the audio share off)
        if (!videoBitrate && data.format?.bit_rate) {
          videoBitrate = Math.max(0, (Number(data.format.bit_rate) || 0) - audioBitrate);
        }

        let rotation = 0;
        if (videoStream) {
          // Check tags first (common in MP4 from phones)
          if (videoStream.tags?.rotate) {
            const r = parseInt(videoStream.tags.rotate);
            if (isFinite(r)) rotation = ((r % 360) + 360) % 360;
          } else {
            // Check side_data (display matrix rotation)
            const sideData = videoStream.side_data_list || [];
            for (const sd of sideData) {
              if (sd.rotation !== undefined) {
                const r = Math.round(parseFloat(sd.rotation));
                // side_data rotation is negative of the display rotation
                if (isFinite(r)) rotation = ((-r % 360) + 360) % 360;
                break;
              }
            }
          }
        }

        const width  = Number(videoStream?.width)  || 0;
        const height = Number(videoStream?.height) || 0;
        resolve({ rotation, hasAudioStream, fps, videoBitrate, audioBitrate, width, height });
      } catch (_) {
        resolve({ rotation: 0, hasAudioStream: true, fps: 0, videoBitrate: 0, audioBitrate: 0, width: 0, height: 0 });
      }
    });
    proc.on('error', () => resolve({ rotation: 0, hasAudioStream: true, fps: 0, videoBitrate: 0, audioBitrate: 0, width: 0, height: 0 }));
  });
}

// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: `SimpleCutter v${app.getVersion()}`,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#1a1a2e',
    frame: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('SimpleCutter started successfully');
  });

  // Guard close when a render is in progress
  mainWindow.on('close', async (e) => {
    if (isForceQuitting) return; // allow auto-update / app.quit() through
    e.preventDefault();

    let rendering = false;
    try {
      rendering = await mainWindow.webContents.executeJavaScript(
        'typeof window.isRenderingActive === "function" ? window.isRenderingActive() : false'
      );
    } catch (_) { /* renderer not ready — allow close */ }

    if (!rendering) {
      mainWindow.destroy();
      return;
    }

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Keep rendering', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Rendering in progress',
      message: 'A video is still rendering.',
      detail: 'Closing now will cancel the render and the output file will be incomplete.'
    });

    if (response === 1) mainWindow.destroy();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Remove menu in production
  if (app.isPackaged) {
    mainWindow.setMenu(null);
  }
}

// Window control IPC handlers (frameless window)
ipcMain.on('win-minimize', () => { mainWindow?.minimize(); });
ipcMain.on('win-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('win-close', () => { mainWindow?.close(); });
ipcMain.on('toggle-devtools', () => { mainWindow?.webContents.toggleDevTools(); });

// IPC Handlers
ipcMain.handle('get-gpu-info', async () => {
  return gpuInfo;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('open-external-url', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('get-video-info', async (event, filePath) => {
  return getVideoInfo(filePath);
});

ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv'] }
    ]
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

/**
 * Output folder for everything the app produces from a source video (clips,
 * GIFs, screenshots): a "cut" subfolder next to the source, unless the source
 * already lives in one (re-cutting a clip must not nest cut/cut/...).
 * Falls back to the source folder itself if the subfolder can't be created.
 */
function ensureCutDir(sourceDir) {
  if (!sourceDir) return sourceDir;
  if (path.basename(sourceDir).toLowerCase() === 'cut') return sourceDir;
  const cutDir = path.join(sourceDir, 'cut');
  try {
    fs.mkdirSync(cutDir, { recursive: true });
    return cutDir;
  } catch (_) {
    return sourceDir;
  }
}

ipcMain.handle('select-output-dir', async (event, opts = {}) => {
  const isGif = opts.isGif || false;
  const sourceDir = opts.sourceDir || '';
  const ext = isGif ? 'gif' : 'mp4';

  const cutDir = ensureCutDir(sourceDir);

  // Generate a random three-word filename
  const randomName = generateRandomFilename();
  const defaultPath = path.join(cutDir, `${randomName}.${ext}`);

  const filters = isGif
    ? [{ name: 'GIF Animation', extensions: ['gif'] }, { name: 'All Files', extensions: ['*'] }]
    : [{ name: 'MP4 Video', extensions: ['mp4'] }, { name: 'GIF Animation', extensions: ['gif'] }, { name: 'All Files', extensions: ['*'] }];

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePath;
});

ipcMain.handle('get-ffmpeg-path', () => {
  return getFFmpegPath();
});

ipcMain.handle('show-in-folder', async (event, filePath) => {
  // Detect WSL — shell.showItemInFolder uses xdg-open which fails without a Linux file manager
  const isWSL = process.platform === 'linux' && fs.existsSync('/proc/version') &&
    fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');

  if (isWSL) {
    try {
      // Convert Linux path to Windows path and open in Explorer with file selected
      const winPath = await runCmd(`wslpath -w "${filePath}"`);
      spawn('explorer.exe', ['/select,', winPath.trim()], { detached: true, stdio: 'ignore' });
    } catch (_) {
      // Fallback: just open the containing folder
      const dir = await runCmd(`wslpath -w "${path.dirname(filePath)}"`);
      spawn('explorer.exe', [dir.trim()], { detached: true, stdio: 'ignore' });
    }
  } else {
    shell.showItemInFolder(filePath);
  }
});

// Save a screenshot (PNG frame from video)
ipcMain.handle('save-screenshot', async (event, opts) => {
  const { videoPath, timestamp, zoom } = opts;
  const ffmpegPath = getFFmpegPath();

  // Build filename: first 20 chars of video name + timestamp
  const videoName = path.basename(videoPath, path.extname(videoPath))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 20);
  const ts = timestamp.toFixed(2).replace('.', 's') + 'ms';
  const outName = `${videoName}_${ts}.png`;
  // Screenshots go to the same "cut" folder as rendered clips
  const outPath = path.join(ensureCutDir(path.dirname(videoPath)), outName);

  // Build optional zoom filter (PNG has no even-dimension requirement so expressions work fine)
  const vfArgs = [];
  if (zoom) {
    const { x, y, w, h } = zoom;
    const xf = Math.max(0, x).toFixed(6);
    const yf = Math.max(0, y).toFixed(6);
    const wf = Math.min(1 - parseFloat(xf), w).toFixed(6);
    const hf = Math.min(1 - parseFloat(yf), h).toFixed(6);
    // Enlarge by one uniform factor so the region keeps its shape (no stretching)
    const factor = Math.max(parseFloat(wf), parseFloat(hf), 0.01).toFixed(6);
    vfArgs.push('-vf', `crop=iw*${wf}:ih*${hf}:iw*${xf}:ih*${yf},scale=iw/${factor}:ih/${factor}:flags=lanczos`);
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(timestamp),
      '-i', videoPath,
      ...vfArgs,
      '-frames:v', '1',
      '-y', outPath
    ];

    const proc = spawn(ffmpegPath, args, { timeout: 10000 });
    let stderr = '';
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', (code) => {
      if (code === 0) resolve({ success: true, path: outPath });
      else reject(new Error(`Screenshot failed: ${stderr.trim().split('\n').pop()}`));
    });
    proc.on('error', reject);
  });
});

// Per-encoder rate-control arguments for a single-pass VBR at a target bitrate.
// Using explicit bitrates (instead of CRF/QP) makes the output size predictable,
// which is what the renderer's size estimate relies on.
function encoderRateArgs(encoder, videoKbps) {
  const b = `${videoKbps}k`;
  const maxrate = `${Math.round(videoKbps * 1.15)}k`;
  const bufsize = `${Math.round(videoKbps * 2)}k`;
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', encoder, '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-b:v', b, '-maxrate', maxrate, '-bufsize', bufsize];
    case 'h264_amf':
      return ['-c:v', encoder, '-quality', 'balanced', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', maxrate, '-bufsize', bufsize];
    case 'h264_qsv':
      return ['-c:v', encoder, '-preset', 'medium', '-b:v', b, '-maxrate', maxrate, '-bufsize', bufsize];
    case 'h264_vaapi':
      return ['-c:v', encoder, '-rc_mode', 'VBR', '-b:v', b, '-maxrate', maxrate, '-bufsize', bufsize];
    case 'h264_videotoolbox':
      return ['-c:v', encoder, '-b:v', b, '-maxrate', maxrate, '-bufsize', bufsize];
    default:
      return ['-c:v', 'libx264', '-preset', 'fast', '-b:v', b, '-maxrate', maxrate, '-bufsize', bufsize];
  }
}

// Process video segments
ipcMain.handle('process-video', async (event, options) => {
  const { segments, outputPath, useHwAccel, createGif, gifOptions, halfResolution, limitFps30, sourceFps, quality, targetMB } = options;
  const ffmpegPath = getFFmpegPath();

  // Detect rotation and audio presence from the source video
  const inputPath = segments.length > 0 ? segments[0].inputPath : null;
  const videoInfo = inputPath ? await getVideoInfo(inputPath) : { rotation: 0, hasAudioStream: true, fps: 0, videoBitrate: 0, audioBitrate: 0, width: 0, height: 0 };
  const rotation = videoInfo.rotation;
  const detectedFps = videoInfo.fps > 0 ? videoInfo.fps : sourceFps;
  const safeFps = (isFinite(detectedFps) && detectedFps >= 1 && detectedFps <= 240) ? detectedFps : 0;

  // Effective dimensions after rotation (90/270 swaps width/height)
  const rawW = videoInfo.width  || 0;
  const rawH = videoInfo.height || 0;
  const effectiveW = (rotation === 90 || rotation === 270) ? rawH : rawW;
  const effectiveH = (rotation === 90 || rotation === 270) ? rawW : rawH;
  // Force even — h264 requires dimensions divisible by 2
  const zoomScaleW = effectiveW > 0 ? Math.round(effectiveW / 2) * 2 : 0;
  const zoomScaleH = effectiveH > 0 ? Math.round(effectiveH / 2) * 2 : 0;

  // Only include audio if not GIF and the source actually has an audio stream
  const hasAudio = !createGif && videoInfo.hasAudioStream;

  // Bitrates: prefer the values the renderer computed (they back the size
  // estimate shown to the user); recompute from the same model otherwise.
  const totalDuration = segments.reduce((s, seg) => s + (seg.endTime - seg.startTime) / (seg.speed || 1), 0);
  let videoKbps = Number(options.videoKbps) || 0;
  let audioKbps = Number(options.audioKbps) || 0;
  if (!createGif && !(videoKbps > 0)) {
    const outW = halfResolution ? Math.round(effectiveW / 2) : effectiveW;
    const outH = halfResolution ? Math.round(effectiveH / 2) : effectiveH;
    const outFps = (limitFps30 && safeFps > 30) ? 30 : safeFps;
    const br = SCQuality.computeBitrates({
      quality: quality || 'high', width: outW, height: outH, fps: outFps,
      durationSec: totalDuration, targetMB,
      sourceVideoKbps: Math.round(videoInfo.videoBitrate / 1000),
      sourceAudioKbps: Math.round(videoInfo.audioBitrate / 1000),
      hasAudio
    });
    videoKbps = br.videoKbps;
    audioKbps = br.audioKbps;
  }
  console.log('Render:', { rotation, hasAudio, fps: safeFps, quality, videoKbps, audioKbps, totalDuration });

  return new Promise((resolve, reject) => {
    // Build filter complex for multiple segments
    let filterComplex = '';
    let inputs = [];
    let concatInputs = '';

    segments.forEach((seg, index) => {
      // Seek on the input side: FFmpeg jumps to the nearest keyframe before the
      // segment start and decodes only from there. (The old trim filter made it
      // decode the whole file from 0 up to every segment, which is extremely slow
      // for segments late in a long recording.) Input seeking is still
      // frame-accurate when re-encoding: frames before the exact start are
      // decoded and dropped.
      const segDur = Math.max(0, seg.endTime - seg.startTime);
      inputs.push('-ss', String(seg.startTime), '-t', String(segDur), '-i', seg.inputPath);

      let videoFilter = 'setpts=PTS-STARTPTS';
      let audioFilter = 'asetpts=PTS-STARTPTS';

      // Apply speed filter
      if (seg.speed !== 1) {
        const pts = 1 / seg.speed;
        videoFilter += `,setpts=${pts}*PTS`;
        if (hasAudio) {
          // atempo only supports 0.5-2.0, chain multiple for extreme speeds
          let speed = seg.speed;
          let atempoChain = [];
          while (speed > 2.0) { atempoChain.push('atempo=2.0'); speed /= 2.0; }
          while (speed < 0.5) { atempoChain.push('atempo=0.5'); speed *= 2.0; }
          atempoChain.push(`atempo=${speed}`);
          audioFilter += ',' + atempoChain.join(',');
        }
      }

      // Apply rotation fix for portrait/rotated videos
      if (rotation === 90) {
        videoFilter += ',transpose=1';
      } else if (rotation === 180) {
        videoFilter += ',hflip,vflip';
      } else if (rotation === 270) {
        videoFilter += ',transpose=2';
      }

      // Apply zoom: crop the selected region then scale back to exact original dimensions
      if (seg.zoom && zoomScaleW > 0 && zoomScaleH > 0) {
        const { x, y, w, h } = seg.zoom;
        const xf = Math.max(0, x).toFixed(6);
        const yf = Math.max(0, y).toFixed(6);
        const wf = Math.min(1 - parseFloat(xf), w).toFixed(6);
        const hf = Math.min(1 - parseFloat(yf), h).toFixed(6);
        // Scale to exact pixel dimensions to guarantee concat compatibility; reset SAR to 1:1
        videoFilter += `,crop=iw*${wf}:ih*${hf}:iw*${xf}:ih*${yf}`;
        if (Math.abs(parseFloat(wf) - parseFloat(hf)) < 0.01) {
          // Region has the frame's aspect ratio: fill the frame exactly
          videoFilter += `,scale=${zoomScaleW}:${zoomScaleH}:flags=lanczos,setsar=1`;
        } else {
          // Free-form region: fit inside the frame and pad with black instead of stretching.
          // Output stays at the exact frame size, which concat requires.
          videoFilter += `,scale=${zoomScaleW}:${zoomScaleH}:force_original_aspect_ratio=decrease:flags=lanczos`
            + `,pad=${zoomScaleW}:${zoomScaleH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
        }
      }

      // Apply half-resolution scale if requested (not for GIF — GIF has its own scale)
      if (halfResolution && !createGif) {
        // trunc(iw/4)*2 == iw/2 rounded down to an even number (h264 needs even dimensions)
        videoFilter += `,scale=trunc(iw/4)*2:trunc(ih/4)*2:flags=lanczos`;
      }

      // Apply 30fps cap if requested (not for GIF — GIF has its own fps)
      if (limitFps30 && !createGif) {
        videoFilter += `,fps=30`;
      }

      filterComplex += `[${index}:v]${videoFilter}[v${index}];`;

      if (hasAudio) {
        if (seg.muted) {
          // Generate silence for the duration of this (trimmed + speed-adjusted) segment
          const silenceDur = segDur / (seg.speed || 1);
          filterComplex += `aevalsrc=0:d=${silenceDur.toFixed(4)}[a${index}];`;
        } else {
          filterComplex += `[${index}:a]${audioFilter}[a${index}];`;
        }
        concatInputs += `[v${index}][a${index}]`;
      } else {
        concatInputs += `[v${index}]`;
      }
    });

    // Use the tested hardware encoder from GPU detection (if requested)
    const hwEncoder = (!createGif && useHwAccel) ? gpuInfo.hwEncoder : null;
    const useVaapi = hwEncoder === 'h264_vaapi' && !!gpuInfo.vaapiDevice;
    let videoOut = '[outv]';

    // Concatenation
    if (createGif) {
      // GIF: video-only concat, then apply GIF-specific filters
      const gifFps = gifOptions.fps || 15;
      const gifW   = gifOptions.width || 480;
      filterComplex += `${concatInputs}concat=n=${segments.length}:v=1:a=0[_gif];`;
      filterComplex += `[_gif]fps=${gifFps},scale=${gifW}:-1:flags=lanczos,split[s0][s1];`;
      filterComplex += `[s0]palettegen=max_colors=128:stats_mode=diff[p];`;
      filterComplex += `[s1][p]paletteuse=dither=bayer:bayer_scale=5[outv]`;
    } else if (hasAudio) {
      filterComplex += `${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`;
    } else {
      // MP4 without audio stream: plain video-only concat
      filterComplex += `${concatInputs}concat=n=${segments.length}:v=1:a=0[outv]`;
    }

    // VAAPI encoders only accept GPU-resident frames: upload after all software filters
    if (useVaapi) {
      filterComplex += `;[outv]format=nv12,hwupload[outhw]`;
      videoOut = '[outhw]';
    }

    // NOTE: Intentionally avoid hardware decoding (-hwaccel input args).
    // We keep software decode + software filters for stability across
    // setpts/concat pipelines, and only use hardware for encoding.

    // Build output args
    const outputArgs = [];
    if (!createGif) {
      outputArgs.push(...encoderRateArgs(hwEncoder, videoKbps));

      if (hasAudio) {
        outputArgs.push('-c:a', 'aac', '-b:a', `${audioKbps}k`);
      }

      // Preserve source framerate — hardware encoders may default to 30/25 fps
      // when the framerate isn't explicitly set after filter_complex + concat
      if (safeFps > 0 && !limitFps30) {
        outputArgs.push('-r', String(Number(safeFps.toFixed(3))));
      }

      // Move the moov atom to the front so the clip previews in chat apps before it's fully downloaded
      outputArgs.push('-movflags', '+faststart');
    }

    // Build final command
    const mapArgs = ['-map', videoOut];
    if (hasAudio) mapArgs.push('-map', '[outa]');

    const args = [
      '-hide_banner',
      ...(useVaapi ? ['-vaapi_device', gpuInfo.vaapiDevice] : []),
      // Disable auto-rotation — we handle it manually in the filter chain
      ...(rotation !== 0 ? ['-noautorotate'] : []),
      ...inputs,
      '-filter_complex', filterComplex,
      ...mapArgs,
      ...outputArgs,
      '-y',
      outputPath
    ];

    console.log('FFmpeg command:', ffmpegPath, args.join(' '));

    const ffmpeg = spawn(ffmpegPath, args);
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      const str = data.toString();
      stderr += str;

      // Parse progress
      const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch) {
        const currentTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        mainWindow?.webContents.send('ffmpeg-progress', { currentTime });
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, outputPath });
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
});

// Auto-updater setup
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info);
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available:', info);
});

autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded — will install on quit:', info);
  updateDownloaded = true;
  // Notify the renderer so the user sees an in-app hint
  mainWindow?.webContents.send('update-downloaded', info);
});

// App events
app.on('ready', async () => {
  // Set correct app identity for Windows notifications & updater
  app.setAppUserModelId('electron.app.dta-cutter');

  // Show the window immediately; GPU/encoder probing runs in the background
  // and pushes its result to the renderer when done.
  createWindow();
  detectGPU().catch(err => console.warn('GPU detection failed:', err));

  // Check for updates in production
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on('before-quit', () => { isForceQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (updateDownloaded) {
      // Force silent install + relaunch after
      autoUpdater.quitAndInstall(true, true);
    } else {
      app.quit();
    }
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});
