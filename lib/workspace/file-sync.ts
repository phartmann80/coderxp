/**
 * WebContainer -> IndexedDB filesystem sync for CoderXP M3.4.
 *
 * Additive persistence of project source files from the shared
 * WebContainer into IndexedDB:
 *
 *   container -> IndexedDB additions YES
 *   container -> IndexedDB updates YES
 *   missing container file -> IndexedDB deletion NO
 *
 * Generated/runtime directories are ignored (node_modules, .next, dist,
 * .git, etc.). Only project source files that belong in persistence.
 *
 * Uses existing persistence helpers (putEntry / listProjectEntries).
 * Uses the shared WebContainer singleton from runtime-client.
 * Does not boot a second container.
 */

import type { WebContainer } from "@webcontainer/api";
import { getBootedWebContainer } from "./runtime-client";
import { getRuntime } from "./runtime";
import { WORKSPACE_PROJECT_ROOT } from "./constants";
import { listProjectEntries, putEntry } from "./persistence";
import { normalizeAndValidateWorkspacePath } from "./path-utils";

/** Directory names excluded from persistence (generated/runtime/VCS). */
export const FILE_SYNC_IGNORE_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".next",
  "dist",
  ".git",
  ".turbo",
  ".cache",
  ".vite",
  "coverage",
  "out",
  "build",
  ".vercel",
]);

/** A source file read from the WebContainer project tree. */
export interface ContainerSourceFile {
  /** Path relative to the project root. */
  path: string;
  /** UTF-8 file contents. */
  contents: string;
}

/** Result of a container -> IndexedDB sync pass. */
export interface FileSyncResult {
  /** New files written to IndexedDB. */
  added: number;
  /** Existing files whose contents changed. */
  updated: number;
  /** Existing files whose contents matched. */
  unchanged: number;
}

interface DirEntLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

function isIgnoredDir(name: string): boolean {
  return FILE_SYNC_IGNORE_DIRS.has(name);
}

/**
 * Recursively list source files under /project in the shared container.
 * Returns an empty list when the runtime has no mounted project or the
 * singleton is not booted.
 */
export async function listContainerSourceFiles(): Promise<ContainerSourceFile[]> {
  if (!getRuntime().isMounted()) {
    return [];
  }

  const container = getBootedWebContainer();
  if (!container) {
    return [];
  }

  const out: ContainerSourceFile[] = [];
  await walkDir(container, WORKSPACE_PROJECT_ROOT, "", out);
  return out;
}

async function walkDir(
  container: WebContainer,
  absDir: string,
  relDir: string,
  out: ContainerSourceFile[],
): Promise<void> {
  let entries: unknown;
  try {
    entries = await container.fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  if (!Array.isArray(entries)) {
    return;
  }

  for (const entry of entries) {
    const name = direntName(entry);
    if (!name || name === "." || name === "..") continue;
    if (isIgnoredDir(name)) continue;

    const relPath = relDir ? `${relDir}/${name}` : name;
    const absPath = `${absDir}/${name}`;

    if (direntIsDirectory(entry)) {
      await walkDir(container, absPath, relPath, out);
      continue;
    }

    try {
      const contents = await container.fs.readFile(absPath, "utf-8");
      if (typeof contents !== "string") continue;
      if (contents.includes("\0")) continue;
      out.push({ path: relPath, contents });
    } catch {
      // Unreadable or non-text file — skip.
    }
  }
}

function direntName(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && "name" in entry) {
    const name = (entry as DirEntLike).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

function direntIsDirectory(entry: unknown): boolean {
  if (entry && typeof entry === "object" && typeof (entry as DirEntLike).isDirectory === "function") {
    try {
      return (entry as DirEntLike).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Sync source files from the shared WebContainer into IndexedDB.
 *
 * Additions and content updates are written via putEntry.
 * Files present in IndexedDB but missing from the container are left
 * untouched (no deletion).
 */
export async function syncContainerToIndexedDB(projectId: string): Promise<FileSyncResult> {
  const containerFiles = await listContainerSourceFiles();
  const existing = await listProjectEntries(projectId);
  const existingFiles = new Map(
    existing.filter((e) => e.kind === "file").map((e) => [e.path, e.contents ?? ""]),
  );

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const file of containerFiles) {
    let normalised: string;
    try {
      normalised = normalizeAndValidateWorkspacePath(file.path);
    } catch {
      continue;
    }

    const previous = existingFiles.get(normalised);
    if (previous === undefined) {
      try {
        await putEntry(projectId, normalised, "file", file.contents);
        added += 1;
      } catch {
        // Skip entries the persistence layer rejects.
      }
      continue;
    }

    if (previous === file.contents) {
      unchanged += 1;
      continue;
    }

    try {
      await putEntry(projectId, normalised, "file", file.contents);
      updated += 1;
    } catch {
      // Skip entries the persistence layer rejects.
    }
  }

  return { added, updated, unchanged };
}

/**
 * True when the active project is present in the shared WebContainer.
 * Preview/runtime may be idle; mounted state is what matters for sync.
 */
export function isProjectPresentInContainer(): boolean {
  return getRuntime().isMounted() && getBootedWebContainer() !== null;
}
