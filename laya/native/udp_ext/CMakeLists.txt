cmake_minimum_required(VERSION 3.15)
project(spk_udp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Portable UDP core (no LayaNative dependency).
add_library(udp_core STATIC src/udp_socket.cpp)
target_include_directories(udp_core PUBLIC src)

# Standalone smoke test: builds and runs anywhere (CI, local) with no runtime.
add_executable(spk_udp_selftest src/udp_selftest.cpp)
target_link_libraries(spk_udp_selftest PRIVATE udp_core)

# LayaNative extension library. On a real Windows build, drop this target and use
# the `extension.vcxproj` from the IDE-exported Native project instead (see
# README.md). This target exists so the JSVM glue is at least syntax-checked.
option(SPK_USE_SHIM_HEADER "Compile against the bundled LayaExtension.h shim" ON)

add_library(spk_udp SHARED src/main.cpp)
target_link_libraries(spk_udp PRIVATE udp_core)
if(SPK_USE_SHIM_HEADER)
  target_include_directories(spk_udp PRIVATE include)
else()
  target_include_directories(spk_udp PRIVATE ${SPK_LAYANATIVE_INCLUDE})
endif()

if(WIN32)
  target_link_libraries(udp_core PUBLIC ws2_32)
endif()
