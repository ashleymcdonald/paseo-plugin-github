# paseo-plugin-github — Plan

Per-project GitHub management inside Paseo. Entry point is a "GitHub" item
in the sidebar area listing each Paseo project with a one-line live summary
— `(github icon) 12 issues · 7 PRs · 3 workflow runs` — which expands into a
tabbed view scoped to that project's repo: **Issues | Board | Pull Requests
| Actions**.

## UX

Single surface with a persistent top bar: **project dropdown** ("All
projects" + one entry per Paseo project with a GitHub remote) followed by
the **tab strip**: Overview | Issues | Board | Pull Requests | Actions.
The dropdown scopes every tab; "All projects" aggregates across repos.

### Overview tab (lander)

- Totals row: open issues, open PRs, workflow runs (7d), project count —
  summed over the summaries of the projects in scope.
- Project table below (Project | Issues | PRs | Runs | Ws columns, in the
  style of Paseo's history table). Clicking a row sets the project filter.
- Projects whose summary errors are excluded from totals; their row shows
  the typed reason (`no GitHub remote`, `gh auth required`, `rate limited`).

### Issues tab

- List of open issues (filter: label, assignee, text search; sort by
  recently updated).
- Issue row → detail view: title, state, body (plain text paragraphs), labels,
  assignees, comment thread, add-comment composer, close/reopen.
- **Primary action: "Work on this issue"** — creates a new workspace/session
  via `usePaseo()`:
  - source: worktree checkout from the project's repo root,
  - title: `#<number> <issue title>`,
  - spawns an agent whose prompt is a snapshot of the issue (title, body,
    labels, recent comments).
  - The new workspace is labeled (`labels: { github-issue: "<n>" }`) so the
    Board tab can correlate workspaces ↔ issues.

### Board tab — shipped as its own sidebar surface

- Own sidebar item ("Board", `SquareKanban`) with its own project filter
  dropdown; removed from the GitHub surface's tab strip.
- **Label mode shipped**: columns from `status:*` labels (natural rank:
  backlog/todo/pending/in progress/in review/done, then alphabetical),
  "No status" inbox always present. Move via card menu; missing labels are
  auto-created on the repo (`gh label create` + retry).
- Workspace correlation shipped as **agent chips** on issue cards
  (agents labeled `github-issue` → workspace → project).
- Follow-ups: GitHub Projects v2 columns/mutations (GraphQL), drag-drop,
  workspace cards as first-class cards.

### Pull Requests tab

- Same shape as Issues: list of open PRs (number, title, author, draft,
  checks rollup success/failure/pending, review decision, age).
- Detail: body, checks list, reviews, "Open on GitHub" (system browser).
- Primary action: "Review this PR" — creates a worktree workspace with
  `checkoutSource: { kind: "change_request", forge: "github", number }` and
  an agent prompted to review the PR.

### Actions tab

- Recent workflow runs (workflow name, branch, commit, status/conclusion,
  duration, age), grouped or filterable by workflow.
- Run detail: jobs → steps, and **log viewing** for failed/completed runs
  via `gh run view --log` fetched through RPC (backend streams/chunks it;
  logs can be large — fetch per-job on demand, never the whole run eagerly).
- Rerun failed / cancel in-progress via `gh run rerun` / `gh run cancel`
  (mutations with confirm).

## Plugin API constraint (verified against current reference)

There is **no project-scoped sidebar contribution** in the plugin API.
Available mounts: global surfaces + sidebar items, workspace/agent panels,
command center items, attachment sources. Therefore:

- The "GitHub" item is a **global sidebar item → global surface**. The
  surface renders the project list itself (the summary rows described
  above), so the UX matches the intent even though Paseo owns the sidebar
  chrome. Projects are enumerated from the SDK workspace list, grouped by
  `projectId` / `projectRootPath`.
- A **workspace-context panel** ("GitHub", icon `Github`) gives the same
  four tabs pre-scoped to the active workspace's project — this is the
  in-context entry point.
- Command center items (workspace context): "Open GitHub board", "New
  GitHub issue" → `openPanel("github")`.

If Paseo later adds a project-list contribution hook, the project-list
component moves there unchanged — the RPC layer is agnostic.

## Architecture

Two layers per the plugin contract; files split by runtime:

```text
index.ts                  wiring: handlers + surfaces + panels + items
github.shared.ts          Zod RPC contracts + shared types
github.server.ts          handlers; all gh invocations, auth, errors
main.client.tsx           global surface: project list → tabs
panel.client.tsx          workspace panel: tabs pre-scoped to project
components/               shared rows, badges, tab bar (added when a 2nd
                          consumer exists, not before)
```

- **Client**: RN primitives, TanStack Query, `useRpc`, `usePaseo`,
  `useWorkspace`. All text from `theme.colors`, padding from
  `layout.compact`. Never touches GitHub directly.
- **Backend**: Node subprocess; shells out to `gh` (argument arrays only —
  issue titles/labels are untrusted, never interpolated). `gh` is the auth
  broker (`gh auth status`); no token handling in the plugin.
- Repo resolution: `gh repo view --json nameWithOwner,defaultBranchRef` run
  in `projectRootPath`. All RPCs take `{ repoDir }` derived client-side from
  the selected project's `projectRootPath`.

### RPC contracts (`github.shared.ts`)

Backend errors are a typed union, never raw stderr:

```ts
type GhError =
  | { ok: false; code: "gh_missing" | "auth_required" | "not_a_repo" | "api_error"; message: string }
```

- `github.repo.info` — nameWithOwner, defaultBranch, viewer login | error.
- `github.project.summary` — `{ openIssues, openPrs, recentRuns }` for the
  project-list rows (one `gh api graphql` batch per repo where possible).
- `github.issues.list` / `github.issues.get` / `github.issues.create` /
  `github.issues.comment` / `github.issues.setState` /
  `github.issues.setLabels` / `github.issues.setAssignees`.
- `github.board.get` — `{ mode: "project_v2" | "labels", columns: [...] }`.
- `github.board.moveCard`.
- `github.pulls.list` / `github.pulls.get`.
- `github.actions.listWorkflows` / `github.actions.listRuns` /
  `github.actions.getRun` / `github.actions.getJobLog` /
  `github.actions.rerun` / `github.actions.cancel`.

Client components consume these via TanStack Query keyed by
`[repoDir, method, params]`; mutations invalidate the affected keys.

## Phases

0. **Bootstrap** — `npm install`, typecheck green, file split above.
1. **RPC layer** — `gh` wrapper + error union + `repo.info` +
   `project.summary` + `issues.list/get`. Manually verifiable via logs.
2. **Project list surface** — sidebar item, summary rows, drill-in shell
   with tab bar (tabs as empty states).
3. **Issues tab** — list, detail, comments, mutations, "Work on this
   issue" workspace creation.
4. **Pull Requests tab** — list, detail, "Review this PR".
5. **Actions tab** — runs list, run detail, per-job logs, rerun/cancel.
6. **Board tab** — Projects v2 or label-fallback columns, issue cards first,
   workspace-card correlation second.
7. **Integration** — workspace panel, command center items, composer
   attachment source (`github-issue`: issue snapshot into agent prompts).

## Conventions

- **Bundler quirks (compiler.ts, verified)**: client bundles build with
  esbuild `platform: "neutral"` — package.json `main`/`module` are ignored,
  so bare imports of anything outside the host externals (react,
  react-native, @tanstack/react-query, zod, SDK) fail to resolve. Deep-import
  ESM entry files instead (e.g. `react-native-svg/lib/module/index.js`,
  typed via a `declare module` shim in `paseo-plugin.d.ts`). RPC names are
  lowercase/digits/dots/hyphens/underscores only — no camelCase.
- **Icons**: the client runtime `require` whitelist (app `evaluate.ts`) only
  serves react / react-native / @tanstack/react-query / zod / SDK, and
  react-native-svg pulls in forbidden react-native internals
  (`codegenNativeComponent`). So `scripts/gen-icons.mjs` rasterizes Lucide
  path data (ISC) to white-on-transparent PNG data URIs, rendered as RN
  `<Image>` with `tintColor`. Run `node scripts/gen-icons.mjs` after adding
  icons.
- **Match the app's design system from source**, not screenshots. Reference
  clone: getpaseo/paseo (`packages/app/src`). Extracted specs: tab strip
  36px with 28px chips (h-pad 8, radius 6, gap 4, active = surface2 fill, no
  border, muted→foreground label); combobox menus (surface0, radius 8, 1px
  border, no dividers, items minHeight 36, 12h/8v, hover surface1, check
  16px muted); table headers 12px/600/uppercase/ls0.5 muted with 1px bottom
  border; rows 8v/12h, hover surface1. Derived fills from the 6 plugin
  tokens: surface1 ≈ foreground@3.5% alpha, surface2 ≈ foreground@7%,
  border ≈ foregroundMuted@35%.
- **Rate limits are a design constraint.** Never the search API for counts —
  one GraphQL call instead. Every read handler is wrapped in the backend TTL
  cache (`cached()` in `github.server.ts`: repo view 10 min, summary 5 min,
  issue list/detail 30 s) so N clients/rows share one upstream call. Client
  polling stays at ≥5 min for summaries. Rate-limit failures surface as the
  typed `rate_limited` code, never as raw 403 text.
- Every `Text` from `theme.colors`; root `surface0`; `layout.compact`
  padding. Verify light + dark, wide + compact before closing a UI phase.
- No speculative shared components; extract on second use.
- No GitHub strings interpolated into shell commands.

## Verification (each phase)

1. `npm run typecheck`.
2. `paseo plugin install <abs path>` (first time) / `paseo plugin reload
   paseo-plugin-github`.
3. `paseo plugin ls` → `running`; `paseo plugin logs paseo-plugin-github`
   clean.
4. Exercise the phase's UI on desktop: one happy path + one error path
   (e.g. `gh auth logout` in a scratch env → typed error renders).
5. Compact layout + both themes for UI phases.

## Non-goals (v1)

- No OAuth/token management (`gh auth login` is the answer).
- No notifications, no diff/code browsing, no CI log live-streaming
  (on-demand fetch only).
- No markdown rendering beyond plain paragraphs.
- No offline cache; TanStack Query in-memory cache only.
