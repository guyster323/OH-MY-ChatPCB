# KiCad Fork Bootstrap

## Target

Create a KiCad 10.0.x fork branch that embeds ChatPCB as a right-side panel.

## Steps

1. Clone KiCad upstream into a sibling checkout.
2. Create a branch named `chatpcb-panel`.
3. Copy `kicad-fork/chatpcb_panel` into the KiCad source tree.
4. Add the panel directory to KiCad CMake build files.
5. Instantiate `CHATPCB_PANEL` in the schematic editor frame first.
6. Package `apps/panel/index.html`, `apps/panel/styles.css`, and `apps/panel/panel.js` into `share/chatpcb_panel/`.
7. Ensure the installed KiCad distribution can run `chatpcb daemon --host 127.0.0.1 --port 41317`.

## Current Windows Configure Evidence

The local `chatpcb-panel-scaffold` checkout is at:

```powershell
C:\Users\windo\kicad-source-mirror-chatpcb
```

`cmake` is not on the default PATH, but Visual Studio bundles a working CMake:

```powershell
C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe
```

The Visual Studio generator path stalled during the initial `CompilerIdC.vcxproj` compile in this shell. The Ninja path works after loading the VS build environment and using the local vcpkg toolchain:

```powershell
cmd /c "call ""C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"" >nul && set VCPKG_ROOT=C:\Users\windo\vcpkg&& ""C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"" -S . -B build\chatpcb-vcpkg -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DKICAD_BUILD_QA_TESTS=OFF -DKICAD_INSTALL_DEMOS=OFF -DCMAKE_TOOLCHAIN_FILE=C:\Users\windo\vcpkg\scripts\buildsystems\vcpkg.cmake"
```

Build the schematic editor target:

```powershell
cmd /c "call ""C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"" >nul && ""C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"" --build build\chatpcb-vcpkg --target eeschema/eeschema.exe -- -j 12"
```

The fork now has a small CMake fallback for this Codex/PowerShell environment where `CMAKE_HOST_SYSTEM_PROCESSOR` is empty; it uses the detected MSVC target architecture as the host architecture before continuing. The build target also prepares ChatPCB panel assets, KiCad runtime schemas/resources, and the DLLs needed for direct build-tree launch of `build\chatpcb-vcpkg\eeschema\eeschema.exe`.

## Acceptance Check

The first fork milestone has been directly verified with Computer Use when:

- KiCad launches with a visible right-side ChatPCB panel.
- The panel connects to `chatpcb-agentd`.
- A prompt creates a project draft in a chosen workspace.
- The generated `.kicad_sch` opens in KiCad.
- `chatpcb validate --project <dir>` runs or returns a typed skip reason.

## Constraint

Do not introduce custom top-level `chatpcb_*` nodes into KiCad files. Store draft metadata in `.chatpcb.json` and only put human-reviewable notes into KiCad schematic text until real symbol placement is implemented.
