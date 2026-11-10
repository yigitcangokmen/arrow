import { handleBlobPost } from "../../../lib/server/blobHandler.ts";

export const runtime = "nodejs";

export const POST = (req: Request) => handleBlobPost(req);
