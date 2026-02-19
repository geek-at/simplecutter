// SimpleCutter - Preload Script
// Exposes secure APIs to renderer process using contextBridge

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Get GPU information
  getGPUInfo: () => ipcRenderer.invoke('get-gpu-info'),
  
  // Get app version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Open file dialog to select video
  selectVideo: () => ipcRenderer.invoke('select-video'),
  
  // Open save dialog for output
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  
  // Get FFmpeg path
  getFFmpegPath: () => ipcRenderer.invoke('get-ffmpeg-path'),
  
  // Process video with segments
  processVideo: (options) => ipcRenderer.invoke('process-video', options),
  
  // Listen for FFmpeg progress
  onFFmpegProgress: (callback) => {
    ipcRenderer.on('ffmpeg-progress', (event, data) => callback(data));
  },
  
  // Remove progress listener
  removeFFmpegProgressListener: () => {
    ipcRenderer.removeAllListeners('ffmpeg-progress');
  },
  
  // Platform info
  platform: process.platform
});

console.log('SimpleCutter preload script loaded');
