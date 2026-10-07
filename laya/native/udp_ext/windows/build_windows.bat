@echo off
setlocal EnableExtensions
rem ---------------------------------------------------------------------------
rem spk_udp - build the LayaNative Windows extension DLL with MSVC directly.
rem
rem Configures the MSVC + Windows SDK environment inline instead of calling
rem vcvars64.bat (which shells out to reg.exe and is blocked in some
rem restricted environments). Only needs the MSVC toolchain + the LayaAir
rem "Windows Build Support" runtime.
rem
rem Usage:  build_windows.bat [<laya-native-sdk-root>]
rem   <laya-native-sdk-root> defaults to ..\..\windows\sdk\project\Runtime\x64\release
rem
rem Overridable: SPK_MSVC, SPK_SDKROOT, SPK_SDKVER
rem Output: ..\..\..\layaide\build-templates\windows\release\spk_udp.dll
rem ---------------------------------------------------------------------------

set "HERE=%~dp0"
set "SRC=%HERE%..\src"
set "OUT=%HERE%..\..\..\layaide\build-templates\windows\release"

set "SDK=%HERE%..\..\windows\sdk\project\Runtime\x64\release"
if not "%~1"=="" set "SDK=%~1"

if not defined SPK_MSVC set "SPK_MSVC=%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.50.35717"
if not defined SPK_SDKROOT set "SPK_SDKROOT=%ProgramFiles(x86)%\Windows Kits\10"
if not defined SPK_SDKVER set "SPK_SDKVER=10.0.26100.0"

if not exist "%SPK_MSVC%\bin\Hostx64\x64\cl.exe" goto :no_msvc
if not exist "%SDK%\include\jsvm\JSVM.h" goto :no_sdk
if not exist "%SDK%\lib\conch.lib" goto :no_conch

set "PATH=%SPK_MSVC%\bin\Hostx64\x64;%PATH%"
set "INCLUDE=%SPK_MSVC%\include;%SPK_SDKROOT%\Include\%SPK_SDKVER%\ucrt;%SPK_SDKROOT%\Include\%SPK_SDKVER%\um;%SPK_SDKROOT%\Include\%SPK_SDKVER%\shared;%SPK_SDKROOT%\Include\%SPK_SDKVER%\winrt;%SPK_SDKROOT%\Include\%SPK_SDKVER%\cppwinrt"
set "LIB=%SPK_MSVC%\lib\x64;%SPK_SDKROOT%\Lib\%SPK_SDKVER%\ucrt\x64;%SPK_SDKROOT%\Lib\%SPK_SDKVER%\um\x64"

if not exist "%OUT%" mkdir "%OUT%"

pushd "%HERE%"
cl /nologo /LD /std:c++20 /O2 /MT /EHsc /utf-8 ^
  /DWIN32 /DNDEBUG /D_WINDOWS /D_USRDLL /DUSING_CONCH_SHARED /DJS_V8 /D_CRT_SECURE_NO_WARNINGS ^
  /I "%SDK%\include" /I "%SRC%" ^
  "%SRC%\main.cpp" "%SRC%\udp_socket.cpp" ^
  /Fe:"%OUT%\spk_udp.dll" ^
  /link /LIBPATH:"%SDK%\lib" conch.lib ws2_32.lib
set "RC=%ERRORLEVEL%"
popd

if not "%RC%"=="0" goto :build_failed
echo [spk_udp] built %OUT%\spk_udp.dll
endlocal & exit /b 0

:no_msvc
echo [spk_udp] cl.exe not found under "%SPK_MSVC%".
echo [spk_udp] Set SPK_MSVC to your MSVC toolset directory, then retry.
exit /b 1

:no_sdk
echo [spk_udp] missing JSVM.h under "%SDK%".
echo [spk_udp] Run "npm run fetch:windows" first, or pass the support-package path.
exit /b 1

:no_conch
echo [spk_udp] missing conch.lib under "%SDK%\lib".
exit /b 1

:build_failed
echo [spk_udp] build FAILED - cl exit code %RC%
exit /b %RC%
