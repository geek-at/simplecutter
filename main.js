const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Keep a global reference of the window object
let mainWindow = null;

// GPU detection results
let gpuInfo = {
  hasGPU: false,
  gpuVendor: null,
  gpuModel: null,
  hardwareAcceleration: true,
  supportedCodecs: []
};

// Detect GPU information via OS-level detection + real FFmpeg encoder testing
function detectGPU() {
  return new Promise(async (resolve) => {

    // ── Step 1: Identify GPU vendor from OS ──
    try {
      if (process.platform === 'win32') {
        // WMIC gives us the real GPU name on Windows
        const wmicOut = await runCmd('wmic path win32_VideoController get Name /value');
        const nameMatch = wmicOut.match(/Name=(.+)/i);
        if (nameMatch) {
          const name = nameMatch[1].trim().toLowerCase();
          gpuInfo.gpuModel = nameMatch[1].trim();
          if (name.includes('nvidia') || name.includes('geforce') || name.includes('rtx') || name.includes('gtx')) {
            gpuInfo.gpuVendor = 'nvidia';
          } else if (name.includes('amd') || name.includes('radeon') || name.includes('rx ')) {
            gpuInfo.gpuVendor = 'amd';
          } else if (name.includes('intel') || name.includes('uhd') || name.includes('iris')) {
            gpuInfo.gpuVendor = 'intel';
          }
          gpuInfo.hasGPU = true;
        }
      } else {
        // Linux: use lspci
        const lspciOut = await runCmd('lspci 2>/dev/null');
        const gpuLines = lspciOut.split('\n').filter(l =>
          /vga|3d|display/i.test(l) && !/microsoft/i.test(l)   // skip WSL virtual GPU
        );
        // If no real GPU lines, check all GPU lines (including Microsoft/WSL)
        const lines = gpuLines.length > 0 ? gpuLines : lspciOut.split('\n').filter(l => /vga|3d|display/i.test(l));

        for (const line of lines) {
          const lower = line.toLowerCase();
          if (lower.includes('nvidia') || lower.includes('geforce')) {
            gpuInfo.gpuVendor = 'nvidia';
          } else if (lower.includes('amd') || lower.includes('radeon') || lower.includes('advanced micro')) {
            gpuInfo.gpuVendor = 'amd';
          } else if (lower.includes('intel')) {
            gpuInfo.gpuVendor = 'intel';
          }
          gpuInfo.gpuModel = line.replace(/^.*:\s*/, '').trim();
          if (gpuInfo.gpuVendor) { gpuInfo.hasGPU = true; break; }
        }
      }
    } catch (e) {
      console.warn('OS GPU detection failed:', e.message);
    }

    // ── Step 2: Fallback — Electron GPU info ──
    if (!gpuInfo.gpuVendor) {
      try {
        const info = await app.getGPUInfo('complete');
        if (info && info.gpuDevice) {
          for (const d of info.gpuDevice) {
            const vid = d.vendorId;
            // Skip Microsoft Basic Render Driver (0x1414)
            if (vid === 0x1414) continue;
            gpuInfo.hasGPU = true;
            if (vid === 0x10DE) gpuInfo.gpuVendor = 'nvidia';
            else if (vid === 0x1002) gpuInfo.gpuVendor = 'amd';
            else if (vid === 0x8086) gpuInfo.gpuVendor = 'intel';
            gpuInfo.gpuModel = d.deviceString || `0x${(d.deviceId || 0).toString(16)}`;
            if (gpuInfo.gpuVendor) break;
          }
        }
      } catch (_) { /* ignore */ }
    }

    // ── Step 3: Test FFmpeg encoders (actually run a tiny encode) ──
    // Order encoders by vendor preference then by common availability
    const candidateEncoders = [];

    if (gpuInfo.gpuVendor === 'nvidia') {
      candidateEncoders.push({ encoder: 'h264_nvenc', vendor: 'nvidia' });
    } else if (gpuInfo.gpuVendor === 'amd') {
      candidateEncoders.push({ encoder: 'h264_amf',   vendor: 'amd' });     // Windows AMD
      candidateEncoders.push({ encoder: 'h264_vaapi',  vendor: 'amd' });     // Linux AMD
    } else if (gpuInfo.gpuVendor === 'intel') {
      candidateEncoders.push({ encoder: 'h264_qsv',   vendor: 'intel' });
      candidateEncoders.push({ encoder: 'h264_vaapi',  vendor: 'intel' });
    }
    // Always try the rest as fallback
    candidateEncoders.push(
      { encoder: 'h264_nvenc',  vendor: 'nvidia' },
      { encoder: 'h264_amf',   vendor: 'amd' },
      { encoder: 'h264_vaapi',  vendor: 'amd' },
      { encoder: 'h264_qsv',   vendor: 'intel' }
    );

    // De-duplicate
    const seen = new Set();
    const uniqueEncoders = candidateEncoders.filter(e => {
      if (seen.has(e.encoder)) return false;
      seen.add(e.encoder);
      return true;
    });

    const ffmpegPath = getFFmpegPath();
    for (const { encoder, vendor } of uniqueEncoders) {
      const works = await testEncoder(ffmpegPath, encoder);
      if (works) {
        gpuInfo.hasGPU = true;
        gpuInfo.gpuVendor = gpuInfo.gpuVendor || vendor;
        gpuInfo.hwEncoder = encoder;
        gpuInfo.hardwareAcceleration = true;
        break;
      }
    }

    if (!gpuInfo.hwEncoder) {
      gpuInfo.hardwareAcceleration = false;
    }

    console.log('GPU Detection:', gpuInfo);
    resolve(gpuInfo);
  });
}

