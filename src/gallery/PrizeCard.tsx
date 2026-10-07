import { formatCategory, formatPrice, publisherPageUrl } from '@/format';

import type { PublicAsset } from '../../server/payloads.ts';

export function PrizeCard({ asset }: { asset: PublicAsset }) {
  const category = formatCategory(asset.category);
  const price = formatPrice(asset.priceCents);
  const publisherLabel = asset.publisher ?? 'Unknown publisher';
  const storeUrl = publisherPageUrl(asset.publisherId);

  return (
    <article className="prize">
      <div className="prize-media">
        {/* The title link below is the accessible one; this one only widens the click target. */}
        <a aria-hidden="true" href={asset.assetUrl} rel="noreferrer" tabIndex={-1} target="_blank">
          {asset.imageUrl === null
            ? <span className="prize-media-empty">No image</span>
            : <img alt="" loading="lazy" src={asset.imageUrl} />}
        </a>
        {price === '' ? null : <span className="prize-price">{price}</span>}
      </div>
      <div className="prize-text">
        <h2 className="prize-title">
          <a href={asset.assetUrl} rel="noreferrer" target="_blank">{asset.name}</a>
        </h2>
        <p className="prize-publisher">
          {storeUrl === null ? publisherLabel : <a href={storeUrl} rel="noreferrer" target="_blank">{publisherLabel}</a>}
        </p>
        <p className="prize-category" title={category ?? undefined}>{category ?? ''}</p>
      </div>
    </article>
  );
}
