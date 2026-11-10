import { handleRelay } from "../../../lib/server/relayHandler.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = (req: Request) => handleRelay(req);
