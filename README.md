# UCL PMS LINE Webhook Local

## Important Note
- The `oldsrc` folder is a backup copy of earlier code and is intentionally excluded from active documentation and analysis.
- Active source files are in `src/` and `package.json`.

## Overview
This repository is a Firebase Realtime Database triggered application implemented in TypeScript and deployed as a Windows service.
It listens for queued transactions, processes LINE image events, saves images, and triggers UiPath API workflows.

## Repository Structure
- `src/main.ts` — application runtime, event queue listeners, transaction orchestration.
- `src/template.ts` — Firebase initialization, database references, listener helper functions, transaction state management.
- `src/type.ts` — shared TypeScript types and interfaces used across the app.
- `Install.js` — installs the app as a Windows service using `node-windows`.
- `Uninstall.js` — removes the Windows service.
- `package.json` — dependencies, scripts, and overrides.

## Core / Template
`src/template.ts` is the core foundation of the project.
It contains:
- Firebase Admin initialization using the service account JSON file.
- Firebase Realtime Database setup for `ServerInstanceDatabase` and `PerformerCaches`.
- Transaction state definitions: `new`, `process`, `failed`, `pending`, `successful`, `finalize`, `takeover`.
- Listener abstractions for queue states:
  - `Listener_NewTransaction`
  - `Listener_PrecessTransaction`
  - `Listener_FailedTransaction`
  - `Listener_FinalizeTransaction`
  - `Listener_PendingTransaction`
- A shared cache model controlling concurrent performer execution and retry handling.

### How the core works
- The app treats each queue entry as an `EventTransactionInfo` object.
- When new queue entries arrive, the listener validates and forwards them into processing.
- Processing updates queue state to `process`, then `finalize` or `failed` depending on outcome.
- Failed transactions are retried up to 3 times and then stopped.
- Finalization decrements running counters and optionally performs post-processing logic.

## Server
`src/main.ts` implements the main business flow and event handling.
Key responsibilities:
- Initialize the server state and default local configuration values.
- Keep `ServerHealth.lastActive` refreshed every minute.
- Manage two main queues:
  - `ImageTransactions` for LINE image events.
  - `UiPathAPITransactions` for UiPath-compatible workflows.
- Use `PerformerCaches` to enforce concurrency limits and rate control.
- Process LINE image events by loading stored `line_events`, saving image metadata, and updating Firebase.
- Process UiPath transactions by validating authentication, refreshing tokens, and dispatching queue work.
- Manage environment-based configuration values stored under `LocalConfigs`.

## Installation as a Windows Service
This project supports installation and removal as a Windows service using `node-windows`.

### Required files
- `ucl-pms-project-firebase-c6b10789f613.json` must be downloaded from the PMS team and placed at the repository root.
- A `.env` file must include:
  - `SERVER_INSTANCE_DATABASE`
  - `PORTAL_API_TOKEN`
  - `PORTAL_PORT`
  - `DATABASE_URL`
  - `STORAGEBUCKET_URL`
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_CHANNEL_SECRET`
  - `UIPATH_APP_ID`
  - `UIPATH_APP_SECRET`
  - `UIPATH_CLOUD_TENANT_ADDRESS`
  - `UIPATH_SCOPE`

### Build and deploy
1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile TypeScript:
   ```bash
   npm run build
   ```
3. Install as a Windows service:
   ```bash
   npm run deploy
   ```
4. Remove the service:
   ```bash
   npm run undeploy
   ```

### Notes
- `Install.js` checks required environment variables before installing.
- `Uninstall.js` removes the service if already installed.
- The Windows service runs the compiled `dist/main.js` script.

## Scripts
- `npm run test` — run `src/main.ts` with `ts-node` and dotenv.
- `npm run start` — execute the built app with dotenv.
- `npm run build` — compile TypeScript sources.
- `npm run deploy` — build and install the Windows service.
- `npm run undeploy` — uninstall the Windows service.

## Dependencies
- `firebase-admin` — Firebase Admin SDK for database and storage access.
- `firebase-functions` — used for shared Firebase tooling.
- `express`, `body-parser` — not currently used heavily in active source, but present in dependencies.
- `node-windows` — install/uninstall Windows service.
- `axios` — external REST/API calls.
- `dotenv` — environment variable loading.

## Security and dependency note
- A safe dependency override was added for `@tootallnate/once` in `package.json` to resolve a transitive vulnerability without downgrading `firebase-admin`.
- Run `npm audit` after any dependency change.

## Excluded backup code
- Do not modify files in `oldsrc/` when updating the active application.
- `oldsrc/` is a backup archive only.
