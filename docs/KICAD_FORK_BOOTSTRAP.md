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

## WebView Host Contract

The fork registers `window.chatpcbHost` as a wxWebView script-message handler. The bundled panel sends one JSON object per message:

- `project.open` supplies an absolute, existing `.kicad_pro` path. The host validates that normal KiCad project extension, resolves its same-basename `.kicad_sch`, and opens it through the current `SCH_EDIT_FRAME`; it does not start another KiCad executable. Every response normalizes `projectPath` to the containing project directory so it correlates with the panel's active project.
- `project.status` asks the host to respond with `type`, the requested `projectPath`, the editor's `dirty` state, and a `linkState` of `linked` or `unlinked`.
- `project.reload` asks the current schematic editor to reload the linked project from disk. A successful response has `type: "project.reload"`, `linkState: "reloaded"`, and `completed: true`.
- `selection.get` asks the schematic host for the current selection. The response type is `selection.context`.

Every host request may include an optional `requestId`. When that field is present and non-empty, `project.status`, `project.reload`, and `selection.context` responses echo the same `requestId`. Requests without `requestId` keep the previous response shape.

A `selection.context` payload has this shape:

```json
{
  "type": "selection.context",
  "requestId": "selection_<uuid>",
  "projectPath": "C:/absolute/project-directory",
  "editor": "schematic",
  "dirty": false,
  "sheet": "/Power",
  "items": [
    {
      "kind": "symbol",
      "kiid": "stable-kicad-uuid",
      "reference": "U1",
      "position": { "x": 101.6, "y": 76.2 }
    },
    {
      "kind": "global_label",
      "kiid": "stable-kicad-uuid-if-available",
      "text": "+3V3",
      "position": { "x": 111.76, "y": 76.2 }
    }
  ],
  "diagnostics": []
}
```

Supported item kinds are `symbol`, `label`, `global_label`, and `hierarchical_label`. Other selected objects are omitted and reported with `KICAD_SELECTION_UNSUPPORTED`. Symbol identity uses KiCad KIID plus reference; labels use KIID plus shown text. Positions are schematic millimetres from `schIUScale.IUTomm`, not raw internal units. The host constructs `window.postMessage` by JSON dump plus string concatenation so a percent character in values cannot corrupt the script.

Opening or reloading is refused when the schematic editor contains unsaved changes. The host posts a `project.status` event with `dirty: true` and `linkState: "conflict"`; it never saves, discards, or overwrites those edits. The user must save or cancel the editor changes before asking ChatPCB to update or reload the project.

The source contract is verified: the C++ drop-in names the official KiCad 10 selection APIs and correlated `requestId` responses. Compiled KiCad 10 selection remains unverified until the missing fork checkout is restored. Do not treat the source contract as a compiled host or interactive result.

Official KiCad builds do not contain this fork panel. In that case the standalone browser fallback remains explicit: copy the displayed `.kicad_pro` path and open it manually in KiCad. The browser must not claim that KiCad was reloaded.

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
- The generated `.kicad_pro` opens in KiCad (the fork resolves and loads its `.kicad_sch` in the existing schematic editor).
- `chatpcb validate --project <dir>` runs or returns a typed skip reason.

## Constraint

Do not introduce custom top-level `chatpcb_*` nodes into KiCad files. Store draft metadata in `.chatpcb.json` and only put human-reviewable notes into KiCad schematic text until real symbol placement is implemented.
