# Quantum experience launcher

An offline launcher for independently built, editable web experiences, using one shared fullscreen Electron window. The welcome screen presents **QuNorth** (MAGNE) and **Explore Quantum** (IQM) as large white and navy touch targets with descriptive subtitles and circular chevrons, over a soft pastel background. Partner branding sits below the cards; portrait screens stack the cards and landscape screens place them side by side. Fonts, texture, and partner images are bundled in `launcher\assets` for offline use. Their internal IDs remain `magne` and `iqm`.

## Setup and run (Windows)

Use Node.js 22.12 or newer and npm. Restore all three dependency trees, then build the experiences:

```powershell
npm.cmd ci
npm.cmd --prefix .\experiences\magne ci
npm.cmd --prefix .\experiences\iqm ci
npm.cmd run build
npm.cmd start
```

Electron is pinned to **39.2.7**. Its official installer downloads the platform runtime during dependency restoration; it is explicitly approved in the root manifest. If your package manager asks for lifecycle-script approval, follow its normal approval process rather than disabling script or Windows protections.

Installation/building needs dependency access; the running application does not need internet access. The shell never installs packages or builds experiences at runtime. Missing builds leave the visitor on the welcome screen with an actionable error.

For a safe portrait development window instead of fullscreen kiosk mode:

```powershell
npm.cmd run dev
```

This command shows the cursor in the welcome screen, MAGNE, and IQM. MAGNE's launcher-owned adapter changes only its cursor-hiding class; it does not enable its separate `?dev=1` mode or change its production idle timeout.

Exit using **Ctrl+Shift+Q while the shell window has focus**. Windowed mode also allows ordinary window closing. Normal kiosk mode is borderless/fullscreen and guards accidental close, Escape, and F11; it is not Windows account lockdown or OS provisioning.

An environment-specific registry workaround was needed during development. On machines with the same restriction, append this approved feed to each dependency-restore command:

```text
--registry=https://ms-feed-25.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/
```

Ordinary machines can use their configured registry. Do not disable TLS verification to work around registry failures.

## Editable source and build boundaries

```text
quantum-kiosk\
  experiences.json        Registered IDs, labels, directories and integration profiles
  electron\               Shared shell, protocol, preload and navigation
  integration\            Launcher-owned adaptations and offline font inputs
  launcher\               Plain HTML/CSS/JS welcome screen
  experiences\
    magne\                Editable renderer; public assets under src\public
    iqm\                  Editable renderer, public assets, config and validators
  scripts\                Build orchestration and launcher/smoke tests
  test\                   Focused shared-shell tests
```

The copies were extracted from `..\magne-kiosk` and `..\makeshift-iqm-kiosk`. Those originals remain untouched. The importer synchronizes **from** those stand-alone projects; it never writes back to them. Local edits in an included copy are allowed, but a later import refuses to overwrite them. Reconcile such edits manually rather than treating an import as a destructive folder copy. Original Electron wrappers and deployment tooling are excluded; dependency folders and generated builds are managed locally.

Each experience has its own manifest, lockfile, `node_modules` and Vite build. They are deliberately not npm workspaces or a merged renderer bundle:

| Dependency | MAGNE | IQM |
| --- | --- | --- |
| Three.js | 0.182.0 | 0.185.1 |
| GSAP | 3.14.2 | 3.15.0 |
| Lottie | 5.13.0 | 5.13.0 |
| Vite | 7.3.1 | 7.3.6 |

Build just the affected copy:

```powershell
npm.cmd --prefix .\experiences\magne run build
npm.cmd --prefix .\experiences\iqm run build
```

For web-only Vite development, run that copy's `dev` script. Direct browser/Vite previews do not have the Electron preload bridge: IQM uses browser development defaults, not the production kiosk runtime. Use the shared shell against rebuilt output for integration testing.

