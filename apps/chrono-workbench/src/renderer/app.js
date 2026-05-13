const api = window.chronoWorkbench;

const state = {
  config: null,
  demos: [],
  projects: [],
  selected: null,
  selectedBuildTargets: new Set(),
  lastLogFile: null,
  lastOutputDir: null
};

const els = {
  buildDirInput: document.getElementById("buildDirInput"),
  dataDirInput: document.getElementById("dataDirInput"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  scanWarning: document.getElementById("scanWarning"),
  importAdamsBtn: document.getElementById("importAdamsBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  buildSelectedBtn: document.getElementById("buildSelectedBtn"),
  selectedBuildCount: document.getElementById("selectedBuildCount"),
  projectsList: document.getElementById("projectsList"),
  demosList: document.getElementById("demosList"),
  selectedType: document.getElementById("selectedType"),
  selectedName: document.getElementById("selectedName"),
  sourcePath: document.getElementById("sourcePath"),
  runCommand: document.getElementById("runCommand"),
  buildCommand: document.getElementById("buildCommand"),
  dataDir: document.getElementById("dataDir"),
  outputDir: document.getElementById("outputDir"),
  runState: document.getElementById("runState"),
  runBtn: document.getElementById("runBtn"),
  stopBtn: document.getElementById("stopBtn"),
  openOutputBtn: document.getElementById("openOutputBtn"),
  openLogBtn: document.getElementById("openLogBtn"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  logOutput: document.getElementById("logOutput")
};

function setRunState(label, className) {
  els.runState.textContent = label;
  els.runState.className = `status ${className}`;
}

function appendLog(text) {
  els.logOutput.textContent += text;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function itemSubtitle(item) {
  if (item.type === "adams") return item.sourcePath;
  if (item.built) return item.sourcePath || item.runCommand;
  return item.buildTarget ? `CMake target: ${item.buildTarget}` : "Not built";
}

function renderList(container, items, emptyText, options = {}) {
  container.innerHTML = "";
  if (!items.length) {
    container.textContent = emptyText;
    container.classList.add("empty-list");
    return;
  }

  container.classList.remove("empty-list");
  for (const item of items) {
    const row = document.createElement("div");
    row.className = `item ${state.selected && state.selected.id === item.id ? "active" : ""}`;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    const checked = item.buildTarget && state.selectedBuildTargets.has(item.buildTarget);
    const badge = item.type === "demo"
      ? `<span class="item-badge ${item.built ? "built" : "missing"}">${item.built ? "Built" : "Not built"}</span>`
      : "";
    const checkbox = options.withBuildCheckbox
      ? `<input class="item-check" type="checkbox" ${checked ? "checked" : ""} aria-label="Select ${item.name} for build" />`
      : "";
    row.innerHTML = `
      <div class="item-row">
        ${checkbox}
        <div class="item-main">
          <div class="item-title-row">
            <div class="item-name"></div>
            ${badge}
          </div>
          <div class="item-meta"></div>
        </div>
      </div>
    `;
    row.querySelector(".item-name").textContent = item.name;
    row.querySelector(".item-meta").textContent = itemSubtitle(item);
    const check = row.querySelector(".item-check");
    if (check) {
      check.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleBuildTarget(item);
      });
    }
    row.addEventListener("click", () => selectItem(item));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectItem(item);
      }
    });
    container.appendChild(row);
  }
}

function render() {
  els.buildDirInput.value = state.config ? state.config.buildDir : "";
  els.dataDirInput.value = state.config ? state.config.dataDir : "";

  renderList(els.projectsList, state.projects, "No imported projects yet.");
  renderList(els.demosList, state.demos, "No demos found.", { withBuildCheckbox: true });

  const selectedCount = state.selectedBuildTargets.size;
  els.selectedBuildCount.textContent = `${selectedCount} selected`;
  els.buildSelectedBtn.disabled = selectedCount === 0;

  if (state.warning) {
    els.scanWarning.textContent = state.warning;
    els.scanWarning.classList.remove("hidden");
  } else {
    els.scanWarning.classList.add("hidden");
  }

  if (!state.selected) {
    els.selectedType.textContent = "No selection";
    els.selectedName.textContent = "Select a demo or imported model";
    els.sourcePath.textContent = "None";
    els.runCommand.textContent = "Select an item to preview the command.";
    els.buildCommand.textContent = "Select a demo to preview the build command.";
    els.dataDir.textContent = "None";
    els.outputDir.textContent = "None";
    els.runBtn.disabled = true;
    return;
  }

  els.selectedType.textContent = state.selected.type === "adams" ? "ADAMS import" : "Chrono demo";
  els.selectedName.textContent = state.selected.name;
  els.sourcePath.textContent = state.selected.sourcePath || (state.selected.buildTarget ? `Not built: ${state.selected.buildTarget}` : "None");
  els.runCommand.textContent = state.selected.runCommand || "Build required before run.";
  els.buildCommand.textContent = state.selected.buildCommand || "No build command for this item.";
  els.dataDir.textContent = state.selected.dataDir || (state.config && state.config.dataDir) || "None";
  els.outputDir.textContent = state.selected.outputDir || "Created per run.";
  els.runBtn.disabled = state.selected.type === "demo" && !state.selected.built;
}

