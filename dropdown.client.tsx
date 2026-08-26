import type { PluginHostProps } from "@getpaseo/plugin";
import React, { useMemo, useState } from "react";
import { Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { ProjectEntry } from "./projects.client";
import { withAlpha } from "./theme.shared";

type DropdownStyles = Record<string, ViewStyle | TextStyle>;

export function ProjectFilterDropdown({
  theme,
  layout,
  projects,
  selectedId,
  onSelect,
}: PluginHostProps & {
  projects: ProjectEntry[];
  selectedId: string | null;
  onSelect: (projectId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const styles = useMemo<DropdownStyles>(() => {
    const border = withAlpha(theme.colors.foregroundMuted, 0.35);
    const surface1 = withAlpha(theme.colors.foreground, 0.035);
    const surface2 = withAlpha(theme.colors.foreground, 0.07);
    return {
      button: {
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
      buttonHover: { backgroundColor: surface2 },
      dot: { width: 8, height: 8, borderRadius: 4 },
      buttonText: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" },
      caret: { color: theme.colors.foregroundMuted, fontSize: 10 },
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
    };
  }, [theme, layout.compact]);

  const selected = projects.find((p) => p.projectId === selectedId) ?? null;
  const label = selected ? selected.name : "All projects";

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project filter: ${label}`}
        onPress={() => setOpen((v) => !v)}
        style={(state) => {
          const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
          return [styles.button, (pressed || hovered) && styles.buttonHover];
        }}
      >
        <View
          style={[
            styles.dot,
            { backgroundColor: selected ? theme.colors.accent : theme.colors.foregroundMuted },
          ]}
        />
        <Text style={styles.buttonText}>{label}</Text>
        <Text style={styles.caret}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open && (
        <View style={styles.menu}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onSelect(null);
              setOpen(false);
            }}
            style={(state) => {
              const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
              return [styles.menuItem, (pressed || hovered) && styles.menuItemHover];
            }}
          >
            <View style={[styles.dot, { backgroundColor: theme.colors.foregroundMuted }]} />
            <Text style={styles.menuItemText}>All projects</Text>
            {!selected && <Text style={styles.check}>✓</Text>}
          </Pressable>
          {projects.map((p) => {
            const isSelected = selected?.projectId === p.projectId;
            return (
              <Pressable
                key={p.projectId}
                accessibilityRole="button"
                onPress={() => {
                  onSelect(p.projectId);
                  setOpen(false);
                }}
                style={(state) => {
                  const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                  return [styles.menuItem, (pressed || hovered) && styles.menuItemHover];
                }}
              >
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: isSelected
                        ? theme.colors.accent
                        : theme.colors.foregroundMuted,
                    },
                  ]}
                />
                <Text style={styles.menuItemText}>{p.name}</Text>
                {isSelected ? (
                  <Text style={styles.check}>✓</Text>
                ) : (
                  <Text style={styles.menuItemDetail}>{p.workspaceCount} ws</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