MAGNE's original Google-hosted **Unica One** font is included locally so its appearance works offline. The launcher-owned font and SIL Open Font License inputs live in `integration\magne\fonts\UnicaOne`; its import profile overlays them into `experiences\magne\src\public\assets\fonts\UnicaOne` and narrowly adapts the upstream font import without replacing the rest of its stylesheet. The existing relative image/Outfit font build warnings refer to public assets verified by the Electron smoke test; existing bundle-size/Lottie warnings are not extraction failures.

## Refresh an experience from its stand-alone project

Close the launcher, then run these commands **from the launcher root**:

```powershell
npm.cmd run experience:import -- iqm --dry-run
npm.cmd run experience:import -- iqm --apply
npm.cmd run experience:import -- magne --from ..\magne-kiosk --dry-run
npm.cmd run experience:import -- magne --from ..\magne-kiosk --apply
```

Without an operation flag, the importer defaults to dry-run. The JSON report lists additions, modifications, deletions, dependency changes, provenance, and local-edit conflicts. A dry-run does not write application files or import state. The `--from` override is a local source directory resolved relative to the launcher root; it does not fetch repositories or modify the original.

**First baseline only:** an existing web-only copy must be explicitly initialized before its first apply:

```powershell
npm.cmd run experience:import -- magne --initialize
npm.cmd run experience:import -- iqm --initialize
```

Initialization adopts the current included files as the baseline after checking their managed-file shape and browser-only lock. It does not replace source or build files, and it refuses to overwrite an existing baseline. Review any prior local edits before adopting a copy; initialization is not a conflict-reset command. Normal refreshes update the baseline automatically.

An apply stages the selected source and launcher adaptations, validates the browser lock, runs profile-owned renderer checks and a Vite build, then promotes the project and baseline together. Unchanged dependency trees are reused; changed manifests/locks or a missing required build tool trigger a staging-only restore with upstream npm lifecycle scripts disabled. Failed validation leaves the current copy intact. Source, destination, profile inputs, and baseline are rechecked before promotion. The importer and shell share a workspace lock, preventing concurrent launch/import and concurrent imports; stale process locks are handled without disabling Windows protections.

Ownership:

- **Import-managed:** the profile's renderer/assets, selected validation scripts/tests, runtime config, web manifest/lock, and Vite configuration. Modified, deleted, or unexpected locally added managed files are conflicts; obsolete tracked upstream files are removed only on a successful import.
- **Launcher-owned:** registry, shared Electron runtime/adapters, `integration` inputs, included READMEs, and IQM's retained `test\web-project.test.mjs`. Imports and rollbacks preserve these local files.
- **Generated/state:** each experience's `dist`/`node_modules`, `.runtime\imports` staging, and `.experience-imports\<id>` baselines/backups. Builds and dependency state participate in conflict checks; backups retain the paired source, build, dependency tree, and baseline.

Each successful apply prints a unique `backupId`. Restore the latest prior version, or specify a retained backup:

```powershell
npm.cmd run experience:import -- iqm --rollback
npm.cmd run experience:import -- iqm --rollback <backup-id>
```

Replace `<backup-id>` with the returned ID; do not type angle brackets in PowerShell. Rollback refuses local conflicts or damaged backups, preserves current launcher-owned files, and creates a recovery backup of the version it replaces. It does not reinstall dependencies or rebuild upstream projects. Keep `.experience-imports` if you want conflict protection and rollback history; retained backups can be large because they include builds and dependency trees.

To resolve a conflict, preserve your edits separately and reconcile the included managed files with their recorded baseline, or move the intended change into the appropriate launcher-owned adaptation. There is no destructive `--force` option.

## Experience registration and compatibility

`experiences.json` is the shell's registry. Each entry defines a unique URL-safe `id`, plain-text `label`, a local `directory` beneath `experiences`, a `defaultSource`, an `importProfile`, an optional `adapter`, and an optional `runtimeConfig` path relative to that experience. Windows backslashes must be escaped in JSON. Do not use absolute destination paths, traversal, symlinks, overlapping directories, or the reserved ID `launcher`.

To register another already-prepared web experience:

