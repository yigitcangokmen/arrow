"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { footerNetText, viewedNetwork } from "../lib/footerNet.ts";

/** The footer's network words for the page being viewed. Rendered inside the footer's <Suspense> (it reads ?network=). */
export function FooterNet({ live }: { live: boolean }) {
  return <>{footerNetText(viewedNetwork(usePathname() ?? "/", useSearchParams().get("network")), live)}</>;
}
