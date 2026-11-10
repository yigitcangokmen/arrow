import { teamAccounts } from "../../../generated/data.ts";
import { handleListings, realListingsDeps } from "../../../lib/server/listingsHandler.ts";

export const runtime = "nodejs";

const deps = realListingsDeps(teamAccounts);

export const GET = (req: Request) => handleListings(req, deps);
