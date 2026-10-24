// One art resolver for the draft, the collection and owned-effect cards.
// iconBond is presentation only; bond remains the gameplay affiliation.
import { assetsItemIconUrl, bondIconUrl } from './assetUrls.js';

export function jibianArtId(card) {
  const id = card?.effectId || card?.jibianId || card?.data?.effectId || card?.id || card?.iconId;
  return typeof id === 'string' ? id.replace(/^jibian:/, '').split('#')[0] : null;
}

export function resolveJibianArt(manifest, card) {
  const id = jibianArtId(card);
  const bondId = card?.iconBond || card?.bond || null;
  return {
    id, bondId,
    whiteGlyph: !!card?.iconBond,
    icon: (bondId && bondIconUrl(manifest, bondId)) || assetsItemIconUrl(manifest, id),
  };
}
