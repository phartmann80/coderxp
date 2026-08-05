/**
 * Workspace type definitions for CoderXP M2 Workspace Alpha.
 *
 * These types define the core domain model for the workspace:
 * projects, files, templates, and runtime state.
 *
 * Commit 1 scope: type definitions only. No persistence, runtime,
 * or template implementation.
 */

/** Supported project template identifiers. */
export type ProjectTemplateId =
  | "react-ts"
  | "nextjs-ts"
  | "static-html";

/** Whether a stored entry is a file or a directory. */
export type WorkspaceEntryKind = "file" | "directory";

/** A single file or directory entry stored in IndexedDB. */
export interface WorkspaceFileRecord {
  /** Project UUID this entry belongs to. */
  projectId: string;
  /** Normalized path relative to project root, e.g. "src/App.tsx". */
  path: string;
  /** Whether this entry is a file or a directory. */
  kind: WorkspaceEntryKind;
  /** File contents (UTF-8 text). Directories must not have contents. */
  contents?: string;
  /** Unix timestamp (ms) of creation. */
  createdAt: number;
  /** Unix timestamp (ms) of last modification. */
  updatedAt: number;
}

/** Project metadata stored in the IndexedDB "projects" store. */
export interface WorkspaceProject {
  /** Unique project identifier (UUID). */
  id: string;
  /** Human-readable project name. */
  name: string;
  /** Template this project was created from. */
  templateId: ProjectTemplateId;
  /** Currently active file path, or null if none. */
  activeFile: string | null;
  /** List of open tab file paths. */
  openTabs: string[];
  /** Unix timestamp (ms) of creation. */
  createdAt: number;
  /** Unix timestamp (ms) of last modification. */
  updatedAt: number;
  /** Monotonically increasing revision number for optimistic concurrency. */
  revision: number;
}

/** Workspace-level preference stored in the "preferences" store. */
export interface WorkspacePreferenceRecord {
  /** Preference key, e.g. "activeProjectId", "theme". */
  key: string;
  /** Preference value (type varies per key). */
  value: unknown;
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
  | "starting"
  | "installing"
  | "running"
  | "stopped"
  | "failed";
