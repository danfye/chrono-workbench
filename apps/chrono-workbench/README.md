# Chrono Workbench

Chrono Workbench is an Electron shell for browsing Project Chrono demos,
importing ADAMS `.adm` files, launching native Chrono simulations, and keeping
run logs and output folders organized.

This is not an embedded 3D viewport. Chrono/Irrlicht simulations still open in
their own native windows while Workbench manages projects, commands, logs, and
outputs.

## Build the Chrono runner

Configure Chrono with Irrlicht enabled and build the Workbench runner:

```bash
cmake -S ../.. -B ../../build-chrono-gui -DENABLE_MODULE_IRRLICHT=ON
cmake --build ../../build-chrono-gui --target chrono_workbench_runner
```

To populate the demo browser, build the demos you want to run:

```bash
cmake --build ../../build-chrono-gui
```

## Run Workbench

```bash
npm install
npm run dev
```

On macOS, after `npm install` has been run once, you can also open the local
launcher directly from Finder:

```text
apps/chrono-workbench/Chrono Workbench Launcher.app
```

The launcher writes startup logs to:

```text
/tmp/chrono-workbench-launcher.log
```

If Electron's binary download is slow on your network, use a mirror:

```bash
npm_config_electron_mirror=https://npmmirror.com/mirrors/electron/ npm install
```

Use the Workspace panel to point Workbench at your Chrono build directory and
data directory. By default it assumes:

```text
repo/build-chrono-gui
repo/data
```

Workbench stores local configuration and run output in:

```text
~/Documents/Chrono Workbench/config.json
~/Documents/Chrono Workbench/projects/
~/Documents/Chrono Workbench/runs/
```

## CLI runner

Workbench launches ADAMS models through:

```bash
chrono_workbench_runner --mode adams --input <file.adm> --data-dir <chrono-data-dir> --output-dir <dir> --timestep 0.005 --realtime true
```

For non-interactive smoke tests, add:

```bash
--max-frames 5
```

## Current Electron note

This development shell is pinned to Electron 31 because it downloads reliably in
the current local environment and has been verified to launch the Workbench
window. `npm audit` reports advisories for this Electron line; for a public
redistributable build, upgrade Electron after confirming the newer binary can be
downloaded on the target network.
