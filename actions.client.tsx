import { type PluginHostProps, useRpc } from "@getpaseo/plugin";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { WorkflowRun } from "./github.shared";
import {
  actionsCancel,
  actionsGetJobLog,
  actionsGetRun,
  actionsListRuns,
  actionsRerun,
} from "./github.shared";
import { withAlpha } from "./theme.shared";

export interface ActionProject {
  projectId: string;
  name: string;
  rootPath: string;
}

type ActionStyles = Record<string, ViewStyle | TextStyle>;

interface ScopedRun {
  run: WorkflowRun;
  repoDir: string;
  projectName: string;
}

function formatAge(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / (86400 * 30))}mo`;
}

function formatDuration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso) return null;
  const seconds = Math.max(0, ((endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso)) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

type RunTone = "success" | "failure" | "running" | "muted";

function runTone(run: WorkflowRun): RunTone {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "startup_failure") return "failure";
  return "muted";
}

export function ActionsTab({
  theme,
  host,
  layout,
  projects,
}: PluginHostProps & { projects: ActionProject[] }) {
  const listRunsRpc = useRpc(actionsListRuns);
  const [selected, setSelected] = useState<ScopedRun | null>(null);

  const styles = useMemo<ActionStyles>(() => {
    const border = withAlpha(theme.colors.foregroundMuted, 0.35);
    const surface1 = withAlpha(theme.colors.foreground, 0.035);
    return {
      container: { flex: 1 },
      list: { flex: 1 },
      row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: layout.compact ? 12 : 16,
        borderBottomWidth: 1,
        borderBottomColor: border,
      },
      rowHover: { backgroundColor: surface1 },
      dot: { width: 8, height: 8, borderRadius: 4 },
      rowMain: { flex: 1, gap: 2 },
      rowTitle: { color: theme.colors.foreground, fontSize: 14 },
      metaText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      empty: { padding: 24, alignItems: "center" },
      muted: { color: theme.colors.foregroundMuted },
    };
  }, [theme, layout.compact]);

  const toneColor = (tone: RunTone): string =>
    tone === "success"
      ? theme.colors.accent
      : tone === "failure"
        ? theme.colors.statusDanger
        : theme.colors.foregroundMuted;

  const runQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["github.actions.list-runs", p.rootPath],
      queryFn: () => listRunsRpc({ repoDir: p.rootPath, limit: 30 }),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });

  const rows: ScopedRun[] = [];
  let anyPending = false;
  projects.forEach((p, i) => {
    const query = runQueries[i];
    if (query?.isPending) anyPending = true;
    const data = query?.data;
    if (!data?.ok) return;
    for (const run of data.runs) {
      rows.push({ run, repoDir: p.rootPath, projectName: p.name });
    }
  });
  rows.sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));

  if (selected) {
    return (
      <RunDetail
        theme={theme}
        host={host}
        layout={layout}
        repoDir={selected.repoDir}
        projectName={selected.projectName}
        runId={selected.run.id}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.list}>
        {anyPending && rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.muted}>Loading workflow runs…</Text>
          </View>
        )}
        {!anyPending && rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.muted}>No workflow runs.</Text>
          </View>
        )}
        {rows.map(({ run, repoDir, projectName }) => {
          const tone = runTone(run);
          return (
            <Pressable
              key={`${repoDir}#${run.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${run.workflowName} run ${run.number}: ${run.displayTitle}`}
              onPress={() => setSelected({ run, repoDir, projectName })}
              style={(state) => {
                const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                return [styles.row, (pressed || hovered) && styles.rowHover];
              }}
            >
              <View style={[styles.dot, { backgroundColor: toneColor(tone) }]} />
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {run.displayTitle}
                </Text>
                <Text style={styles.metaText}>
                  {projects.length > 1 ? `${projectName} · ` : ""}
                  {run.workflowName} #{run.number}
                  {run.branch ? ` · ${run.branch}` : ""} · {run.event} ·{" "}
                  {run.status === "completed" ? run.conclusion : run.status} ·{" "}
                  {formatAge(run.createdAt)} ago
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function RunDetail({
  theme,
  layout,
  repoDir,
  projectName,
  runId,
  onBack,
}: PluginHostProps & {
  repoDir: string;
  projectName: string;
  runId: number;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const getRunRpc = useRpc(actionsGetRun);
  const getLogRpc = useRpc(actionsGetJobLog);
  const rerunRpc = useRpc(actionsRerun);
  const cancelRpc = useRpc(actionsCancel);
  const [openLogJobId, setOpenLogJobId] = useState<number | null>(null);

  const styles = useMemo<ActionStyles>(() => {
    const border = withAlpha(theme.colors.foregroundMuted, 0.35);
    const surface1 = withAlpha(theme.colors.foreground, 0.035);
    return {
      container: { flex: 1 },
      header: {
        gap: 8,
        paddingHorizontal: layout.compact ? 12 : 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: border,
      },
      headerTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
      backText: { color: theme.colors.accent, fontSize: 13 },
      title: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" },
      metaText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      actionsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
      button: {
        height: 28,
        justifyContent: "center",
        paddingHorizontal: 12,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: surface1,
      },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      body: { flex: 1, padding: layout.compact ? 12 : 16, gap: 4 },
      sectionTitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 4,
      },
      job: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: border,
        marginBottom: 8,
        gap: 6,
      },
      jobHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
      dot: { width: 8, height: 8, borderRadius: 4 },
      jobName: { color: theme.colors.foreground, fontSize: 14, flex: 1 },
      stepRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16 },
      stepName: { color: theme.colors.foregroundMuted, fontSize: 12, flex: 1 },
      logBox: {
        borderRadius: 6,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: surface1,
        maxHeight: 320,
      },
      logBoxContent: { padding: 10 },
      logText: {
        color: theme.colors.foreground,
        fontSize: 11,
        fontFamily: "monospace",
        // RNW uses CSS pre-wrap, which never breaks long unbroken tokens
        // (URLs, SHAs) and lets the log blow out the whole layout width.
        // wordBreak is passed through to CSS on web; native ignores it.
        ...({ wordBreak: "break-all" } as object),
      },
      muted: { color: theme.colors.foregroundMuted },
      danger: { color: theme.colors.statusDanger },
    };
  }, [theme, layout.compact]);

  const toneColor = (tone: RunTone): string =>
    tone === "success"
      ? theme.colors.accent
      : tone === "failure"
        ? theme.colors.statusDanger
        : theme.colors.foregroundMuted;

  const detailQuery = useQuery({
    queryKey: ["github.actions.get-run", repoDir, runId],
    queryFn: () => getRunRpc({ repoDir, runId }),
    staleTime: 15_000,
    refetchInterval: (query) =>
      query.state.data?.ok && query.state.data.run.status !== "completed" ? 15_000 : false,
  });

  const logQuery = useQuery({
    queryKey: ["github.actions.get-job-log", repoDir, openLogJobId],
    queryFn: () => getLogRpc({ repoDir, jobId: openLogJobId as number }),
    enabled: openLogJobId !== null,
    staleTime: 60_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["github.actions.get-run", repoDir, runId] });
    void queryClient.invalidateQueries({ queryKey: ["github.actions.list-runs", repoDir] });
  };

  const rerunMutation = useMutation({
    mutationFn: (failedOnly: boolean) => rerunRpc({ repoDir, runId, failedOnly }),
    onSuccess: (result) => {
      if (result.ok) invalidate();
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelRpc({ repoDir, runId }),
    onSuccess: (result) => {
      if (result.ok) invalidate();
    },
  });

  const data = detailQuery.data;
  const run = data?.ok ? data.run : null;
  const jobs = data?.ok ? data.jobs : [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable accessibilityRole="button" onPress={onBack}>
            <Text style={styles.backText}>← {projectName}</Text>
          </Pressable>
        </View>
        {detailQuery.isPending && <Text style={styles.muted}>Loading run…</Text>}
        {data && !data.ok && <Text style={styles.danger}>{data.message}</Text>}
        {run && (
          <>
            <Text style={styles.title}>
              {run.workflowName} #{run.number}
            </Text>
            <Text style={styles.metaText}>
              {run.displayTitle}
              {run.branch ? ` · ${run.branch}` : ""} · {run.event} ·{" "}
              {run.status === "completed" ? run.conclusion : run.status} ·{" "}
              {formatAge(run.createdAt)} ago
            </Text>
            <View style={styles.actionsRow}>
              {run.status === "completed" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => rerunMutation.mutate(run.conclusion !== "success")}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>
                    {rerunMutation.isPending
                      ? "Rerunning…"
                      : run.conclusion === "success"
                        ? "Rerun all"
                        : "Rerun failed"}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => cancelMutation.mutate()}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>
                    {cancelMutation.isPending ? "Cancelling…" : "Cancel run"}
                  </Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => void Linking.openURL(run.url)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Open on GitHub</Text>
              </Pressable>
            </View>
            {rerunMutation.data && !rerunMutation.data.ok && (
              <Text style={styles.danger}>{rerunMutation.data.message}</Text>
            )}
            {cancelMutation.data && !cancelMutation.data.ok && (
              <Text style={styles.danger}>{cancelMutation.data.message}</Text>
            )}
          </>
        )}
      </View>
      {run && (
        <ScrollView style={styles.body}>
          <Text style={styles.sectionTitle}>Jobs ({jobs.length})</Text>
          {jobs.map((job) => {
            const jobTone: RunTone =
              job.status !== "completed"
                ? "running"
                : job.conclusion === "success"
                  ? "success"
                  : job.conclusion === "failure"
                    ? "failure"
                    : "muted";
            const duration = formatDuration(job.startedAt, job.completedAt);
            const logOpen = openLogJobId === job.id;
            return (
              <View key={job.id} style={styles.job}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${logOpen ? "Hide" : "Show"} log for ${job.name}`}
                  onPress={() => setOpenLogJobId(logOpen ? null : job.id)}
                  style={styles.jobHeader}
                >
                  <View style={[styles.dot, { backgroundColor: toneColor(jobTone) }]} />
                  <Text style={styles.jobName}>{job.name}</Text>
                  <Text style={styles.metaText}>
                    {job.status === "completed" ? job.conclusion : job.status}
                    {duration ? ` · ${duration}` : ""} · log {logOpen ? "▴" : "▾"}
                  </Text>
                </Pressable>
                {job.steps.map((step) => (
                  <View key={step.number} style={styles.stepRow}>
                    <View
                      style={[
                        styles.dot,
                        {
                          backgroundColor:
                            step.conclusion === "success"
                              ? theme.colors.accent
                              : step.conclusion === "failure"
                                ? theme.colors.statusDanger
                                : theme.colors.foregroundMuted,
                          width: 6,
                          height: 6,
                        },
                      ]}
                    />
                    <Text style={styles.stepName}>{step.name}</Text>
                  </View>
                ))}
                {logOpen && (
                  <ScrollView style={styles.logBox} nestedScrollEnabled>
                    <View style={styles.logBoxContent}>
                      {logQuery.isPending && <Text style={styles.muted}>Loading log…</Text>}
                      {logQuery.data && !logQuery.data.ok && (
                        <Text style={styles.danger}>{logQuery.data.message}</Text>
                      )}
                      {logQuery.data?.ok && (
                        <>
                          {logQuery.data.truncated && (
                            <Text style={styles.metaText}>
                              Log truncated to the last 512 KiB.{"\n"}
                            </Text>
                          )}
                          <Text style={styles.logText}>{logQuery.data.log}</Text>
                        </>
                      )}
                    </View>
                  </ScrollView>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
