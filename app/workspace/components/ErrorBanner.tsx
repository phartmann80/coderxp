"use client";

/**
 * Error banner for CoderXP M2 Workspace Alpha.
 *
 * Displays typed persistence errors with a retry action.
 * Does not expose stack traces, browser internals, file contents, or secrets.
 */

import { AlertTriangle, RotateCcw } from "lucide-react";
import type { WorkspaceError } from "../hooks/useWorkspaceState";

const ERROR_MESSAGES: Record<string, string> = {
  PERSISTENCE_UNAVAILABLE: "Local storage is not available in this browser. Project management requires IndexedDB.",
  DATABASE_OPEN_FAILED: "The local database could not be opened. It may be blocked by another tab.",
  QUOTA_EXCEEDED: "Storage quota exceeded. Remove unused projects to free space.",
  TRANSACTION_FAILED: "The last operation failed. Please try again.",
  PROJECT_NOT_FOUND: "The requested project was not found.",
  INVALID_PROJECT_NAME: "The project name is invalid. Use 1 to 100 characters.",
  TEMPLATE_UNAVAILABLE: "This template is not yet available for project creation.",
};

interface ErrorBannerProps {
  error: WorkspaceError;
  onRetry: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  const message = ERROR_MESSAGES[error.code] ?? error.message;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
      <div className="flex items-center gap-3 text-amber-400">
        <AlertTriangle className="w-6 h-6" />
        <span className="text-sm font-medium">Something went wrong</span>
      </div>
      <p className="text-sm text-gray-400 max-w-md text-center">{message}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 text-sm text-cyan-400 border border-cyan-800 rounded-md hover:bg-cyan-950/40 transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
        Retry
      </button>
    </div>
  );
}