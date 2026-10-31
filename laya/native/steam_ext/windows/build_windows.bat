@echo off
setlocal EnableExtensions
rem ---------------------------------------------------------------------------
rem spk_steam - build the LayaNative Windows Steamworks extension DLL with MSVC.
rem
rem Mirrors native/crypto_ext/windows/build_windows.bat (inline MSVC + SDK env,
rem no vcvars64 shell-out).
rem
rem Inputs:
rem   SPK_STEAMWORKS   Steamworks SDK root (must contain public\steam_api.h and
rem                    lib\win64\steam_api64.lib). Default: D:\Steam\Steamworks
rem   SPK_MSVC / SPK_SDKROOT / SPK_SDKVER  as in crypto_ext
rem
rem Output:
rem   ..\..\..\layaide\build-templates\windows\release\spk_steam.dll
rem
rem Redistribution: copy steam_api64.dll (from %SPK_STEAMWORKS%\redist or
rem the game's Steam runtime) next to the game .exe. The game must be run
rem through the Steam client for init() to succeed.
rem ---------------------------------------------------------------------------

set "HERE=%~dp0"
set "SRC=%HERE%..\src"
set "OUT=%HERE%..\..\..\layaide\build-templates\windows\release"

set "SDK=%HERE%..\..\windows\sdk\project\Runtime\x64\release"
if not "%~1"=="" set "SDK=%~1"

if not defined SPK_STEAMWORKS set "SPK_STEAMWORKS=D:\Steam\Steamworks"
if not defined SPK_MSVC set "SPK_MSVC=%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.50.35717"
if not defined SPK_SDKROOT set "SPK_SDKROOT=%ProgramFiles(x86)%\Windows Kits\10"
if not defined SPK_SDKVER set "SPK_SDKVER=10.0.26100.0"

if not exist "%SPK_MSVC%\bin\Hostx64\x64\cl.exe" goto :no_msvc
if not exist "%SPK_STEAMWORKS%\public\steam_api.h" goto :no_steamworks
if not exist "%SDK%\include\jsvm\JSVM.h" goto :no_sdk
if not exist "%SDK%\lib\conch.lib" goto :no_conch

set "PATH=%SPK_MSVC%\bin\Hostx64\x64;%PATH%"
set "INCLUDE=%SPK_MSVC%\include;%SPK_SDKROOT%\Include\%SPK_SDKVER%\ucrt;%SPK_SDKROOT%\Include\%SPK_SDKVER%\um;%SPK_SDKROOT%\Include\%SPK_SDKVER%\shared;%SPK_SDKROOT%\Include\%SPK_SDKVER%\winrt;%SPK_SDKROOT%\Include\%SPK_SDKVER%\cppwinrt"
set "LIB=%SPK_MSVC%\lib\x64;%SPK_SDKROOT%\Lib\%SPK_SDKVER%\ucrt\x64;%SPK_SDKROOT%\Lib\%SPK_SDKVER%\um\x64"

if not exist "%OUT%" mkdir "%OUT%"

pushd "%HERE%"
cl /nologo /LD /std:c++20 /O2 /MT /EHsc /utf-8 ^
  /DWIN32 /DNDEBUG /D_WINDOWS /D_USRDLL /DUSING_CONCH_SHARED /DJS_V8 /D_CRT_SECURE_NO_WARNINGS ^
  /I "%SDK%\include" /I "%SRC%" /I "%SPK_STEAMWORKS%\public" ^
  "%SRC%\main.cpp" "%SRC%\steam_bridge.cpp" ^
  /Fe:"%OUT%\spk_steam.dll" ^
  /link /LIBPATH:"%SDK%\lib" /LIBPATH:"%SPK_STEAMWORKS%\lib\win64" conch.lib steam_api64.lib
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto :build_failed

echo [spk_steam] built %OUT%\spk_steam.dll
endlocal & exit /b 0

:no_msvc
echo [spk_steam] cl.exe not found under "%SPK_MSVC%".
exit /b 1
:no_steamworks
echo [spk_steam] Steamworks SDK not found under "%SPK_STEAMWORKS%" (need public\steam_api.h).
echo [spk_steam] Download the SDK from the partner portal and set SPK_STEAMWORKS.
exit /b 1
:no_sdk
echo [spk_steam] missing JSVM.h under "%SDK%".
echo [spk_steam] Run "npm run fetch:windows" first, or pass the support-package path.
exit /b 1
:no_conch
echo [spk_steam] missing conch.lib under "%SDK%\lib".
exit /b 1
:build_failed
echo [spk_steam] build FAILED - cl exit code %RC%
exit /b %RC%
