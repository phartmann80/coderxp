/**
 * WebContainer runtime manager for CoderXP M2 Workspace Alpha.
 *
 * Commit 5 scope: real static HTML/CSS/JS execution layer.
 *
 * Owns:
 * - Lazy WebContainer boot (one instance per page session)
 * - Project file mounting into /project
 * - Real process spawning (node server.mjs)
 * - Real stdout/stderr capture
 * - Real server-ready URL from the WebContainer event
 * - Generation-based process ownership (stale runs cannot overwrite newer)
 * - Stop / remount / re-run lifecycle
 *
 * Does NOT:
 * - Fake terminal output, fake build messages, or fake preview URLs
 * - Boot WebContainer until runtime is first needed
 * - Tear down WebContainer during normal project switching
 */

import { bootWebContainer } from "./runtime-client";
import { WORKSPACE_PROJECT_ROOT } from "./constants";
import type { WorkspaceFileRecord } from "./types";
import type { WebContainer, WebContainerProcess } from "@webcontainer/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Runtime states — each corresponds to actual runtime work. */
export type RuntimeState =
  | "idle"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "running"
  | "stopping"
  | "error";

/** A single output line from the runtime process. */
export interface OutputLine {
  /** Monotonic sequence number for React keys. */
  id: number;
  /** The text content of the line. */
  text: string;
}

/** Callback for runtime state changes. */
export type RuntimeStateCallback = (state: RuntimeState) => void;

/** Callback for output lines. */
export type OutputCallback = (line: OutputLine) => void;

/** Callback for preview URL changes. */
export type PreviewUrlCallback = (url: string | null) => void;

/** Callback for runtime errors. */
export type ErrorCallback = (message: string) => void;

// ---------------------------------------------------------------------------
// Runtime types
// ---------------------------------------------------------------------------

/** Which kind of runtime to use for a project. */
export type RuntimeKind = "static" | "react";

// ---------------------------------------------------------------------------
// Runtime manager
// ---------------------------------------------------------------------------

/**
 * Manages a single WebContainer instance and its process lifecycle.
 *
 * One instance per workspace page session. Reused across project switches.
 */
export class WorkspaceRuntime {
  private container: WebContainer | null = null;
  private currentProcess: WebContainerProcess | null = null;
  private generation = 0;
  private outputId = 0;
  private serverReadyUnsubscribe: (() => void) | null = null;
  private mounted = false;
  private runtimeKind: RuntimeKind = "static";
  private depsInstalled = false;

  // Callbacks
  private stateCallback: RuntimeStateCallback | null = null;
  private outputCallback: OutputCallback | null = null;
  private previewUrlCallback: PreviewUrlCallback | null = null;
  private errorCallback: ErrorCallback | null = null;

  /**
   * Register callbacks for runtime events.
   */
  onStateChange(cb: RuntimeStateCallback): void {
    this.stateCallback = cb;
  }

  onOutput(cb: OutputCallback): void {
    this.outputCallback = cb;
  }

  onPreviewUrl(cb: PreviewUrlCallback): void {
    this.previewUrlCallback = cb;
  }

  onError(cb: ErrorCallback): void {
    this.errorCallback = cb;
  }

  private setState(state: RuntimeState): void {
    this.stateCallback?.(state);
  }

  private emitOutput(text: string): void {
    this.outputCallback?.({ id: this.outputId++, text });
  }

  private emitPreviewUrl(url: string | null): void {
    this.previewUrlCallback?.(url);
  }

  private emitError(message: string): void {
    this.errorCallback?.(message);
  }

  /**
   * Lazily boots the WebContainer if not already booted.
   * Returns the booted instance. Safe to call multiple times.
   */
  private async ensureBooted(): Promise<WebContainer> {
    if (this.container) return this.container;

    this.setState("booting");
    try {
      this.container = await bootWebContainer();

      // Listen for server-ready events. Only the current generation may set the URL.
      this.serverReadyUnsubscribe = this.container.on("server-ready", (port, url) => {
        // Only accept the URL if this is the current generation.
        if (this.isCurrentGeneration()) {
          this.emitPreviewUrl(url);
          this.setState("running");
        }
      });

      return this.container;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "WebContainer boot failed";
      this.emitError(msg);
      this.setState("error");
      throw err;
    }
  }

