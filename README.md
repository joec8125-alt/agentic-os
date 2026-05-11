# AOS dashboard for C:\ai

Local web dashboard for browsing/editing the AOS at `C:\ai`. Pure Node — no `npm install` needed.

## Run

Double-click `start.bat`, or:

```
node server.js
```

Opens at <http://localhost:4321>.

## What it does

- **Overview** — skills count, context file count, latest audit, CLAUDE.md/AGENTS.md status, where skills live
- **Skills** — browse all 38 skill packs in `skills/`, view rendered SKILL.md, copy `/<skill>` slash command
- **Context** — list of all `.md`/`.txt` at root + in `context/` and `brain/`. Click to open side-by-side editor + live preview. Autosaves on idle (1.5s) or `Ctrl+S`.
- **Audits** — `audits/<date>.md` files (none yet — created when you run `/audit`)
- **Files** — full file tree, click any text/markdown file to edit, click any image to view

## How it adapts

The dashboard auto-detects:
- **Skills location**: `.claude/skills/` first, then `skills/` (this repo uses the second)
- **Skill file casing**: matches `SKILL.md` OR `skill.md` case-insensitively (this repo has both)
- **Context dirs**: `context/` and/or `brain/` (whichever exist)
- **Optional folders**: `audits/`, `decisions/`, `archives/` are gracefully empty if missing

## Configuration

- Default port: `4321`. Override with `PORT=5000 node server.js`.
- AOS root: defaults to the dashboard's parent directory (`C:\ai`). Override with `set AOS_ROOT=D:\some\other\aos && node server.js`.

## Security

- Binds to `127.0.0.1` only — never on the network
- All filesystem operations scoped to AOS root; path traversal (`../`) rejected
- No auth — do NOT expose to the internet

## Dependencies

None. Uses only Node built-in modules. Tested on Node 18+. Tailwind via CDN at runtime (no install).
