import { handleX402 } from "../../../../lib/server/x402Handler.ts";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> }; // Next 16: params is a Promise

export async function GET(req: Request, { params }: Ctx) {
  return handleX402(req, (await params).id);
}

export async function HEAD(req: Request, { params }: Ctx) {
  return handleX402(req, (await params).id);
}
