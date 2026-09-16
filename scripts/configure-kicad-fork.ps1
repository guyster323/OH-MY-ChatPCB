$ErrorActionPreference = 'Stop'

$fork = if ($env:CHATPCB_KICAD_FORK) {
    $env:CHATPCB_KICAD_FORK
} else {
    'C:\Users\windo\kicad-source-mirror-chatpcb'
}

if (-not (Test-Path -LiteralPath $fork)) {
    throw "KiCad fork checkout not found: $fork"
}

$vcvars = 'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat'
$cmake = 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ninjaDir = 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja'
$vcpkgRoot = 'C:\Users\windo\vcpkg'
$buildDir = 'build\chatpcb-vcpkg'

if (-not (Test-Path -LiteralPath $vcvars)) { throw "vcvars64.bat not found: $vcvars" }
if (-not (Test-Path -LiteralPath $cmake)) { throw "cmake.exe not found: $cmake" }
if (-not (Test-Path -LiteralPath $vcpkgRoot)) { throw "vcpkg not found: $vcpkgRoot" }

$sync = Join-Path $PSScriptRoot 'sync-kicad-fork-panel.ps1'
& $sync

$bat = Join-Path $env:TEMP 'configure-kicad-fork.bat'
@"
@echo off
call "$vcvars" >nul
set "PATH=$ninjaDir;%PATH%"
set "VCPKG_ROOT=$vcpkgRoot"
cd /d "$fork"
"$cmake" -S . -B $buildDir -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DKICAD_BUILD_QA_TESTS=OFF -DKICAD_INSTALL_DEMOS=OFF -DKICAD_BUILD_I18N=OFF -DCMAKE_TOOLCHAIN_FILE=$vcpkgRoot\scripts\buildsystems\vcpkg.cmake
"@ | Set-Content -Encoding ASCII -Path $bat

cmd.exe /c "`"$bat`""
if ($LASTEXITCODE -ne 0) {
    throw "KiCad fork CMake configure failed with exit code $LASTEXITCODE"
}

Write-Host "Configure complete. Build the schematic editor with:"
Write-Host "  cmake --build `"$fork\$buildDir`" --target eeschema/eeschema.exe -- -j 12"
