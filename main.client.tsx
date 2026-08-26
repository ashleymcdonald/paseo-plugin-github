import { type PluginSurfaceProps, usePaseo, useRpc } from "@getpaseo/plugin";
import { useQueries, useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { projectSummary } from "./github.shared";
import { ActionsTab } from "./actions.client";
import { Icon } from "./icons.client";
import { IssuesTab } from "./issues.client";
import { PullsTab } from "./pulls.client";
import { withAlpha } from "./theme.shared";

interface ProjectEntry {
  projectId: string;
  name: string;
  rootPath: string;
  workspaceCount: number;
}

type SurfaceStyles = Record<string, ViewStyle | TextStyle>;

const TABS = [
  { id: "Overview", icon: "overview" },
  { id: "Issues", icon: "issues" },
  { id: "Board", icon: "board" },
  { id: "Pull Requests", icon: "pulls" },
  { id: "Actions", icon: "actions" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function summaryDetail(code: string): string {
  switch (code) {
    case "gh_missing":
      return "gh not installed";
    case "auth_required":
      return "gh auth required";
    case "not_a_repo":
      return "no GitHub remote";
    case "rate_limited":
      return "rate limited";
    default:
      return "error";
  }
}

export function MainSurface({ theme, host, layout }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const getSummary = useRpc(projectSummary);
  const [filter, setFilter] = useState<string | null>(null); // projectId, null = all
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");

  const styles = useMemo<SurfaceStyles>(
    () => {
      const border = withAlpha(theme.colors.foregroundMuted, 0.35);
      const surface1 = withAlpha(theme.colors.foreground, 0.035);
      const surface2 = withAlpha(theme.colors.foreground, 0.07);
      return {
        screen: { flex: 1, backgroundColor: theme.colors.surface0 },
        // workspace-desktop-tabs-row.tsx: 36px strip, surface0, 1px bottom border
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
        // host-filter.tsx: gap 6, 6v/12h padding, radius 6, surface1 bg, 1px border
        dropdownButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          height: 28,
          paddingHorizontal: 12,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: surface1,
        },
        dot: { width: 8, height: 8, borderRadius: 4 },
        dropdownButtonText: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" },
        dropdownCaret: { color: theme.colors.foregroundMuted, fontSize: 10 },
        // combobox.tsx: surface0, radius 8, 1px border, no dividers,
        // items minHeight 36, 12h/8v padding, gap 8, check 16px muted
        menu: {
          position: "absolute",
          top: "100%",
          left: 0,
          marginTop: 5,
          minWidth: 220,
          maxWidth: 400,
          maxHeight: 400,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: theme.colors.surface0,
          paddingVertical: 4,
          zIndex: 20,
        },
        menuItem: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 36,
          paddingVertical: 8,
          paddingHorizontal: 12,
        },
        menuItemHover: { backgroundColor: surface1 },
        menuItemText: { color: theme.colors.foreground, fontSize: 14, flex: 1 },
        menuItemDetail: { color: theme.colors.foregroundMuted, fontSize: 12 },
        check: { color: theme.colors.foregroundMuted, fontSize: 14 },
        // tabs: 28px chips, 8h padding, radius 6, gap 4,
        // active = surface2 fill (no border), muted → foreground label
        tabBar: { flexDirection: "row", gap: 4, flexShrink: 1 },
        tab: {
          height: 28,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 8,
          borderRadius: 6,
        },
        tabActive: { backgroundColor: surface2 },
        tabText: { color: theme.colors.foregroundMuted, fontSize: 14 },
        tabTextActive: { color: theme.colors.foreground },
        body: {
          flex: 1,
          padding: layout.compact ? 12 : 16,
          gap: layout.compact ? 10 : 16,
        },
        totalsRow: { flexDirection: "row", gap: layout.compact ? 8 : 12, flexWrap: "wrap" },
        // settings.ts card pattern: surface1, radius 8, 1px border
        totalCard: {
          gap: 2,
          paddingVertical: layout.compact ? 10 : 14,
          paddingHorizontal: layout.compact ? 14 : 20,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: surface1,
          minWidth: layout.compact ? 100 : 140,
        },
        totalValue: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 26, fontWeight: "600" },
        totalLabel: { color: theme.colors.foregroundMuted, fontSize: 12 },
        // tool-call-details.tsx: header 12px/600/uppercase/ls0.5 muted, 12h/8v, 1px border
        tableHeader: {
          flexDirection: "row",
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: border,
        },
        tableHeaderText: {
          color: theme.colors.foregroundMuted,
          fontSize: 12,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        // agent-list.tsx rows: 8v/12h padding, hover surface1, 1px dividers
        tableRow: {
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: border,
        },
        tableRowHover: { backgroundColor: surface1 },
        cellName: { flex: 3, color: theme.colors.foreground, fontSize: 14 },
        cellNum: { flex: 1, color: theme.colors.foreground, fontSize: 14, textAlign: "right" },
        cellNumMuted: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 14, textAlign: "right" },
        cellDetail: { color: theme.colors.foregroundMuted, fontSize: 12 },
        muted: { color: theme.colors.foregroundMuted },
        danger: { color: theme.colors.statusDanger },
        placeholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
      };
    },
    [theme, layout.compact],
  );

  const projectsQuery = useQuery({
    queryKey: ["github-plugin.projects"],
    queryFn: async (): Promise<ProjectEntry[]> => {
      const result = await paseo.workspaces.list();
      const byProject = new Map<string, ProjectEntry>();
      for (const ws of result.entries) {
        const existing = byProject.get(ws.projectId);
        if (existing) {
          existing.workspaceCount += 1;
        } else {
          byProject.set(ws.projectId, {
            projectId: ws.projectId,
            name: ws.projectCustomName ?? ws.projectDisplayName,
            rootPath: ws.projectRootPath,
            workspaceCount: 1,
          });
        }
      }
      return [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 60_000,
  });

  const projects = projectsQuery.data ?? [];
  const selectedProject = projects.find((p) => p.projectId === filter) ?? null;
  const scopedProjects = selectedProject ? [selectedProject] : projects;

  const summaryResults = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["github.project.summary", p.rootPath],
      queryFn: () => getSummary({ repoDir: p.rootPath }),
      staleTime: 2 * 60_000,
      refetchInterval: 5 * 60_000,
    })),
  });
  const summaryByRoot = new Map(
    projects.map((p, i) => [p.rootPath, summaryResults[i]] as const),
  );

  const totals = { issues: 0, prs: 0, runs: 0, loaded: 0 };
  for (const p of scopedProjects) {
    const data = summaryByRoot.get(p.rootPath)?.data;
    if (data?.ok) {
      totals.issues += data.summary.openIssues;
      totals.prs += data.summary.openPrs;
      totals.runs += data.summary.recentRuns;
      totals.loaded += 1;
    }
  }

  const filterLabel = selectedProject ? selectedProject.name : "All projects";

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Project filter: ${filterLabel}`}
            onPress={() => setMenuOpen((v) => !v)}
            style={(state) => { const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean }; return [
              styles.dropdownButton,
              (pressed || hovered) && { backgroundColor: withAlpha(theme.colors.foreground, 0.07) },
            ]; }}
          >
            <View
              style={[
                styles.dot,
                { backgroundColor: selectedProject ? theme.colors.accent : theme.colors.foregroundMuted },
              ]}
            />
            <Text style={styles.dropdownButtonText}>{filterLabel}</Text>
            <Text style={styles.dropdownCaret}>{menuOpen ? "▴" : "▾"}</Text>
          </Pressable>
          {menuOpen && (
            <View style={styles.menu}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setFilter(null);
                  setMenuOpen(false);
                }}
                style={(state) => { const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean }; return [
                  styles.menuItem,
                  (pressed || hovered) && styles.menuItemHover,
                ]; }}
              >
                <View style={[styles.dot, { backgroundColor: theme.colors.foregroundMuted }]} />
                <Text style={styles.menuItemText}>All projects</Text>
                {!selectedProject && <Text style={styles.check}>✓</Text>}
              </Pressable>
              {projects.map((p) => (
                <Pressable
                  key={p.projectId}
                  accessibilityRole="button"
                  onPress={() => {
                    setFilter(p.projectId);
                    setMenuOpen(false);
                  }}
                  style={(state) => { const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean }; return [
                    styles.menuItem,
                    (pressed || hovered) && styles.menuItemHover,
                  ]; }}
                >
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          selectedProject?.projectId === p.projectId
                            ? theme.colors.accent
                            : theme.colors.foregroundMuted,
                      },
                    ]}
                  />
                  <Text style={styles.menuItemText}>{p.name}</Text>
                  {selectedProject?.projectId === p.projectId ? (
                    <Text style={styles.check}>✓</Text>
                  ) : (
                    <Text style={styles.menuItemDetail}>{p.workspaceCount} ws</Text>
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </View>
        <View style={styles.tabBar}>
          {TABS.map((t) => {
            const active = tab === t.id;
            const contentColor = active
              ? theme.colors.foreground
              : theme.colors.foregroundMuted;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityLabel={`${t.id} tab`}
                onPress={() => setTab(t.id)}
                style={(state) => {
                  const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                  return [
                    styles.tab,
                    active
                      ? styles.tabActive
                      : (pressed || hovered) && { backgroundColor: withAlpha(theme.colors.foreground, 0.035) },
                  ];
                }}
              >
                <Icon name={t.icon} size={14} color={contentColor} />
                <Text style={[styles.tabText, active ? styles.tabTextActive : undefined]}>
                  {t.id}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tab === "Overview" ? (
        <ScrollView style={styles.body}>
          <View style={styles.totalsRow}>
            <View style={styles.totalCard}>
              <Text style={styles.totalValue}>{totals.issues}</Text>
              <Text style={styles.totalLabel}>Open issues</Text>
            </View>
            <View style={styles.totalCard}>
              <Text style={styles.totalValue}>{totals.prs}</Text>
              <Text style={styles.totalLabel}>Open PRs</Text>
            </View>
            <View style={styles.totalCard}>
              <Text style={styles.totalValue}>{totals.runs}</Text>
              <Text style={styles.totalLabel}>Runs (7d)</Text>
            </View>
            <View style={styles.totalCard}>
              <Text style={styles.totalValue}>{scopedProjects.length}</Text>
              <Text style={styles.totalLabel}>Projects</Text>
            </View>
          </View>

          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, { flex: 3 }]}>Project</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>Issues</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>PRs</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>Runs</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>Ws</Text>
          </View>
          {projectsQuery.isPending && <Text style={styles.muted}>Loading projects…</Text>}
          {projectsQuery.isError && (
            <Text style={styles.danger}>Failed to list workspaces from this host.</Text>
          )}
          {scopedProjects.map((p) => {
            const query = summaryByRoot.get(p.rootPath);
            const data = query?.data;
            return (
              <Pressable
                key={p.projectId}
                accessibilityRole="button"
                accessibilityLabel={`Filter to ${p.name}`}
                onPress={() => setFilter(p.projectId)}
                style={(state) => { const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean }; return [
                  styles.tableRow,
                  (pressed || hovered) && styles.tableRowHover,
                ]; }}
              >
                <Text style={styles.cellName}>{p.name}</Text>
                {query?.isPending || !data ? (
                  <>
                    <Text style={styles.cellNumMuted}>…</Text>
                    <Text style={styles.cellNumMuted}>…</Text>
                    <Text style={styles.cellNumMuted}>…</Text>
                  </>
                ) : data.ok ? (
                  <>
                    <Text style={styles.cellNum}>{data.summary.openIssues}</Text>
                    <Text style={styles.cellNum}>{data.summary.openPrs}</Text>
                    <Text style={styles.cellNum}>{data.summary.recentRuns}</Text>
                  </>
                ) : (
                  <Text style={[styles.cellDetail, { flex: 3, textAlign: "right" }]}>
                    {summaryDetail(data.code)}
                  </Text>
                )}
                <Text style={styles.cellNumMuted}>{p.workspaceCount}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : tab === "Issues" ? (
        <IssuesTab
          theme={theme}
          host={host}
          layout={layout}
          projects={scopedProjects.map((p) => ({
            projectId: p.projectId,
            name: p.name,
            rootPath: p.rootPath,
          }))}
        />
      ) : tab === "Actions" ? (
        <ActionsTab
          theme={theme}
          host={host}
          layout={layout}
          projects={scopedProjects.map((p) => ({
            projectId: p.projectId,
            name: p.name,
            rootPath: p.rootPath,
          }))}
        />
      ) : tab === "Pull Requests" ? (
        <PullsTab
          theme={theme}
          host={host}
          layout={layout}
          projects={scopedProjects.map((p) => ({
            projectId: p.projectId,
            name: p.name,
            rootPath: p.rootPath,
          }))}
        />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.muted}>
            {tab} · {filterLabel}
            {selectedProject ? ` (${selectedProject.rootPath})` : " (aggregated across repos)"}{" "}
            — arrives in a later phase
          </Text>
        </View>
      )}
    </View>
  );
}
