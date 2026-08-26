import { type PluginHostProps, usePaseo, useRpc } from "@getpaseo/plugin";
import { useQueries, useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { PullSummary } from "./github.shared";
import { pullsGet, pullsList } from "./github.shared";
import { Icon } from "./icons.client";
import { withAlpha } from "./theme.shared";

export interface PullProject {
  projectId: string;
  name: string;
  rootPath: string;
}

type PullStyles = Record<string, ViewStyle | TextStyle>;

interface ScopedPull {
  pull: PullSummary;
  repoDir: string;
  projectName: string;
}

type PullStateFilter = "open" | "closed" | "merged";

function formatAge(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / (86400 * 30))}mo`;
}

function checksText(checks: PullSummary["checks"]): string {
  if (checks.total === 0) return "no checks";
  const parts: string[] = [];
  if (checks.success > 0) parts.push(`${checks.success} ✓`);
  if (checks.failure > 0) parts.push(`${checks.failure} ✗`);
  if (checks.pending > 0) parts.push(`${checks.pending} …`);
  return parts.join(" ");
}

function reviewText(decision: PullSummary["reviewDecision"]): string | null {
  switch (decision) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes requested";
    case "review_required":
      return "review required";
    default:
      return null;
  }
}

export function PullsTab({
  theme,
  host,
  layout,
  projects,
}: PluginHostProps & { projects: PullProject[] }) {
  const listPullsRpc = useRpc(pullsList);
  const [stateFilter, setStateFilter] = useState<PullStateFilter>("open");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScopedPull | null>(null);

  const styles = useMemo<PullStyles>(() => {
    const border = withAlpha(theme.colors.foregroundMuted, 0.35);
    const surface1 = withAlpha(theme.colors.foreground, 0.035);
    return {
      container: { flex: 1 },
      filterRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: layout.compact ? 12 : 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: border,
      },
      stateChip: { height: 28, justifyContent: "center", paddingHorizontal: 12, borderRadius: 6 },
      stateChipActive: { backgroundColor: withAlpha(theme.colors.foreground, 0.07) },
      stateChipText: { color: theme.colors.foregroundMuted, fontSize: 13 },
      stateChipTextActive: { color: theme.colors.foreground },
      searchInput: {
        flex: 1,
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: surface1,
        color: theme.colors.foreground,
        fontSize: 13,
      },
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
      rowMain: { flex: 1, gap: 3 },
      rowTitle: { color: theme.colors.foreground, fontSize: 14 },
      rowMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
      metaText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      draftChip: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 9999,
        backgroundColor: withAlpha(theme.colors.foregroundMuted, 0.18),
      },
      draftText: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "500" },
      diffAdd: { color: theme.colors.accent, fontSize: 12 },
      diffDel: { color: theme.colors.statusDanger, fontSize: 12 },
      commentCount: { flexDirection: "row", alignItems: "center", gap: 4 },
      empty: { padding: 24, alignItems: "center" },
      muted: { color: theme.colors.foregroundMuted },
      accent: { color: theme.colors.accent },
      danger: { color: theme.colors.statusDanger },
    };
  }, [theme, layout.compact]);

  const pullQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["github.pulls.list", p.rootPath, { state: stateFilter, search: search || undefined }],
      queryFn: () =>
        listPullsRpc({ repoDir: p.rootPath, state: stateFilter, search: search || undefined, limit: 50 }),
      staleTime: 30_000,
    })),
  });

  const rows: ScopedPull[] = [];
  let anyPending = false;
  let firstError: string | null = null;
  projects.forEach((p, i) => {
    const query = pullQueries[i];
    if (query?.isPending) anyPending = true;
    const data = query?.data;
    if (data && !data.ok) {
      firstError ??= `${p.name}: ${data.code}`;
      return;
    }
    for (const pull of data?.ok ? data.pulls : []) {
      rows.push({ pull, repoDir: p.rootPath, projectName: p.name });
    }
  });
  rows.sort((a, b) => b.pull.updatedAt.localeCompare(a.pull.updatedAt));

  if (selected) {
    return (
      <PullDetail
        theme={theme}
        host={host}
        layout={layout}
        repoDir={selected.repoDir}
        projectName={selected.projectName}
        number={selected.pull.number}
        onBack={() => setSelected(null)}
      />
    );
  }

  const checksColor = (checks: PullSummary["checks"]) =>
    checks.total === 0
      ? theme.colors.foregroundMuted
      : checks.failure > 0
        ? theme.colors.statusDanger
        : checks.pending > 0
          ? theme.colors.foregroundMuted
          : theme.colors.accent;

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {(["open", "closed", "merged"] as const).map((s) => {
          const active = stateFilter === s;
          return (
            <Pressable
              key={s}
              accessibilityRole="button"
              onPress={() => setStateFilter(s)}
              style={[styles.stateChip, active ? styles.stateChipActive : undefined]}
            >
              <Text style={[styles.stateChipText, active ? styles.stateChipTextActive : undefined]}>
                {s[0].toUpperCase() + s.slice(1)}
              </Text>
            </Pressable>
          );
        })}
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search pull requests"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.searchInput}
        />
      </View>
      <ScrollView style={styles.list}>
        {anyPending && rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.muted}>Loading pull requests…</Text>
          </View>
        )}
        {!anyPending && rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.muted}>{firstError ?? `No ${stateFilter} pull requests.`}</Text>
          </View>
        )}
        {rows.map(({ pull, repoDir, projectName }) => (
          <Pressable
            key={`${repoDir}#${pull.number}`}
            accessibilityRole="button"
            accessibilityLabel={`PR ${pull.number}: ${pull.title}`}
            onPress={() => setSelected({ pull, repoDir, projectName })}
            style={(state) => {
              const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
              return [styles.row, (pressed || hovered) && styles.rowHover];
            }}
          >
            <View style={styles.rowMain}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {pull.isDraft && (
                  <View style={styles.draftChip}>
                    <Text style={styles.draftText}>Draft</Text>
                  </View>
                )}
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {pull.title}
                </Text>
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.metaText}>
                  {projects.length > 1 ? `${projectName} ` : ""}#{pull.number}
                  {pull.author ? ` · ${pull.author}` : ""} · {formatAge(pull.updatedAt)}
                </Text>
                <Text style={styles.diffAdd}>+{pull.additions}</Text>
                <Text style={styles.diffDel}>−{pull.deletions}</Text>
                <Text style={[styles.metaText, { color: checksColor(pull.checks) }]}>
                  {checksText(pull.checks)}
                </Text>
                {reviewText(pull.reviewDecision) && (
                  <Text style={styles.metaText}>· {reviewText(pull.reviewDecision)}</Text>
                )}
              </View>
            </View>
            {pull.commentCount > 0 && (
              <View style={styles.commentCount}>
                <Icon name="comment" size={12} color={theme.colors.foregroundMuted} />
                <Text style={styles.metaText}>{pull.commentCount}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function PullDetail({
  theme,
  layout,
  repoDir,
  projectName,
  number,
  onBack,
}: PluginHostProps & {
  repoDir: string;
  projectName: string;
  number: number;
  onBack: () => void;
}) {
  const paseo = usePaseo();
  const getPullRpc = useRpc(pullsGet);
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);

  const styles = useMemo<PullStyles>(() => {
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
      stateBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999 },
      stateBadgeText: { fontSize: 12, fontWeight: "500" },
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
      buttonPrimary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      buttonPrimaryText: { color: theme.colors.accentForeground, fontSize: 13 },
      body: { flex: 1, padding: layout.compact ? 12 : 16, gap: 12 },
      bodyText: {
        color: theme.colors.foreground,
        fontSize: 14,
        lineHeight: 20,
      },
      sectionTitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
      },
      checkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
      dot: { width: 8, height: 8, borderRadius: 4 },
      checkName: { color: theme.colors.foreground, fontSize: 13, flex: 1 },
      reviewRow: { gap: 2, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: border },
      reviewMeta: { color: theme.colors.foregroundMuted, fontSize: 12 },
      reviewBody: { color: theme.colors.foreground, fontSize: 13 },
      diffAdd: { color: theme.colors.accent, fontSize: 12 },
      diffDel: { color: theme.colors.statusDanger, fontSize: 12 },
      muted: { color: theme.colors.foregroundMuted },
      accent: { color: theme.colors.accent },
      danger: { color: theme.colors.statusDanger },
    };
  }, [theme, layout.compact]);

  const detailQuery = useQuery({
    queryKey: ["github.pulls.get", repoDir, number],
    queryFn: () => getPullRpc({ repoDir, number }),
    staleTime: 30_000,
  });

  const data = detailQuery.data;
  const pull = data?.ok ? data.pull : null;

  const startReview = async () => {
    if (!pull) return;
    setWorkspaceStatus("Creating workspace…");
    try {
      const workspace = await paseo.workspaces.create({
        title: `Review PR #${pull.number}: ${pull.title}`,
        source: {
          kind: "worktree",
          cwd: repoDir,
          action: "checkout",
          checkoutSource: { kind: "change_request", forge: "github", number: pull.number },
        },
      });
      setWorkspaceStatus("Starting agent…");
      const snapshot = await paseo.providers.snapshot();
      type ProviderEntry = {
        enabled?: boolean;
        status: string;
        provider: string;
        models?: { id: string; isDefault?: boolean }[];
      };
      const ready = (snapshot.entries as ProviderEntry[]).find(
        (e) => e.enabled !== false && e.status === "ready" && (e.models?.length ?? 0) > 0,
      );
      const model = ready?.models?.find((m) => m.isDefault) ?? ready?.models?.[0];
      if (!ready || !model) {
        setWorkspaceStatus(`Workspace created (${workspace.name ?? workspace.id}); no ready provider for an agent.`);
        return;
      }
      await workspace.agents.create({
        config: { provider: `${ready.provider}/${model.id}` },
        title: `Review PR #${pull.number}`,
        prompt: [
          `Review GitHub pull request #${pull.number}: ${pull.title}`,
          `URL: ${pull.url}`,
          `Branches: ${pull.headRef} → ${pull.baseRef}`,
          `Diff: +${pull.additions} −${pull.deletions}`,
          "",
          pull.body,
        ].join("\n"),
        labels: { "github-pr": String(pull.number) },
      });
      setWorkspaceStatus(`Workspace "${workspace.name ?? workspace.id}" ready.`);
    } catch (err) {
      setWorkspaceStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const stateColor = pull
    ? pull.state === "open"
      ? theme.colors.accent
      : pull.state === "merged"
        ? theme.colors.accent
        : theme.colors.foregroundMuted
    : theme.colors.foregroundMuted;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable accessibilityRole="button" onPress={onBack}>
            <Text style={styles.backText}>← {projectName}</Text>
          </Pressable>
          {pull && (
            <View style={[styles.stateBadge, { backgroundColor: withAlpha(stateColor, 0.18) }]}>
              <Text style={[styles.stateBadgeText, { color: stateColor }]}>
                {pull.isDraft ? "draft" : pull.state}
              </Text>
            </View>
          )}
        </View>
        {detailQuery.isPending && <Text style={styles.muted}>Loading pull request…</Text>}
        {data && !data.ok && <Text style={styles.danger}>{data.message}</Text>}
        {pull && (
          <>
            <Text style={styles.title}>
              #{pull.number} {pull.title}
            </Text>
            <Text style={styles.metaText}>
              {pull.headRef} → {pull.baseRef}
              {pull.author ? ` · ${pull.author}` : ""} · opened {formatAge(pull.createdAt)} ago ·{" "}
              <Text style={styles.diffAdd}>+{pull.additions}</Text>{" "}
              <Text style={styles.diffDel}>−{pull.deletions}</Text>
              {reviewText(pull.reviewDecision) ? ` · ${reviewText(pull.reviewDecision)}` : ""}
            </Text>
            <View style={styles.actionsRow}>
              {pull.state === "open" && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void startReview()}
                  style={[styles.button, styles.buttonPrimary]}
                >
                  <Text style={styles.buttonPrimaryText}>Review this PR</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => void Linking.openURL(pull.url)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Open on GitHub</Text>
              </Pressable>
            </View>
            {workspaceStatus && <Text style={styles.muted}>{workspaceStatus}</Text>}
          </>
        )}
      </View>
      {pull && (
        <ScrollView style={styles.body}>
          {pull.body.length > 0 && <Text style={styles.bodyText}>{pull.body}</Text>}
          <Text style={styles.sectionTitle}>
            Checks ({pull.checkRuns.length}) — {checksText(pull.checks)}
          </Text>
          {pull.checkRuns.map((check, i) => (
            <View key={i} style={styles.checkRow}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      check.conclusion === "success"
                        ? theme.colors.accent
                        : check.conclusion === "failure"
                          ? theme.colors.statusDanger
                          : theme.colors.foregroundMuted,
                  },
                ]}
              />
              <Text style={styles.checkName}>{check.name}</Text>
              <Text style={styles.metaText}>{check.conclusion ?? check.status}</Text>
            </View>
          ))}
          <Text style={styles.sectionTitle}>Reviews ({pull.reviews.length})</Text>
          {pull.reviews.map((review, i) => (
            <View key={i} style={styles.reviewRow}>
              <Text style={styles.reviewMeta}>
                {review.author ?? "unknown"} · {review.state.replaceAll("_", " ")}
                {review.submittedAt ? ` · ${formatAge(review.submittedAt)} ago` : ""}
              </Text>
              {review.body.length > 0 && <Text style={styles.reviewBody}>{review.body}</Text>}
            </View>
          ))}
          <Text style={styles.sectionTitle}>Comments ({pull.comments.length})</Text>
          {pull.comments.map((comment, i) => (
            <View key={i} style={styles.reviewRow}>
              <Text style={styles.reviewMeta}>
                {comment.author ?? "unknown"} · {formatAge(comment.createdAt)} ago
              </Text>
              <Text style={styles.reviewBody}>{comment.body}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
