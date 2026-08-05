/**
 * WebContainer runtime client for CoderXP M2 Workspace Alpha.
 *
 * Commit 1 scope: lazy singleton contract only. Does NOT boot,
 * mount, or run any processes. The singleton is created on first
 * access but WebContainer.boot() is not called until explicitly
 * invoked by a future commit.
 *
 * Binding corrections applied:
 * - COEP mode: require-corp (not credentialless)
 * - Project root: WORKSPACE_PROJECT_ROOT ("project")
 * - Singleton lifecycle: one instance per page lifetime
 * - teardown() reserved for fatal corruption / disposal only
 * - No teardown() during ordinary project switching
 */

import { WebContainer } from "@webcontainer/api";
import { WEBCONTAINER_BOOT_OPTIONS, WORKSPACE_PROJECT_ROOT } from "./constants";

/** Lazy singleton holder for the WebContainer instance. */
let webContainerInstance: WebContainer | null = null;

/** Whether boot() has been called on the current instance. */
let booted = false;

/** Promise tracking an in-progress boot. */
let bootPromise: Promise<WebContainer> | null = null;

/**
 * Boots the WebContainer singleton if not already booted.
 *
 * Uses the binding boot options: coep require-corp,
 * forwardPreviewErrors, workdirName coderxp.
 *
 * @returns the booted WebContainer instance
 */
export async function bootWebContainer(): Promise<WebContainer> {
  if (booted && webContainerInstance) {
    return webContainerInstance;
  }

  if (bootPromise) {
    return bootPromise;
  }

  bootPromise = WebContainer.boot(WEBCONTAINER_BOOT_OPTIONS).then((instance) => {
    webContainerInstance = instance;
    booted = true;
    bootPromise = null;
    return instance;
  });

  return bootPromise;
}

/**
 * Tears down the WebContainer singleton.
 *
 * Reserved for:
 * - Fatal runtime corruption
 * - Workspace disposal
 * - A failed instance that cannot be reset
 *
 * Do NOT call this during ordinary project switching.
 */
export function teardownWebContainer(): void {
  if (webContainerInstance) {
    webContainerInstance.teardown();
    webContainerInstance = null;
    booted = false;
    bootPromise = null;
  }
}

/**
 * Removes the project directory from the WebContainer.
 *
 * Called before mounting a new project during project switching.
 */
export async function removeProjectRoot(): Promise<void> {
  if (!webContainerInstance || !booted) return;
  await webContainerInstance.fs.rm(WORKSPACE_PROJECT_ROOT, {
    recursive: true,
    force: true,
  });
}

/** Whether the WebContainer singleton is currently booted. */
export function isBooted(): boolean {
  return booted;
}