  /**
   * Mounts project files into /project inside the WebContainer.
   * Clears the previous /project contents first.
   */
  async mountProject(files: WorkspaceFileRecord[], kind: RuntimeKind = "static"): Promise<void> {
    const container = await this.ensureBooted();

    this.setState("mounting");
    this.runtimeKind = kind;
    this.depsInstalled = false;

    // Clear previous project files.
    try {
      await container.fs.rm(WORKSPACE_PROJECT_ROOT, { recursive: true, force: true });
    } catch {
      // Ignore if /project does not exist yet.
    }

    // Write each file record into /project, preserving directory structure.
    for (const file of files) {
      if (file.kind !== "file") continue;
      const fullPath = `${WORKSPACE_PROJECT_ROOT}/${file.path}`;
      const contents = file.contents ?? "";

      // Create parent directories if needed.
      const lastSlash = fullPath.lastIndexOf("/");
      if (lastSlash > WORKSPACE_PROJECT_ROOT.length) {
        const dir = fullPath.slice(0, lastSlash);
        try {
          await container.fs.mkdir(dir, { recursive: true });
        } catch {
          // Directory may already exist.
        }
      }

      await container.fs.writeFile(fullPath, contents);
    }

    this.mounted = true;
  }

  /**
   * Starts the project runtime inside the WebContainer.
   *
   * For static projects: spawns `node server.mjs`.
   * For React projects: runs `npm install` (if needed) then `npm run dev`.
   *
   * Uses a generation token so a stale Run cannot overwrite a newer one.
   * The caller must ensure files are flushed (saved) before calling this.
   */
  async run(): Promise<void> {
    // Stop any existing process first.
    await this.stop();

    const gen = ++this.generation;

    try {
      const container = await this.ensureBooted();

      if (!this.mounted) {
        this.emitError("No project mounted. Open a project first.");
        this.setState("error");
        return;
      }

      this.emitPreviewUrl(null);

      if (this.runtimeKind === "react") {
        await this.runReact(container, gen);
      } else {
        await this.runStatic(container, gen);
      }
    } catch (err) {
      if (gen === this.generation) {
        const msg = err instanceof Error ? err.message : "Failed to start runtime";
        this.emitError(msg);
        this.setState("error");
      }
    }
  }

  /**
   * Run the static Node HTTP server.
   */
  private async runStatic(container: WebContainer, gen: number): Promise<void> {
    this.setState("starting");

    const process = await container.spawn("node", ["server.mjs"], {
      cwd: WORKSPACE_PROJECT_ROOT,
    });

    if (gen !== this.generation) {
      process.kill();
      return;
    }

    this.currentProcess = process;
    this.captureOutput(process, gen);

    const exitCode = await process.exit;

    if (gen === this.generation) {
      if (exitCode !== 0) {
        this.emitOutput(`Process exited with code ${exitCode}`);
        this.emitError(`Server process exited with code ${exitCode}`);
        this.setState("error");
      } else {
        this.setState("idle");
      }
      this.currentProcess = null;
      this.emitPreviewUrl(null);
    }
  }

