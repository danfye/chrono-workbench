const { spawn } = require("child_process");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_DIR = path.join(os.homedir(), "Documents", "Chrono Workbench");
const CONFIG_PATH = path.join(APP_DIR, "config.json");
const PROJECTS_DIR = path.join(APP_DIR, "projects");
const RUNS_DIR = path.join(APP_DIR, "runs");
const BUILDS_DIR = path.join(APP_DIR, "builds");

let repoRoot = path.resolve(__dirname, "../../..");
let activeRun = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureWorkbenchDirs() {
  ensureDir(APP_DIR);
  ensureDir(PROJECTS_DIR);
  ensureDir(RUNS_DIR);
  ensureDir(BUILDS_DIR);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizePath(value) {
  return path.resolve(value || repoRoot);
}

function defaultConfig() {
  return {
    repoRoot,
    buildDir: path.join(repoRoot, "build-chrono-gui"),
    dataDir: path.join(repoRoot, "data")
  };
}

function loadConfig() {
  ensureWorkbenchDirs();
  const config = { ...defaultConfig(), ...readJson(CONFIG_PATH, {}) };
  config.repoRoot = normalizePath(config.repoRoot);
  config.buildDir = normalizePath(config.buildDir);
  config.dataDir = normalizePath(config.dataDir);
  writeJson(CONFIG_PATH, config);
  return config;
}

function saveConfig(patch) {
  const config = { ...loadConfig(), ...patch };
  config.repoRoot = normalizePath(config.repoRoot);
  config.buildDir = normalizePath(config.buildDir);
  config.dataDir = normalizePath(config.dataDir);
  writeJson(CONFIG_PATH, config);
  return config;
}

function projectFile(id) {
  return path.join(PROJECTS_DIR, `${id}.json`);
}

function safeId(value) {
  return String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function listProjects() {
  ensureWorkbenchDirs();
  return fs.readdirSync(PROJECTS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson(path.join(PROJECTS_DIR, file), null))
    .filter(Boolean)
    .sort((a, b) => String(b.lastRunAt || b.createdAt).localeCompare(String(a.lastRunAt || a.createdAt)));
}

function createProjectFromAdams(inputPath) {
  ensureWorkbenchDirs();
  const config = loadConfig();
  const name = path.basename(inputPath, path.extname(inputPath));
  const id = `${timestampId()}-${safeId(name)}`;
  const outputDir = path.join(RUNS_DIR, id);
  const command = buildRunnerCommand({
    input: inputPath,
    dataDir: config.dataDir,
    outputDir,
    timestep: 0.005,
    realtime: true
  });
  const now = new Date().toISOString();
  const project = {
    id,
    name,
    type: "adams",
    sourcePath: inputPath,
    runCommand: command.display,
    dataDir: config.dataDir,
    outputDir,
    createdAt: now,
    lastRunAt: null
  };
  writeJson(projectFile(id), project);
  return project;
}

function getBuildBin(config) {
  return path.join(config.buildDir, "bin");
}

function getBuildCommand(config, target) {
  return {
    executable: "cmake",
    args: ["--build", config.buildDir, "--target", target, "--parallel"],
    display: ["cmake", "--build", config.buildDir, "--target", target, "--parallel"].map(quoteCommand).join(" ")
  };
}

function isExecutable(file) {
  try {
    const stats = fs.statSync(file);
    if (!stats.isFile()) return false;
    if (process.platform === "win32") return file.toLowerCase().endsWith(".exe");
    return (stats.mode & 0o111) !== 0;
  } catch (error) {
    return false;
  }
}

function macBundleExecutable(appPath) {
  const name = path.basename(appPath, ".app");
  const preferred = path.join(appPath, "Contents", "MacOS", name);
  if (fs.existsSync(preferred)) return preferred;
  const macosDir = path.join(appPath, "Contents", "MacOS");
  if (!fs.existsSync(macosDir)) return null;
  const candidates = fs.readdirSync(macosDir)
    .map((file) => path.join(macosDir, file))
    .filter(isExecutable);
  return candidates[0] || null;
}

function expectedDemoExecutable(config, target) {
  const binDir = getBuildBin(config);
  if (process.platform === "darwin") {
    return path.join(binDir, `${target}.app`, "Contents", "MacOS", target);
  }
  if (process.platform === "win32") {
    return path.join(binDir, `${target}.exe`);
  }
  return path.join(binDir, target);
}

function scanBuiltDemos(config) {
  const binDir = getBuildBin(config);
  const built = new Map();
  if (!fs.existsSync(binDir)) {
    return built;
  }

  for (const entry of fs.readdirSync(binDir)) {
    if (!entry.startsWith("demo_")) continue;
    const fullPath = path.join(binDir, entry);
    const stats = fs.statSync(fullPath);
    let executable = null;
    if (process.platform === "darwin" && stats.isDirectory() && entry.endsWith(".app")) {
      executable = macBundleExecutable(fullPath);
    } else if (stats.isFile() && isExecutable(fullPath)) {
      executable = fullPath;
    }
    if (!executable) continue;
    const target = entry.replace(/\.app$/i, "").replace(/\.exe$/i, "");
    built.set(target, executable);
  }
  return built;
}

function parseDemoTargetsFromBuildNinja(config) {
  const ninjaFile = path.join(config.buildDir, "build.ninja");
  if (!fs.existsSync(ninjaFile)) return [];
  const content = fs.readFileSync(ninjaFile, "utf8");
  const targets = new Set();
  const pattern = /^build\s+(demo_[A-Za-z0-9_]+):\s+phony\b/gm;
  let match = pattern.exec(content);
  while (match) {
    targets.add(match[1]);
    match = pattern.exec(content);
  }
  return [...targets];
}

function scanDemoTargetsWithCMake(config) {
  try {
    const output = execFileSync("cmake", ["--build", config.buildDir, "--target", "help"], {
      cwd: config.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.match(/^(demo_[A-Za-z0-9_]+):/))
      .filter(Boolean)
      .map((match) => match[1]);
  } catch (error) {
    return [];
  }
}

function scanDemoTargets(config) {
  const targets = new Set(parseDemoTargetsFromBuildNinja(config));
  if (!targets.size) {
    for (const target of scanDemoTargetsWithCMake(config)) {
      targets.add(target);
    }
  }
  return [...targets].sort((a, b) => a.localeCompare(b));
}

function scanDemos() {
  const config = loadConfig();
  const binDir = getBuildBin(config);
  if (!fs.existsSync(config.buildDir)) {
    return {
      config,
      demos: [],
      warning: `Build directory not found: ${config.buildDir}`
    };
  }

  const builtDemos = scanBuiltDemos(config);
  const targets = scanDemoTargets(config);
  const targetNames = targets.length ? targets : [...builtDemos.keys()];

  const demos = targetNames.map((target) => {
    const expectedExecutable = expectedDemoExecutable(config, target);
    const sourcePath = builtDemos.get(target) || (isExecutable(expectedExecutable) ? expectedExecutable : null);
    const built = Boolean(sourcePath);
    const buildCommand = getBuildCommand(config, target);
    return {
      id: target,
      name: target,
      type: "demo",
      buildTarget: target,
      built,
      sourcePath,
      runCommand: built ? quoteCommand(sourcePath) : null,
      buildCommand: buildCommand.display,
      dataDir: config.dataDir,
      outputDir: RUNS_DIR
    };
  });

  let warning = null;
  if (!fs.existsSync(binDir)) {
    warning = `Build bin directory not found: ${binDir}`;
  } else if (!targets.length) {
    warning = `No CMake demo targets found in ${config.buildDir}. Configure Chrono with BUILD_DEMOS=ON.`;
  }

  return { config, demos, warning };
}

function findRunner(config) {
  const binDir = getBuildBin(config);
  const names = process.platform === "win32"
    ? ["chrono_workbench_runner.exe"]
    : ["chrono_workbench_runner"];
  for (const name of names) {
    const candidate = path.join(binDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function quoteCommand(value) {
  if (!value.includes(" ")) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildRunnerCommand({ input, dataDir, outputDir, timestep, realtime }) {
  const config = loadConfig();
  const runner = findRunner(config);
  const args = [
    "--mode", "adams",
    "--input", input,
    "--data-dir", dataDir,
    "--output-dir", outputDir,
    "--timestep", String(timestep || 0.005),
    "--realtime", realtime === false ? "false" : "true"
  ];
  return {
    executable: runner,
    args,
    display: [runner || "<missing chrono_workbench_runner>", ...args].map(quoteCommand).join(" ")
  };
}

function appendLog(logFile, text) {
  fs.appendFileSync(logFile, text);
}

function isPathCommand(executable) {
  return executable.includes("/") || executable.includes("\\");
}

function stopActiveRun() {
  if (!activeRun) return { stopped: false };
  activeRun.process.kill();
  const result = { stopped: true, id: activeRun.id };
  activeRun = null;
  return result;
}

function launchProcess({ id, name, executable, args, cwd, outputDir, projectId, action = "run", target = null, logName = "run.log", queueIndex = null, queueTotal = null }, onEvent) {
  if (!executable || (isPathCommand(executable) && !fs.existsSync(executable))) {
    throw new Error(`Executable not found: ${executable || "missing path"}`);
  }

  stopActiveRun();
  ensureDir(outputDir);
  const logFile = path.join(outputDir, logName);
  const header = `\n[${new Date().toISOString()}] ${name}\n${[executable, ...args].join(" ")}\n\n`;
  appendLog(logFile, header);

  const child = spawn(executable, args, { cwd, env: process.env });
  activeRun = { id, action, process: child, logFile };

  const emit = (type, payload) => {
    const event = { id, action, target, queueIndex, queueTotal, type, logFile, outputDir, ...payload };
    if (onEvent) onEvent(event);
  };

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    appendLog(logFile, text);
    emit("stdout", { text });
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    appendLog(logFile, text);
    emit("stderr", { text });
  });

  child.on("error", (error) => {
    appendLog(logFile, `\n[error] ${error.message}\n`);
    emit("error", { text: error.message });
  });

  child.on("close", (code, signal) => {
    appendLog(logFile, `\n[exit] code=${code} signal=${signal || ""}\n`);
    if (activeRun && activeRun.id === id) activeRun = null;
    if (projectId) {
      const project = readJson(projectFile(projectId), null);
      if (project) {
        project.lastRunAt = new Date().toISOString();
        project.outputDir = outputDir;
        writeJson(projectFile(projectId), project);
      }
    }
    emit("exit", { code, signal });
  });

  emit("start", { text: header });
  return { id, logFile, outputDir, pid: child.pid };
}

async function waitForProcessClosed(id) {
  return new Promise((resolve) => {
    const poll = () => {
      if (!activeRun || activeRun.id !== id) {
        resolve();
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

async function buildDemoQueue(items, onEvent) {
  const config = loadConfig();
  const queue = (items || [])
    .filter((item) => item && item.buildTarget)
    .map((item) => ({ target: item.buildTarget, name: item.name || item.buildTarget }));

  if (!queue.length) {
    throw new Error("No demo targets selected for build.");
  }

  const results = [];
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    const id = `${timestampId()}-build-${safeId(item.target)}`;
    const outputDir = path.join(BUILDS_DIR, id);
    const command = getBuildCommand(config, item.target);
    const result = launchProcess({
      id,
      name: `Build ${item.target}`,
      executable: command.executable,
      args: command.args,
      cwd: config.repoRoot,
      outputDir,
      action: "build",
      target: item.target,
      logName: "build.log",
      queueIndex: index + 1,
      queueTotal: queue.length
    }, onEvent);
    results.push(result);
    await waitForProcessClosed(id);
  }

  return { queued: queue.length, results };
}

function runItem(item, onEvent) {
  const config = loadConfig();
  const id = `${timestampId()}-${safeId(item.name)}`;
  const outputDir = item.outputDir || path.join(RUNS_DIR, id);

  if (item.type === "adams") {
    const command = buildRunnerCommand({
      input: item.sourcePath,
      dataDir: item.dataDir || config.dataDir,
      outputDir,
      timestep: item.timestep || 0.005,
      realtime: item.realtime !== false
    });
    if (!command.executable) {
      throw new Error(`chrono_workbench_runner was not found in ${getBuildBin(config)}. Build target chrono_workbench_runner first.`);
    }
    return launchProcess({
      id,
      name: item.name,
      executable: command.executable,
      args: command.args,
      cwd: config.repoRoot,
      outputDir,
      projectId: item.id
    }, onEvent);
  }

  if (!item.sourcePath || !fs.existsSync(item.sourcePath)) {
    throw new Error(`Demo is not built yet: ${item.buildTarget || item.name}`);
  }

  return launchProcess({
    id,
    name: item.name,
    executable: item.sourcePath,
    args: [],
    cwd: config.repoRoot,
    outputDir
  }, onEvent);
}

module.exports = {
  APP_DIR,
  BUILDS_DIR,
  CONFIG_PATH,
  PROJECTS_DIR,
  RUNS_DIR,
  buildDemoQueue,
  createProjectFromAdams,
  listProjects,
  loadConfig,
  runItem,
  saveConfig,
  scanDemos,
  stopActiveRun
};
