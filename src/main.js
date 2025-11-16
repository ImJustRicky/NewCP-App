const { app, BrowserWindow, autoUpdater } = require("electron");
const discord_integration = require("./integrations/discord");
const path = require("path");

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) app.quit();

// Optional: auto-update from the original NewCP repo.
// You may comment this out if you do not wish your custom client to update
// from their GitHub releases.
if (process.platform !== "darwin") {
  require("update-electron-app")({
    repo: "New-Club-Penguin/NewCP-App-Build",
  });
}

/**
 * Your local CP domains
 */
const CP_BASE = "http://cp.local";
const CP_PLAY = "http://play.cp.local";
// Use these as needed; included so navigation checks do not block them.
const CP_LEGACY = "http://legacy.cp.local";
const CP_MEDIA = "http://media.cp.local";

/**
 * Only allow navigation within your own origins.
 */
const ALLOWED_ORIGINS = [
  CP_BASE,
  CP_PLAY,
  CP_LEGACY,
  CP_MEDIA,
];

/**
 * Flash plug-in paths per platform
 */
const pluginPaths = {
  win32: path.join(path.dirname(__dirname), "lib/pepflashplayer.dll"),
  darwin: path.join(path.dirname(__dirname), "lib/PepperFlashPlayer.plugin"),
  linux: path.join(path.dirname(__dirname), "lib/libpepflashplayer.so"),
};

if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
}

const pluginName = pluginPaths[process.platform];
console.log("pluginName", pluginName);

app.commandLine.appendSwitch("ppapi-flash-path", pluginName);
app.commandLine.appendSwitch("ppapi-flash-version", "31.0.0.122");

// If you later use HTTPS with self-signed certificates this prevents SSL errors.
// For plain HTTP it is harmless but not required.
app.commandLine.appendSwitch("ignore-certificate-errors");

let mainWindow;

/**
 * Create the splash and main windows, and load your CP site.
 */
const createWindow = () => {
  // Splash window
  let splashWindow = new BrowserWindow({
    width: 600,
    height: 320,
    frame: false,
    transparent: true,
    show: false,
  });

  splashWindow.setResizable(false);
  splashWindow.loadURL(
    "file://" + path.join(path.dirname(__dirname), "src/index.html"),
  );
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
  splashWindow.webContents.on("did-finish-load", () => {
    splashWindow.show();
  });

  // Main game window
  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    useContentSize: true,
    show: false,
    webPreferences: {
      plugins: true,
    },
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    discord_integration.initDiscordRichPresence();
  });

  // Block navigation to origins outside your CP domains
  mainWindow.webContents.on("will-navigate", (event, urlString) => {
    const origin = new URL(urlString).origin;
    if (!ALLOWED_ORIGINS.includes(origin)) {
      console.log("Blocked navigation to", origin);
      event.preventDefault();
    }
  });

  app.on("before-quit", async () => {
    await discord_integration.cleanupDiscord();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.session.clearHostResolverCache();

  // Load your local CP site (play client)
  // Change CP_PLAY to CP_BASE if you prefer the main site first.
  withTimeout(mainWindow.loadURL(CP_PLAY + "/"), 60000).catch(async (err) => {
    console.error("Failed to load CP site:", err.message);
    await discord_integration.cleanupDiscord();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
};

/**
 * Launch logic and single-instance guard
 */
const launchMain = () => {
  // Disallow multiple clients running
  if (!app.requestSingleInstanceLock()) {
    return app.quit();
  }

  app.on("second-instance", (_event, _commandLine, _workingDirectory) => {
    // Focus the existing window if the user tries to open another instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  // Custom protocol handler (optional; can be renamed if desired)
  app.setAsDefaultProtocolClient("newcp");

  app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
      // On macOS, recreate a window if none exist when the dock icon is clicked
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
      process.exit(0);
    }
  });
};

/**
 * Helper: wrap a promise with a timeout
 */
async function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`Operation timed out after ${ms} ms`));
    }, ms);
  });

  return Promise.race([promise, timeout]);
}

launchMain();
