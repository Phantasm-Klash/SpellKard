@echo off
setlocal EnableExtensions
rem ---------------------------------------------------------------------------
rem spk_crypto - build the LayaNative Windows extension DLL with MSVC directly.
rem
rem Mirrors native/udp_ext/windows/build_windows.bat: it configures the MSVC +
rem Windows SDK environment inline instead of calling vcvars64.bat (which shells
rem out to reg.exe and is blocked in some restricted environments).
rem
rem Two targets are produced, because the extension has two halves that fail in
rem different places:
rem
rem   spk_crypto.dll       the engine glue (needs the LayaAir runtime headers)
rem   spk_crypto_selftest  the platform random filler on its own, linked as a
rem                        plain console program so it runs with no engine at
rem                        all. This is what proves BCryptGenRandom actually
rem                        works on the machine.
rem
rem Usage:  build_windows.bat [<laya-native-sdk-root>]
rem   <laya-native-sdk-root> defaults to ..\..\windows\sdk\project\Runtime\x64\release
rem
rem Overridable: SPK_MSVC, SPK_SDKROOT, SPK_SDKVER
rem Output: ..\..\..\layaide\build-templates\windows\release\spk_crypto.dll
rem         .\spk_crypto_selftest.exe
rem ---------------------------------------------------------------------------

set "HERE=%~dp0"
set "SRC=%HERE%..\src"
set "OUT=%HERE%..\..\..\layaide\build-templates\windows\release"
set "TEST_OUT=%HERE%"

set "SDK=%HERE%..\..\windows\sdk\project\Runtime\x64\release"
if not "%~1"=="" set "SDK=%~1"

if not defined SPK_MSVC set "SPK_MSVC=%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.50.35717"
if not defined SPK_SDKROOT set "SPK_SDKROOT=%ProgramFiles(x86)%\Windows Kits\10"
if not defined SPK_SDKVER set "SPK_SDKVER=10.0.26100.0"

if not exist "%SPK_MSVC%\bin\Hostx64\x64\cl.exe" goto :no_msvc

set "PATH=%SPK_MSVC%\bin\Hostx64\x64;%PATH%"
set "INCLUDE=%SPK_MSVC%\include;%SPK_SDKROOT%\Include\%SPK_SDKVER%\ucrt;%SPK_SDKROOT%\Include\%SPK_SDKVER%\um;%SPK_SDKROOT%\Include\%SPK_SDKVER%\shared;%SPK_SDKROOT%\Include\%SPK_SDKVER%\winrt;%SPK_SDKROOT%\Include\%SPK_SDKVER%\cppwinrt"
set "LIB=%SPK_MSVC%\lib\x64;%SPK_SDKROOT%\Lib\%SPK_SDKVER%\ucrt\x64;%SPK_SDKROOT%\Lib\%SPK_SDKVER%\um\x64"

rem --- 1. the standalone platform test (no engine headers needed) -----------
pushd "%HERE%"
cl /nologo /std:c++20 /O2 /MT /EHsc /utf-8 ^
  /DWIN32 /DNDEBUG /D_WINDOWS /D_CRT_SECURE_NO_WARNINGS ^
  /I "%SRC%" ^
  "%SRC%\random.cpp" "%SRC%\selftest.cpp" ^
  /Fe:"%TEST_OUT%\spk_crypto_selftest" ^
  /link /SUBSYSTEM:CONSOLE bcrypt.lib
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto :build_failed

"%TEST_OUT%\spk_crypto_selftest.exe"
if not "%ERRORLEVEL%"=="0" goto :selftest_failed

rem --- 2. the engine extension DLL (needs the runtime headers) --------------
if not exist "%SDK%\include\jsvm\JSVM.h" goto :no_sdk
if not exist "%SDK%\lib\conch.lib" goto :no_conch

if not exist "%OUT%" mkdir "%OUT%"

pushd "%HERE%"
cl /nologo /LD /std:c++20 /O2 /MT /EHsc /utf-8 ^
  /DWIN32 /DNDEBUG /D_WINDOWS /D_USRDLL /DUSING_CONCH_SHARED /DJS_V8 /D_CRT_SECURE_NO_WARNINGS ^
  /I "%SDK%\include" /I "%SRC%" ^
  "%SRC%\main.cpp" "%SRC%\random.cpp" ^
  /Fe:"%OUT%\spk_crypto.dll" ^
  /link /LIBPATH:"%SDK%\lib" conch.lib bcrypt.lib
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto :build_failed

echo [spk_crypto] built %OUT%\spk_crypto.dll
endlocal & exit /b 0

:no_msvc
echo [spk_crypto] cl.exe not found under "%SPK_MSVC%".
echo [spk_crypto] Set SPK_MSVC to your MSVC toolset directory, then retry.
exit /b 1
:no_sdk
echo [spk_crypto] missing JSVM.h under "%SDK%".
echo [spk_crypto] Run "npm run fetch:windows" first, or pass the support-package path.
exit /b 1
:no_conch
echo [spk_crypto] missing conch.lib under "%SDK%\lib".
exit /b 1
:selftest_failed
echo [spk_crypto] platform random self-test FAILED - the OS CSPRNG is not usable here.
echo [spk_crypto] The client would fall back to the weak DRBG; fix the platform build.
exit /b 1
:build_failed
echo [spk_crypto] build FAILED - cl exit code %RC%
exit /b %RC%
