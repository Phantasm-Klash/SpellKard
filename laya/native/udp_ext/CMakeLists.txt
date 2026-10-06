cmake_minimum_required(VERSION 3.15)
project(spk_udp CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Portable UDP core (no LayaNative dependency).
add_library(udp_core STATIC src/udp_socket.cpp)
target_include_directories(udp_core PUBLIC src)

# Standalone smoke test: builds and runs anywhere (CI, local) with no runtime.
add_executable(spk_udp_selftest src/udp_selftest.cpp)
target_link_libraries(spk_udp_selftest PRIVATE udp_core)

# LayaNative extension library.
#
#   SPK_USE_SHIM_HEADER=ON  (default) compiles against include/, a byte-level
#                           mirror of the real 3.4.1 headers, so CI can
#                           syntax-check the JSVM glue without the runtime.
#   SPK_USE_SHIM_HEADER=OFF compiles against the real runtime headers; point
#                           SPK_LAYANATIVE_INCLUDE at
#                           <support-package>/project/Runtime/<arch>/release/include
#                           (Windows: use native/udp_ext/windows/extension.vcxproj
#                           instead — this path is for Linux/OHOS/Android builds).
option(SPK_USE_SHIM_HEADER "Compile against the bundled LayaExtension.h shim" ON)

add_library(spk_udp SHARED src/main.cpp)
target_link_libraries(spk_udp PRIVATE udp_core)
if(SPK_USE_SHIM_HEADER)
  target_include_directories(spk_udp PRIVATE include)
else()
  target_include_directories(spk_udp PRIVATE ${SPK_LAYANATIVE_INCLUDE})
  # The real JSVM.h selects its type set from these macros (see JSVM_Types.h).
  target_compile_definitions(spk_udp PRIVATE USING_CONCH_SHARED JS_V8)
endif()

if(WIN32)
  target_link_libraries(udp_core PUBLIC ws2_32)
endif()
