import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export const ghErrorSchema = z.object({
  ok: z.literal(false),
  code: z.enum(["gh_missing", "auth_required", "not_a_repo", "rate_limited", "api_error"]),
  message: z.string(),
});
export type GhError = z.infer<typeof ghErrorSchema>;

const repoDirInput = { repoDir: z.string().min(1) };

// ---------------------------------------------------------------------------
// github.repo.info
// ---------------------------------------------------------------------------

export const repoInfoSchema = z.object({
  nameWithOwner: z.string(),
  defaultBranch: z.string(),
  url: z.string(),
  viewer: z.string().nullable(),
});
export type RepoInfo = z.infer<typeof repoInfoSchema>;

export const repoInfo = defineRpc({
  name: "github.repo.info",
  input: z.object(repoDirInput),
  output: z.union([
    z.object({ ok: z.literal(true), repo: repoInfoSchema }),
    ghErrorSchema,
  ]),
});

// ---------------------------------------------------------------------------
// github.project.summary
// ---------------------------------------------------------------------------

export const projectSummary = defineRpc({
  name: "github.project.summary",
  input: z.object(repoDirInput),
  output: z.union([
    z.object({
      ok: z.literal(true),
      summary: z.object({
        openIssues: z.number().int().nonnegative(),
        openPrs: z.number().int().nonnegative(),
        recentRuns: z.number().int().nonnegative(),
      }),
    }),
    ghErrorSchema,
  ]),
});

// ---------------------------------------------------------------------------
// github.issues.list / github.issues.get
// ---------------------------------------------------------------------------

export const issueLabelSchema = z.object({
  name: z.string(),
  color: z.string(),
});

export const issueSummarySchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  url: z.string(),
  author: z.string().nullable(),
  labels: z.array(issueLabelSchema),
  assignees: z.array(z.string()),
  commentCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type IssueSummary = z.infer<typeof issueSummarySchema>;

export const issueCommentSchema = z.object({
  author: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});

export const issueDetailSchema = issueSummarySchema.extend({
  body: z.string(),
  createdAt: z.string(),
  comments: z.array(issueCommentSchema),
});
export type IssueDetail = z.infer<typeof issueDetailSchema>;

export const issuesList = defineRpc({
  name: "github.issues.list",
  input: z.object({
    ...repoDirInput,
    state: z.enum(["open", "closed", "all"]).default("open"),
    labels: z.array(z.string()).optional(),
    assignee: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.union([
    z.object({ ok: z.literal(true), issues: z.array(issueSummarySchema) }),
    ghErrorSchema,
  ]),
});

export const issuesGet = defineRpc({
  name: "github.issues.get",
  input: z.object({
    ...repoDirInput,
    number: z.number().int().positive(),
  }),
  output: z.union([
    z.object({ ok: z.literal(true), issue: issueDetailSchema }),
    ghErrorSchema,
  ]),
});

// ---------------------------------------------------------------------------
// github.issues.create / comment / setState
// ---------------------------------------------------------------------------

export const issuesCreate = defineRpc({
  name: "github.issues.create",
  input: z.object({
    ...repoDirInput,
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
  }),
  output: z.union([
    z.object({ ok: z.literal(true), number: z.number().int(), url: z.string() }),
    ghErrorSchema,
  ]),
});

export const issuesComment = defineRpc({
  name: "github.issues.comment",
  input: z.object({
    ...repoDirInput,
    number: z.number().int().positive(),
    body: z.string().min(1),
  }),
  output: z.union([z.object({ ok: z.literal(true) }), ghErrorSchema]),
});

export const issuesSetState = defineRpc({
  name: "github.issues.set-state",
  input: z.object({
    ...repoDirInput,
    number: z.number().int().positive(),
    state: z.enum(["open", "closed"]),
  }),
  output: z.union([z.object({ ok: z.literal(true) }), ghErrorSchema]),
});

// ---------------------------------------------------------------------------
// github.actions.*
// ---------------------------------------------------------------------------

export const runStatusSchema = z.enum([
  "queued",
  "in_progress",
  "completed",
  "waiting",
  "requested",
]);
export const runConclusionSchema = z.enum([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "neutral",
  "timed_out",
  "action_required",
  "startup_failure",
]);

export const workflowRunSchema = z.object({
  id: z.number().int(),
  number: z.number().int(),
  workflowName: z.string(),
  displayTitle: z.string(),
  branch: z.string().nullable(),
  event: z.string(),
  status: runStatusSchema,
  conclusion: runConclusionSchema.nullable(),
  url: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const runStepSchema = z.object({
  name: z.string(),
  number: z.number().int(),
  status: z.string(),
  conclusion: z.string().nullable(),
});

export const runJobSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  steps: z.array(runStepSchema),
});
export type RunJob = z.infer<typeof runJobSchema>;

export const actionsListRuns = defineRpc({
  name: "github.actions.list-runs",
  input: z.object({
    ...repoDirInput,
    limit: z.number().int().min(1).max(100).default(30),
  }),
  output: z.union([
    z.object({ ok: z.literal(true), runs: z.array(workflowRunSchema) }),
    ghErrorSchema,
  ]),
});

export const actionsGetRun = defineRpc({
  name: "github.actions.get-run",
  input: z.object({
    ...repoDirInput,
    runId: z.number().int().positive(),
  }),
  output: z.union([
    z.object({
      ok: z.literal(true),
      run: workflowRunSchema,
      jobs: z.array(runJobSchema),
    }),
    ghErrorSchema,
  ]),
});

export const actionsGetJobLog = defineRpc({
  name: "github.actions.get-job-log",
  input: z.object({
    ...repoDirInput,
    jobId: z.number().int().positive(),
  }),
  output: z.union([
    z.object({ ok: z.literal(true), log: z.string(), truncated: z.boolean() }),
    ghErrorSchema,
  ]),
});

export const actionsRerun = defineRpc({
  name: "github.actions.rerun",
  input: z.object({
    ...repoDirInput,
    runId: z.number().int().positive(),
    failedOnly: z.boolean().default(false),
  }),
  output: z.union([z.object({ ok: z.literal(true) }), ghErrorSchema]),
});

export const actionsCancel = defineRpc({
  name: "github.actions.cancel",
  input: z.object({
    ...repoDirInput,
    runId: z.number().int().positive(),
  }),
  output: z.union([z.object({ ok: z.literal(true) }), ghErrorSchema]),
});

// ---------------------------------------------------------------------------
// github.pulls.list / github.pulls.get
// ---------------------------------------------------------------------------

export const pullChecksSchema = z.object({
  total: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failure: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});
export type PullChecks = z.infer<typeof pullChecksSchema>;

export const reviewDecisionSchema = z.enum([
  "approved",
  "changes_requested",
  "review_required",
]);

export const pullSummarySchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  url: z.string(),
  author: z.string().nullable(),
  isDraft: z.boolean(),
  labels: z.array(issueLabelSchema),
  assignees: z.array(z.string()),
  commentCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  reviewDecision: reviewDecisionSchema.nullable(),
  checks: pullChecksSchema,
});
export type PullSummary = z.infer<typeof pullSummarySchema>;

