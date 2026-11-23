# Live while you edit

For a page that updates itself while you change the spec or the data, serve it in watch mode:

```
node <skill-dir>/scripts/serve.mjs --watch dashboard.json --open
```

- It builds once, serves the result on `127.0.0.1` and rebuilds when the spec or any file source (csv, parquet, json, duckdb, sqlite) is saved. The open page reloads on its own.
- Postgres and MySQL sources have no file to watch: add `--interval <seconds>` (5 to 86400), e.g. `--interval 60`, to rebuild on a timer. `--interval` also works for file sources.
- The page has a **Rebuild now** button for an immediate rebuild.
- If the first build fails, it prints the errors and exits 1 without starting the server; a usage or IO problem on that first build (missing `node_modules`, an unwritable `dist`, a busy port) exits 2. After that, a failed build (invalid spec, half-written data file) shows an error banner and keeps the last good page. The next good save rebuilds.
- `--theme <name>` picks a theme (it wins over the spec's `theme`). `--allow-outside` and `--timeout <seconds>` work as for build; `--port <n>` and `--open` are serve options.
- Only the served copy is live: it adds `connect-src 'self'` to the CSP for the event stream. `dist/index.html` on disk is the normal static page (`default-src 'none'`), and a page opened from disk (`file://`) is static: it never updates itself.

For scheduled rebuilds of the file on disk, use the sections below.

# Scheduled rebuilds

A refresh is `build.mjs` again: it re-runs every query and rewrites `dist/index.html`. No LLM. No network for
file sources; postgres and mysql sources connect read-only to their database on each run. (sqlite, postgres and
mysql sources need their extension installed once with `setup.mjs`; see `schema.md`.)
Use absolute paths in schedules, since cron and launchd start in a bare environment. Replace `<skill-dir>`
with the folder containing `SKILL.md` and `/abs/dashboard.json` with your spec.

A scheduled dashboard reruns its queries under the same titles, so a finding title ("North drives half of revenue")
goes stale on the next refresh. Give a scheduled dashboard neutral titles that stay true ("Revenue by region").

Find your node path first: `command -v node`.

## cron (Linux, macOS)

`crontab -e`, then hourly at minute 5, logging to a file:

```
5 * * * * /usr/local/bin/node <skill-dir>/scripts/build.mjs /abs/dashboard.json >> $HOME/dashboard-build.log 2>&1
```

## Postgres and MySQL credentials

Postgres and MySQL sources read their connection string from an environment variable. Cron and launchd do not load
your shell profile. Do not put the string in `dashboard.json`, on the crontab line or in a plist: the password
would sit in plain files and show in `ps`. Instead:

1. Connect as a read-only database role. `READ_ONLY` on the attach only limits DuckDB; the role is the real guard.
2. Keep the string in an env file only you can read (`chmod 600 /abs/dashboard.env`):

   ```
   PG_URL='postgres://readonly:<password>@db.example.com:5432/app'
   ```

3. Write a wrapper script (`chmod 700 /abs/dashboard-build.sh`) that sources the env file, then schedule the wrapper
   in place of `node`:

   ```
   #!/bin/sh
   set -a
   . /abs/dashboard.env
   set +a
   exec /usr/local/bin/node <skill-dir>/scripts/build.mjs /abs/dashboard.json
   ```

   For cron: `5 * * * * /abs/dashboard-build.sh >> $HOME/dashboard-build.log 2>&1`.

## launchd (macOS)

Save as `~/Library/LaunchAgents/com.example.dashboard-build.plist` (rename `com.example` to your own prefix):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.dashboard-build</string>
  <key>ProgramArguments</key>
  <array>
    <!-- the wrapper script from "Postgres and MySQL credentials"; for file sources only, call /usr/local/bin/node with build.mjs and the spec instead -->
    <string>/abs/dashboard-build.sh</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/Users/you/Library/Logs/dashboard-build.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Library/Logs/dashboard-build.log</string>
</dict>
</plist>
```

Use real absolute paths in the plist, and in the wrapper's `<skill-dir>` (plists do not expand `~` or `$HOME`).

```
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.dashboard-build.plist
launchctl kickstart -k gui/$(id -u)/com.example.dashboard-build   # run now
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.example.dashboard-build.plist   # stop
```

## Serving the result

Point any static host at the `dist` folder, or run `node <skill-dir>/scripts/serve.mjs /abs/dist`. The page
shows its "Refreshed" time, and each chart shows the refresh time of its own query.
