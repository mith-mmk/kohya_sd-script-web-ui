// Preload script — minimal surface for context bridge
// Currently no IPC needed (all communication via HTTP/WebSocket to localhost)
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__kohya__', {
  version: process.env['npm_package_version'] ?? '0.1.0',
  pickDirectory: () => ipcRenderer.invoke('kohya:pick-directory') as Promise<string | null>,
  pickFile: (kind: 'model' | 'binary') => ipcRenderer.invoke('kohya:pick-file', kind) as Promise<string | null>,
  listImagePreviews: (dirPath: string, maxItems: number) => ipcRenderer.invoke('kohya:list-image-previews', dirPath, maxItems) as Promise<{
    previews: Array<{ name: string; url: string }>;
    total: number;
  }>,
});