export const pullCheckRunSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
});

export const pullReviewSchema = z.object({
  author: z.string().nullable(),
  state: z.string(),
  body: z.string(),
  submittedAt: z.string().nullable(),
});

export const pullDetailSchema = pullSummarySchema.extend({
  body: z.string(),
  createdAt: z.string(),
  mergeable: z.string().nullable(),
  checkRuns: z.array(pullCheckRunSchema),
  reviews: z.array(pullReviewSchema),
  comments: z.array(issueCommentSchema),
});
export type PullDetail = z.infer<typeof pullDetailSchema>;

export const pullsList = defineRpc({
  name: "github.pulls.list",
  input: z.object({
    ...repoDirInput,
    state: z.enum(["open", "closed", "merged", "all"]).default("open"),
    search: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.union([
    z.object({ ok: z.literal(true), pulls: z.array(pullSummarySchema) }),
    ghErrorSchema,
  ]),
});

export const pullsGet = defineRpc({
  name: "github.pulls.get",
  input: z.object({
    ...repoDirInput,
    number: z.number().int().positive(),
  }),
  output: z.union([
    z.object({ ok: z.literal(true), pull: pullDetailSchema }),
    ghErrorSchema,
  ]),
});

// ---------------------------------------------------------------------------
// github.board.*  (label-mode columns: status:* labels)
// ---------------------------------------------------------------------------

export const boardColumnSchema = z.object({
  /** The status label backing this column; null = "no status" inbox column. */
  label: z.string().nullable(),
  /** Display title (label minus the "status:" prefix, or "No status"). */
  title: z.string(),
  color: z.string().nullable(),
});
export type BoardColumn = z.infer<typeof boardColumnSchema>;

export const boardGet = defineRpc({
  name: "github.board.get",
  input: z.object({
    ...repoDirInput,
    limit: z.number().int().min(1).max(300).default(200),
  }),
  output: z.union([
    z.object({
      ok: z.literal(true),
      columns: z.array(boardColumnSchema),
      issues: z.array(issueSummarySchema),
    }),
    ghErrorSchema,
  ]),
});

export const boardMove = defineRpc({
  name: "github.board.move",
  input: z.object({
    ...repoDirInput,
    number: z.number().int().positive(),
    /** Status label to add; null when moving into the "no status" column. */
    addLabel: z.string().nullable(),
    /** Status label to remove; null when the issue had no status label. */
    removeLabel: z.string().nullable(),
  }),
  output: z.union([z.object({ ok: z.literal(true) }), ghErrorSchema]),
});
