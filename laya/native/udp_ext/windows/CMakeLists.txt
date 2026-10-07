cmake_minimum_required(VERSION 3.15)
project(spk_udp_windows CXX)

# Windows build of the spk_udp LayaNative extension.
#
# Mirrors `extension.vcxproj` so the DLL can also be produced with CMake when a
# direct MSBuild invocation is unavailable. Output lands in
# `layaide/build-templates/windows/release/`, which the LayaAir IDE merges into
# the published Windows client directory.

if(NOT WIN32)
  message(FATAL_ERROR "This CMakeLists builds the Windows spk_udp.dll; use ../CMakeLists.txt on other platforms.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED LAYANATIVE_SDK_ROOT OR LAYANATIVE_SDK_ROOT STREQUAL "")
  set(LAYANATIVE_SDK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../windows/sdk/project/Runtime/x64/release")
endif()
file(TO_CMAKE_PATH "${LAYANATIVE_SDK_ROOT}" LAYANATIVE_SDK_ROOT)

foreach(required "include/jsvm/JSVM.h" "include/extension/LayaExtension.h" "lib/conch.lib")
  if(NOT EXISTS "${LAYANATIVE_SDK_ROOT}/${required}")
    message(FATAL_ERROR
      "Missing ${required} under LAYANATIVE_SDK_ROOT=${LAYANATIVE_SDK_ROOT}. Run `npm run fetch:windows`.")
  endif()
endforeach()

add_library(spk_udp SHARED
  ../src/main.cpp
  ../src/udp_socket.cpp
)

target_include_directories(spk_udp PRIVATE
  "${LAYANATIVE_SDK_ROOT}/include"
  ../src
)

target_compile_definitions(spk_udp PRIVATE
  WIN32 NDEBUG _WINDOWS _USRDLL USING_CONCH_SHARED JS_V8 _CRT_SECURE_NO_WARNINGS
)

set(_spk_output_dir "${CMAKE_CURRENT_SOURCE_DIR}/../../../layaide/build-templates/windows/release")

set_target_properties(spk_udp PROPERTIES
  PREFIX ""
  OUTPUT_NAME "spk_udp"
  SUFFIX ".dll"
  RUNTIME_OUTPUT_DIRECTORY "${_spk_output_dir}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${_spk_output_dir}"
  LIBRARY_OUTPUT_DIRECTORY "${_spk_output_dir}"
)

# Match the official template: static CRT (/MT).
set_property(TARGET spk_udp PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")

target_link_directories(spk_udp PRIVATE "${LAYANATIVE_SDK_ROOT}/lib")
target_link_libraries(spk_udp PRIVATE conch ws2_32)

message(STATUS "spk_udp will be written to ${_spk_output_dir}")
