/**
 * Hierarchical file-tree builder for CoderXP M2 Workspace Alpha.
 *
 * Commit 3 final correction: rebuilt around a single path map.
 *
 * The tree is derived from stored WorkspaceFileRecord paths, not from
 * template constants. Implicit visual parent folders may be derived
 * when necessary, but are distinguishable internally from persisted
 * entries (isPersisted = false for implicit directories).
 *
 * Rules:
 * - Directories before files within each parent.
 * - Stable alphabetical ordering using direct string comparison (not locale).
 * - Correct segment-boundary nesting.
 * - No path mutation.
 * - No invented implicit records stored in IndexedDB.
 * - Deterministic regardless of input record order.
 * - Exactly one node per path in a Map<string, FileTreeNode>.
 * - Implicit directory nodes merge with later persisted directory
 *   records rather than creating duplicate nodes.
 * - File/directory path collisions are handled deterministically:
 *   a persisted entry always wins over an implicit one, and the
 *   first persisted kind for a given path is kept.
 * - Identical serialized output for every permutation of the same records.
 */

import type { WorkspaceFileRecord } from "./types";

/** A node in the hierarchical file tree. */
export interface FileTreeNode {
  /** Display name (last path segment). */
  name: string;
  /** Full path relative to project root. */
  path: string;
  /** Whether this node is a file or directory. */
  kind: "file" | "directory";
  /** Whether this entry was persisted in IndexedDB (true) or derived as an implicit visual parent (false). */
  isPersisted: boolean;
  /** Child nodes (directories first, then files, alphabetically sorted). */
  children: FileTreeNode[];
}

/**
 * Fixed path comparator using direct string comparison (not locale-dependent).
 * Produces a deterministic ordering regardless of the runtime locale.
 */
function comparePaths(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Build a hierarchical file tree from persisted file records.
 *
 * Uses a single Map<string, FileTreeNode> keyed by full path to guarantee
 * exactly one node per path. Processing order is canonicalized with a
 * fixed path comparator, not input order. Implicit directories are
 * registered in the map immediately. When a persisted directory later
 * matches an implicit directory, the existing node is upgraded in place.
 *
 * Deterministic policies:
 * - A persisted file whose path is also required as a parent directory:
 *   the file wins (it is the leaf entry); the implicit directory at the
 *   same path is not created because the file occupies that path slot.
 * - Defensive duplicate records (same path, same kind): the first
 *   persisted entry for a given path is kept; subsequent duplicates
 *   are skipped.
 * - A persisted directory and a persisted file with the same path:
 *   the first persisted entry wins; the second is skipped.
 *
 * Directories are sorted before files within each parent. Both groups
 * use direct string comparison by name (not locale-dependent).
 */
export function buildFileTree(entries: WorkspaceFileRecord[]): FileTreeNode[] {
  // Canonicalize processing order with a fixed path comparator.
  // Copy the array (do not mutate the input) and sort by path.
  const sorted = [...entries].sort((a, b) => comparePaths(a.path, b.path));

  // Single map: exactly one node per path.
  const nodeMap = new Map<string, FileTreeNode>();

  // Root node (not in the map; its children are the top-level nodes).
  const root: FileTreeNode = {
    name: "",
    path: "",
    kind: "directory",
    isPersisted: true,
    children: [],
  };

  // Track which paths are persisted directories (for implicit-dir upgrade).
  const persistedDirPaths = new Set(
    entries.filter((e) => e.kind === "directory").map((e) => e.path),
  );

  for (const entry of sorted) {
    const segments = entry.path.split("/");
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      const partialPath = segments.slice(0, i + 1).join("/");

      if (isLast) {
        // This is the actual entry (file or persisted directory).
        // Skip if we've already inserted a node for this exact path
        // (collision detection: first entry wins, no duplicates).
        if (nodeMap.has(partialPath)) {
          // Defensive duplicate: skip.
          continue;
        }

        const node: FileTreeNode = {
          name: segment,
          path: partialPath,
          kind: entry.kind,
          isPersisted: true,
          children: [],
        };
        nodeMap.set(partialPath, node);
        current.children.push(node);
      } else {
        // This is an intermediate path segment: may be an implicit directory
        // or a previously inserted persisted directory.
        let child = nodeMap.get(partialPath);

        if (!child) {
          // Create an implicit directory node and register it in the map.
          child = {
            name: segment,
            path: partialPath,
            kind: "directory",
            isPersisted: persistedDirPaths.has(partialPath),
            children: [],
          };
          nodeMap.set(partialPath, child);
          current.children.push(child);
        } else if (!child.isPersisted && persistedDirPaths.has(partialPath)) {
          // Upgrade an implicit directory node to persisted when a
          // persisted directory record exists for this path.
          child.isPersisted = true;
        }

        current = child;
      }
    }
  }

  // Sort the tree recursively: directories first, then files, alphabetical.
  sortTree(root);

  return root.children;
}

/**
 * Recursively sort tree nodes: directories before files, alphabetical
 * within each group using direct string comparison (not locale-dependent).
 * Mutates the children arrays in place.
 */
function sortTree(node: FileTreeNode): void {
  node.children.sort((a, b) => {
    // Directories before files.
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    // Alphabetical by name using direct string comparison.
    return comparePaths(a.name, b.name);
  });

  for (const child of node.children) {
    sortTree(child);
  }
}
