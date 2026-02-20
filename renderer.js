// SimpleCutter - Renderer
// Set up electronAPI directly (nodeIntegration is enabled, contextIsolation is off)

const { ipcRenderer } = require('electron');

window.electronAPI = {
  getGPUInfo: () => ipcRenderer.invoke('get-gpu-info'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getVideoFps: (filePath) => ipcRenderer.invoke('get-video-fps', filePath),
  selectVideo: () => ipcRenderer.invoke('select-video'),
  selectOutputDir: (opts) => ipcRenderer.invoke('select-output-dir', opts),
  saveScreenshot: (opts) => ipcRenderer.invoke('save-screenshot', opts),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  getFFmpegPath: () => ipcRenderer.invoke('get-ffmpeg-path'),
  processVideo: (options) => ipcRenderer.invoke('process-video', options),
  onFFmpegProgress: (callback) => {
    ipcRenderer.on('ffmpeg-progress', (_event, data) => callback(data));
  },
  removeFFmpegProgressListener: () => {
    ipcRenderer.removeAllListeners('ffmpeg-progress');
  },
  platform: process.platform
};

console.log('SimpleCutter renderer initialized');
