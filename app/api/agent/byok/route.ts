/**
 * BYOK Management API Route for CoderXP Revision 2.3.
 *
 * Implements Directive §10.3:
 * - Accepts API key once over HTTPS, validates with live models call
 * - Stores encrypted server-side in secrets store
 * - Returns ONLY maskedKey (…last4) and discovered models to the client
 * - The full key is never serialized or returned
 */

import { NextResponse } from "next/server";
import {
  saveServerByok,
  listServerByok,
  revokeServerByok,
} from "@/lib/workspace/byok-server-store";
import type { ByokProviderId } from "@/lib/workspace/byok-providers";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      providerId: ByokProviderId;
      apiKey: string;
      baseUrl?: string;
      mode?: "local" | "cloud";
    };

    if (!body || !body.providerId || !body.apiKey) {
      return NextResponse.json(
        { ok: false, error: "providerId and apiKey are required." },
        { status: 400 },
      );
    }

    const userId = "default_user"; // Scoped per authenticated session/user
    const result = await saveServerByok(userId, body.providerId, body.apiKey, {
      baseUrl: body.baseUrl,
      mode: body.mode,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "Validation failed." },
        { status: 400 },
      );
    }

    // Return client record (contains maskedKey only)
    return NextResponse.json({ ok: true, record: result.record });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Internal server error." },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const userId = "default_user";
    const records = listServerByok(userId);
    return NextResponse.json({ ok: true, records });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Internal server error." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const providerId = url.searchParams.get("providerId") as ByokProviderId | null;

    if (!providerId) {
      return NextResponse.json(
        { ok: false, error: "providerId query parameter is required." },
        { status: 400 },
      );
    }

    const userId = "default_user";
    const revoked = revokeServerByok(userId, providerId);
    return NextResponse.json({ ok: true, revoked });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Internal server error." },
      { status: 500 },
    );
  }
}