function selectItem(item) {
  state.selected = item;
  render();
}

function toggleBuildTarget(item) {
  if (!item.buildTarget) return;
  if (state.selectedBuildTargets.has(item.buildTarget)) {
    state.selectedBuildTargets.delete(item.buildTarget);
  } else {
    state.selectedBuildTargets.add(item.buildTarget);
  }
  render();
}

async function refresh() {
  const next = await api.getState();
  state.config = next.config;
  state.demos = next.demos || [];
  state.projects = next.projects || [];
  state.warning = next.warning;
  const knownTargets = new Set(state.demos.map((item) => item.buildTarget).filter(Boolean));
  state.selectedBuildTargets = new Set([...state.selectedBuildTargets].filter((target) => knownTargets.has(target)));
  if (state.selected) {
    const all = [...state.projects, ...state.demos];
    state.selected = all.find((item) => item.id === state.selected.id) || state.selected;
  }
  render();
}

async function runSelected() {
  if (!state.selected) return;
  if (state.selected.type === "demo" && !state.selected.built) {
    appendLog(`[Workbench] ${state.selected.name} is not built yet. Select it and click Build Selected first.\n`);
    return;
  }
  setRunState("Running", "running");
  appendLog(`\n[Workbench] Launching ${state.selected.name}\n`);
  try {
    const result = await api.run(state.selected);
    state.lastLogFile = result.logFile;
    state.lastOutputDir = result.outputDir;
    els.openOutputBtn.disabled = false;
    els.openLogBtn.disabled = false;
  } catch (error) {
    setRunState("Error", "error");
    appendLog(`[Workbench error] ${error.message}\n`);
  }
}

async function buildSelected() {
  const items = state.demos.filter((item) => state.selectedBuildTargets.has(item.buildTarget));
  if (!items.length) return;
  setRunState("Building", "running");
  appendLog(`\n[Workbench] Building ${items.length} selected demo target(s).\n`);
  try {
    const result = await api.buildDemos(items);
    state.lastLogFile = result.results[result.results.length - 1]?.logFile || state.lastLogFile;
    state.lastOutputDir = result.results[result.results.length - 1]?.outputDir || state.lastOutputDir;
    els.openOutputBtn.disabled = !state.lastOutputDir;
    els.openLogBtn.disabled = !state.lastLogFile;
  } catch (error) {
    setRunState("Error", "error");
    appendLog(`[Workbench error] ${error.message}\n`);
  }
}

els.saveConfigBtn.addEventListener("click", async () => {
  await api.saveConfig({
    buildDir: els.buildDirInput.value,
    dataDir: els.dataDirInput.value
  });
  await refresh();
});

els.importAdamsBtn.addEventListener("click", async () => {
  const project = await api.chooseAdams();
  if (project) {
    await refresh();
    selectItem(project);
  }
});

els.refreshBtn.addEventListener("click", refresh);
els.buildSelectedBtn.addEventListener("click", buildSelected);
els.runBtn.addEventListener("click", runSelected);

els.stopBtn.addEventListener("click", async () => {
  await api.stop();
  setRunState("Idle", "idle");
  appendLog("[Workbench] Stop requested.\n");
});

els.openOutputBtn.addEventListener("click", () => {
  if (state.lastOutputDir) api.openPath(state.lastOutputDir);
});

els.openLogBtn.addEventListener("click", () => {
  if (state.lastLogFile) api.openPath(state.lastLogFile);
});

els.clearLogBtn.addEventListener("click", () => {
  els.logOutput.textContent = "";
});

api.onRunEvent((event) => {
  if (event.type === "stdout" || event.type === "stderr" || event.type === "start" || event.type === "error") {
    appendLog(event.text || "");
  }
  if (event.type === "exit") {
    setRunState(event.code === 0 ? "Idle" : "Error", event.code === 0 ? "idle" : "error");
    const label = event.action === "build" ? `Build ${event.target}` : "Process";
    appendLog(`[Workbench] ${label} exited with code ${event.code}\n`);
    refresh();
  }
});

refresh().catch((error) => {
  setRunState("Error", "error");
  appendLog(`[Startup error] ${error.message}\n`);
});
