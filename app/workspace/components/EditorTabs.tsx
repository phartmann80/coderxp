"use client";

/**
 * Editor tab bar for CoderXP M2 Workspace Alpha.
 *
 * Commit 4 scope: displays open file tabs with close buttons.
 * - Clicking a tab activates that file.
 * - Close button removes the tab and switches to the next available tab.
 * - Dirty indicator (unsaved changes) shown as a dot.
 * - Matches the obsidian/graphite workspace palette.
 */

import { X, File as FileIcon } from "lucide-react";
import { getEntryName } from "@/lib/workspace/path-utils";

interface EditorTabsProps {
  /** Open tab file paths. */
  openTabs: string[];
  /** Currently active file path. */
  activeFile: string | null;
  /** Set of file paths with unsaved changes. */
  dirtyPaths: Set<string>;
  /** Called when a tab is clicked. */
  onSelect: (path: string) => void;
  /** Called when a tab's close button is clicked. */
  onClose: (path: string) => void;
}

export function EditorTabs({
  openTabs,
  activeFile,
  dirtyPaths,
  onSelect,
  onClose,
}: EditorTabsProps) {
  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-stretch overflow-x-auto border-b border-gray-800 bg-[#0a0b0d]">
      {openTabs.map((path) => {
        const isActive = path === activeFile;
        const isDirty = dirtyPaths.has(path);
        const name = getEntryName(path);

        return (
          <div
            key={path}
            className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer border-r border-gray-800/50 transition-colors select-none ${
              isActive
                ? "bg-[#0d0e10] text-gray-200"
                : "bg-[#0a0b0d] text-gray-500 hover:bg-[#0d0e10]/50 hover:text-gray-400"
            }`}
            onClick={() => onSelect(path)}
            role="tab"
            aria-selected={isActive}
          >
            <FileIcon className="w-3 h-3 flex-shrink-0 text-gray-600" />
            <span className="text-xs font-mono truncate max-w-[120px]">{name}</span>
            {isDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
            )}
            <button
              className="flex-shrink-0 p-0.5 rounded hover:bg-gray-700/50 transition-colors opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onClose(path);
              }}
              aria-label={`Close ${name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
