/**
 * Workspace type definitions for CoderXP M2 Workspace Alpha.
 *
 * These types define the core domain model for the workspace:
 * projects, files, templates, and runtime state.
 *
 * Commit 1 scope: type definitions only. No persistence, runtime,
 * or template implementation.
 */

/** Supported project templates. */
export type ProjectTemplate = "react-ts" | "nextjs-ts" | "static-html";

/** A single file entry stored in IndexedDB. */
export interface WorkspaceFile {
  /** Project UUID this file belongs to. */
  projectId: string;
  /** Normalized path relative to project root, e.g. "src/App.tsx". */
  path: string;
  /** File contents (UTF-8 text). */
  content: string;
  /** Unix timestamp (ms) of last modification. */
  lastModified: number;
}

/** Project metadata stored in the IndexedDB "projects" store. */
export interface WorkspaceProject {
  /** Unique project identifier (UUID). */
  id: string;
  /** Human-readable project name. */
  name: string;
  /** Template this project was created from. */
  template: ProjectTemplate;
  /** Currently active file path, or null if none. */
  activeFile: string | null;
  /** List of open tab file paths. */
  openTabs: string[];
  /** Unix timestamp (ms) of creation. */
  createdAt: number;
  /** Unix timestamp (ms) of last modification. */
  lastModified: number;
}

/** Workspace-level preferences stored in the "preferences" store. */
export interface WorkspacePreferences {
  /** Currently active project UUID, or null. */
  activeProjectId: string | null;
}

/** Process labels for terminal output streams. */
export type ProcessLabel =
  | "system"
  | "install"
  | "dev-server"
  | "build"
  | "preview"
  | "exit"
  | "error";

/** A single output line from a runtime process. */
export interface ProcessOutputEntry {
  /** Process that produced this output. */
  label: ProcessLabel;
  /** Output text (combined stdout/stderr, not labeled separately). */
  text: string;
  /** Unix timestamp (ms). */
  timestamp: number;
}

/** Runtime status of the workspace. */
export type RuntimeStatus =
  | "idle"
  | "booting"
  | "installing"
  | "running"
  | "building"
  | "error";
