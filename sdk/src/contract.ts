// Typed view calls on the market contract (names and shapes: contracts/arrow views.rs). No indexer (DEC L-07).
import { type Network, NETWORKS } from "./config.ts";
import { type RpcOptions, view } from "./rpc.ts";
import { ConfigView, Eval, LeakBudget, Listing, Purchase, VersionView } from "./schemas.ts";

const MAX_PAGE = 50;

export class ArrowViews {
  constructor(public readonly network: Network, public readonly contractId: string = NETWORKS[network].contract, private readonly o?: RpcOptions) {}

  private call(method: string, args: object = {}) {
    return view<unknown>(this.network, this.contractId, method, args, this.o);
  }
  private async maybe<T>(schema: { parse(v: unknown): T }, method: string, args: object): Promise<T | null> {
    const raw = await this.call(method, args);
    return raw === null ? null : schema.parse(raw);
  }

  async config() {
    return ConfigView.parse(await this.call("get_config"));
  }
  async programPubkey(): Promise<string | null> {
    return (await this.call("program_pubkey")) as string | null;
  }
  listing(id: number | string) {
    return this.maybe(Listing, "get_listing", { listing_id: Number(id) });
  }
  async listings({ from = 0, limit = MAX_PAGE }: { from?: number; limit?: number } = {}) {
    const raw = await this.call("get_listings", { from_index: from, limit: Math.min(limit, MAX_PAGE) });
    return Listing.array().parse(raw);
  }
  eval(id: number | string) {
    return this.maybe(Eval, "get_eval", { eval_id: Number(id) });
  }
  async evalsByListing(listingId: number | string, { from = 0, limit = MAX_PAGE }: { from?: number; limit?: number } = {}) {
    const raw = await this.call("get_evals_by_listing", { listing_id: Number(listingId), from_index: from, limit: Math.min(limit, MAX_PAGE) });
    return Eval.array().parse(raw);
  }
  purchase(id: number | string) {
    return this.maybe(Purchase, "get_purchase", { purchase_id: Number(id) });
  }
  leakBudget(listingId: number | string) {
    return this.maybe(LeakBudget, "leak_budget", { listing_id: Number(listingId) });
  }
  async version() {
    return VersionView.parse(await this.call("version"));
  }
}
