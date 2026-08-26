import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface } from "./main.client";
import {
  actionsCancel,
  actionsGetJobLog,
  actionsGetRun,
  actionsListRuns,
  actionsRerun,
  issuesComment,
  issuesCreate,
  issuesGet,
  issuesList,
  issuesSetState,
  projectSummary,
  repoInfo,
} from "./github.shared";
import {
  cancelWorkflowRun,
  commentOnIssue,
  createIssue,
  getIssue,
  getJobLog,
  getProjectSummary,
  getRepoInfo,
  getWorkflowRun,
  listIssues,
  listWorkflowRuns,
  rerunWorkflowRun,
  setIssueState,
} from "./github.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(repoInfo, getRepoInfo);
  plugin.handle(projectSummary, getProjectSummary);
  plugin.handle(issuesList, listIssues);
  plugin.handle(issuesGet, getIssue);
  plugin.handle(issuesCreate, createIssue);
  plugin.handle(issuesComment, commentOnIssue);
  plugin.handle(issuesSetState, setIssueState);
  plugin.handle(actionsListRuns, listWorkflowRuns);
  plugin.handle(actionsGetRun, getWorkflowRun);
  plugin.handle(actionsGetJobLog, getJobLog);
  plugin.handle(actionsRerun, rerunWorkflowRun);
  plugin.handle(actionsCancel, cancelWorkflowRun);

  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "GitHub",
    icon: "Github",
    surface: "main",
  });
  return () => {};
}
