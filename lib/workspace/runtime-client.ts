/**
 * WebContainer runtime client for CoderXP.
 *
 * M3.1: boot timeout added. The boot promise races against a configurable
 * timeout. On timeout, the promise rejects with a clear error so callers
 * can surface a retry UI instead of hanging at "mounting" forever.
 *
 * Binding corrections applied:
 * - COEP mode: require-corp (not credentialless)
 * - Project root: WORKSPACE_PROJECT_ROOT ("project")
 * - Singleton lifecycle: one instance per page lifetime
 * - teardown() reserved for fatal corruption / disposal only
 * - No teardown() during ordinary project switching
 * - Failed boot clears the pending promise and permits retry
 */

import { WebContainer } from "@webcontainer/api";
import { WEBCONTAINER_BOOT_OPTIONS, WORKSPACE_PROJECT_ROOT } from "./constants";

/** Lazy singleton holder for the WebContainer instance. */
let webContainerInstance: WebContainer | null = null;

/** Whether boot() has been called on the current instance. */
let booted = false;

/** Promise tracking an in-progress boot. */
let bootPromise: Promise<WebContainer> | null = null;

/** Boot timeout timer (for cancellation on success). */
let bootTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Boots the WebContainer singleton if not already booted.
 *
 * Uses the binding boot options: coep require-corp,
 * forwardPreviewErrors, workdirName coderxp.
 *
 * M3.1: A configurable boot timeout (default 15s) prevents the boot
 * from hanging indefinitely. On timeout, the promise rejects with a
 * clear error so callers can surface a retry UI.
 *
 * On failure, clears the pending promise and resets state so
 * a later retry is possible. Does not create multiple boot
 * attempts concurrently.
 *
 * @param timeoutMs Boot timeout in milliseconds (default 15000).
 * @returns the booted WebContainer instance
 */
export async function bootWebContainer(timeoutMs: number = 15000): Promise<WebContainer> {
  if (booted && webContainerInstance) {
    return webContainerInstance;
  }

  if (bootPromise) {
    return bootPromise;
  }

  // Race the boot against a timeout.
  const timeoutPromise = new Promise<never>((_, reject) => {
    bootTimer = setTimeout(() => {
      reject(new Error(`WebContainer boot timed out after ${timeoutMs / 1000}s. The browser environment may not support WebContainers.`));
    }, timeoutMs);
  });

  bootPromise = Promise.race([
    WebContainer.boot(WEBCONTAINER_BOOT_OPTIONS),
    timeoutPromise,
  ])
    .then((instance) => {
      if (bootTimer) {
        clearTimeout(bootTimer);
        bootTimer = null;
      }
      webContainerInstance = instance as WebContainer;
      booted = true;
      return webContainerInstance;
    })
    .catch((error: unknown) => {
      if (bootTimer) {
        clearTimeout(bootTimer);
        bootTimer = null;
      }
      webContainerInstance = null;
      booted = false;
      throw error;
    })
    .finally(() => {
      bootPromise = null;
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
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
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
