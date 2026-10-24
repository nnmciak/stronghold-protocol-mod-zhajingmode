import { MORTIS_BEAST_CARD, MORTIS_BEAST_TRAIT } from '../../../../shared/mujicaJibian.js';

/** A card's effect view may carry an instance suffix; never read another seat's cards. */
export function mujicaGarrisonsForMatch(garrisons, match, ownerId = null) {
  const pub = match?.public;
  if (!/zhajing/i.test(String(pub?.modeId || '')) && pub?.difficulty !== 'ZHAJING') return garrisons;
  const own = match?.private, field = match?.field;
  const pid = ownerId ?? own?.playerId;
  if (!pid) return garrisons;
  const effects = pid === own?.playerId ? own.effects
    : field?.effectsByPlayer?.[pid] ?? (field?.fieldId === `n:${pid}`
      || field?.players?.length === 1 && field.players[0] === pid ? field?.effects : []);
  const isBeast = (ref) => [ref?.key, ref?.id, ref?.effectId, ref?.data?.effectId]
    .some(v => typeof v === 'string' && v.replace(/^jibian:/, '').split('#')[0] === MORTIS_BEAST_CARD);
  if (!(effects || []).some(isBeast)) return garrisons;
  return garrisons.map(g => g.garrisonId === 'garrison_mujica_mortis'
    ? { ...g, desc: MORTIS_BEAST_TRAIT, descRaw: MORTIS_BEAST_TRAIT } : g);
}