  /**
   * Run the React + TypeScript dev server via Vite.
   *
   * If dependencies are not yet installed, runs `npm install` first.
   * Then runs `npm run dev` which starts Vite with --host 0.0.0.0.
   */
  private async runReact(container: WebContainer, gen: number): Promise<void> {
    // Install dependencies if not already installed.
    if (!this.depsInstalled) {
      this.setState("installing");

      const installProcess = await container.spawn("npm", ["install"], {
        cwd: WORKSPACE_PROJECT_ROOT,
      });

      if (gen !== this.generation) {
        installProcess.kill();
        return;
      }

      this.captureOutput(installProcess, gen);

      const installExit = await installProcess.exit;

      if (gen !== this.generation) return;

      if (installExit !== 0) {
        this.emitOutput(`npm install exited with code ${installExit}`);
        this.emitError(`Dependency installation failed (code ${installExit})`);
        this.setState("error");
        return;
      }

      this.depsInstalled = true;
    }

    // Start the Vite dev server.
    this.setState("starting");

    const devProcess = await container.spawn("npm", ["run", "dev"], {
      cwd: WORKSPACE_PROJECT_ROOT,
    });

    if (gen !== this.generation) {
      devProcess.kill();
      return;
    }

    this.currentProcess = devProcess;
    this.captureOutput(devProcess, gen);

    // The dev server runs indefinitely; wait for exit.
    const exitCode = await devProcess.exit;

    if (gen === this.generation) {
      if (exitCode !== 0) {
        this.emitOutput(`Process exited with code ${exitCode}`);
        this.emitError(`Dev server exited with code ${exitCode}`);
        this.setState("error");
      } else {
        this.setState("idle");
      }
      this.currentProcess = null;
      this.emitPreviewUrl(null);
    }
  }

  /**
   * Captures stdout/stderr from a WebContainer process and emits output lines.
   * Only emits for the current generation.
   */
  private captureOutput(process: WebContainerProcess, gen: number): void {
    if (!process.output) return;
    const reader = process.output.getReader();
    const readStream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (gen === this.generation && value) {
            const lines = value.split("\n");
            for (const line of lines) {
              if (line.length > 0) {
                this.emitOutput(line);
              }
            }
          }
        }
      } catch {
        // Stream closed or process killed.
      }
    };
    readStream();
  }

  /**
   * Stops the current runtime process.
   */
  async stop(): Promise<void> {
    if (this.currentProcess) {
      this.setState("stopping");
      this.generation++; // Invalidate the current generation.
      try {
        this.currentProcess.kill();
      } catch {
        // Process may already be dead.
      }
      this.currentProcess = null;
      this.emitPreviewUrl(null);
    }
    this.setState("idle");
  }

  /**
   * Switches to a new project: stops the current process, clears output,
   * and remounts the new project files.
   */
  async switchProject(files: WorkspaceFileRecord[], kind: RuntimeKind = "static"): Promise<void> {
    await this.stop();
    this.outputId = 0;
    this.mounted = false;
    await this.mountProject(files, kind);
  }

  /**
   * Whether the current generation is still the active one.
   */
  private isCurrentGeneration(): boolean {
    // The generation is incremented on each run() and stop().
    // A server-ready event is only valid if no newer run/stop has occurred.
    return this.generation > 0 && this.currentProcess !== null;
  }

  /**
   * Tears down the runtime entirely. Reserved for fatal errors or disposal.
   */
  dispose(): void {
    if (this.serverReadyUnsubscribe) {
      this.serverReadyUnsubscribe();
      this.serverReadyUnsubscribe = null;
    }
    if (this.currentProcess) {
      try {
        this.currentProcess.kill();
      } catch {
        // ignore
      }
      this.currentProcess = null;
    }
    this.container = null;
    this.mounted = false;
  }
}

/**
 * Singleton runtime instance for the workspace page session.
 */
let runtimeInstance: WorkspaceRuntime | null = null;

/**
 * Returns the singleton WorkspaceRuntime instance.
 * Creates it on first call.
 */
export function getRuntime(): WorkspaceRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new WorkspaceRuntime();
  }
  return runtimeInstance;
}

/**
 * Determines the runtime kind for a project based on its template ID.
 * React + TypeScript projects use the React runtime; everything else uses static.
 */
export function getRuntimeKind(templateId: string): RuntimeKind {
  if (templateId === "react-ts") return "react";
  return "static";
}
