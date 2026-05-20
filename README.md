# Cartable

Local Pronote tooling for families. A Python CLI mirrors a student's Pronote account into a local SQLite database; a Mac app (Tauri + React + FastAPI sidecar) visualises the data and adds a Claude-powered chat plus a Google Calendar 2-week sync.

Nothing leaves your machine. Pronote is read-only from this codebase's perspective — Cartable never writes back to Pronote.

## Repository layout

```
.
├── src/cartable/                 # Python CLI: cartable sync | status | login-test | …
├── skill/pronote/                # "pronote" Claude skill (DB schema + query recipes)
├── launchd/                      # macOS launchd plist for periodic sync
├── app/                          # Cartable.app — Tauri 2 + React + Python sidecar
│   ├── src-tauri/                # Rust shell that spawns the backend on launch
│   ├── src/                      # React 19 + Tailwind v4 + Recharts + react-markdown
│   └── backend/                  # FastAPI on 127.0.0.1:7531 (cartable_app_backend)
└── .github/workflows/            # CI + release builds
```

## Components

### Cartable CLI (`src/cartable/`)

A thin wrapper around [`pronotepy`](https://github.com/bain3/pronotepy) that handles the parent-account quirks and stores a deterministic snapshot in `data/pronote.db`.

```bash
cp .env.example .env             # then fill in PRONOTE_URL, USERNAME, PASSWORD
uv sync
uv run cartable login-test       # confirms credentials, finds the right child
uv run cartable sync             # populates data/pronote.db
uv run cartable status           # last sync info
```

Auth supports both direct password login and 43 French ENT providers. Token is rotated and stored at `data/token.json` (mode 0600). See `cartable list-ents` for the provider list.

A launchd plist template at [`launchd/com.user.cartable.sync.plist`](launchd/com.user.cartable.sync.plist) is provided to refresh every 30 minutes. macOS plists can't expand env vars in `<string>` fields, so we substitute `$HOME` once at install time:

```bash
sed -e "s|__HOME__|$HOME|g" launchd/com.user.cartable.sync.plist \
    > ~/Library/LaunchAgents/com.user.cartable.sync.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.user.cartable.sync.plist
```

### Pronote Claude skill (`skill/pronote/`)

Drop-in skill for Claude Code that documents the SQLite schema and exposes useful query recipes. Install once:

```bash
ln -s "$PWD/skill/pronote" ~/.claude/skills/pronote
```

### Cartable.app (`app/`)

A self-contained macOS application (Tauri 2 shell + React frontend + PyInstaller-bundled Python backend). Reads `data/pronote.db` from the CLI half above. Three views:

- **Schedule** — week grid with prev/today/next navigation, lessons highlighted by status (test, cancelled, room change). Includes a one-click "sync 14 days to Google Calendar" button.
- **Grades** — subject-average bar chart vs class, normalised trend line across periods, leaderboard sorted by gap-to-class, deduplicated recent grades list.
- **Chat** — Claude Agent SDK loop with the `pronote` skill loaded. Multi-turn, SSE-streamed, markdown rendering.

The app and backend speak HTTP over `127.0.0.1:7531`. Logs land in `~/Library/Logs/Cartable/backend.log`.

## Build & run

Dev (live-reload):

```bash
cd app && npm install
cd backend && uv sync
cd .. && npm run tauri dev
```

Production `.app` (self-contained, ~105 MB, no `uv` needed at runtime):

```bash
cd app/backend && uv run pyinstaller \
  --onefile --noconfirm \
  --name cartable-app-backend-aarch64-apple-darwin \
  --collect-all uvicorn --collect-all fastapi --collect-all pydantic --collect-all pydantic_core \
  --collect-all starlette --collect-all anyio --collect-all watchfiles --collect-all httptools \
  --collect-all uvloop --collect-all websockets \
  --collect-all google --collect-all googleapiclient --collect-all google_auth_oauthlib \
  --collect-all claude_agent_sdk \
  --collect-submodules cartable_app_backend \
  src/cartable_app_backend/__main__.py
cp dist/cartable-app-backend-aarch64-apple-darwin ../src-tauri/binaries/
cd .. && npm run tauri build -- --bundles app
```

The output is at `app/src-tauri/target/release/bundle/macos/Cartable.app`.

CI publishes signed releases on every `v*` tag (see [`.github/workflows/release.yml`](.github/workflows/release.yml)).

## Configuration

Cartable picks up the following at runtime — all optional:

| Variable | Default | What it does |
|----------|---------|---|
| `CARTABLE_DB` | `~/Documents/Claude/cartable/data/pronote.db` | Path to the SQLite DB read by the app's backend. |
| `CARTABLE_DIR` | `~/Documents/Claude/cartable` | Working directory for the Claude Agent SDK (so it can find the `pronote` skill). |
| `CARTABLE_APP_PORT` | `7531` | Local HTTP port the backend listens on. |
| `CARTABLE_APP_CONFIG_DIR` | `~/Library/Application Support/Cartable` | Where Google OAuth credentials and tokens are stored. |
| `CARTABLE_CALENDAR_NAME` | `"Pronote — <student first name>"` | Name of the Google Calendar Cartable writes lessons into. |
| `CARTABLE_CALENDAR_TIMEZONE` | system timezone (from `/etc/localtime`) | IANA timezone string for calendar events. |

For the CLI half, see [`.env.example`](.env.example) for the full list of `PRONOTE_*` and `CARTABLE_DATA_DIR` variables.

## Privacy & data

- All data stays on your Mac. The app makes no outbound calls except to Pronote (during `cartable sync`) and Google Calendar (only when you click the sync button, and only for the calendar you explicitly authorise).
- Pronote credentials live in `.env` and a rotating token in `data/token.json` — both gitignored.
- The Claude chat runs through the [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk/overview) which uses your existing Claude Code installation. Requests to Anthropic include the user's prompt, the system prompt, and the data the agent fetches via its tools.

## Known limitations

- macOS only. The Tauri shell, the PyInstaller target, and the launchd job are all Mac-specific.
- The `.app` is unsigned, so on first launch macOS Gatekeeper will refuse to open it. Right-click → Open the first time, or run `xattr -d com.apple.quarantine Cartable.app`. Code signing requires an Apple Developer ID ($99/yr) — wire it into [`release.yml`](.github/workflows/release.yml) if you have one.
- pronotepy lags Pronote protocol changes by days when they happen. If `cartable sync` breaks after a Pronote update, check [`bain3/pronotepy`](https://github.com/bain3/pronotepy) for the fix.

## License

[MIT](LICENSE)
