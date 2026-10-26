cmake_minimum_required(VERSION 3.15)
project(spk_win CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Window-control core. On Windows this is real Win32; on every other platform it
# compiles to failure-returning stubs (see src/window_control.cpp), so CI can
# syntax-check the entire extension — including the window logic — without the
# runtime. No LayaNative dependency.
add_library(win_control STATIC src/window_control.cpp)
target_include_directories(win_control PUBLIC src)

# LayaNative extension library.
#
#   SPK_USE_SHIM_HEADER=ON  (default) compiles against include/, a byte-level
#                           mirror of the real 3.4.1 headers, so CI can
#                           syntax-check the JSVM glue without the runtime.
#   SPK_USE_SHIM_HEADER=OFF compiles against the real runtime headers; point
#                           SPK_LAYANATIVE_INCLUDE at
#                           <support-package>/project/Runtime/<arch>/release/include
#                           (Windows: use native/win_ext/windows/extension.vcxproj
#                           instead — this path is for reference only).
option(SPK_USE_SHIM_HEADER "Compile against the bundled LayaExtension.h shim" ON)

add_library(spk_win SHARED src/main.cpp)
target_link_libraries(spk_win PRIVATE win_control)
if(SPK_USE_SHIM_HEADER)
  target_include_directories(spk_win PRIVATE include)
  if(MSVC)
    # CI-only. The shim declares the jsvm_* API but provides no definitions; the
    # real symbols are resolved by the LayaNative runtime at load time. GNU ld
    # allows undefined symbols in a shared object, MSVC does not — so downgrade
    # them to warnings for this syntax-check configuration.
    target_link_options(spk_win PRIVATE /FORCE:UNRESOLVED)
  endif()
else()
  target_include_directories(spk_win PRIVATE ${SPK_LAYANATIVE_INCLUDE})
  # The real JSVM.h selects its type set from these macros (see JSVM_Types.h).
  target_compile_definitions(spk_win PRIVATE USING_CONCH_SHARED JS_V8)
endif()

if(WIN32)
  target_link_libraries(win_control PUBLIC user32)
endif()
