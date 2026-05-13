#--------------------------------------------------------------
# Chrono Workbench support programs

option(BUILD_CHRONO_WORKBENCH_RUNNER "Build the Chrono Workbench runner executable" ON)
mark_as_advanced(FORCE BUILD_CHRONO_WORKBENCH_RUNNER)

if(BUILD_CHRONO_WORKBENCH_RUNNER)
  if(NOT ENABLE_MODULE_IRRLICHT)
    message(WARNING "chrono_workbench_runner requires ENABLE_MODULE_IRRLICHT=ON and will not be built.")
  else()
    message(STATUS "Chrono Workbench support programs...")
    message(STATUS "...add chrono_workbench_runner")

    include_directories(${CH_INCLUDES})
    include_directories(${CH_IRRLICHTINC})

    add_executable(chrono_workbench_runner chrono_workbench_runner.cpp)
    source_group("" FILES chrono_workbench_runner.cpp)

    set_target_properties(chrono_workbench_runner PROPERTIES
      FOLDER workbench
      COMPILE_FLAGS "${CH_CXX_FLAGS} ${CH_IRRLICHT_CXX_FLAGS}"
      LINK_FLAGS "${CH_LINKERFLAG_EXE}")

    set_property(TARGET chrono_workbench_runner PROPERTY
      VS_DEBUGGER_WORKING_DIRECTORY "$<TARGET_FILE_DIR:chrono_workbench_runner>")

    target_link_libraries(chrono_workbench_runner
      ChronoEngine
      ChronoEngine_irrlicht)

    install(TARGETS chrono_workbench_runner DESTINATION ${CH_INSTALL_DEMO})
  endif()
endif()
