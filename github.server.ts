import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { z } from "zod";
import type {
  BoardColumn,
  GhError,
  IssueDetail,
  IssueSummary,
  PullChecks,
  PullDetail,
  PullSummary,
  RepoInfo,
  RunJob,
  WorkflowRun,
  actionsCancel,
  actionsGetJobLog,
  actionsGetRun,
  actionsListRuns,
  actionsRerun,
  boardGet,
  boardMove,
  issuesComment,
  issuesCreate,
  issuesGet,
  issuesList,
  issuesSetState,
  projectSummary,
  pullsGet,
  pullsList,
  repoInfo,
} from "./github.shared";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024; // workflow logs and large issue lists

type GhFailure = { code: GhError["code"]; message: string };

class GhCommandError extends Error {
  constructor(public readonly failure: GhFailure) {
    super(failure.message);
  }
}

function toGhError(err: unknown): GhError {
  if (err instanceof GhCommandError) {
    return { ok: false, ...err.failure };
  }
  return {
    ok: false,
    code: "api_error",
    message: err instanceof Error ? err.message : String(err),
  };
}

function classify(err: unknown): GhFailure {
  const e = err as { code?: string; stderr?: string; message?: string };
  if (e?.code === "ENOENT") {
    return {
      code: "gh_missing",
      message: "GitHub CLI (gh) is not installed on this machine.",
    };
  }
  const stderr = (e?.stderr ?? e?.message ?? "").toLowerCase();
  if (stderr.includes("rate limit") || stderr.includes("api rate limit exceeded")) {
    return {
      code: "rate_limited",
      message: "GitHub API rate limit exceeded; showing cached data where possible.",
    };
  }
  if (
    stderr.includes("not logged into") ||
    stderr.includes("authentication") ||
    stderr.includes("to authenticate") ||
    stderr.includes("requires authentication")
  ) {
    return {
      code: "auth_required",
      message: "gh is not authenticated. Run `gh auth login` on the daemon machine.",
    };
  }
  if (
    stderr.includes("not a git repository") ||
    stderr.includes("no git remote") ||
    stderr.includes("could not resolve to a repository") ||
    (stderr.includes("repository") && stderr.includes("not found"))
  ) {
    return {
      code: "not_a_repo",
      message: "This directory does not resolve to a GitHub repository.",
    };
  }
  const firstLine = (e?.stderr ?? e?.message ?? "gh command failed")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return { code: "api_error", message: firstLine ?? "gh command failed" };
}

async function gh(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch (err) {
    throw new GhCommandError(classify(err));
  }
}

async function ghJson<T>(args: string[], cwd: string): Promise<T> {
  const stdout = await gh(args, cwd);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new GhCommandError({
      code: "api_error",
      message: `gh returned non-JSON output for: gh ${args.join(" ")}`,
    });
  }
}

// ---------------------------------------------------------------------------
// TTL cache — one entry per key, shared by every connected client. Keeps
// per-row UI polling from multiplying into GitHub rate-limit territory.
// ---------------------------------------------------------------------------

const cache = new Map<string, { expiresAt: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }
  const value = await fn();
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

