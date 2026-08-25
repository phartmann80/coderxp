import { NextResponse } from "next/server";
import { getActiveProvider } from "@/lib/server/agent-provider-registry";
import { isSameOriginRequest } from "@/lib/server/agent-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sanitized administrator-approved model list only.
 * Never exposes credentials, upstream URLs, pricing, or raw discovery payloads.
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

  if (health.status === "access_restricted" || health.access === "restricted") {
    return NextResponse.json(
      { errorCode: "ACCESS_RESTRICTED", message: "Provider access is restricted." },
      { status: 403 },
    );
  }

  if (!provider.listSanitizedModels) {
    return NextResponse.json(
      { errorCode: "PROVIDER_UNAVAILABLE", message: "Model listing is unavailable." },
      { status: 503 },
    );
  }

  const listed = await provider.listSanitizedModels();
  if (!listed.ok) {
    return NextResponse.json(
      { errorCode: listed.errorCode, message: listed.message },
      { status: listed.status },
    );
  }

  return NextResponse.json({
    ok: true,
    provider: health.provider === "anthropic-byok" ? "anthropic" : health.provider,
    providerId: health.provider,
    models: listed.models,
    defaultModelId: listed.defaultModelId,
  });
}
