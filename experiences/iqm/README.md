# IQM web experience

The editable Vite renderer lives in `src`; authored media and external/vendor modules live in `public`. These have been refreshed from the updated `..\makeshift-iqm-kiosk` (relative to the launcher root), without changing that original project. Obsolete source files and renderer tests were removed to match upstream. This package retains its web-only build setup and shared-shell runtime bridge; it has no separate Electron runtime, packaging, deployment, or asset-generation scripts.

The included copy is independently editable, not automatically synchronized with the original. From the launcher root, `npm.cmd run experience:import -- iqm --dry-run` previews a refresh; `--apply` stages, validates, and replaces it only when there are no conflicting local edits. The importer preserves these web-only boundaries and the launcher-owned `test\web-project.test.mjs`, while excluding upstream Electron tests and generated output. See the root README for baseline initialization, backups, rollback, and dependency behavior.

- `npm run dev`: loopback-only Vite, dynamically allocated port.
- `npm run check`: Node syntax/tests, nanoscale camera, and media validation.
- `npm run build:renderer`: Vite output in `dist`, with media checks before and after.
- `npm run build`: source checks followed by the renderer build.
- `npm run preview`: preview existing output over loopback on a dynamically allocated port.

The shared desktop shell injects immutable `window.kiosk` (`platform`, `appVersion`, `isDevelopment`, `isKiosk`, `config`) before document scripts. Its config comes from `config/kiosk.config.json`, preserving the authored two-stage idle defaults. Direct browser development retains the renderer's original no-preload fallback. The renderer does not use Electron APIs.

Browser versions are pinned to the source lock, not the older manifest ranges: GSAP 3.15.0, lottie-web 5.13.0, Three 0.185.1, and Vite 7.3.6. Vite's dependency lock retains its required and optional platform dependency closure, with no Electron or production-tool dependencies.
