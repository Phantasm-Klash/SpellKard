@echo off
rem ---------------------------------------------------------------------------
rem spk_win - one-command MSVC build for the LayaNative Windows extension.
rem
rem Produces spk_win.dll (and copies the descriptor) into
rem   layaide\build-templates\windows\release\
rem next to spk_win.layaext.json, ready for the LayaAir IDE to publish.
rem
rem Why this script and not vcvars alone: the sandbox blocks reg.exe, so
rem vcvars64.bat cannot auto-discover the Windows SDK. The UCRT / UM include and
rem lib paths are therefore added explicitly below.
rem
rem Run from a shell that can reach cmd, e.g.:
rem   cmd //c D:\gotouhou\SpellKard\laya\native\win_ext\windows\build_spk_win.bat
rem
rem NOTE: keep this file ASCII-only. A non-ASCII byte (e.g. an em-dash) makes
rem cmd.exe desync its line parser under codepage 936 and swallow the leading
rem characters of the following lines.
rem ---------------------------------------------------------------------------
setlocal
set "REPO=D:\gotouhou\SpellKard\laya"
set "SDK=%REPO%\native\windows\sdk\project\Runtime\x64\release"
set "WINSDK=C:\Program Files (x86)\Windows Kits\10"
set "WINSDKVER=10.0.26100.0"
set "OUT=%REPO%\layaide\build-templates\windows\release"
if not exist "%OUT%" mkdir "%OUT%"
if not exist "%REPO%\native\win_ext\build" mkdir "%REPO%\native\win_ext\build"

call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
set "INCLUDE=%INCLUDE%;%WINSDK%\Include\%WINSDKVER%\ucrt;%WINSDK%\Include\%WINSDKVER%\um;%WINSDK%\Include\%WINSDKVER%\shared"
set "LIB=%LIB%;%WINSDK%\Lib\%WINSDKVER%\ucrt\x64;%WINSDK%\Lib\%WINSDKVER%\um\x64"
rem rc.exe and mt.exe live in the SDK's bin, and vcvars cannot find them
rem (it looks them up in the registry, and reg.exe is blocked here).
set "PATH=%PATH%;%WINSDK%\bin\%WINSDKVER%\x64"

cl /nologo /LD /O2 /std:c++20 /EHsc /MT /DNDEBUG /utf-8 ^
  /DWIN32 /D_WINDOWS /D_USRDLL /DUSING_CONCH_SHARED /DJS_V8 /D_CRT_SECURE_NO_WARNINGS ^
  /I "%SDK%\include" ^
  "%REPO%\native\win_ext\src\main.cpp" ^
  "%REPO%\native\win_ext\src\window_control.cpp" ^
  /Fo"%REPO%\native\win_ext\build\\" /Fe"%OUT%\spk_win.dll" ^
  /link /LIBPATH:"%SDK%\lib" conch.lib user32.lib
set "CL_EXIT=%errorlevel%"
if not "%CL_EXIT%"=="0" goto :fail

copy /y "%REPO%\native\win_ext\spk_win.layaext.json" "%OUT%\spk_win.layaext.json" >nul
rem Keep a copy in the extension's own build/ directory as well.
copy /y "%OUT%\spk_win.dll" "%REPO%\native\win_ext\build\spk_win.dll" >nul
echo EXIT=%CL_EXIT%
goto :eof

:fail
echo EXIT=%CL_EXIT%
