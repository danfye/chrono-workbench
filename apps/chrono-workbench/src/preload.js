const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chronoWorkbench", {
  getState: () => ipcRenderer.invoke("workbench:getState"),
  saveConfig: (patch) => ipcRenderer.invoke("workbench:saveConfig", patch),
  chooseAdams: () => ipcRenderer.invoke("workbench:chooseAdams"),
  run: (item) => ipcRenderer.invoke("workbench:run", item),
  buildDemos: (items) => ipcRenderer.invoke("workbench:buildDemos", items),
  stop: () => ipcRenderer.invoke("workbench:stop"),
  openPath: (targetPath) => ipcRenderer.invoke("workbench:openPath", targetPath),
  onRunEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("run:event", handler);
    return () => ipcRenderer.removeListener("run:event", handler);
  }
});