1. Put its independent web project in `experiences\<name>` and build it to `dist\index.html` with relative asset URLs.
2. Add its registry entry. Set `adapter` and `runtimeConfig` to `null` when unnecessary.
3. Restore its browser dependencies, build, then restart the shell. The welcome targets, content roots, navigation allowlist, and root build/test orchestration follow the registry.

Registration alone does not create a stand-alone import recipe. Repeated imports require a reviewed profile in `scripts\experience-import` that selects browser-owned files, adapts the web manifest/config, and validates upstream compatibility. The MAGNE and IQM profiles are deliberately specific: an upstream layout change should fail clearly rather than copy a new Electron wrapper or silently omit required content.

The original projects remain runnable independently. Launcher-owned adapters belong outside their imported renderer trees; the shared preload supplies the optional runtime bridge without requiring either original project to adopt it. Browser dependency versions come from each source lockfile; an import does **not** upgrade the shared Electron runtime.

## Shell behavior and display selection

- One active top-level document: `quantum-app://launcher/index.html` or `quantum-app://<registered-id>/index.html`.
- Each host serves a separate local content root. A switch unloads the old document rather than running a hidden experience, preserving independent CSS, globals and storage origins.
- The privileged secure/standard protocol supports modules, correct asset MIME types, streamed media, HEAD and byte ranges for video seeking. HTTP(S), file/FTP navigation, new windows and downloads are blocked.
- The window is sandboxed and context-isolated, with Node integration disabled and narrow document-authenticated IPC.
- Renderer crashes/load failures recover to welcome. The shell prevents display sleep and enforces one instance; it has no shell inactivity timeout or automatic experience restart.

Normal mode ranks portrait Elo/touch displays deterministically and follows display changes. Explicit overrides are optional; an unavailable override falls back to the usual selection:

```powershell
$env:KIOSK_DISPLAY_LABEL = 'Elo'
npm.cmd start
```

Also supported: `KIOSK_DISPLAY_ID` (Electron display ID) and `KIOSK_DISPLAY_INDEX` (zero-based current display enumeration). ID takes priority over index, then label. Prefer a label/ID over an index for installations where display enumeration can change. Remove a development override with `Remove-Item Env:\KIOSK_DISPLAY_LABEL`.

## Runtime configuration and return controls

The shared preload supplies immutable `window.kiosk` data before experience startup: `bridgeVersion: 1`, capability flags, platform, app version, `isDevelopment`, `isKiosk`, and the document's optional registered configuration. IQM uses its copied `config\kiosk.config.json`; documents without a `runtimeConfig` receive an empty config object. Invalid runtime envelopes expose no bridge.

Normal mode uses production kiosk behavior. `--windowed` selects development behavior. Magne retains its 60-second production idle timeout; IQM retains its two 120-second production idle stages and configured development timeouts. Existing Home/Exit actions remain internal to their respective experiences.

The narrow immutable `window.launcher` bridge provides `bridgeVersion: 1`, capability flags, and:

- `getExperiences()` → `[{ id, label }]`; accepted only from the welcome main frame. Labels are rendered as text, never interpolated HTML.
- `getState()` → `{ document, isLoading, experienceId, error }`.
- `launchExperience(id)` → `{ ok, state }` for registered IDs; accepted only from the welcome main frame.
- `returnToLauncher()` → `{ ok, state }`; available to trusted experience main frames. `capabilities.returnToLauncher` is true in experience documents and false on the launcher.
- `onStateChanged(callback)` → an unsubscribe function.

Each experience's welcome screen includes an **Exit to main menu** button in the top-right corner. Both use the same compact white button with an orange outline, orange label, and decorative close icon. At the 768px-wide portrait reference size, the button is 26px tall with 12px top and 36px right insets; MAGNE scales responsively and IQM uses equivalent dimensions within its scaled 2160px stage. It returns directly to the launcher without confirmation; it never closes the shared window or quits Electron. Existing MAGNE Home and IQM Exit controls still return to their own welcome screens, where visitors can then leave the experience. The control is hidden, disabled, and removed from keyboard focus during interaction. It disables immediately on activation; failed navigation shows accessible feedback and permits a retry.

