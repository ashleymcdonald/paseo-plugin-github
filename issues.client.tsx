import { type PluginHostProps, usePaseo, useRpc } from "@getpaseo/plugin";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
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
import type { IssueSummary } from "./github.shared";
import { issuesComment, issuesGet, issuesList, issuesSetState } from "./github.shared";
import { Icon } from "./icons.client";
import { withAlpha } from "./theme.shared";

export interface IssueProject {
  projectId: string;
  name: string;
  rootPath: string;
}

type IssueStyles = Record<string, ViewStyle | TextStyle>;

interface ScopedIssue {
  issue: IssueSummary;
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

function issuePrompt(issue: {
  number: number;
  title: string;
  body?: string;
  labels?: { name: string }[];
  url?: string;
}): string {
  const lines = [
    `Work on GitHub issue #${issue.number}: ${issue.title}`,
    issue.url ? `URL: ${issue.url}` : null,
    issue.labels && issue.labels.length > 0
      ? `Labels: ${issue.labels.map((l) => l.name).join(", ")}`
      : null,
    "",
    issue.body ?? "",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function IssuesTab({
  theme,
  host,
  layout,
  projects,
}: PluginHostProps & { projects: IssueProject[] }) {
  const listIssuesRpc = useRpc(issuesList);
  const [stateFilter, setStateFilter] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScopedIssue | null>(null);

  const styles = useMemo<IssueStyles>(() => {
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
      stateChip: {
        height: 28,
        justifyContent: "center",
        paddingHorizontal: 12,
        borderRadius: 6,
      },
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
      labelChip: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 9999,
      },
      labelText: { fontSize: 11, fontWeight: "500" },
      commentCount: { flexDirection: "row", alignItems: "center", gap: 4 },
      empty: { padding: 24, alignItems: "center" },
      muted: { color: theme.colors.foregroundMuted },
      danger: { color: theme.colors.statusDanger },
    };
  }, [theme, layout.compact]);

  const issueQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: [
        "github.issues.list",
        p.rootPath,
        { state: stateFilter, search: search || undefined },
      ],
      queryFn: () =>
        listIssuesRpc({
          repoDir: p.rootPath,
          state: stateFilter,
          search: search || undefined,
          limit: 50,
        }),
      staleTime: 30_000,
    })),
  });

  const rows: ScopedIssue[] = [];
  let anyPending = false;
  let firstError: string | null = null;
  projects.forEach((p, i) => {
    const query = issueQueries[i];
    if (query?.isPending) anyPending = true;
    const data = query?.data;
    if (data && !data.ok) {
      firstError ??= `${p.name}: ${data.code}`;
      return;
    }
    for (const issue of data?.ok ? data.issues : []) {
      rows.push({ issue, repoDir: p.rootPath, projectName: p.name });
    }
  });
  rows.sort((a, b) => b.issue.updatedAt.localeCompare(a.issue.updatedAt));

  if (selected) {
    return (
      <IssueDetail
        theme={theme}
        host={host}
        layout={layout}
        repoDir={selected.repoDir}
        projectName={selected.projectName}
        number={selected.issue.number}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {(["open", "closed"] as const).map((s) => {
          const active = stateFilter === s;
          return (
            <Pressable
              key={s}
              accessibilityRole="button"
              onPress={() => setStateFilter(s)}
              style={[styles.stateChip, active ? styles.stateChipActive : undefined]}
            >
              <Text style={[styles.stateChipText, active ? styles.stateChipTextActive : undefined]}>
                {s === "open" ? "Open" : "Closed"}
              </Text>
            </Pressable>
          );
        })}
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search issues"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.searchInput}
        />
      </View>
      <ScrollView style={styles.list}>
        {anyPending && rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.muted}>Loading issues…</Text>
          </View>
        )}
        {!anyPending && rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.muted}>
              {firstError ?? `No ${stateFilter} issues.`}
            </Text>
          </View>
        )}
        {rows.map(({ issue, repoDir, projectName }) => (
          <Pressable
            key={`${repoDir}#${issue.number}`}
            accessibilityRole="button"
            accessibilityLabel={`Issue ${issue.number}: ${issue.title}`}
            onPress={() => setSelected({ issue, repoDir, projectName })}
            style={(state) => {
              const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
              return [styles.row, (pressed || hovered) && styles.rowHover];
            }}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {issue.title}
              </Text>
              <View style={styles.rowMeta}>
                <Text style={styles.metaText}>
                  {projects.length > 1 ? `${projectName} ` : ""}#{issue.number}
                  {issue.author ? ` · ${issue.author}` : ""} · {formatAge(issue.updatedAt)}
                </Text>
                {issue.labels.slice(0, 3).map((label) => (
                  <View
                    key={label.name}
                    style={[styles.labelChip, { backgroundColor: withAlpha(`#${label.color}`, 0.18) }]}
                  >
                    <Text style={[styles.labelText, { color: `#${label.color}` }]}>
                      {label.name}
                    </Text>
                  </View>
                ))}
                {issue.labels.length > 3 && (
                  <Text style={styles.metaText}>+{issue.labels.length - 3}</Text>
                )}
              </View>
            </View>
            {issue.commentCount > 0 && (
              <View style={styles.commentCount}>
                <Icon name="comment" size={12} color={theme.colors.foregroundMuted} />
                <Text style={styles.metaText}>{issue.commentCount}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function IssueDetail({
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
  const queryClient = useQueryClient();
  const getIssueRpc = useRpc(issuesGet);
  const commentRpc = useRpc(issuesComment);
  const setStateRpc = useRpc(issuesSetState);
  const [draft, setDraft] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);

  const styles = useMemo<IssueStyles>(() => {
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
      stateBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 9999,
      },
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
      buttonPrimary: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      buttonPrimaryText: { color: theme.colors.accentForeground, fontSize: 13 },
      body: { flex: 1, padding: layout.compact ? 12 : 16, gap: 12 },
      bodyText: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      sectionTitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
      },
      comment: {
        gap: 4,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: border,
      },
      commentMeta: { color: theme.colors.foregroundMuted, fontSize: 12 },
      commentBody: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      composer: {
        flexDirection: "row",
        gap: 8,
        padding: layout.compact ? 12 : 16,
        borderTopWidth: 1,
        borderTopColor: border,
        alignItems: "flex-end",
      },
      composerInput: {
        flex: 1,
        minHeight: 36,
        maxHeight: 120,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: surface1,
        color: theme.colors.foreground,
        fontSize: 13,
      },
      muted: { color: theme.colors.foregroundMuted },
      danger: { color: theme.colors.statusDanger },
    };
  }, [theme, layout.compact]);

  const detailQuery = useQuery({
    queryKey: ["github.issues.get", repoDir, number],
    queryFn: () => getIssueRpc({ repoDir, number }),
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["github.issues.get", repoDir, number] });
    void queryClient.invalidateQueries({ queryKey: ["github.issues.list", repoDir] });
    void queryClient.invalidateQueries({ queryKey: ["github.project.summary", repoDir] });
  };

  const commentMutation = useMutation({
    mutationFn: (body: string) => commentRpc({ repoDir, number, body }),
    onSuccess: (result) => {
      if (result.ok) {
        setDraft("");
        invalidate();
      }
    },
  });

  const stateMutation = useMutation({
    mutationFn: (state: "open" | "closed") => setStateRpc({ repoDir, number, state }),
    onSuccess: (result) => {
      if (result.ok) {
        invalidate();
      }
    },
  });

  const data = detailQuery.data;
  const issue = data?.ok ? data.issue : null;

  const startWorkspace = async () => {
    if (!issue) return;
    setWorkspaceStatus("Creating workspace…");
    try {
      const slug = issue.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const workspace = await paseo.workspaces.create({
        title: `#${issue.number} ${issue.title}`,
        source: {
          kind: "worktree",
          cwd: repoDir,
          action: "branch-off",
          branchName: `issue-${issue.number}-${slug || "work"}`,
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
        title: `#${issue.number} ${issue.title}`,
        prompt: issuePrompt(issue),
        labels: { "github-issue": String(issue.number) },
      });
      setWorkspaceStatus(`Workspace "${workspace.name ?? workspace.id}" ready.`);
    } catch (err) {
      setWorkspaceStatus(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable accessibilityRole="button" onPress={onBack}>
            <Text style={styles.backText}>← {projectName}</Text>
          </Pressable>
          {issue && (
            <View
              style={[
                styles.stateBadge,
                {
                  backgroundColor:
                    issue.state === "open"
                      ? withAlpha(theme.colors.accent, 0.18)
                      : withAlpha(theme.colors.foregroundMuted, 0.18),
                },
              ]}
            >
              <Text
                style={[
                  styles.stateBadgeText,
                  {
                    color:
                      issue.state === "open" ? theme.colors.accent : theme.colors.foregroundMuted,
                  },
                ]}
              >
                {issue.state}
              </Text>
            </View>
          )}
        </View>
        {detailQuery.isPending && <Text style={styles.muted}>Loading issue…</Text>}
        {data && !data.ok && <Text style={styles.danger}>{data.message}</Text>}
        {issue && (
          <>
            <Text style={styles.title}>
              #{issue.number} {issue.title}
            </Text>
            <Text style={styles.metaText}>
              {issue.author ? `${issue.author} · ` : ""}opened {formatAge(issue.createdAt)} ago
              {issue.labels.length > 0 ? ` · ${issue.labels.map((l) => l.name).join(", ")}` : ""}
            </Text>
            <View style={styles.actionsRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void startWorkspace()}
                style={[styles.button, styles.buttonPrimary]}
              >
                <Text style={styles.buttonPrimaryText}>Work on this issue</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  stateMutation.mutate(issue.state === "open" ? "closed" : "open")
                }
                style={styles.button}
              >
                <Text style={styles.buttonText}>
                  {issue.state === "open" ? "Close issue" : "Reopen issue"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void Linking.openURL(issue.url)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Open on GitHub</Text>
              </Pressable>
            </View>
            {workspaceStatus && <Text style={styles.muted}>{workspaceStatus}</Text>}
          </>
        )}
      </View>
      {issue && (
        <>
          <ScrollView style={styles.body}>
            {issue.body.length > 0 && <Text style={styles.bodyText}>{issue.body}</Text>}
            <Text style={styles.sectionTitle}>Comments ({issue.comments.length})</Text>
            {issue.comments.map((comment, i) => (
              <View key={i} style={styles.comment}>
                <Text style={styles.commentMeta}>
                  {comment.author ?? "unknown"} · {formatAge(comment.createdAt)} ago
                </Text>
                <Text style={styles.commentBody}>{comment.body}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a comment"
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              style={styles.composerInput}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const body = draft.trim();
                if (body.length > 0) commentMutation.mutate(body);
              }}
              style={[styles.button, styles.buttonPrimary]}
            >
              <Text style={styles.buttonPrimaryText}>
                {commentMutation.isPending ? "Sending…" : "Comment"}
              </Text>
            </Pressable>
          </View>
          {commentMutation.data && !commentMutation.data.ok && (
            <Text style={styles.danger}>{commentMutation.data.message}</Text>
          )}
          {stateMutation.data && !stateMutation.data.ok && (
            <Text style={styles.danger}>{stateMutation.data.message}</Text>
          )}
        </>
      )}
    </View>
  );
}
