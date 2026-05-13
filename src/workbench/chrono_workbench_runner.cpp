// =============================================================================
// PROJECT CHRONO - http://projectchrono.org
//
// Copyright (c) 2026 projectchrono.org
// All rights reserved.
//
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file at the top level of the distribution and at
// http://projectchrono.org/license-chrono.txt.
//
// =============================================================================
//
// Runner executable for Chrono Workbench.  The Electron shell uses this small
// CLI to launch controlled Chrono jobs without coupling the desktop UI to demo
// internals.  Version 1 supports loading ADAMS .adm files with the existing
// Chrono parser and visualizing them through an external Irrlicht window.
//
// =============================================================================

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "chrono/core/ChGlobal.h"
#include "chrono/core/ChRealtimeStep.h"
#include "chrono/physics/ChBodyEasy.h"
#include "chrono/physics/ChSystemSMC.h"
#include "chrono/utils/ChParserAdams.h"

#include "chrono_irrlicht/ChVisualSystemIrrlicht.h"
#include "chrono_thirdparty/filesystem/path.h"

using namespace chrono;
using namespace chrono::irrlicht;
using namespace chrono::utils;

namespace {

struct Options {
    std::string mode = "adams";
    std::string input;
    std::string data_dir = "../data/";
    std::string output_dir = "DEMO_OUTPUT/CHRONO_WORKBENCH";
    double timestep = 0.005;
    bool realtime = true;
    bool verbose = true;
    int max_frames = -1;
};

struct ParseResult {
    Options options;
    std::string error;
};

std::string Usage() {
    return "Usage:\n"
           "  chrono_workbench_runner --mode adams --input <file.adm> "
           "--data-dir <chrono-data-dir> --output-dir <dir> "
           "[--timestep 0.005] [--realtime true] [--max-frames N]\n";
}

bool IsTrueValue(const std::string& value) {
    return value == "1" || value == "true" || value == "TRUE" || value == "yes" || value == "YES" ||
           value == "on" || value == "ON";
}

bool RequireValue(int& index, int argc, char* argv[], const std::string& option, std::string& value, std::string& error) {
    if (index + 1 >= argc) {
        error = "Missing value for " + option;
        return false;
    }
    ++index;
    value = argv[index];
    return true;
}

bool ParseDouble(const std::string& value, double& parsed) {
    std::istringstream in(value);
    in >> parsed;
    return !in.fail() && in.eof();
}

bool ParseInt(const std::string& value, int& parsed) {
    std::istringstream in(value);
    in >> parsed;
    return !in.fail() && in.eof();
}

ParseResult ParseArgs(int argc, char* argv[]) {
    ParseResult result;
    std::string value;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            std::cout << Usage();
            std::exit(0);
        } else if (arg == "--mode") {
            if (!RequireValue(i, argc, argv, arg, result.options.mode, result.error))
                return result;
        } else if (arg == "--input") {
            if (!RequireValue(i, argc, argv, arg, result.options.input, result.error))
                return result;
        } else if (arg == "--data-dir") {
            if (!RequireValue(i, argc, argv, arg, result.options.data_dir, result.error))
                return result;
        } else if (arg == "--output-dir") {
            if (!RequireValue(i, argc, argv, arg, result.options.output_dir, result.error))
                return result;
        } else if (arg == "--timestep") {
            if (!RequireValue(i, argc, argv, arg, value, result.error))
                return result;
            if (!ParseDouble(value, result.options.timestep)) {
                result.error = "Invalid --timestep value: " + value;
                return result;
            }
        } else if (arg == "--realtime") {
            if (!RequireValue(i, argc, argv, arg, value, result.error))
                return result;
            result.options.realtime = IsTrueValue(value);
        } else if (arg == "--verbose") {
            if (!RequireValue(i, argc, argv, arg, value, result.error))
                return result;
            result.options.verbose = IsTrueValue(value);
        } else if (arg == "--max-frames") {
            if (!RequireValue(i, argc, argv, arg, value, result.error))
                return result;
            if (!ParseInt(value, result.options.max_frames)) {
                result.error = "Invalid --max-frames value: " + value;
                return result;
            }
        } else {
            result.error = "Unknown argument: " + arg;
            return result;
        }
    }

    if (result.options.mode != "adams") {
        result.error = "Unsupported mode: " + result.options.mode;
        return result;
    }
    if (result.options.input.empty()) {
        result.error = "Missing required --input <file.adm>";
        return result;
    }
    if (result.options.timestep <= 0) {
        result.error = "--timestep must be greater than zero";
        return result;
    }

    return result;
}

std::string WithTrailingSlash(const std::string& path) {
    if (path.empty())
        return path;
    const char last = path[path.size() - 1];
    if (last == '/' || last == '\\')
        return path;
    return path + "/";
}

bool PathExists(const std::string& path) {
    return filesystem::path(path).exists();
}

bool EnsureDirectory(const std::string& path, std::string& error) {
    filesystem::path dir(path);
    if (dir.exists()) {
        if (!dir.is_directory()) {
            error = "Output path exists but is not a directory: " + path;
            return false;
        }
        return true;
    }

    const filesystem::path parent = dir.parent_path();
    if (!parent.empty() && !parent.exists())
        if (!EnsureDirectory(parent.str(), error))
            return false;

    if (!filesystem::create_directory(dir) && !dir.exists()) {
        error = "Failed to create output directory: " + path;
        return false;
    }
    return true;
}