The controls are launcher-owned: `experiences.json` selects the `magne`/`iqm` adapters in `electron\runtime-adapters.cjs`; the sandboxed preload mounts the control in MAGNE's `#attract-screen` or IQM's `[data-screen="attract"]`. `electron\return-control-styles.cjs` supplies scoped Electron-injected CSS compatible with IQM's inline-style restrictions and scaled stage. Observers/listeners are disposed when the document unloads. No return-control HTML/JS/CSS is added to the imported renderers or originals, so imports preserve these adapters and stand-alone/browser runs have no launcher-specific button. An upstream welcome-selector change requires a reviewed adapter update.

A successful navigation destroys the caller's document; don't rely on its pending callback executing afterward. The newly loaded welcome reads current state.

For isolated test/session data, set `QUANTUM_KIOSK_USER_DATA_DIR` to an absolute local directory before starting. It contains user data, session data, logs and crash dumps. Otherwise Electron uses its normal per-user application paths.

## Validation

```powershell
npm.cmd test
npm.cmd run test:experiences
npm.cmd run smoke
npm.cmd run smoke:production
```

The root test suite covers display choice, content/path isolation, protocol/ranges, navigation, recovery and welcome behavior. IQM retains its renderer tests and syntax/media/nanoscale validators; its build performs those checks too. Magne's extraction is checked through builds and real-shell smoke coverage, not obsolete child-Electron tests.

`smoke` opens a temporary windowed shell and checks real document switching, repeated taps, synthetic touch dispatch, welcome-only return controls and touch/mouse return, unchanged internal Home/Exit behavior, runtime data, local fonts, missing-build recovery, renderer-crash recovery, graphics capabilities, States of Matter video HEAD/range/seek behavior, two representative IQM module mounts, unload/audio cleanup and focused operator quit. It briefly renames Magne's built entry for the missing-build case and restores it in cleanup; do not run it against an active installation. A forced test termination can leave `index.html.smoke-backup`; restore it or rebuild Magne before running again.

`smoke:production` briefly takes over the selected display in fullscreen kiosk mode. It checks a native synthetic welcome touch launch, IQM production styling and actual 120-second timer scheduling after activating its Start button's normal click handler, return navigation, and operator quit. The windowed smoke separately checks synthetic touch on IQM Start. Cross-document synthetic Start touch did not activate the menu during local fullscreen testing, so physical production touch must still be accepted on the target hardware. Reports/screenshots and isolated profiles are under `.runtime\smoke\windowed` and `.runtime\smoke\production` (unless the profile directory is overridden).

Initial launcher validation passed **41 root tests**, both Vite builds, and **6 fullscreen production checks**. After refreshing IQM from its updated source, its build passed **37 renderer tests** plus syntax, camera/nanoscale, and media validation, and the shared-shell windowed smoke passed **19 checks**. The fullscreen checks predate this IQM refresh and were not rerun for it. Local fullscreen was 1920×1080 landscape; this is not acceptance of the portrait Elo hardware.

The subsequent registry/return-control integration passed **40 targeted root tests** and **32 windowed Electron smoke checks**, including both welcome return buttons, synthetic touch on both, mouse/double activation, hidden interaction-state controls, internal Home/Exit preservation, cursor behavior and document/audio unloading. No experience rebuild was needed because this change is entirely shell-owned. Fullscreen and physical portrait acceptance have not been rerun for these controls.

The importer and registry passed **33 targeted tests** (25 importer fixtures and 8 registry tests). Real MAGNE/IQM baseline initialization, staged imports, rollback, and post-import smoke remain pending; fixture success is not end-to-end acceptance of the real imports. Import baselines and backups under `.experience-imports` are local generated state and are excluded from Git.

Console messages from deliberately rejected IPC and the forced renderer crash are expected negative-test diagnostics. Treat test exit status and JSON reports as the result.

Physical 2160×3840 Elo selection, touch calibration, audio output, sustained GPU/frame-rate behavior, and complete content acceptance still need checking on the target kiosk. Packaged installers, Windows provisioning and asset pruning are separate work.
