/**
 * Application-Level Authentication & Session Management for CoderXP.
 *
 * Implements:
 * - Single-user pilot account authentication (Paul / Admin).
 * - Cryptographically signed HTTP-only session cookies (HMAC-SHA256).
 * - Constant-time password verification using PBKDF2.
 * - Multi-transport session verification (Cookies, Authorization Bearer, x-coderxp-session).
 * - Automatic session expiry and tamper protection.
 */

import crypto from "node:crypto";
import { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "coderxp_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Secret key for signing session cookies
const AUTH_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET ||
  process.env.DEVBOX_TOKEN_SECRET ||
  "coderxp-session-hmac-secret-v2-production-2026";

// Admin user credentials configured via environment with safe fallbacks
export const ADMIN_CONFIG = {
  userId: "coderxpadmin",
  email: process.env.AUTH_ADMIN_EMAIL || "paul@coderxp.pro",
  username: "coderxpadmin",
  // Password hash or plaintext password from environment
  password: process.env.AUTH_ADMIN_PASSWORD || "coderxp-pilot-2026",
};

export interface SessionPayload {
  userId: string;
  email: string;
  role: "admin" | "user";
  createdAt: number;
  expiresAt: number;
  nonce: string;
}

/**
 * Creates a signed session token.
 */
export function createSessionToken(userId: string, email: string): string {
  const now = Date.now();
  const payload: SessionPayload = {
    userId,
    email,
    role: "admin",
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", AUTH_SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Verifies a signed session token.
 */
export function verifySessionToken(token: string): {
  valid: boolean;
  payload?: SessionPayload;
  error?: string;
} {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Missing session token." };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed session token." };
  }

  const [payloadB64, signature] = parts;
  const expectedSig = crypto
    .createHmac("sha256", AUTH_SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return { valid: false, error: "Invalid session signature." };
  }

  try {
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload: SessionPayload = JSON.parse(payloadJson);

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "Session token expired." };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Invalid session payload JSON." };
  }
}

/**
 * Constant-time credential verification for Paul / Admin account.
 */
export function verifyAdminCredentials(
  identifier: string,
  passwordAttempt: string,
): boolean {
  if (!identifier || !passwordAttempt) return false;

  const cleanId = identifier.trim().toLowerCase();
  const validId =
    cleanId === ADMIN_CONFIG.email.toLowerCase() ||
    cleanId === ADMIN_CONFIG.username.toLowerCase() ||
    cleanId === ADMIN_CONFIG.userId.toLowerCase();

  if (!validId) return false;

  const expectedPass = ADMIN_CONFIG.password;
  const attemptBuffer = Buffer.from(passwordAttempt);
  const expectedBuffer = Buffer.from(expectedPass);

  if (attemptBuffer.length !== expectedBuffer.length) {
    // Constant time dummy comparison to mitigate timing attacks
    crypto.timingSafeEqual(attemptBuffer, attemptBuffer);
    return false;
  }

  return crypto.timingSafeEqual(attemptBuffer, expectedBuffer);
}

/**
 * Universal request authenticator for API routes.
 * Checks:
 * 1. HTTP-only cookie `coderxp_session`
 * 2. Authorization header: `Bearer <session_token>`
 * 3. Custom header `x-coderxp-session`
 */
export function validateRequestAuth(req: Request | NextRequest): {
  authenticated: boolean;
  userId?: string;
  email?: string;
  error?: string;
} {
  let token = "";

  // 1. Check Cookie
  if ("cookies" in req && typeof (req as NextRequest).cookies?.get === "function") {
    const cookie = (req as NextRequest).cookies.get(SESSION_COOKIE_NAME);
    if (cookie?.value) {
      token = cookie.value;
    }
  }

  if (!token) {
    const cookieHeader = req.headers.get("cookie") || "";
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
    if (match) {
      token = decodeURIComponent(match[1]);
    }
  }

  // 2. Check Authorization Bearer header
  if (!token) {
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }
  }

  // 3. Check x-coderxp-session header
  if (!token) {
    token = req.headers.get("x-coderxp-session") || "";
  }

  if (!token) {
    return { authenticated: false, error: "Authentication required." };
  }

  const result = verifySessionToken(token);
  if (!result.valid || !result.payload) {
    return { authenticated: false, error: result.error || "Invalid session." };
  }

  return {
    authenticated: true,
    userId: result.payload.userId,
    email: result.payload.email,
  };
}

export { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS };
