# ChatPCB Natural-Language Project Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create a named KiCad project, send a Korean or English circuit request that automatically generates or safely updates it, and see distinct request, readiness, ERC, and KiCad-link outcomes.

**Architecture:** Add a provider-stream normalizer that understands Codex JSON events and extracts only approved ChatPCB calls. Add a daemon-level `project.request` orchestration operation which makes Send deterministic: it runs the provider, falls back to the local bounded generator when no tool call is emitted, validates ERC, and returns one structured result. The panel manages an active named project rather than a raw path, and the KiCad fork panel exposes a small host bridge for open/status/reload.

**Tech Stack:** Node.js ESM, `node:test`, Playwright, browser WebSocket UI, KiCad CLI 10, wxWidgets/wxWebView C++, Windows KiCad launcher.

## Global Constraints

- Preserve normal KiCad files and project-local symbol libraries; do not create custom `chatpcb_*` top-level KiCad nodes.
- Treat Korean and English prompt text as UTF-8; do not translate or reject it based on language.
- Constrain new-project directories to the selected workspace root and reject traversal, Windows reserved names, and existing project directories.
- `Send` applies the requested generation/update automatically; an existing project that fails ERC validation must retain its previous artifacts.
- Never overwrite a KiCad editor with unsaved changes; report a conflict and require save/cancel first.
- Keep request execution, release-readiness review, ERC validation, and KiCad-link state as separate UI concepts.
- Do not claim clean PCB DRC or release readiness from a clean ERC result.

---

### Task 1: Normalize Codex JSON output into safe provider events

**Files:**
- Modify: `src/runtime/provider-process.js:1-225`
- Modify: `tests/provider-process.test.js:1-150`

**Interfaces:**
- Consumes: Codex JSON Lines events from `codex exec --json` and existing plain-text provider stdout.
- Produces: `runProviderProcess(options): Promise<{ exitCode, events, stderr, tracePath? }>` where `events` contains only `agent.delta` or validated `tool.call` envelopes.
- Adds: `parseProviderMessageText(events, text, allowedTools)` internal helper that parses standalone `{"type":"tool.call",...}` lines from an assistant message and turns all remaining non-empty text into `agent.delta` envelopes.

- [ ] **Step 1: Write failing Codex lifecycle and Korean-message tests**

Add a test that emits ignored Codex events (`thread.started`, `turn.started`,
`item.started`, and a completed non-message item), then an `agent_message`
whose text contains Korean reasoning and a standalone allowed call:

```js
const message = [
  '요청한 회로 초안을 생성합니다.',
  '{"type":"tool.call","payload":{"id":"call_ko","name":"schematic.generate","args":{"prompt":"ESP32-S3 회로"}}}'
].join('\n');

assert.deepEqual(transcript.events.map((event) => event.type), ['agent.delta', 'tool.call']);
assert.equal(transcript.events[0].payload.text, '요청한 회로 초안을 생성합니다.');
assert.equal(transcript.events[1].payload.id, 'call_ko');
```

Add a separate test that an unsupported embedded call still rejects with
`Unsupported provider tool call`, while a completed `command_execution` item
is ignored rather than throwing the current generic protocol sentence.

- [ ] **Step 2: Run the focused tests to verify the current parser fails**

Run: `node --test tests/provider-process.test.js`

Expected: the new lifecycle test fails with `Providers may only emit tool.call JSON or normal assistant text.`

- [ ] **Step 3: Implement provider-specific event normalization**

Change `addProviderLine` so that known Codex lifecycle events and all non-agent
`item.started`/`item.completed` events return without adding a delta.  For a
completed `agent_message`, pass `parsed.item.text` to the new helper.  Keep the
existing raw `tool.call` branch for plain providers.  The helper must split
message text on newlines, parse only full JSON tool-call lines, validate each
call with `validateProviderToolCall`, and preserve all other lines in a single
assistant delta.

```js
if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message') {
  parseProviderMessageText(events, parsed.item.text ?? '', allowedTools);
  return;
}

if (parsed.type?.startsWith('item.') || ['thread.started', 'turn.started', 'turn.completed'].includes(parsed.type)) {
  return;
}
```

- [ ] **Step 4: Run focused provider tests**

Run: `node --test tests/provider-process.test.js`

Expected: all provider-parser tests pass, including Korean assistant text,
ignored Codex item events, raw plain-provider calls, malformed calls, redaction,
timeout, and cancellation.

- [ ] **Step 5: Commit the isolated adapter change**

```powershell
git add src/runtime/provider-process.js tests/provider-process.test.js
git commit -m "fix: normalize Codex provider event stream"
```

### Task 2: Create named workspace projects and run Send as one validated operation

**Files:**
- Create: `src/workflow/project-workspace.js`
- Create: `tests/project-workspace.test.js`
- Modify: `src/runtime/agent-daemon.js:12-178`
- Modify: `tests/daemon.test.js:10-170`

**Interfaces:**
- Consumes: `{ workspaceRoot, projectName }` from the panel and `{ projectDir, prompt, provider }` from Send.
- Produces: `createNamedProject({ workspaceRoot, projectName }): Promise<{ displayName, slug, projectDir }>` and `project.request` results shaped as `{ operation: 'generated' | 'patched', files, review, validation, providerEvents }`.
- Adds daemon tools: `project.create` for an empty named project directory and `project.request` for provider-assisted, automatic generation or update.

- [ ] **Step 1: Write failing workspace-path tests**

In `tests/project-workspace.test.js`, use a temporary workspace root and cover:

```js
const created = await createNamedProject({ workspaceRoot, projectName: '가스 센서 보드 01' });
assert.equal(created.slug, '가스-센서-보드-01');
assert.equal(created.projectDir, path.join(workspaceRoot, '가스-센서-보드-01'));
await assert.rejects(
  () => createNamedProject({ workspaceRoot, projectName: '../outside' }),
  { code: 'INVALID_PROJECT_NAME' }
);
await assert.rejects(
  () => createNamedProject({ workspaceRoot, projectName: 'CON' }),
  { code: 'INVALID_PROJECT_NAME' }
);
```

Also assert duplicate directory creation fails with `PROJECT_EXISTS` and that
the resolved path remains inside the resolved workspace root.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/project-workspace.test.js`

Expected: FAIL because `project-workspace.js` does not exist.

- [ ] **Step 3: Implement safe project-directory creation**

Create `src/workflow/project-workspace.js` using `path.resolve`, `mkdir` with
`recursive: false`, and a deterministic slugger.  Allow Unicode letters,
numbers, spaces, `_`, and `-`; collapse whitespace to `-`; reject separators,
`.`/`..`, empty results, Windows reserved basenames (`CON`, `PRN`, `AUX`,
`NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), and any resolved directory outside the
root.  Export typed `Error` objects by assigning `error.code` before throwing.

- [ ] **Step 4: Write failing daemon orchestration tests**

Extend `tests/daemon.test.js` with an injected provider transcript that emits
the Korean assistant message plus `schematic.generate`.  Call `project.create`
then `project.request` and assert:

```js
assert.equal(result.ok, true);
assert.equal(result.result.operation, 'generated');
assert.equal(result.result.validation.erc.errorCount, 0);
assert.ok(result.result.files.schematic.endsWith('.kicad_sch'));
```

Add an existing-project case in which the provider returns no tool call; assert
`project.request` falls back to the bounded local generator for an empty
project, and falls back to `schematic.patch` with `approved: true` for a
generated project.  Add an ERC-failure injected case asserting the previous
spec file remains unchanged.

- [ ] **Step 5: Run focused daemon tests to verify the new cases fail**

Run: `node --test tests/daemon.test.js`

Expected: FAIL because `project.create` still aliases generation and
`project.request` is unknown.

- [ ] **Step 6: Implement `project.create` and `project.request`**

