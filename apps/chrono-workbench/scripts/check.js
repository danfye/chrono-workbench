const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const files = [
  "src/main.js",
  "src/preload.js",
  "src/workbench-service.js",
  "src/renderer/app.js"
];

for (const file of files) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required file: ${file}`);
  }
  execFileSync(process.execPath, ["--check", fullPath], { stdio: "inherit" });
}

console.log("Chrono Workbench source check passed.");
