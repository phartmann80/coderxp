"use client";

/**
 * CodeMirror editor for CoderXP M2 Workspace Alpha.
 *
 * Commit 4 scope: file-content editing with CodeMirror 6 via @uiw/react-codemirror.
 * - Dark theme matching the workspace obsidian/graphite palette.
 * - Language extensions resolved from file path.
 * - Debounced save via onChange callback (SAVE_DEBOUNCE_MS).
 * - Read-only mode for directories and unsupported entries.
 */

import { useMemo, useRef, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { getLanguageExtension, getLanguageLabel } from "@/lib/workspace/lang";
import { SAVE_DEBOUNCE_MS } from "@/lib/workspace/constants";

interface CodeEditorProps {
  /** Path of the file being edited. */
  filePath: string;
  /** Current file contents. */
  value: string;
  /** Whether the editor is read-only. */
  readOnly?: boolean;
  /** Immediate callback on every content change (before debounce). */
  onChange?: (value: string) => void;
  /** Debounced save callback. Called SAVE_DEBOUNCE_MS after the last edit. */
  onSave?: (path: string, contents: string) => void;
}

/** Custom dark theme extension matching the workspace palette. */
const darkTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#0d0e10",
      color: "#d4d4d4",
      height: "100%",
      fontSize: "13px",
    },
    ".cm-content": {
      caretColor: "#22d3ee",
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
      padding: "8px 0",
    },
    ".cm-gutters": {
      backgroundColor: "#0d0e10",
      color: "#4a4a4a",
      border: "none",
      borderRight: "1px solid #1e1e1e",
    },
    ".cm-activeLine": {
      backgroundColor: "#161719",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#161719",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "#264f78",
    },
    ".cm-cursor": {
      borderLeftColor: "#22d3ee",
    },
    ".cm-matchingBracket": {
      backgroundColor: "#1e3a5f",
      outline: "1px solid #3b82f6",
    },
    "&.cm-focused": {
      outline: "none",
    },
  },
  { dark: true },
);

export function CodeEditor({ filePath, value, readOnly = false, onChange, onSave }: CodeEditorProps) {
  const extensions = useMemo(() => getLanguageExtension(filePath), [filePath]);
  const languageLabel = useMemo(() => getLanguageLabel(filePath), [filePath]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContent = useRef(value);

  // Keep latestContent in sync so the debounce callback always saves the
  // most recent content, not a stale closure value.
  useEffect(() => {
    latestContent.current = value;
  }, [value]);

  // Cleanup pending debounce on unmount or file switch.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [filePath]);

  const handleChange = useCallback(
    (val: string) => {
      latestContent.current = val;
      if (onChange) onChange(val);

      if (!onSave || readOnly) return;

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        onSave(filePath, latestContent.current);
        debounceRef.current = null;
      }, SAVE_DEBOUNCE_MS);
    },
    [filePath, onSave, onChange, readOnly],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-[#0d0e10]">
        <span className="text-xs text-gray-500 font-mono">{filePath}</span>
        <span className="text-xs text-gray-600">{languageLabel}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <CodeMirror
          value={value}
          height="100%"
          theme={darkTheme}
          extensions={extensions}
          readOnly={readOnly}
          onChange={handleChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            indentOnInput: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
