import { app, BrowserWindow, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import http from 'http';

const SERVER_PORT = 3001;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
// IS_DEV: true when NODE_ENV=development OR when running from the source tree
// (i.e. not inside an asar/packaged app)
const IS_DEV =
  process.env['NODE_ENV'] === 'development' ||
  !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

// ── Start the Node.js API server ─────────────────────────────────────────────
function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverEntry = IS_DEV
      ? path.join(__dirname, '../../server/dist/index.js')
      : path.join(process.resourcesPath, 'server/dist/index.js');

    const sdScriptsDir = IS_DEV
      ? path.join(__dirname, '../../../sd-scripts')
      : path.join(process.resourcesPath, 'sd-scripts');

    const bridgeDir = IS_DEV
      ? path.join(__dirname, '../../../python/bridge')
      : path.join(process.resourcesPath, 'python/bridge');

    serverProcess = spawn(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        NODE_ENV: IS_DEV ? 'development' : 'production',
        PORT: String(SERVER_PORT),
        SD_SCRIPTS_DIR: sdScriptsDir,
        BRIDGE_DIR: bridgeDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString();
      console.log('[server]', msg.trim());
      if (msg.includes(`listening on`)) resolve();
    });

    serverProcess.stderr?.on('data', (d: Buffer) => console.error('[server-err]', d.toString().trim()));
    serverProcess.on('error', reject);
    setTimeout(resolve, 5000); // fallback: assume ready after 5s
  });
}

// ── Poll until server responds ────────────────────────────────────────────────
function waitForServer(maxWaitMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http.get(`${SERVER_URL}/api/jobs`, res => {
        if (res.statusCode === 200) resolve();
        else retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > maxWaitMs) { reject(new Error('Server did not start')); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

// ── Create the main Electron window ──────────────────────────────────────────
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Kohya LoRA Builder',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const webUrl = IS_DEV ? 'http://localhost:5173' : SERVER_URL;
  mainWindow.loadURL(webUrl);

  if (IS_DEV) mainWindow.webContents.openDevTools();

  // Open external links in OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await startServer();
    await waitForServer();
    createWindow();
  } catch (err) {
    console.error('Failed to start server:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