/**
 * Test if an FFmpeg encoder actually works by encoding 1 black frame.
 * Returns true if the encoder ran successfully, false otherwise.
 */
function testEncoder(ffmpegPath, encoder) {
  return new Promise((resolve) => {
    const tmpOut = path.join(app.getPath('temp'), `_sc_test_${encoder}.mp4`);
    // Generate 1 frame of black video and encode with the candidate encoder
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.04',
      '-c:v', encoder,
      '-frames:v', '1',
      '-y', tmpOut
    ];

    const proc = spawn(ffmpegPath, args, { timeout: 8000 });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, 8000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      // Clean up temp file
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

ipcMain.handle('select-output-dir', async (event, opts = {}) => {
  const isGif = opts.isGif || false;
  const sourceDir = opts.sourceDir || '';
  const ext = isGif ? '.gif' : '.mp4';
  const defaultPath = sourceDir ? path.join(sourceDir, ext) : ext;
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
  const { videoPath, timestamp } = opts;
  const ffmpegPath = getFFmpegPath();

  // Build filename: first 20 chars of video name + timestamp
  const videoName = path.basename(videoPath, path.extname(videoPath))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 20);
  const ts = timestamp.toFixed(2).replace('.', 's') + 'ms';
  const outName = `${videoName}_${ts}.png`;
  const outPath = path.join(path.dirname(videoPath), outName);

  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(timestamp),
      '-i', videoPath,
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

// Process video segments
ipcMain.handle('process-video', async (event, options) => {
  const { segments, outputPath, useHwAccel, createGif, gifOptions } = options;
  const ffmpegPath = getFFmpegPath();
  
  return new Promise((resolve, reject) => {
    const hasAudio = !createGif;

    // Build filter complex for multiple segments
    let filterComplex = '';
    let inputs = [];
    let concatInputs = '';
    
    segments.forEach((seg, index) => {
      inputs.push('-i', seg.inputPath);
      
      let videoFilter = '';
      let audioFilter = '';
      
      // Apply speed filter
      if (seg.speed !== 1) {
        const pts = 1 / seg.speed;
        videoFilter = `setpts=${pts}*PTS`;
        if (hasAudio) {
          // atempo only supports 0.5-2.0, chain multiple for extreme speeds
          let speed = seg.speed;
          let atempoChain = [];
          while (speed > 2.0) { atempoChain.push('atempo=2.0'); speed /= 2.0; }
          while (speed < 0.5) { atempoChain.push('atempo=0.5'); speed *= 2.0; }
          atempoChain.push(`atempo=${speed}`);
          audioFilter = atempoChain.join(',');
        }
      }
      
      // Apply trim
      let trimFilter = `trim=start=${seg.startTime}:end=${seg.endTime},setpts=PTS-STARTPTS`;
      if (videoFilter) {
        videoFilter = `${trimFilter},${videoFilter}`;
      } else {
        videoFilter = trimFilter;
      }
      
      filterComplex += `[${index}:v]${videoFilter}[v${index}];`;

      if (hasAudio) {
        if (audioFilter) {
          audioFilter = `atrim=start=${seg.startTime}:end=${seg.endTime},asetpts=PTS-STARTPTS,${audioFilter}`;
        }
        filterComplex += `[${index}:a]${audioFilter || `atrim=start=${seg.startTime}:end=${seg.endTime},asetpts=PTS-STARTPTS`}[a${index}];`;
        concatInputs += `[v${index}][a${index}]`;
      } else {
        concatInputs += `[v${index}]`;
      }
    });
    
    // Concatenation — video-only for GIF, video+audio for MP4
    if (hasAudio) {
      filterComplex += `${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`;
    } else {
      // GIF: video-only concat, then apply GIF-specific filters
      const gifFps = gifOptions.fps || 15;
      const gifW   = gifOptions.width || 480;
      filterComplex += `${concatInputs}concat=n=${segments.length}:v=1:a=0[_gif];`;
      filterComplex += `[_gif]fps=${gifFps},scale=${gifW}:-1:flags=lanczos,split[s0][s1];`;
      filterComplex += `[s0]palettegen=max_colors=128:stats_mode=diff[p];`;
      filterComplex += `[s1][p]paletteuse=dither=bayer:bayer_scale=5[outv]`;
    }
    
    // Use the tested hardware encoder from GPU detection (if requested)
    const hwEncoder = (!createGif && useHwAccel) ? gpuInfo.hwEncoder : null;
    
    // Build hardware acceleration input args
    let hwAccelArgs = [];
    if (hwEncoder) {
      if (hwEncoder === 'h264_nvenc')       hwAccelArgs = ['-hwaccel', 'cuda', '-hwaccel_device', '0'];
      else if (hwEncoder === 'h264_amf')    hwAccelArgs = ['-hwaccel', 'dxva2'];
      else if (hwEncoder === 'h264_vaapi')  hwAccelArgs = ['-hwaccel', 'vaapi'];
      else if (hwEncoder === 'h264_qsv')    hwAccelArgs = ['-hwaccel', 'qsv'];
    }
    
    // Build output args
    const outputArgs = [];
    if (!createGif) {
      if (hwEncoder) {
        outputArgs.push('-c:v', hwEncoder);
        if (hwEncoder === 'h264_nvenc') outputArgs.push('-preset', 'fast');
      } else {
        outputArgs.push('-c:v', 'libx264', '-preset', 'fast');
      }
      outputArgs.push('-c:a', 'aac', '-b:a', '192k');
    }
    
    // Build final command
    const mapArgs = ['-map', '[outv]'];
    if (hasAudio) mapArgs.push('-map', '[outa]');

    const args = [
      ...hwAccelArgs,
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
        // You can send progress back to renderer
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

// Auto-updater events
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
  console.log('Update downloaded:', info);
});

// App events
app.on('ready', async () => {
  // Detect GPU first
  await detectGPU();
  
  // Create window after GPU detection
  createWindow();
  
  // Check for updates in production
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
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
