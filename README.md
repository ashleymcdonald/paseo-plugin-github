# paseo-plugin-github

GitHub management inside [Paseo](https://paseo.sh): issues, kanban board,
pull requests, and Actions runs for every project on your daemon — without
leaving your agent workspace.

## Features

- **Overview** — open issues, PRs, and workflow-run totals across all your
  Paseo projects, with a per-project table. One click filters every tab to
  that project's repo.
- **Issues** — browse open/closed issues across repos, read the full
  thread, comment, close/reopen, and **start a dedicated agent workspace on
  an issue** in one click (worktree + branch + issue context as the prompt).
- **Pull Requests** — open/closed/merged PRs across repos with checks
  rollup, review decisions, and diff stats. Detail view shows checks,
  reviews, and comments; **"Review this PR"** creates a change-request
  checkout workspace with an agent reviewing the PR.
- **Actions** — recent workflow runs across repos, job/step breakdown,
  inline log viewing (tail-capped for large logs), rerun failed jobs,
  cancel running workflows.
- **Board** — a separate sidebar surface: kanban over open issues with
  columns from `status:*` labels (merged across repos when unfiltered).
  Move cards between columns from the card menu — missing status labels are
  created on the repo automatically. Agent workspaces started from issues
  show up as live status chips on their cards.

The UI is built with the host's own design tokens and matches Paseo's
native look on desktop and mobile, in every theme.

## Requirements

- A [Paseo](https://paseo.sh) daemon with **plugins enabled**
  (Settings → Plugins).
- The [GitHub CLI](https://cli.github.com/) (`gh`) installed and
  authenticated (`gh auth login`) on the daemon machine. The plugin never
  handles tokens itself — `gh` is the auth broker.

## Install

```bash
git clone https://github.com/ashleymcdonald/paseo-plugin-github
paseo plugin install /absolute/path/to/paseo-plugin-github
paseo plugin ls   # expect: paseo-plugin-github  running
```

Open the **GitHub** item in the Paseo sidebar.

## How it works

- The plugin resolves each Paseo project to its GitHub repo with
  `gh repo view` and shells out to `gh` for everything else — no Octokit,
  no stored credentials.
- All GitHub access runs in the plugin's daemon-side subprocess behind
  Zod-validated RPCs. Client surfaces are pure React Native primitives +
  TanStack Query.
- Rate limits are a design constraint: open issue/PR counts come from a
  single GraphQL query (never the search API), and every read is wrapped in
  a server-side TTL cache shared by all connected clients. Mutations bust
  the cache for their repo.

## Development

```bash
npm install
npm run typecheck
paseo plugin reload paseo-plugin-github
paseo plugin logs paseo-plugin-github
```

| File                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `index.ts`              | Wiring: RPC handlers + surface/sidebar registration  |
| `github.shared.ts`      | Zod RPC contracts and shared types                   |
| `github.server.ts`      | Handlers: `gh` wrapper, TTL cache, error taxonomy    |
| `main.client.tsx`       | GitHub surface: project filter, tab bar, Overview    |
| `issues.client.tsx`     | Issues tab: list, detail, comments, agent workspaces |
| `pulls.client.tsx`      | Pull Requests tab: list, detail, checks, reviews     |
| `actions.client.tsx`    | Actions tab: runs, jobs, logs, rerun/cancel          |
| `board.client.tsx`      | Board surface: label-mode kanban with move menu      |
| `dropdown.client.tsx`   | Shared project filter dropdown                       |
| `projects.client.tsx`   | Shared Paseo project enumeration hook                |
| `theme.shared.ts`       | Theme token helpers (alpha-derived borders/fills)    |
| `scripts/gen-icons.mjs` | Regenerates `icons.client.tsx` (Lucide → PNG)        |

## License

ISC
