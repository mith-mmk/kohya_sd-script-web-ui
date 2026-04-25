// Preload script — minimal surface for context bridge
// Currently no IPC needed (all communication via HTTP/WebSocket to localhost)
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('__kohya__', {
  version: process.env['npm_package_version'] ?? '0.1.0',
});