Update the daemon dispatch table so `project.create` calls
`createNamedProject`.  Add `project.request` that invokes the selected provider
with the active project path, executes each allowed provider call, and falls
back to the local generator/approved patch when the transcript contains no
tool calls.  After the resulting generation or patch, call `validateProject`
and recompute the readiness review with that validation.

```js
const hasSpec = await projectHasSpec(projectDir);
const applied = toolResults.length
  ? toolResults.at(-1).result
  : hasSpec
    ? await applySchematicPatch({ projectDir, prompt, approved: true })
    : await generateMcuPeripheralProject({ projectDir, prompt });
const validation = await validateProject({ projectDir });
return { operation: hasSpec ? 'patched' : 'generated', files: applied.files, validation, review };
```

Only use the fallback after a successful provider transcript with no calls; a
provider parse/cancellation failure must remain a failed request.

- [ ] **Step 7: Run focused workflow tests**

Run: `node --test tests/project-workspace.test.js tests/daemon.test.js`

Expected: PASS with safe name creation, provider/fallback generation,
automatic validation, and rollback preservation covered.

- [ ] **Step 8: Commit the workspace and orchestration change**

```powershell
git add src/workflow/project-workspace.js tests/project-workspace.test.js src/runtime/agent-daemon.js tests/daemon.test.js
git commit -m "feat: run named projects from natural language"
```

### Task 3: Replace the ambiguous panel controls with an active-project UX

**Files:**
- Modify: `apps/panel/index.html:1-85`
- Modify: `apps/panel/panel.js:1-380`
- Modify: `apps/panel/styles.css`
- Modify: `scripts/verify-panel-ui.js:1-260`
- Modify: `tests/panel-assets.test.js`

**Interfaces:**
- Consumes: `project.create` and `project.request` daemon responses from Task 2.
- Produces: an active-project card, named-project dialog, request-status card,
  separate review/ERC/KiCad-link cards, and `window.chatpcbHost` calls used by Task 4.
- Sends: `project.create { workspaceRoot, projectName }`, `project.request { projectDir, prompt, provider }`, and optional host messages `{ type: 'project.open' | 'project.status' | 'project.reload', projectPath }`.

- [ ] **Step 1: Write failing browser-flow assertions**

Refactor `scripts/verify-panel-ui.js` to start with no active project.  Fill a
new-project name of `가스 센서 보드 01`, click **New project**, wait for the
active-project card, enter the Korean request below, and click **Send**:

```js
await page.getByLabel('Project name').fill('가스 센서 보드 01');
await page.getByRole('button', { name: 'New project' }).click();
await page.getByRole('status', { name: 'Active project' }).waitFor();
await page.getByLabel('Circuit request').fill('ESP32-S3와 가스 센서를 연결한 회로를 만들어줘');
await page.getByRole('button', { name: 'Send' }).click();
await page.getByRole('status', { name: 'Request status' }).filter({ hasText: 'Completed' }).waitFor();
```

Assert there is no `#generate-button`, artifacts include `.kicad_pro`, the ERC
card exposes `0 errors` and `0 warnings`, and a simulated provider protocol
failure appears in the request card without the raw
`Providers may only emit` sentence.

- [ ] **Step 2: Run browser UI verification to verify it fails**

Run: `npm run verify:ui`

Expected: FAIL because the current panel still requires a raw path and exposes
the Generate button.

- [ ] **Step 3: Implement the active-project panel state**

Replace the path input and `Generate` button with an accessible new-project
form containing `workspace-root`, `project-name`, and **New project**.  Keep
the active project’s display name and resolved directory in panel state.
Disable Send until creation succeeds.  Route Send to `project.request`, set
request status to `running`, and render its returned operation, artifacts,
review, and validation independently.

Use a small rendering API rather than reusing the chat log as status:

