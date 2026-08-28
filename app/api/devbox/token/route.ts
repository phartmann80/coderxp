/**
 * Devbox WSS Token Generation Endpoint for CoderXP Revision 2.4.
 *
 * Implements Amendment 1:
 * - Issues short-lived (60s) single-use WSS tokens for authenticated workspace sessions.
 */

import { NextResponse } from "next/server";
import { mintDevboxWssToken } from "@/lib/server/devbox-token";
import { devboxMetering } from "@/lib/devbox/metering";
import type { UserPlanTier } from "@/lib/devbox/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      projectId?: string;
      userId?: string;
      tier?: UserPlanTier;
    };

    const projectId = body.projectId || "default-project";
    const userId = body.userId || "default-user";
    const tier = body.tier || "pro";

    // 1. Verify tier entitlement & quota
    const check = devboxMetering.canStartDevbox(userId, tier);
    if (!check.allowed) {
      return NextResponse.json(
        { ok: false, error: check.reason },
        { status: 403 },
      );
    }

    // 2. Mint single-use token
    const token = mintDevboxWssToken(userId, projectId);

    return NextResponse.json({
      ok: true,
      token,
      expiresInSeconds: 60,
      wsUrl: `/ws/devbox/?token=${encodeURIComponent(token)}&projectId=${encodeURIComponent(projectId)}`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Internal server error." },
      { status: 500 },
    );
  }
}
