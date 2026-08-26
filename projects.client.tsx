import { usePaseo } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";

export interface ProjectEntry {
  projectId: string;
  name: string;
  rootPath: string;
  workspaceCount: number;
}

export function usePaseoProjects() {
  const paseo = usePaseo();
  return useQuery({
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
}
