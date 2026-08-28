/**
 * T3 Approval Decision Endpoint for CoderXP Phase A.
 *
 * Implements Roadmap §0 & Amendment 4:
 * - Grants single or session-scoped approvals for T3 operations (e.g. git push).
 */

import { NextResponse } from "next/server";
import { devboxCredentialGate } from "@/lib/server/devbox-credential-gate";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      projectId?: string;
      branch?: string;
      scope?: "single" | "session";
      decision?: "approved" | "rejected";
    };

    const projectId = body.projectId || "default-project";
    const branch = body.branch || "main";
    const scope = body.scope || "single";

    if (body.decision === "approved") {
      devboxCredentialGate.grantApproval(projectId, branch, scope);
      return NextResponse.json({ ok: true, approved: true, projectId, branch, scope });
    }

    return NextResponse.json({ ok: true, approved: false, reason: "Rejected by user" });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Internal server error." },
      { status: 500 },
    );
  }
}
