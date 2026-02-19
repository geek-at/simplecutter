// SimpleCutter - Core Functions
// Utility functions for the application

/**
 * Format seconds to MM:SS format
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format seconds to HH:MM:SS format
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
function formatTimeLong(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse time string to seconds
 * @param {string} timeStr - Time string (MM:SS or HH:MM:SS)
 * @returns {number} Time in seconds
 */
function parseTime(timeStr) {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parseFloat(timeStr) || 0;
}

/**
 * Get file extension
 * @param {string} filename - Filename
 * @returns {string} File extension
 */
function getExtension(filename) {
  return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2).toLowerCase();
}

/**
 * Check if file is a video
 * @param {string} filename - Filename
 * @returns {boolean} True if video file
 */
function isVideoFile(filename) {
  const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg'];
  return videoExtensions.includes(getExtension(filename));
}

/**
 * Get video filename without extension
 * @param {string} filename - Filename
 * @returns {string} Filename without extension
 */
function getBasename(filename) {
  return filename.replace(/\.[^/.]+$/, '');
}

/**
 * Generate a unique filename
 * @param {string} dir - Directory path
 * @param {string} baseName - Base filename
 * @param {string} ext - File extension
 * @returns {string} Unique filename
 */
function generateUniqueName(dir, baseName, ext) {
  let name = `${dir}/${baseName}.${ext}`;
  let counter = 1;
  
  while (require('fs').existsSync(name)) {
    name = `${dir}/${baseName}_${counter}.${ext}`;
    counter++;
  }
  
  return name;
}

/**
 * Validate segment times
 * @param {number} start - Start time
 * @param {number} end - End time
 * @param {number} duration - Video duration
 * @returns {object} Validation result with isValid and error message
 */
function validateSegment(start, end, duration) {
  if (isNaN(start) || isNaN(end)) {
    return { isValid: false, error: 'Invalid time values' };
  }
  
  if (start < 0) {
    return { isValid: false, error: 'Start time cannot be negative' };
  }
  
  if (end > duration) {
    return { isValid: false, error: 'End time exceeds video duration' };
  }
  
  if (start >= end) {
    return { isValid: false, error: 'Start time must be less than end time' };
  }
  
  return { isValid: true, error: null };
}

/**
 * Calculate output file size estimate (in bytes)
 * @param {number} duration - Duration in seconds
 * @param {number} bitrate - Bitrate in kbps
 * @returns {number} Estimated file size in bytes
 */
function estimateFileSize(duration, bitrate) {
  return Math.round((duration * bitrate * 1000) / 8);
}

/**
 * Format bytes to human readable
 * @param {number} bytes - Bytes
 * @returns {string} Formatted size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Debounce function
 * @param {function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Clamp a number between min and max
 * @param {number} num - Number to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

/**
 * Convert timestamp to seconds
 * @param {string} timestamp - Timestamp in format HH:MM:SS.mmm
 * @returns {number} Seconds
 */
function timestampToSeconds(timestamp) {
  const parts = timestamp.split(':');
  let seconds = 0;
  
  if (parts.length === 3) {
    seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  
  return seconds;
}

/**
 * Get speed label
 * @param {number} speed - Speed multiplier
 * @returns {string} Speed label
 */
function getSpeedLabel(speed) {
  if (speed === 1) return 'Normal';
  if (speed < 1) return `${speed}x (Slow)`;
  return `${speed}x (Fast)`;
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatTime,
    formatTimeLong,
    parseTime,
    getExtension,
    isVideoFile,
    getBasename,
    generateUniqueName,
    validateSegment,
    estimateFileSize,
    formatBytes,
    debounce,
    clamp,
    timestampToSeconds,
    getSpeedLabel
  };
}
