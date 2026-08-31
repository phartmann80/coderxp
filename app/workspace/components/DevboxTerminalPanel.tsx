"use client";

/**
 * Live Interactive Devbox Terminal Panel for CoderXP Revision 2.4.
 *
 * Connects directly to the host PTY broker daemon over authenticated WebSocket (WSS).
 * Spawns real commands inside the isolated Ubuntu Linux Devbox container.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface DevboxTerminalPanelProps {
  projectId: string;
  active: boolean;
}

export function DevboxTerminalPanel({ projectId, active }: DevboxTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputBufferRef = useRef<string>("");
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef<number>(-1);

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writePrompt = useCallback((term: Terminal) => {
    term.write("\r\n\x1b[1;32mdeveloper@coderxp-devbox\x1b[0m:\x1b[1;34m/workspace\x1b[0m$ ");
    inputBufferRef.current = "";
  }, []);

  const connectDevbox = useCallback(async () => {
    setError(null);
    setConnected(false);

    try {
      // 1. Request single-use Devbox WSS Token
      const res = await fetch("/api/devbox/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Token generation failed (${res.status})`);
      }

      const data = await res.json();
      const token = data.token;

      // 2. Build WebSocket URL
      const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
      const host = window.location.host;
      const wsUrl = isHttps
        ? `wss://${host}/ws/devbox/?token=${encodeURIComponent(token)}&projectId=${encodeURIComponent(projectId)}`
        : `ws://${window.location.hostname}:3200/?token=${encodeURIComponent(token)}&projectId=${encodeURIComponent(projectId)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        const term = termRef.current;
        if (term) {
          term.writeln("\r\n\x1b[1;32m✓ Connected to CoderXP Devbox Runtime (Ubuntu 24.04 LTS)\x1b[0m");
          term.writeln("\x1b[2m  Full autonomy enabled · Pre-push security gate & audit logging active\x1b[0m");
          writePrompt(term);
        }
      };

      ws.onmessage = (event) => {
        const term = termRef.current;
        if (!term) return;

        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === "output" && typeof parsed.data === "string") {
            term.write(parsed.data);
            writePrompt(term);
          } else if (typeof parsed === "string") {
            term.write(parsed);
          }
        } catch {
          term.write(event.data);
        }
      };

      ws.onerror = () => {
        setConnected(false);
        setError("WebSocket connection failed.");
      };

      ws.onclose = () => {
        setConnected(false);
        const term = termRef.current;
        if (term) {
          term.writeln("\r\n\x1b[1;33m[Devbox session disconnected]\x1b[0m");
        }
      };
    } catch (err: any) {
      setError(err?.message || "Failed to initialize Devbox terminal.");
      const term = termRef.current;
      if (term) {
        term.writeln(`\r\n\x1b[1;31mTerminal Error: ${err?.message || "Devbox unavailable"}\x1b[0m`);
      }
    }
  }, [projectId, writePrompt]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
      theme: {
        background: "#0a0b0d",
        foreground: "#d4d4d4",
        cursor: "#38bdf8",
        selectionBackground: "#264f78",
        black: "#0a0b0d",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#38bdf8",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e5e7eb",
      },
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    term.writeln("\x1b[1;36mCoderXP Agent Devbox Terminal\x1b[0m");
    term.writeln("\x1b[2mInitializing secure container PTY session…\x1b[0m");

    // Key Handler for interactive shell
    term.onKey(({ key, domEvent }) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const ev = domEvent;
      if (ev.key === "Enter") {
        const cmd = inputBufferRef.current.trim();
        term.writeln("");
        if (cmd) {
          historyRef.current.push(cmd);
          historyIdxRef.current = historyRef.current.length;

          // Dispatch command to host PTY broker
          const parts = cmd.split(" ");
          const command = parts[0];
          const args = parts.slice(1);
          ws.send(JSON.stringify({ type: "command", command, args, raw: cmd }));
        } else {
          writePrompt(term);
        }
        inputBufferRef.current = "";
      } else if (ev.key === "Backspace") {
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          term.write("\b \b");
        }
      } else if (ev.key === "ArrowUp") {
        if (historyRef.current.length > 0 && historyIdxRef.current > 0) {
          historyIdxRef.current -= 1;
          const prevCmd = historyRef.current[historyIdxRef.current];
          while (inputBufferRef.current.length > 0) {
            term.write("\b \b");
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          }
          inputBufferRef.current = prevCmd;
          term.write(prevCmd);
        }
      } else if (ev.key === "ArrowDown") {
        if (historyRef.current.length > 0 && historyIdxRef.current < historyRef.current.length - 1) {
          historyIdxRef.current += 1;
          const nextCmd = historyRef.current[historyIdxRef.current];
          while (inputBufferRef.current.length > 0) {
            term.write("\b \b");
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          }
          inputBufferRef.current = nextCmd;
          term.write(nextCmd);
        } else if (historyIdxRef.current === historyRef.current.length - 1) {
          historyIdxRef.current = historyRef.current.length;
          while (inputBufferRef.current.length > 0) {
            term.write("\b \b");
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          }
        }
      } else if (ev.key === "c" && ev.ctrlKey) {
        term.writeln("^C");
        inputBufferRef.current = "";
        writePrompt(term);
      } else if (!ev.altKey && !ev.ctrlKey && !ev.metaKey && key.length === 1) {
        inputBufferRef.current += key;
        term.write(key);
      }
    });

    connectDevbox();

    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (wsRef.current) {
        wsRef.current.close();
      }
      term.dispose();
    };
  }, [projectId, connectDevbox, writePrompt]);

  useEffect(() => {
    if (active && fitRef.current) {
      setTimeout(() => {
        fitRef.current?.fit();
      }, 50);
    }
  }, [active]);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative" }}>
      {/* Devbox Status Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "4px 10px",
          background: "#111318",
          borderBottom: "1px solid #1e222d",
          fontSize: "11px",
          fontFamily: "var(--mono)",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            backgroundColor: connected ? "#22c55e" : error ? "#ef4444" : "#eab308",
          }}
        />
        <span style={{ color: "#9ca3af" }}>
          {connected ? "Devbox PTY · Ubuntu 24.04 (Host Container)" : error ? "Disconnected" : "Connecting to Devbox…"}
        </span>
        <span style={{ flex: 1 }} />
        {(!connected || error) && (
          <button
            onClick={connectDevbox}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#38bdf8",
              borderRadius: "4px",
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            Retry Connection
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          padding: "6px 8px",
          backgroundColor: "#0a0b0d",
          overflow: "hidden",
        }}
      />
    </div>
  );
}
