import { type PluginSurfaceProps, usePaseo, useRpc } from "@getpaseo/plugin";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { BoardColumn, IssueSummary } from "./github.shared";
import { boardGet, boardMove } from "./github.shared";
import { ProjectFilterDropdown } from "./dropdown.client";
import { usePaseoProjects } from "./projects.client";
import { withAlpha } from "./theme.shared";

type BoardStyles = Record<string, ViewStyle | TextStyle>;

const STATUS_PREFIX = "status:";

interface BoardIssue extends IssueSummary {
  repoDir: string;
  projectName: string;
  projectId: string;
}

function statusLabelOf(issue: IssueSummary): string | null {
  const label = issue.labels.find((l) => l.name.toLowerCase().startsWith(STATUS_PREFIX));
  return label ? label.name : null;
}

function formatAge(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / (86400 * 30))}mo`;
}

interface Column {
  title: string;
  issues: BoardIssue[];
}

export function BoardSurface({ theme, host, layout }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  const getBoardRpc = useRpc(boardGet);
  const moveRpc = useRpc(boardMove);
  const [filter, setFilter] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null); // `${repoDir}#${number}`

  const styles = useMemo<BoardStyles>(() => {
    const border = withAlpha(theme.colors.foregroundMuted, 0.35);
    const surface1 = withAlpha(theme.colors.foreground, 0.035);
    const surface2 = withAlpha(theme.colors.foreground, 0.07);
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      topBar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: layout.compact ? 8 : 12,
        height: 36,
        borderBottomWidth: 1,
        borderBottomColor: border,
        zIndex: 10,
      },
      board: { flex: 1, padding: layout.compact ? 8 : 12 },
      column: {
        width: layout.compact ? 240 : 280,
        maxHeight: "100%",
        marginRight: layout.compact ? 8 : 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: surface1,
      },
      columnHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: border,
      },
      columnTitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
      },
      columnCount: { color: theme.colors.foregroundMuted, fontSize: 12 },
      cards: { padding: 8, gap: 8 },
      card: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: theme.colors.surface0,
        padding: 10,
        gap: 6,
      },
      cardHover: { backgroundColor: surface2 },
      cardTitle: { color: theme.colors.foreground, fontSize: 13 },
      cardMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
      metaText: { color: theme.colors.foregroundMuted, fontSize: 11 },
      labelChip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 9999 },
      labelText: { fontSize: 10, fontWeight: "500" },
      agentChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 9999,
        backgroundColor: withAlpha(theme.colors.accent, 0.15),
      },
      agentText: { color: theme.colors.accent, fontSize: 10, fontWeight: "500" },
      moveMenu: {
        marginTop: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: theme.colors.surface0,
        paddingVertical: 4,
        zIndex: 30,
      },
      moveItem: { paddingVertical: 6, paddingHorizontal: 10 },
      moveItemHover: { backgroundColor: surface1 },
      moveItemText: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted },
      danger: { color: theme.colors.statusDanger },
      empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    };
  }, [theme, layout.compact]);

  const projectsQuery = usePaseoProjects();
  const projects = projectsQuery.data ?? [];
  const selectedProject = projects.find((p) => p.projectId === filter) ?? null;
  const scopedProjects = selectedProject ? [selectedProject] : projects;

  const boardQueries = useQueries({
    queries: scopedProjects.map((p) => ({
      queryKey: ["github.board.get", p.rootPath],
      queryFn: () => getBoardRpc({ repoDir: p.rootPath, limit: 200 }),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });

  // Merge columns across repos by title; "No status" always first.
  const columnOrder: string[] = [];
  const issuesByColumn = new Map<string, BoardIssue[]>();
  // repoDir -> column title -> backing status label (null for "No status").
  const labelByRepoTitle = new Map<string, Map<string, string | null>>();
  let anyPending = false;
  let firstError: string | null = null;
  scopedProjects.forEach((p, i) => {
    const query = boardQueries[i];
    if (query?.isPending) anyPending = true;
    const data = query?.data;
    if (!data) return;
    if (!data.ok) {
      firstError ??= `${p.name}: ${data.code}`;
      return;
    }
    const labelByTitle = new Map<string, string | null>();
    for (const column of data.columns) {
      labelByTitle.set(column.title, column.label);
    }
    labelByRepoTitle.set(p.rootPath, labelByTitle);
    const titleOf = (label: string | null): string =>
      label === null
        ? "No status"
        : (data.columns.find((c) => c.label === label)?.title ?? label);
    for (const issue of data.issues) {
      const title = titleOf(statusLabelOf(issue));
      if (!issuesByColumn.has(title)) {
        issuesByColumn.set(title, []);
        columnOrder.push(title);
      }
      issuesByColumn.get(title)?.push({
        ...issue,
        repoDir: p.rootPath,
        projectName: p.name,
        projectId: p.projectId,
      });
    }
  });
  if (columnOrder.length > 0 && !columnOrder.includes("No status")) {
    // Keep the inbox reachable even when empty, so cards can be moved back.
    columnOrder.unshift("No status");
    issuesByColumn.set("No status", []);
  }
  columnOrder.sort((a, b) =>
    a === "No status" ? -1 : b === "No status" ? 1 : a.localeCompare(b),
  );
  const columns: Column[] = columnOrder.map((title) => ({
    title,
    issues: issuesByColumn.get(title) ?? [],
  }));

  // Agent ↔ issue correlation: the Issues tab labels agents it spawns with
  // github-issue. Map agent.workspaceId → projectId via the workspace list.
  const workspacesQuery = useQuery({
    queryKey: ["github-plugin.workspaces-raw"],
    queryFn: () => paseo.workspaces.list(),
    staleTime: 60_000,
  });
  const agentsQuery = useQuery({
    queryKey: ["github-plugin.agents"],
    queryFn: () => paseo.agents.list(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const agentByIssue = new Map<string, string>(); // `${projectId}#${n}` -> status
  if (workspacesQuery.data && agentsQuery.data) {
    const projectByWorkspace = new Map<string, string>();
    for (const ws of workspacesQuery.data.entries) {
      projectByWorkspace.set(ws.id, ws.projectId);
    }
    for (const agent of agentsQuery.data.entries) {
      const issueNumber = agent.labels?.["github-issue"];
      const projectId = projectByWorkspace.get(agent.workspaceId);
      if (issueNumber && projectId) {
        agentByIssue.set(`${projectId}#${issueNumber}`, agent.status);
      }
    }
  }

  const moveMutation = useMutation({
    mutationFn: (input: {
      repoDir: string;
      number: number;
      addLabel: string | null;
      removeLabel: string | null;
    }) => moveRpc(input),
    onSuccess: (result, input) => {
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: ["github.board.get", input.repoDir] });
        void queryClient.invalidateQueries({ queryKey: ["github.issues.list", input.repoDir] });
      }
    },
  });

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <ProjectFilterDropdown
          theme={theme}
          host={host}
          layout={layout}
          projects={projects}
          selectedId={selectedProject?.projectId ?? null}
          onSelect={setFilter}
        />
      </View>
      {anyPending && columns.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.muted}>Loading board…</Text>
        </View>
      ) : columns.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.muted}>
            {firstError ?? "No open issues with status labels in scope."}
          </Text>
        </View>
      ) : (
        <ScrollView horizontal style={styles.board}>
          {columns.map((column) => (
            <View key={column.title} style={styles.column}>
              <View style={styles.columnHeader}>
                <Text style={styles.columnTitle}>{column.title}</Text>
                <Text style={styles.columnCount}>{column.issues.length}</Text>
              </View>
              <ScrollView style={styles.cards} nestedScrollEnabled>
                {column.issues.map((issue) => {
                  const key = `${issue.repoDir}#${issue.number}`;
                  const menuOpen = menuFor === key;
                  const agentStatus = agentByIssue.get(`${issue.projectId}#${issue.number}`);
                  return (
                    <View key={key}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move issue ${issue.number}: ${issue.title}`}
                        onPress={() => setMenuFor(menuOpen ? null : key)}
                        style={(state) => {
                          const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                          return [styles.card, (pressed || hovered) && styles.cardHover];
                        }}
                      >
                        <Text style={styles.cardTitle} numberOfLines={2}>
                          {issue.title}
                        </Text>
                        <View style={styles.cardMeta}>
                          <Text style={styles.metaText}>
                            {scopedProjects.length > 1 ? `${issue.projectName} ` : ""}#{issue.number} ·{" "}
                            {formatAge(issue.updatedAt)}
                          </Text>
                          {issue.labels
                            .filter((l) => !l.name.toLowerCase().startsWith(STATUS_PREFIX))
                            .slice(0, 2)
                            .map((label) => (
                              <View
                                key={label.name}
                                style={[styles.labelChip, { backgroundColor: withAlpha(`#${label.color}`, 0.18) }]}
                              >
                                <Text style={[styles.labelText, { color: `#${label.color}` }]}>
                                  {label.name}
                                </Text>
                              </View>
                            ))}
                          {agentStatus && (
                            <View style={styles.agentChip}>
                              <Text style={styles.agentText}>agent · {agentStatus}</Text>
                            </View>
                          )}
                        </View>
                      </Pressable>
                      {menuOpen && (
                        <View style={styles.moveMenu}>
                          {columnOrder
                            .filter((title) => title !== column.title)
                            .map((title) => (
                              <Pressable
                                key={title}
                                accessibilityRole="button"
                                onPress={() => {
                                  setMenuFor(null);
                                  const mapped = labelByRepoTitle.get(issue.repoDir)?.get(title);
                                  const addLabel =
                                    mapped !== undefined ? mapped : `${STATUS_PREFIX} ${title}`;
                                  moveMutation.mutate({
                                    repoDir: issue.repoDir,
                                    number: issue.number,
                                    addLabel,
                                    removeLabel: statusLabelOf(issue),
                                  });
                                }}
                                style={(state) => {
                                  const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                                  return [styles.moveItem, (pressed || hovered) && styles.moveItemHover];
                                }}
                              >
                                <Text style={styles.moveItemText}>Move to {title}</Text>
                              </Pressable>
                            ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
