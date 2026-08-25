import { NextResponse } from "next/server";
import { getActiveProvider } from "@/lib/server/agent-provider-registry";
import { isSameOriginRequest } from "@/lib/server/agent-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Safe agent health. Never exposes credentials, env names, upstream URLs,
 * full model lists, quota, or internal provider errors.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { errorCode: "ACCESS_RESTRICTED", message: "Cross-origin agent requests are not allowed." },
      { status: 403 },
    );
  }

  const provider = getActiveProvider();
  const health = provider.getSafeHealth();

  return NextResponse.json({
    ok: health.ok,
    provider: health.provider === "anthropic-byok" ? "anthropic" : health.provider,
    providerId: health.provider,
    ready: health.ready,
    access: health.access,
    status: health.status,
    byokRequired: health.byokRequired,
    displayName: health.displayName,
    defaultModelDisplayName: health.defaultModelDisplayName,
  });
}
