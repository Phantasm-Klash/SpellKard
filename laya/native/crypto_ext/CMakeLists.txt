cmake_minimum_required(VERSION 3.15)
project(spk_crypto CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The platform random filler has no engine dependency at all, so it can be
# tested on its own — which is what `spk_crypto_selftest` does.
add_library(crypto_core STATIC src/random.cpp)
target_include_directories(crypto_core PUBLIC src)

# Standalone smoke test: builds and runs anywhere (CI, local) with no runtime.
add_executable(spk_crypto_selftest src/selftest.cpp)
target_link_libraries(spk_crypto_selftest PRIVATE crypto_core)

# LayaNative extension library.
#
#   SPK_USE_SHIM_HEADER=ON  (default) compiles against include/, a byte-level
#                           mirror of the real 3.4.1 headers, so CI can
#                           syntax-check the JSVM glue without the runtime.
#   SPK_USE_SHIM_HEADER=OFF compiles against the real runtime headers; point
#                           SPK_LAYANATIVE_INCLUDE at
#                           <support-package>/project/Runtime/<arch>/release/include
#                           (Windows: use native/crypto_ext/windows/extension.vcxproj
#                           instead — this path is for Linux/OHOS/Android builds).
option(SPK_USE_SHIM_HEADER "Compile against the bundled LayaExtension.h shim" ON)

add_library(spk_crypto SHARED src/main.cpp)
target_link_libraries(spk_crypto PRIVATE crypto_core)
if(SPK_USE_SHIM_HEADER)
  target_include_directories(spk_crypto PRIVATE include)
else()
  target_include_directories(spk_crypto PRIVATE ${SPK_LAYANATIVE_INCLUDE})
  target_compile_definitions(spk_crypto PRIVATE USING_CONCH_SHARED JS_V8)
endif()

if(WIN32)
  # CNG lives in bcrypt; ws2_32 is not needed here.
  target_link_libraries(spk_crypto PRIVATE bcrypt)
endif()