```js
function renderRequestStatus({ state, summary, technicalDetail = '' }) {
  requestStatusEl.dataset.state = state;
  requestStatusEl.textContent = summary;
  requestTechnicalDetailEl.textContent = technicalDetail;
  requestTechnicalDetailsEl.hidden = technicalDetail.length === 0;
}

function renderValidation({ erc, skipped, reason, completedAt }) {
  validationStatusEl.dataset.state = skipped ? 'unavailable' : erc.errorCount === 0 ? 'passed' : 'failed';
  validationStatusEl.textContent = skipped ? reason : `${erc.errorCount} errors, ${erc.warningCount} warnings`;
  validationTimestampEl.textContent = completedAt ?? '';
}

function renderKiCadLink({ linkState, projectPath, dirty = false }) {
  kiCadLinkEl.dataset.state = linkState;
  kiCadLinkEl.textContent = dirty ? `Unsaved KiCad changes: ${projectPath}` : `${linkState}: ${projectPath}`;
}
```

Map daemon errors to user-facing Korean-safe copy such as `요청을 처리하지
못했습니다. 다시 시도하거나 기술 상세를 확인하세요.` and place the original
error only in a collapsed `details` element.

- [ ] **Step 4: Add the explicit KiCad open/reload controls and browser fallback**

Render **Open in KiCad** only after artifacts contain `.kicad_pro`.  If
`window.chatpcbHost` exists, post a `project.open` message; otherwise show the
resolved project path and launcher guidance rather than claiming a reload.
Request `project.status` before a Send-driven update and show a conflict card
when the host reports unsaved changes.  On successful update, post
`project.reload` and show `reload-needed` until the host confirms completion.

- [ ] **Step 5: Run panel asset and browser-flow tests**

Run: `node --test tests/panel-assets.test.js && npm run verify:ui`

Expected: PASS.  The Playwright flow verifies named Korean projects, Send-only
generation, separate request/review/ERC states, hidden internal errors, and
the standalone KiCad fallback.

- [ ] **Step 6: Commit the panel UX change**

```powershell
git add apps/panel/index.html apps/panel/panel.js apps/panel/styles.css scripts/verify-panel-ui.js tests/panel-assets.test.js
git commit -m "feat: guide natural language project creation"
```

### Task 4: Add the KiCad WebView host bridge and unsaved-edit protection

**Files:**
- Modify: `kicad-fork/chatpcb_panel/chatpcb_panel.h:1-20`
- Modify: `kicad-fork/chatpcb_panel/chatpcb_panel.cpp:1-94`
- Modify: `tests/kicad-fork.test.js`
- Modify: `docs/KICAD_FORK_BOOTSTRAP.md`

**Interfaces:**
- Consumes: panel messages from Task 3: `project.open`, `project.status`, `project.reload`.
- Produces: host-to-WebView status events `{ type: 'project.status', projectPath, dirty, linkState }` and `{ type: 'project.reload', linkState }`.
- Adds: `CHATPCB_PANEL::OnScriptMessage(wxWebViewEvent&)`, `PostHostEvent(...)`, `OpenProject(...)`, `IsEditorDirty()`, and `ReloadActiveProject()`.

- [ ] **Step 1: Write failing fork-source assertions**

Extend `tests/kicad-fork.test.js` to require the C++ panel source/header to
declare and bind a script-message handler and to contain the exact protocol
tokens `project.open`, `project.status`, `project.reload`, and `dirty`.
Require the bootstrap document to state that `.kicad_pro`, not only
`.kicad_sch`, is opened.

- [ ] **Step 2: Run the focused fork test to verify it fails**

Run: `node --test tests/kicad-fork.test.js`

Expected: FAIL because the scaffold only starts the daemon and loads the WebView.

- [ ] **Step 3: Implement WebView message routing**

Register a WebView script message handler during panel construction and bind it
to `OnScriptMessage`.  Parse one JSON object per message.  For `project.status`,
post current path plus dirty state.  For `project.open`, invoke KiCad’s project
open API with the supplied normal `.kicad_pro` after validating the extension.
For `project.reload`, return a conflict event without changing files when the
editor is dirty; otherwise invoke the editor reload API and post completion.

