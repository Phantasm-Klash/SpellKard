cmake_minimum_required(VERSION 3.15)
project(spk_steam CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Steamworks SDK root (contains public/steam_api.h and lib/win64).
# Download from the Steamworks partner portal; typical location:
#   C:/Steam/Steamworks
set(SPK_STEAMWORKS "" CACHE PATH "Steamworks SDK root (directory containing public/ and lib/)")
if(NOT SPK_STEAMWORKS)
  message(FATAL_ERROR "SPK_STEAMWORKS is required (Steamworks SDK root)")
endif()

# SPK_USE_SHIM_HEADER=ON (default) compiles the JSVM glue against include/,
# a byte-level mirror of the real 3.4.1 headers, for syntax checking without
# the runtime. The Steamworks side always needs the real SDK.
option(SPK_USE_SHIM_HEADER "Compile against the bundled LayaExtension.h shim" ON)

add_library(spk_steam SHARED src/main.cpp src/steam_bridge.cpp)
target_include_directories(spk_steam PRIVATE ${SPK_STEAMWORKS}/public)
if(SPK_USE_SHIM_HEADER)
  target_include_directories(spk_steam PRIVATE include)
else()
  target_include_directories(spk_steam PRIVATE ${SPK_LAYANATIVE_INCLUDE})
  target_compile_definitions(spk_steam PRIVATE USING_CONCH_SHARED JS_V8)
endif()

if(WIN32)
  # steam_api64.dll is redistributed next to the game exe (see README).
  target_link_libraries(spk_steam PRIVATE ${SPK_STEAMWORKS}/lib/win64/steam_api64.lib)
endif()
