import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowViews } from "@arrow/sdk/contract";
import type { Listing } from "@arrow/sdk/schemas";
import type { Metadata } from "next";
import { ErrorBox } from "../../../components/ErrorBox.tsx";
import { teamAccounts } from "../../../generated/data.ts";
import { blockersFor, marketStateFrom } from "../../../lib/blockers.ts";
import { CONTRACTS, parseNetwork } from "../../../lib/config.ts";
import { toListingView } from "../../../lib/server/listingsCache.ts";
import form from "../../../components/form.module.css";
import { BuyFlow } from "./BuyFlow.tsx";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Listing ${id}` };
}

export default async function BuyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ network?: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const net = parseNetwork((await searchParams).network);
  const views = new ArrowViews(net, CONTRACTS[net]);

  let listing: Listing | null = null;
  let programPk: string | null = null;
  let config: Awaited<ReturnType<ArrowViews["config"]>> | null = null;
  let failure: string | null = null;
  try {
    [listing, programPk, config] = await Promise.all([views.listing(id), views.programPubkey(), views.config()]);
  } catch (e) {
    failure = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  }
  if (!failure && !listing) notFound();

  return (
    <div data-ready="true">
      {net === "testnet" ? (
        <div className={form.band} role="note">
          Payments run on mainnet; use <Link href="/try">/try</Link> for the free testnet flow. This page is read-only on testnet.
        </div>
      ) : null}
      {failure || !listing ? (
        <ErrorBox title={`Could not read listing ${id} on ${net}`} fallback="Reload in a minute, or inspect it from the CLI: npm run arrow -- eval --help">
          <p className="mono">{failure}</p>
        </ErrorBox>
      ) : (
        <BuyFlow
          network={net}
          listing={toListingView(listing, teamAccounts)}
          programPk={programPk}
          readOnly={net !== "mainnet"}
          blockers={{
            inspect: blockersFor("eval", marketStateFrom(config!, programPk), listing).map((b) => b.message),
            buy: blockersFor("buy", marketStateFrom(config!, programPk), listing).map((b) => b.message),
          }}
        />
      )}
    </div>
  );
}
