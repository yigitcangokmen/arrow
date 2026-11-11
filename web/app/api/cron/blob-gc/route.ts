import { handleBlobGc, realGcDeps } from "../../../../lib/server/blobGc.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = (req: Request) => handleBlobGc(req, realGcDeps);
