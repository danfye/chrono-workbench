const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const service = require("./workbench-service");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    title: "Chrono Workbench",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function sendRunEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("run:event", event);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  service.stopActiveRun();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("workbench:getState", async () => {
  const scan = service.scanDemos();
  return {
    config: scan.config,
    demos: scan.demos,
    warning: scan.warning,
    projects: service.listProjects(),
    appDir: service.APP_DIR
  };
});

ipcMain.handle("workbench:saveConfig", async (_event, patch) => {
  return service.saveConfig(patch || {});
});

ipcMain.handle("workbench:chooseAdams", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import ADAMS model",
    properties: ["openFile"],
    filters: [
      { name: "ADAMS files", extensions: ["adm"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePaths.length) return null;
  return service.createProjectFromAdams(result.filePaths[0]);
});

ipcMain.handle("workbench:run", async (_event, item) => {
  return service.runItem(item, sendRunEvent);
});

ipcMain.handle("workbench:buildDemos", async (_event, items) => {
  return service.buildDemoQueue(items, sendRunEvent);
});

ipcMain.handle("workbench:stop", async () => {
  return service.stopActiveRun();
});

ipcMain.handle("workbench:openPath", async (_event, targetPath) => {
  if (!targetPath) return { opened: false };
  const result = await shell.openPath(targetPath);
  return { opened: !result, error: result || null };
});
