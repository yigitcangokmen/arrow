import { handleSponsor } from "../../../lib/server/sponsor.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = (req: Request) => handleSponsor(req);