// Mutations bust every cached read for the repo so the next list/detail
// fetch reflects the change.
function invalidateRepo(repoDir: string): void {
  for (const key of cache.keys()) {
    if (key.includes(`:${repoDir}:`) || key.endsWith(`:${repoDir}`)) {
      cache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// gh JSON shapes (subset of fields we request)
// ---------------------------------------------------------------------------

interface GhRepoView {
  nameWithOwner: string;
  defaultBranchRef: { name: string };
  url: string;
}

interface GhIssueRow {
  number: number;
  title: string;
  state: string;
  url: string;
  author: { login: string } | null;
  labels: { name: string; color: string }[];
  assignees: { login: string }[];
  comments: { author: { login: string } | null; body: string; createdAt: string }[];
  updatedAt: string;
}

interface GhIssueDetail extends GhIssueRow {
  body: string;
  createdAt: string;
}

function toIssueSummary(row: GhIssueRow): IssueSummary {
  return {
    number: row.number,
    title: row.title,
    state: row.state.toLowerCase() === "closed" ? "closed" : "open",
    url: row.url,
    author: row.author?.login ?? null,
    labels: row.labels.map((l) => ({ name: l.name, color: l.color })),
    assignees: row.assignees.map((a) => a.login),
    commentCount: row.comments.length,
    updatedAt: row.updatedAt,
  };
}

function toIssueDetail(row: GhIssueDetail): IssueDetail {
  return {
    ...toIssueSummary(row),
    body: row.body,
    createdAt: row.createdAt,
    comments: row.comments.map((c) => ({
      author: c.author?.login ?? null,
      body: c.body,
      createdAt: c.createdAt,
    })),
  };
}

const ISSUE_FIELDS =
  "number,title,state,url,author,labels,assignees,comments,updatedAt";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type Input<C extends { input: z.ZodType }> = z.output<C["input"]>;

function resolveRepo(repoDir: string): Promise<GhRepoView> {
  return cached(`repoview:${repoDir}`, 10 * 60_000, () =>
    ghJson<GhRepoView>(
      ["repo", "view", "--json", "nameWithOwner,defaultBranchRef,url"],
      repoDir,
    ),
  );
}

export async function getRepoInfo({ repoDir }: Input<typeof repoInfo>) {
  try {
    const [repo, viewer] = await Promise.all([
      resolveRepo(repoDir),
      ghJson<{ login: string }>(["api", "user"], repoDir).catch(() => null),
    ]);
    const info: RepoInfo = {
      nameWithOwner: repo.nameWithOwner,
      defaultBranch: repo.defaultBranchRef.name,
      url: repo.url,
      viewer: viewer?.login ?? null,
    };
    return { ok: true as const, repo: info };
  } catch (err) {
    return toGhError(err);
  }
}

const SUMMARY_TTL = 5 * 60_000;

const SUMMARY_QUERY = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    issues(states:OPEN){ totalCount }
    pullRequests(states:OPEN){ totalCount }
  }
}`;

interface GhSummaryGraphql {
  data: {
    repository: {
      issues: { totalCount: number };
      pullRequests: { totalCount: number };
    };
  };
}

export async function getProjectSummary({ repoDir }: Input<typeof projectSummary>) {
  return cached(`summary:${repoDir}`, SUMMARY_TTL, async () => {
    try {
      const repo = await resolveRepo(repoDir);
      const [owner, name] = repo.nameWithOwner.split("/");
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      // GraphQL: one point-cost call instead of two search-API calls (search
      // has a far lower rate limit). Actions runs are REST-only.
      const [counts, runs] = await Promise.all([
        ghJson<GhSummaryGraphql>(
          ["api", "graphql", "-f", `query=${SUMMARY_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`],
          repoDir,
        ),
        ghJson<{ workflow_runs: { created_at: string }[] }>(
          ["api", `repos/${repo.nameWithOwner}/actions/runs?per_page=100`],
          repoDir,
        ).catch(() => ({ workflow_runs: [] })), // Actions may be disabled
      ]);
      return {
        ok: true as const,
        summary: {
          openIssues: counts.data.repository.issues.totalCount,
          openPrs: counts.data.repository.pullRequests.totalCount,
          recentRuns: runs.workflow_runs.filter((r) => r.created_at >= sevenDaysAgo)
            .length,
        },
      };
    } catch (err) {
      return toGhError(err);
    }
  });
}

export async function listIssues({
  repoDir,
  state,
  labels,
  assignee,
  search,
  limit,
}: Input<typeof issuesList>) {
  const key = `issues:${repoDir}:${state}:${(labels ?? []).join(",")}:${assignee ?? ""}:${search ?? ""}:${limit}`;
  return cached(key, 30_000, async () => {
    try {
    const args = [
      "issue",
      "list",
      "--state",
      state,
      "--json",
      ISSUE_FIELDS,
      "--limit",
      String(limit),
    ];
    if (labels && labels.length > 0) {
      for (const label of labels) {
        args.push("--label", label);
      }
    }
    if (assignee) {
      args.push("--assignee", assignee);
    }
    if (search) {
      args.push("--search", search);
    }
    const rows = await ghJson<GhIssueRow[]>(args, repoDir);
    return { ok: true as const, issues: rows.map(toIssueSummary) };
    } catch (err) {
      return toGhError(err);
    }
  });
}

export async function getIssue({ repoDir, number }: Input<typeof issuesGet>) {
  return cached(`issue:${repoDir}:${number}`, 30_000, async () => {
    try {
      const row = await ghJson<GhIssueDetail>(
        [
          "issue",
          "view",
          String(number),
          "--json",
          `${ISSUE_FIELDS},body,createdAt`,
        ],
        repoDir,
      );
      return { ok: true as const, issue: toIssueDetail(row) };
    } catch (err) {
      return toGhError(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Mutation handlers
// ---------------------------------------------------------------------------

export async function createIssue({
  repoDir,
  title,
  body,
  labels,
}: Input<typeof issuesCreate>) {
  try {
    const args = ["issue", "create", "--title", title];
    if (body) {
      args.push("--body", body);
    }
    if (labels) {
      for (const label of labels) {
        args.push("--label", label);
      }
    }
    // gh issue create has no --json; stdout is the new issue URL.
    const url = (await gh(args, repoDir)).trim();
    const number = Number(url.split("/").pop());
    if (!Number.isInteger(number) || number <= 0) {
      throw new GhCommandError({
        code: "api_error",
        message: `gh issue create returned unexpected output: ${url}`,
      });
    }
    invalidateRepo(repoDir);
    return { ok: true as const, number, url };
  } catch (err) {
    return toGhError(err);
  }
}

export async function commentOnIssue({ repoDir, number, body }: Input<typeof issuesComment>) {
  try {
    await gh(["issue", "comment", String(number), "--body", body], repoDir);
    invalidateRepo(repoDir);
    return { ok: true as const };
  } catch (err) {
    return toGhError(err);
  }
}

export async function setIssueState({ repoDir, number, state }: Input<typeof issuesSetState>) {
  try {
    await gh(["issue", state === "closed" ? "close" : "reopen", String(number)], repoDir);
    invalidateRepo(repoDir);
    return { ok: true as const };
  } catch (err) {
    return toGhError(err);
  }
}

// ---------------------------------------------------------------------------
// Actions handlers
// ---------------------------------------------------------------------------

const RUN_FIELDS =
  "databaseId,number,workflowName,displayTitle,headBranch,event,status,conclusion,url,createdAt,updatedAt";

interface GhRunRow {
  databaseId: number;
  number: number;
  workflowName: string;
  displayTitle: string;
  headBranch: string | null;
  event: string;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface GhRunJob {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: { name: string; number: number; status: string; conclusion: string | null }[];
}

const KNOWN_STATUSES = new Set([
  "queued",
  "in_progress",
  "completed",
  "waiting",
  "requested",
]);
const KNOWN_CONCLUSIONS = new Set([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "neutral",
  "timed_out",
  "action_required",
  "startup_failure",
]);

function toWorkflowRun(row: GhRunRow): WorkflowRun {
  return {
    id: row.databaseId,
    number: row.number,
    workflowName: row.workflowName,
    displayTitle: row.displayTitle,
    branch: row.headBranch ?? null,
    event: row.event,
    status: (KNOWN_STATUSES.has(row.status) ? row.status : "completed") as WorkflowRun["status"],
    conclusion: (
      row.conclusion && KNOWN_CONCLUSIONS.has(row.conclusion)
        ? row.conclusion
        : null
    ) as WorkflowRun["conclusion"],
    url: row.url,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listWorkflowRuns({ repoDir, limit }: Input<typeof actionsListRuns>) {
  return cached(`runs:${repoDir}:${limit}`, 30_000, async () => {
    try {
      const rows = await ghJson<GhRunRow[]>(
        ["run", "list", "--json", RUN_FIELDS, "--limit", String(limit)],
        repoDir,
      );
      return { ok: true as const, runs: rows.map(toWorkflowRun) };
    } catch (err) {
      return toGhError(err);
    }
  });
}

export async function getWorkflowRun({ repoDir, runId }: Input<typeof actionsGetRun>) {
  return cached(`run:${repoDir}:${runId}`, 30_000, async () => {
    try {
      const row = await ghJson<GhRunRow & { jobs: GhRunJob[] }>(
        ["run", "view", String(runId), "--json", `${RUN_FIELDS},jobs`],
        repoDir,
      );
      const jobs: RunJob[] = (row.jobs ?? []).map((job) => ({
        id: job.databaseId,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        steps: (job.steps ?? []).map((step) => ({
          name: step.name,
          number: step.number,
          status: step.status,
          conclusion: step.conclusion,
        })),
      }));
      return { ok: true as const, run: toWorkflowRun(row), jobs };
    } catch (err) {
      return toGhError(err);
    }
  });
}

const LOG_CAP = 512 * 1024;

export async function getJobLog({ repoDir, jobId }: Input<typeof actionsGetJobLog>) {
  return cached(`joblog:${repoDir}:${jobId}`, 60_000, async () => {
    try {
      const raw = await gh(["run", "view", "--job", String(jobId), "--log"], repoDir);
      // Keep the tail: failures surface at the end of a log.
      const truncated = raw.length > LOG_CAP;
      return { ok: true as const, log: truncated ? raw.slice(-LOG_CAP) : raw, truncated };
    } catch (err) {
      return toGhError(err);
    }
  });
}

export async function rerunWorkflowRun({ repoDir, runId, failedOnly }: Input<typeof actionsRerun>) {
  try {
    const args = ["run", "rerun", String(runId)];
    if (failedOnly) {
      args.push("--failed");
    }
    await gh(args, repoDir);
    invalidateRepo(repoDir);
    return { ok: true as const };
  } catch (err) {
    return toGhError(err);
  }
}

export async function cancelWorkflowRun({ repoDir, runId }: Input<typeof actionsCancel>) {
  try {
    await gh(["run", "cancel", String(runId)], repoDir);
    invalidateRepo(repoDir);
    return { ok: true as const };
  } catch (err) {
    return toGhError(err);
  }
}

// ---------------------------------------------------------------------------
// Pull request handlers
// ---------------------------------------------------------------------------

const PR_FIELDS =
  "number,title,state,url,author,labels,assignees,comments,updatedAt,createdAt,isDraft,headRefName,baseRefName,additions,deletions,reviewDecision,statusCheckRollup";

interface GhCheckRollupEntry {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
}

interface GhPrRow {
  number: number;
  title: string;
  state: string;
  url: string;
  author: { login: string } | null;
  isDraft: boolean;
  labels: { name: string; color: string }[];
  assignees: { login: string }[];
  comments: { author: { login: string } | null; body: string; createdAt: string }[];
  updatedAt: string;
  createdAt: string;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  reviewDecision: string;
  statusCheckRollup: GhCheckRollupEntry[] | null;
}

interface GhPrDetail extends GhPrRow {
  body: string;
  mergeable: string | null;
  reviews: {
    author: { login: string } | null;
    state: string;
    body: string;
    submittedAt: string | null;
  }[];
}

function summarizeChecks(rollup: GhCheckRollupEntry[] | null): PullChecks {
  const checks: PullChecks = { total: 0, success: 0, failure: 0, pending: 0 };
  for (const entry of rollup ?? []) {
    checks.total += 1;
    // CheckRun: status + conclusion. StatusContext: state.
    const state = (entry.state ?? "").toUpperCase();
    const status = (entry.status ?? "").toUpperCase();
    const conclusion = (entry.conclusion ?? "").toUpperCase();
    if (state === "PENDING" || state === "EXPECTED" || (status !== "" && status !== "COMPLETED")) {
      checks.pending += 1;
    } else if (
      conclusion === "FAILURE" || conclusion === "TIMED_OUT" || conclusion === "CANCELLED" ||
      conclusion === "ACTION_REQUIRED" || conclusion === "STARTUP_FAILURE" ||
      state === "FAILURE" || state === "ERROR"
    ) {
      checks.failure += 1;
    } else if (conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED" || state === "SUCCESS") {
      checks.success += 1;
    } else {
      checks.pending += 1;
    }
  }
  return checks;
}

function toCheckRuns(rollup: GhCheckRollupEntry[] | null): PullDetail["checkRuns"] {
  return (rollup ?? []).map((entry) => ({
    name: entry.name ?? entry.context ?? "check",
    status: (entry.status ?? entry.state ?? "").toLowerCase(),
    conclusion: (entry.conclusion ?? entry.state ?? null)?.toLowerCase() ?? null,
  }));
}

function toPullSummary(row: GhPrRow): PullSummary {
  const state = row.state.toLowerCase();
  return {
    number: row.number,
    title: row.title,
    state: state === "merged" ? "merged" : state === "closed" ? "closed" : "open",
    url: row.url,
    author: row.author?.login ?? null,
    isDraft: row.isDraft,
    labels: row.labels.map((l) => ({ name: l.name, color: l.color })),
    assignees: row.assignees.map((a) => a.login),
    commentCount: row.comments.length,
    updatedAt: row.updatedAt,
    headRef: row.headRefName,
    baseRef: row.baseRefName,
    additions: row.additions,
    deletions: row.deletions,
    reviewDecision:
      row.reviewDecision === "APPROVED"
        ? "approved"
        : row.reviewDecision === "CHANGES_REQUESTED"
          ? "changes_requested"
          : row.reviewDecision === "REVIEW_REQUIRED"
            ? "review_required"
            : null,
    checks: summarizeChecks(row.statusCheckRollup),
  };
}

export async function listPulls({ repoDir, state, search, limit }: Input<typeof pullsList>) {
  const key = `pulls:${repoDir}:${state}:${search ?? ""}:${limit}`;
  return cached(key, 30_000, async () => {
    try {
      const args = [
        "pr", "list", "--state", state, "--json", PR_FIELDS, "--limit", String(limit),
      ];
      if (search) {
        args.push("--search", search);
      }
      const rows = await ghJson<GhPrRow[]>(args, repoDir);
      return { ok: true as const, pulls: rows.map(toPullSummary) };
    } catch (err) {
      return toGhError(err);
    }
  });
}

export async function getPull({ repoDir, number }: Input<typeof pullsGet>) {
  return cached(`pull:${repoDir}:${number}`, 30_000, async () => {
    try {
      const row = await ghJson<GhPrDetail>(
        ["pr", "view", String(number), "--json", `${PR_FIELDS},body,mergeable,reviews`],
        repoDir,
      );
      const pull: PullDetail = {
        ...toPullSummary(row),
        body: row.body,
        createdAt: row.createdAt,
        mergeable: row.mergeable ?? null,
        checkRuns: toCheckRuns(row.statusCheckRollup),
        reviews: (row.reviews ?? []).map((r) => ({
          author: r.author?.login ?? null,
          state: r.state.toLowerCase(),
          body: r.body,
          submittedAt: r.submittedAt,
        })),
        comments: row.comments.map((c) => ({
          author: c.author?.login ?? null,
          body: c.body,
          createdAt: c.createdAt,
        })),
      };
      return { ok: true as const, pull };
    } catch (err) {
      return toGhError(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Board handlers (label-mode: columns from status:* labels)
// ---------------------------------------------------------------------------

const STATUS_PREFIX = "status:";

// Natural board order for common workflow states; unknown labels sort after,
// alphabetically.
const COLUMN_RANK: Record<string, number> = {
  backlog: 0,
  todo: 1,
  pending: 2,
  "in progress": 3,
  "in review": 4,
  review: 5,
  done: 6,
};

interface GhLabelRow {
  name: string;
  color: string;
}

export async function getBoard({ repoDir, limit }: Input<typeof boardGet>) {
  return cached(`board:${repoDir}:${limit}`, 30_000, async () => {
    try {
      const [labels, rows] = await Promise.all([
        ghJson<GhLabelRow[]>(["label", "list", "--json", "name,color", "--limit", "200"], repoDir),
        ghJson<GhIssueRow[]>(
          ["issue", "list", "--state", "open", "--json", ISSUE_FIELDS, "--limit", String(limit)],
          repoDir,
        ),
      ]);
      const issues = rows.map(toIssueSummary);
      // Columns cover every status label on the repo plus any in use on open
      // issues (labels can exist on issues without being in the label list
      // after renames).
      const seen = new Map<string, string>(); // label name -> color
      for (const label of labels) {
        if (label.name.toLowerCase().startsWith(STATUS_PREFIX)) {
          seen.set(label.name, label.color);
        }
      }
      for (const issue of issues) {
        for (const label of issue.labels) {
          if (label.name.toLowerCase().startsWith(STATUS_PREFIX) && !seen.has(label.name)) {
            seen.set(label.name, label.color);
          }
        }
      }
      const rank = (label: string): number =>
        COLUMN_RANK[label.slice(STATUS_PREFIX.length).trim().toLowerCase()] ?? 100;
      const columns: BoardColumn[] = [...seen.entries()]
        .map(([label, color]): BoardColumn => ({
          label,
          title: label.slice(STATUS_PREFIX.length).trim() || label,
          color,
        }))
        .sort((a, b) => {
          const byRank = rank(a.label as string) - rank(b.label as string);
          return byRank !== 0 ? byRank : a.title.localeCompare(b.title);
        });
      const hasNoStatus = issues.some(
        (issue) => !issue.labels.some((l) => l.name.toLowerCase().startsWith(STATUS_PREFIX)),
      );
      if (hasNoStatus || columns.length === 0) {
        columns.unshift({ label: null, title: "No status", color: null });
      }
      return { ok: true as const, columns, issues };
    } catch (err) {
      return toGhError(err);
    }
  });
}

export async function moveBoardCard({
  repoDir,
  number,
  addLabel,
  removeLabel,
}: Input<typeof boardMove>) {
  try {
    const args = ["issue", "edit", String(number)];
    if (addLabel) {
      args.push("--add-label", addLabel);
    }
    if (removeLabel) {
      args.push("--remove-label", removeLabel);
    }
    if (!addLabel && !removeLabel) {
      return { ok: true as const };
    }
    try {
      await gh(args, repoDir);
    } catch (err) {
      // Moving to a column whose label doesn't exist on this repo yet:
      // create it and retry once.
      const message = err instanceof GhCommandError ? err.failure.message.toLowerCase() : "";
      if (addLabel && message.includes("not found") && message.includes(addLabel.toLowerCase())) {
        await gh(["label", "create", addLabel, "--color", "8b949e"], repoDir);
        await gh(args, repoDir);
      } else {
        throw err;
      }
    }
    invalidateRepo(repoDir);
    return { ok: true as const };
  } catch (err) {
    return toGhError(err);
  }
}
