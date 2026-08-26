import type { PluginContext } from "@getpaseo/plugin";
import { BoardSurface } from "./board.client";
import { MainSurface } from "./main.client";
import {
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
import {
  cancelWorkflowRun,
  commentOnIssue,
  createIssue,
  getBoard,
  getIssue,
  getJobLog,
  getProjectSummary,
  getPull,
  getRepoInfo,
  getWorkflowRun,
  listIssues,
  listPulls,
  listWorkflowRuns,
  moveBoardCard,
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
  plugin.handle(pullsList, listPulls);
  plugin.handle(pullsGet, getPull);
  plugin.handle(boardGet, getBoard);
  plugin.handle(boardMove, moveBoardCard);

  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "GitHub",
    icon: "Github",
    surface: "main",
  });
  plugin.addSurface("board", BoardSurface);
  plugin.addSidebarItem({
    id: "board",
    title: "Board",
    icon: "SquareKanban",
    surface: "board",
  });
  return () => {};
}
