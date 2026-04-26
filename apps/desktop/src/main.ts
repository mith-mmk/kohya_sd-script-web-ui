import { app, BrowserWindow, shell, dialog, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { pathToFileURL } from 'url';

const SERVER_PORT = 3001;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|bmp|gif)$/iu;
// IS_DEV: true when NODE_ENV=development OR when running from the source tree
// (i.e. not inside an asar/packaged app)
const IS_DEV =
  process.env['NODE_ENV'] === 'development' ||
  !app.isPackaged;

if (IS_DEV) {
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
}

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

type NativePreviewItem = {
  name: string;
  url: string;
};

async function showNativeOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return mainWindow
    ? dialog.showOpenDialog(mainWindow, options)
    : dialog.showOpenDialog(options);
}

type RuntimePaths = {
  serverEntry: string;
  sdScriptsDir: string;
  bridgeDir: string;
  pythonBin: string;
  dbPath: string;
  workBase: string;
};

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;

  const envText = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of envText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(separatorIndex + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function getBundledPythonPath(baseDir: string): string {
  return process.platform === 'win32'
    ? path.join(baseDir, '.venv', 'Scripts', 'python.exe')
    : path.join(baseDir, '.venv', 'bin', 'python');
}

function resolveRuntimePaths(): RuntimePaths {
  const repoRoot = path.resolve(__dirname, '../../..');
  const userDataDir = app.getPath('userData');

  const serverEntry = process.env['SERVER_ENTRY'] ?? (
    IS_DEV
      ? path.join(__dirname, '../../server/dist/index.js')
      : path.join(process.resourcesPath, 'server/dist/index.js')
  );

  const sdScriptsDir = process.env['SD_SCRIPTS_DIR'] ?? (
    IS_DEV
      ? path.join(repoRoot, 'sd-scripts')
      : path.join(process.resourcesPath, 'sd-scripts')
  );

  const bridgeDir = process.env['BRIDGE_DIR'] ?? (
    IS_DEV
      ? path.join(repoRoot, 'python/bridge')
      : path.join(process.resourcesPath, 'python/bridge')
  );

  const pythonBin = process.env['PYTHON_BIN'] ?? (
    IS_DEV
      ? getBundledPythonPath(repoRoot)
      : getBundledPythonPath(process.resourcesPath)
  );

  const dbPath = process.env['DB_PATH'] ?? (
    IS_DEV
      ? path.join(repoRoot, 'data', 'kohya.db')
      : path.join(userDataDir, 'data', 'kohya.db')
  );

  const workBase = process.env['WORK_BASE'] ?? (
    IS_DEV
      ? path.join(repoRoot, 'work')
      : path.join(userDataDir, 'work')
  );

  return { serverEntry, sdScriptsDir, bridgeDir, pythonBin, dbPath, workBase };
}

function assertRuntimePaths(runtimePaths: RuntimePaths): void {
  const missing: string[] = [];

  if (!fs.existsSync(runtimePaths.serverEntry)) missing.push(`server entry: ${runtimePaths.serverEntry}`);
  if (!fs.existsSync(runtimePaths.sdScriptsDir)) missing.push(`sd-scripts dir: ${runtimePaths.sdScriptsDir}`);
  if (!fs.existsSync(runtimePaths.bridgeDir)) missing.push(`bridge dir: ${runtimePaths.bridgeDir}`);
  if (!fs.existsSync(runtimePaths.pythonBin)) missing.push(`python runtime: ${runtimePaths.pythonBin}`);

  if (missing.length) {
    throw new Error(`Missing runtime resources: ${missing.join(', ')}`);
  }
}

ipcMain.handle('kohya:pick-directory', async () => {
  const result = await showNativeOpenDialog({
    properties: ['openDirectory'],
  });

  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('kohya:pick-file', async (_event, kind: 'model' | 'binary') => {
  const filters = kind === 'binary'
    ? [{ name: 'Model and binary files', extensions: ['safetensors', 'ckpt', 'pt', 'bin'] }]
    : [{ name: 'Model files', extensions: ['safetensors', 'ckpt', 'pt'] }];

  const result = await showNativeOpenDialog({
    properties: ['openFile'],
    filters,
  });

  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('kohya:list-image-previews', async (_event, dirPath: string, maxItems: number) => {
  if (!dirPath) return { previews: [] as NativePreviewItem[], total: 0 };

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const imageFiles = entries
    .filter(entry => entry.isFile() && IMAGE_FILE_RE.test(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));

  return {
    previews: imageFiles.slice(0, Math.max(0, maxItems)).map(name => ({
      name,
      url: pathToFileURL(path.join(dirPath, name)).href,
    })),
    total: imageFiles.length,
  };
});

// ── Start the Node.js API server ─────────────────────────────────────────────
function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const runtimePaths = resolveRuntimePaths();
    assertRuntimePaths(runtimePaths);
    fs.mkdirSync(path.dirname(runtimePaths.dbPath), { recursive: true });
    fs.mkdirSync(runtimePaths.workBase, { recursive: true });

    serverProcess = spawn(process.execPath, [runtimePaths.serverEntry], {
      env: {
        ...process.env,
        NODE_ENV: IS_DEV ? 'development' : 'production',
        PORT: String(SERVER_PORT),
        DB_PATH: runtimePaths.dbPath,
        WORK_BASE: runtimePaths.workBase,
        PYTHON_BIN: runtimePaths.pythonBin,
        SD_SCRIPTS_DIR: runtimePaths.sdScriptsDir,
        BRIDGE_DIR: runtimePaths.bridgeDir,
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
