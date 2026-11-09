import type { BoardService } from "../boards/boards.js";
import type { BrainService } from "../brain/brain.js";
import type { ProjectService } from "../projects/projects.js";
import type { WorkflowService } from "../workflows/service.js";

/** Composition bag for Board, Project, Brain, and workflow reverse refs on Session. */
export type ControlPlane = {
  boards?: BoardService;
  projects?: ProjectService;
  brain?: BrainService;
  workflows?: WorkflowService;
  onSlackApproval?: (sessionId: string, toolName: string, callId: string) => void;
};
