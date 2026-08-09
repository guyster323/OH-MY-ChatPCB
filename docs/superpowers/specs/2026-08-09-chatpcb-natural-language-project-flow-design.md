# ChatPCB natural-language project flow design

## Goal

Make the primary panel workflow unambiguous: a user creates/selects a named
project, writes a natural-language request in Korean or English, and sends it
to generate or update the circuit.  The panel must clearly distinguish request
execution, circuit-review readiness, and ERC validation results.

## Scope

This change covers the local ChatPCB panel, provider adapter, project-path and
KiCad active-project handling, and their automated/UI verification.  It does
not add new supported electronic components, change KiCad file generation
semantics, or claim release-quality PCB routing.

## User workflow

1. The user opens the panel and chooses **New project**.
2. The panel accepts a display name and optional workspace location.  It
   derives a safe folder slug under the configured workspace root, creates the
   project only through the existing generation workflow, then marks it active.
3. The user enters a Korean or English circuit request and presses **Send**.
4. For a new/empty project, the provider requests `schematic.generate`.  For
   an existing project, it requests an approved `schematic.patch`; validation
   failure preserves or restores the prior files using the existing rollback
   contract.
5. The panel renders: (a) request progress/result, (b) project artifacts, (c)
   circuit review status, and (d) ERC error/warning counts plus execution time.
   **Preview** remains an optional inspection action rather than the only way
   to make a change.
6. The user chooses **Open in KiCad** to open the generated `.kicad_pro` as the
   active KiCad project.  An embedded panel requests a project switch in its
   hosting editor; a standalone browser panel opens the project through the
   local KiCad launcher.

The legacy **Generate** button is removed so it cannot be mistaken for a
new-project operation.

## Architecture

### Panel state and controls

The panel owns an explicit active-project state instead of treating a free-form
filesystem path as the main project selector.  A small new-project form
validates the name before submitting a `project.create`/generation request.
It shows the resolved project directory after success.

`Send` remains the single natural-language action.  It disables duplicate
submissions while work is in flight, shows progress, and routes successful tool
results into the artifacts, review, and validation sections.  A request failure
does not overwrite the most recent valid review result.

### Provider event normalization

The Codex adapter invokes `codex exec --json`, whose output contains lifecycle
and item events in addition to assistant messages.  The provider-process layer
will normalize known Codex events before applying the ChatPCB tool protocol:

- ignore lifecycle/progress and non-message item events;
- extract assistant-message text from completed message items;
- parse a standalone ChatPCB `tool.call` JSON line embedded in that message;
- render other assistant text as a normal assistant delta;
- validate only an extracted `tool.call` against the allowed tool names.

The existing plain-text provider behavior stays compatible.  An unknown or
malformed tool request fails closed, but the panel maps it to a concise,
actionable Korean/English-safe failure card; raw protocol detail is retained in
an expandable technical-detail area.

### Automatic generation and validation

The provider prompt continues to be UTF-8 input without language detection or
translation.  A successful generate/update run triggers `validate.erc` for the
active project.  The resulting ERC outcome is displayed even when the circuit
review remains blocked for release-readiness reasons.  Failure to validate is
shown as an unavailable/failed validation state, never as a false clean result.

### KiCad active-project integration

ChatPCB owns the project directory and artifact lifecycle; KiCad owns visual
editing.  A generated directory is a normal KiCad project, not an opaque
ChatPCB document.  The opening target is its `.kicad_pro` file rather than the
schematic alone, so project-local symbol tables and settings travel with it.

The embedded fork panel adds a host bridge for `project.open`, `project.status`,
and `project.reload`:

- `project.open` switches the schematic editor to the selected `.kicad_pro`
  project instead of starting an unbounded number of editor windows;
- `project.status` reports the current project path and whether unsaved editor
  modifications exist;
- `project.reload` reloads the active project after a successful external
  ChatPCB update.

The standalone browser uses the local launcher to open the same `.kicad_pro`.
Until the fork bridge is available, the panel retains this explicit launcher as
the supported fallback; it never claims that an official KiCad instance has
silently reloaded files.

Before ChatPCB updates an active project, it asks the host for dirty state.  If
there are unsaved KiCad edits, automatic overwrite is blocked and the user is
asked to save or cancel.  If the project is clean, ChatPCB uses the existing
rollback-safe patch path and then requests reload.  A failed ERC validation
restores the prior artifacts and leaves the editor on that prior project state.

## UI states

| Concern | States | User-facing behavior |
| --- | --- | --- |
| Request | idle, running, succeeded, failed, cancelled | Clear status near Send; error copy explains the next action. |
| Project | none, creating, active | Active display name and resolved directory are visible; Send is disabled when no active project exists. |
| Review | pending, ready-for-prototype-review, blocked | Shows release/readiness findings only. |
| ERC | not-run, running, passed, failed, unavailable | Shows error/warning counts and timestamp independently of review. |
| KiCad link | not-open, opening, active, reload-needed, conflict | Shows active `.kicad_pro`, host availability, and any unsaved-edit conflict. |

## Error handling

- Invalid or duplicate project names are rejected before filesystem work.
- Project paths are constrained to the chosen workspace root; no raw arbitrary
  path is silently accepted through the primary new-project UI.
- Provider stream parse failures do not leak the internal sentence currently
  shown to users.  Technical details remain available for diagnostics.
- Existing project modifications use the established rollback path when ERC
  validation fails.
- Cancellation returns the request controls to an idle state and preserves the
  previous active-project/review/validation information.
- ChatPCB never overwrites a KiCad project with unsaved editor changes.  A
  missing host bridge falls back to explicit project launch/reopen guidance.

## Verification

Automated tests will cover:

- Codex JSON lifecycle/item events plus Korean assistant text and an embedded
  allowed tool call;
- rejection of malformed/unsupported tool calls without exposing raw protocol
  copy in the panel;
- project-name slug/path validation and active-project state;
- Send-driven generation/update triggering validation and rendering separate
  request, review, and ERC states.
- `.kicad_pro` opening/reload request construction, dirty-editor conflict
  handling, and standalone-launch fallback behavior.

Computer Use verification will create a temporary named project from the panel,
send a Korean prompt, confirm successful status/artifacts/review/ERC display,
open that project in KiCad, and confirm the official KiCad ERC window can show
the corresponding results.

## Acceptance criteria

- The prior Korean Send scenario no longer shows “Providers may only emit …”.
- A user can create/select a named project without interpreting a raw path as a
  generation command.
- Send automatically generates or updates the active project and presents its
  result without requiring Generate.
- Request failure, readiness review, and ERC outcome remain visibly separate.
- ChatPCB opens the generated normal KiCad project and never overwrites an
  editor with unsaved changes.
- Automated tests pass and the end-to-end Computer Use scenario succeeds.
