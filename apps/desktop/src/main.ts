import { app, BrowserWindow, shell, dialog, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';

const IMAGE_FILE_RE = /\.(png|jpe?g|webp|bmp|gif)$/iu;
const USE_VITE_DEV_SERVER = process.env['NODE_ENV'] === 'development';
const USE_SOURCE_TREE = !app.isPackaged;

if (USE_SOURCE_TREE) {
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
}

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

function resolveAppIconPath(): string {
  return USE_SOURCE_TREE
    ? path.resolve(__dirname, '../assets/app-icon.png')
    : path.join(process.resourcesPath, 'assets/app-icon.png');
}

type NativePreviewItem = {
  name: string;
  url: string;
};

function getImageMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

async function showNativeOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return mainWindow
    ? dialog.showOpenDialog(mainWindow, options)
    : dialog.showOpenDialog(options);
}

type RuntimePaths = {
  nodeBin: string;
  serverEntry: string;
  sdScriptsDir: string;
  bridgeDir: string;
  pythonBin: string;
  dbPath: string;
  workBase: string;
  host: string;
  port: number;
  serverUrl: string;
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
  const host = process.env['HOST'] ?? '127.0.0.1';
  const port = getConfiguredPort();
  const serverUrl = `http://${host}:${port}`;

  const serverEntry = process.env['SERVER_ENTRY'] ?? (
    USE_SOURCE_TREE
      ? path.join(__dirname, '../../server/dist/index.js')
      : path.join(process.resourcesPath, 'server/dist/index.js')
  );
  const nodeBin = process.env['NODE_BIN'] ?? (
    USE_SOURCE_TREE
      ? 'node'
      : path.join(process.resourcesPath, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  );

  const sdScriptsDir = process.env['SD_SCRIPTS_DIR'] ?? (
    USE_SOURCE_TREE
      ? path.join(repoRoot, 'sd-scripts')
      : path.join(process.resourcesPath, 'sd-scripts')
  );

  const bridgeDir = process.env['BRIDGE_DIR'] ?? (
    USE_SOURCE_TREE
      ? path.join(repoRoot, 'python/bridge')
      : path.join(process.resourcesPath, 'python/bridge')
  );

  const pythonBin = process.env['PYTHON_BIN'] ?? (
    USE_SOURCE_TREE
      ? getBundledPythonPath(repoRoot)
      : getBundledPythonPath(process.resourcesPath)
  );

  const dbPath = process.env['DB_PATH'] ?? (
    USE_SOURCE_TREE
      ? path.join(repoRoot, 'data', 'kohya.db')
      : path.join(userDataDir, 'data', 'kohya.db')
  );

  const workBase = process.env['WORK_BASE'] ?? (
    USE_SOURCE_TREE
      ? path.join(repoRoot, 'work')
      : path.join(userDataDir, 'work')
  );

  return { nodeBin, serverEntry, sdScriptsDir, bridgeDir, pythonBin, dbPath, workBase, host, port, serverUrl };
}

function getConfiguredPort(): number {
  const rawPort = process.env['PORT'] ?? '3001';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }
  return port;
}

function assertRuntimePaths(runtimePaths: RuntimePaths): void {
  const missing: string[] = [];

  if (!runtimePaths.nodeBin || (path.isAbsolute(runtimePaths.nodeBin) && !fs.existsSync(runtimePaths.nodeBin))) {
    missing.push(`node runtime: ${runtimePaths.nodeBin}`);
  }
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
    previews: await Promise.all(
      imageFiles.slice(0, Math.max(0, maxItems)).map(async name => {
        const filePath = path.join(dirPath, name);
        const fileBytes = await fs.promises.readFile(filePath);
        return {
          name,
          url: `data:${getImageMimeType(name)};base64,${fileBytes.toString('base64')}`,
        };
      })
    ),
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

    serverProcess = spawn(runtimePaths.nodeBin, [runtimePaths.serverEntry], {
      env: {
        ...process.env,
        NODE_ENV: USE_VITE_DEV_SERVER ? 'development' : 'production',
        HOST: runtimePaths.host,
        PORT: String(runtimePaths.port),
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
    serverProcess.on('exit', code => {
      reject(new Error(`Server process exited before startup completed: ${code ?? 'unknown'}`));
    });
    setTimeout(resolve, 5000); // fallback: assume ready after 5s
  });
}

// ── Poll until server responds ────────────────────────────────────────────────
function waitForServer(serverUrl: string, maxWaitMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let lastError = 'no response yet';
    const check = () => {
      http.get(`${serverUrl}/api/jobs`, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8').slice(0, 500);
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          lastError = `HTTP ${res.statusCode ?? 'unknown'} ${body}`;
          retry();
        });
        res.on('error', err => {
          lastError = err.message;
          retry();
        });
      }).on('error', err => {
        lastError = err.message;
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > maxWaitMs) {
        reject(new Error(`Server did not start: ${lastError}`));
        return;
      }
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
    backgroundColor: '#0f1115',
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const runtimePaths = resolveRuntimePaths();
  const webUrl = USE_VITE_DEV_SERVER ? 'http://localhost:5173' : runtimePaths.serverUrl;
  mainWindow.loadURL(webUrl);

  if (USE_VITE_DEV_SERVER) mainWindow.webContents.openDevTools();

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
    const runtimePaths = resolveRuntimePaths();
    await startServer();
    await waitForServer(runtimePaths.serverUrl);
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
