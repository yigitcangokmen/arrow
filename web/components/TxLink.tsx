import type { Network } from "../lib/config.ts";
import { type Chain, shortHash, txUrl } from "../lib/links.ts";

export function TxLink({ chain, network, hash }: { chain: Chain; network: Network; hash: string }) {
  return (
    <a className="mono" href={txUrl(chain, network, hash)} target="_blank" rel="noopener noreferrer" title={hash}>
      {shortHash(hash)}
    </a>
  );
}