bool ResolveInputPath(const std::string& input, const std::string& data_dir, std::string& resolved, std::string& error) {
    if (PathExists(input)) {
        resolved = input;
        return true;
    }

    const std::string data_candidate = WithTrailingSlash(data_dir) + input;
    if (PathExists(data_candidate)) {
        resolved = data_candidate;
        return true;
    }

    error = "ADAMS input file not found: " + input;
    return false;
}

void WriteRunMetadata(const Options& options, const std::string& input_path) {
    const std::string path = WithTrailingSlash(options.output_dir) + "run_metadata.json";
    std::ofstream out(path.c_str());
    if (!out.good())
        throw std::runtime_error("Failed to write metadata: " + path);

    out << "{\n";
    out << "  \"mode\": \"" << options.mode << "\",\n";
    out << "  \"input\": \"" << input_path << "\",\n";
    out << "  \"dataDir\": \"" << options.data_dir << "\",\n";
    out << "  \"outputDir\": \"" << options.output_dir << "\",\n";
    out << "  \"timestep\": " << options.timestep << ",\n";
    out << "  \"realtime\": " << (options.realtime ? "true" : "false") << "\n";
    out << "}\n";
}

void WriteAdamsReport(const ChParserAdams::Report& report, const std::string& output_dir) {
    const std::string path = WithTrailingSlash(output_dir) + "adams_report.txt";
    std::ofstream out(path.c_str());
    if (!out.good())
        throw std::runtime_error("Failed to write ADAMS report: " + path);

    out << "Bodies: " << report.bodies.size() << "\n";
    for (const auto& item : report.bodies)
        out << "  body " << item.first << "\n";

    out << "Joints: " << report.joints.size() << "\n";
    for (const auto& item : report.joints)
        out << "  joint " << item.first << " type=" << item.second.type << "\n";
}

void AddReferenceGround(ChSystemSMC& system) {
    auto ground = chrono_types::make_shared<ChBodyEasyBox>(40, 2, 40, 1000, true, false);
    ground->SetBodyFixed(true);
    ground->SetPos(ChVector<>(0, -2.9, 0));
    ground->SetNameString("workbench_ground");
    system.AddBody(ground);

    const std::string texture = GetChronoDataFile("textures/concrete.jpg");
    if (PathExists(texture))
        ground->GetVisualShape(0)->SetTexture(texture);
}

int RunAdams(const Options& options) {
    std::string error;
    if (!EnsureDirectory(options.output_dir, error)) {
        std::cerr << "chrono_workbench_runner error: " << error << "\n";
        return 1;
    }

    std::string input_path;
    if (!ResolveInputPath(options.input, options.data_dir, input_path, error)) {
        std::cerr << "chrono_workbench_runner error: " << error << "\n";
        return 1;
    }

    SetChronoDataPath(WithTrailingSlash(options.data_dir));
    SetChronoOutputPath(WithTrailingSlash(options.output_dir));

    std::cout << "Chrono Workbench runner\n";
    std::cout << "Mode: " << options.mode << "\n";
    std::cout << "Input: " << input_path << "\n";
    std::cout << "Data: " << GetChronoDataPath() << "\n";
    std::cout << "Output: " << GetChronoOutputPath() << "\n";
    std::cout << "Timestep: " << options.timestep << "\n";

    WriteRunMetadata(options, input_path);

    ChSystemSMC system;
    ChParserAdams parser;
    parser.SetVisualizationType(ChParserAdams::VisType::LOADED);
    parser.SetVerbose(options.verbose);
    parser.Parse(system, input_path);
    WriteAdamsReport(parser.GetReport(), options.output_dir);

    std::cout << "Parsed bodies: " << parser.GetReport().bodies.size() << "\n";
    std::cout << "Parsed joints: " << parser.GetReport().joints.size() << "\n";

    AddReferenceGround(system);

    auto vis = chrono_types::make_shared<ChVisualSystemIrrlicht>();
    vis->AttachSystem(&system);
    vis->SetWindowSize(1024, 720);
    vis->SetWindowTitle("Chrono Workbench - ADAMS model");
    vis->Initialize();
    vis->AddLogo();
    vis->AddSkyBox();
    vis->AddCamera(ChVector<>(0, 0, 2));
    vis->AddTypicalLights();

    ChRealtimeStepTimer realtime_timer;
    int frame = 0;
    while (vis->Run()) {
        vis->BeginScene();
        vis->Render();
        vis->EndScene();

        system.DoStepDynamics(options.timestep);
        if (options.realtime)
            realtime_timer.Spin(options.timestep);

        ++frame;
        if (options.max_frames >= 0 && frame >= options.max_frames)
            break;
    }

    std::cout << "Run complete after " << frame << " frames.\n";
    return 0;
}

}  // namespace

int main(int argc, char* argv[]) {
    const ParseResult parsed = ParseArgs(argc, argv);
    if (!parsed.error.empty()) {
        std::cerr << "chrono_workbench_runner error: " << parsed.error << "\n\n";
        std::cerr << Usage();
        return 1;
    }

    try {
        return RunAdams(parsed.options);
    } catch (const std::exception& e) {
        std::cerr << "chrono_workbench_runner error: " << e.what() << "\n\n";
        std::cerr << Usage();
        return 1;
    }
}
