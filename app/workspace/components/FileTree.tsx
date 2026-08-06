"use client";

/**
 * Read-only file tree for CoderXP M2 Workspace Alpha.
 *
 * Commit 3 scope: read-only hierarchical display of stored file paths.
 * No create, rename, delete, drag-and-drop, or editing.
 *
 * The tree is generated from persisted entries via buildFileTree().
 * Directories before files, stable alphabetical ordering.
 */

import { useState } from "react";
import { ChevronRight, ChevronDown, File as FileIcon, Folder } from "lucide-react";
import type { FileTreeNode } from "@/lib/workspace/project-tree";

interface FileTreeProps {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function FileTree({ nodes, selectedPath, onSelect }: FileTreeProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <FileTreeNodeView
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface FileTreeNodeViewProps {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function FileTreeNodeView({ node, depth, selectedPath, onSelect }: FileTreeNodeViewProps) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === node.path;

  if (node.kind === "directory") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full px-2 py-1 text-left text-sm text-gray-300 hover:bg-gray-800/50 rounded transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-gray-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-gray-500" />
          )}
          <Folder className="w-3.5 h-3.5 flex-shrink-0 text-gray-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.length > 0 && (
          <div>
            {node.children.map((child) => (
              <FileTreeNodeView
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1.5 w-full px-2 py-1 text-left text-sm rounded transition-colors ${
        isSelected
          ? "bg-cyan-950/40 text-cyan-300"
          : "text-gray-300 hover:bg-gray-800/50"
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <FileIcon className="w-3.5 h-3.5 flex-shrink-0 text-gray-500" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