```cpp
void CHATPCB_PANEL::OnScriptMessage( wxWebViewEvent& aEvent )
{
    const nlohmann::json request = nlohmann::json::parse( aEvent.GetString().ToUTF8().data() );
    if( request.value( "type", "" ) == "project.status" )
        PostHostEvent( BuildProjectStatus() );
    else if( request.value( "type", "" ) == "project.reload" && IsEditorDirty() )
        PostHostEvent( { { "type", "project.status" }, { "linkState", "conflict" }, { "dirty", true } } );
    else if( request.value( "type", "" ) == "project.open" )
        OpenProject( wxString::FromUTF8( request.at( "projectPath" ).get<std::string>() ) );
}
```

Use the KiCad fork’s existing editor/project-manager APIs rather than starting
another executable for embedded-mode opens.  Keep the browser fallback from
Task 3 unchanged.

- [ ] **Step 4: Document build and behavior expectations**

Update `docs/KICAD_FORK_BOOTSTRAP.md` with the host-message contract, the
unsaved-edit refusal behavior, and the manual fallback when an official KiCad
build lacks the fork panel.

- [ ] **Step 5: Run focused fork contract tests**

Run: `node --test tests/kicad-fork.test.js`

Expected: PASS with host bridge symbols, protocol tokens, `.kicad_pro` opening,
and dirty-conflict behavior documented.

- [ ] **Step 6: Commit the host bridge change**

```powershell
git add kicad-fork/chatpcb_panel/chatpcb_panel.h kicad-fork/chatpcb_panel/chatpcb_panel.cpp tests/kicad-fork.test.js docs/KICAD_FORK_BOOTSTRAP.md
git commit -m "feat: link ChatPCB projects to KiCad"
```

### Task 5: Verify the complete user path and update user-facing documentation

**Files:**
- Modify: `README.md:44-151`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `scripts/verify-panel-flow.js`

**Interfaces:**
- Consumes: the named-project, `project.request`, panel, and host-bridge contracts from Tasks 1-4.
- Produces: repeatable CLI/UI checks and current user documentation.

- [ ] **Step 1: Write failing flow-verifier assertions**

Update `scripts/verify-panel-flow.js` so its WebSocket scenario first calls
`project.create` with a Korean display name, then calls `project.request` with
a Korean prompt.  Assert a normal KiCad project path, generated operation, ERC
object, and review object are returned.  Add a mock host-state event asserting
that a dirty project returns `linkState: 'conflict'` without a reload request.

- [ ] **Step 2: Run the flow verifier to verify it fails before documentation-only changes**

Run: `npm run verify:panel`

Expected: PASS only after the Task 2 daemon implementation is present; before
that it fails on unknown `project.request`.

- [ ] **Step 3: Update README and architecture documentation**

Replace instructions that say “click Generate” with: create a named project,
write a Korean or English request, press Send, inspect the independent ERC and
review cards, then open the `.kicad_pro` in KiCad.  Document that clean ERC
does not mean clean PCB DRC/release readiness, and that the panel refuses
automatic updates while KiCad has unsaved edits.

- [ ] **Step 4: Run all automated verification**

Run: `npm test && npm run verify:panel && npm run verify:ui`

Expected: all Node tests, WebSocket flow verification, and Playwright panel UI
verification pass.

- [ ] **Step 5: Perform the Computer Use end-to-end check**

Using the KiCad fork panel when available (otherwise the standalone browser
fallback), create a temporary named project, send this Korean prompt, and
confirm the success, review, ERC, and KiCad-link cards:

```text
ESP32-S3와 가스 센서를 연결하고 3.3V 전원을 사용하는 회로를 만들어줘.
```

Open the returned `.kicad_pro` in KiCad, run ERC through KiCad’s Inspect menu,
and record the visible error/warning counts.  Confirm that a deliberately dirty
editor shows the conflict state instead of accepting a reload.

- [ ] **Step 6: Commit the verification and documentation update**

```powershell
git add README.md docs/ARCHITECTURE.md scripts/verify-panel-flow.js
git commit -m "docs: describe natural language project workflow"
```
