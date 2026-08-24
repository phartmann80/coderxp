import { NextRequest } from "next/server";
import {
  createAgentStreamHandler,
  createConcurrencyGate,
  defaultStreamLimits,
  MAX_GLOBAL_CONCURRENT_STREAMS,
} from "@/lib/server/agent-stream-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const productionHandler = createAgentStreamHandler({
  fetchUpstream: fetch,
  clock: () => Date.now(),
  scheduleTimeout: (fn, ms) => setTimeout(fn, ms),
  cancelTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  limits: defaultStreamLimits,
  concurrency: createConcurrencyGate(MAX_GLOBAL_CONCURRENT_STREAMS),
});

export async function POST(req: NextRequest): Promise<Response> {
  return productionHandler(req);
}
