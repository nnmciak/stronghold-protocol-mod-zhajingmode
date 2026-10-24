// Asset URL resolution against data/assets.json (docs/ASSETS.md). Pure: every function takes the
// manifest object (or null) and returns a URL string or null — callers draw their own fallback
// (glyph, CSS shape) when null. Only URLs present in the manifest are ever returned, so the client
// never requests files the asset pipeline did not produce (no 404 noise in the console).

const str = (v) => (typeof v === 'string' && v ? v : null);
const obj = (v) => (v && typeof v === 'object' ? v : null);

/** @param {any} m manifest @param {string} key 'group/key' */
export function uiUrl(m, key) {
  return str(obj(obj(m)?.ui)?.[key]);
}

/**
 * Operator avatar for a chess record (golden → E2 art when present).
 * @param {any} m manifest
 * @param {any} chess chess.json record (or { assets: { avatar } })
 */
export function chessAvatarUrl(m, chess) {
  const chars = obj(obj(m)?.chars);
  const id = str(chess?.assets?.avatar) || str(chess?.charId);
  if (!chars || !id) return null;
  if (id.endsWith('_2') && !chars[id]) {
    const base = chars[id.slice(0, -2)];
    return str(base?.avatarE2) || str(base?.avatar);
  }
  return str(chars[id]?.avatar) || (chess?.charId ? str(chars[chess.charId]?.avatar) : null);
}

/**
 * Half-body portrait (180×360) for a chess record (golden → E2 portrait when present).
 *
 * 干员皮肤 (docs/SKINS.md): `opts.skin` asks for the skin's own illustration first. It is keyed by OPERATOR —
 * `data/assets.json → chars[charId].skins[skinId].portrait` — so a `char_*` id works as well as a chess id
 * (the 换装 tab and the 自选编队 both pick per operator). A skin with no exported illustration falls through to the
 * default portrait rather than showing a broken frame, which is what the ~99 skins without one would do otherwise.
 *
 * @param {any} m
 * @param {any} chess
 * @param {{ skin?: string | null }} [opts]
 */
export function chessPortraitUrl(m, chess, opts) {
  const chars = obj(obj(m)?.chars);
  const id = str(chess?.assets?.portrait);
  if (!chars) return null;

  const skinId = str(opts && opts.skin);
  if (skinId) {
    const charId = str(chess?.charId) || (id ? id.replace(/_[12]$/, '') : '');
    const rec = charId ? chars[charId] : null;
    const skinArt = rec && rec.skins ? rec.skins[skinId] : null;
    const bySkin = skinArt ? str(skinArt.portrait) : null;
    if (bySkin) return bySkin;
  }

  if (id) {
    if (id.endsWith('_2')) {
      const base = chars[id.slice(0, -2)];
      if (base) return str(base.portraitE2) || str(base.portrait);
    }
    if (id.endsWith('_1')) {
      const base = chars[id.slice(0, -2)];
      if (base) return str(base.portrait);
    }
  }
  const byChar = chess?.charId ? chars[chess.charId] : null;
  if (!byChar) return null;
  return (chess?.isGolden ? str(byChar.portraitE2) : null) || str(byChar.portrait);
}

/** 皮肤立绘是不是【官方商店立绘】(assets/char/skin_portrait_shop/)。
 *
 * 为什么要区分:官方那批图是游戏自己为商店卡片裁好的,构图与卡片天生契合,直接铺满格子会显得
 * 比原版更"满";而自裁的那批(官方合集里没有的皮肤)人物偏小、四周留白多,必须铺满才好看。
 * 于是卡片样式分两种 —— 官方图保持卡片的原样(带核心盟约水印和底部渐隐),自裁图才铺满。
 */
export function isOfficialSkinArt(m, chess, opts) {
  const url = chessPortraitUrl(m, chess, opts);
  if (!url) return false;
  const charId = str(chess?.charId) || str(chess?.assets?.portrait)?.replace(/_[12]$/, '');
  const skin = obj(obj(obj(m)?.chars)?.[charId])?.skins?.[str(opts?.skin)];
  // Original 180×360 skin portraits use the same half-body framing as default art.
  // Their source folder is skin_portrait, so folder-only detection treated them as
  // full-card custom crops and enlarged faces with object-fit:cover.
  return url.indexOf('/skin_portrait_shop/') >= 0
    || (!!str(skin?.portrait) && skin.portraitLayout === 'half-body');
}

/** Skill icon of a chess record (manifest `skills[iconId]`, else the empty skill sprite). */
export function skillIconUrl(m, chess) {
  const skills = obj(obj(m)?.skills);
  const id = str(chess?.assets?.skillIcon) || str(chess?.skill?.iconId) || str(chess?.skill?.skillId);
  if (skills && id && skills[id]) return str(skills[id]);
  const byId = obj(obj(m)?.skillsById);
  const alt = byId && chess?.skill?.skillId ? byId[chess.skill.skillId] : null;
  if (skills && alt && skills[alt]) return str(skills[alt]);
  return uiUrl(m, 'skillIcon/empty');
}

/**
 * Skill icon of one skill record (DESIGN §16 `skills[]`: iconId / skillId), else the empty skill sprite — or null with
 * `{ empty: false }` (the asset manifest only carries the default skills' icons: callers then draw a lettered S1–S3
 * tile instead of a blank square).
 */
export function skillRecordIconUrl(m, skill, { empty = true } = {}) {
  const skills = obj(obj(m)?.skills);
  for (const id of [str(skill?.iconId), str(skill?.skillId)]) if (skills && id && skills[id]) return str(skills[id]);
  const byId = obj(obj(m)?.skillsById);
  const alt = byId && skill?.skillId ? byId[skill.skillId] : null;
  if (skills && alt && skills[alt]) return str(skills[alt]);
  return empty ? uiUrl(m, 'skillIcon/empty') : null;
}

const PROF_KEY = {
  PIONEER: 'pioneer', WARRIOR: 'warrior', TANK: 'tank', SNIPER: 'sniper', CASTER: 'caster', MEDIC: 'medic',
  SUPPORT: 'support', SPECIAL: 'special',
};

/** Profession icon (small white glyph). */
export function profIconUrl(m, profession) {
  const k = PROF_KEY[String(profession || '').toUpperCase()];
  return k ? str(obj(obj(obj(m)?.prof)?.icon)?.[k]) : null;
}

/** Sub-profession icon from a chess record (`assets.subProfIcon` = 'sub_<id>_icon'). */
export function subProfIconUrl(m, chess) {
  const sub = obj(obj(obj(m)?.prof)?.sub);
  if (!sub) return null;
  const raw = str(chess?.assets?.subProfIcon);
  const id = raw ? raw.replace(/^sub_/, '').replace(/_icon$/, '') : str(chess?.subProfessionId);
  return id ? str(sub[id]) : null;
}

/** Bond glyph (white; tint in CSS). */
export function bondIconUrl(m, bondId) {
  return bondId ? str(obj(obj(m)?.bonds)?.[bondId]) : null;
}

/** Band (strategy) icon. */
export function bandIconUrl(m, bandId) {
  return bandId ? str(obj(obj(m)?.bands)?.[bandId]) : null;
}

/** Item icon for an items.json record (by trapId / iconId) or a raw trap id. */
export function itemIconUrl(m, item) {
  const items = obj(obj(m)?.items);
  if (!items) return null;
  if (typeof item === 'string') return str(items[item]);
  return str(items[item?.iconId]) || str(items[item?.trapId]);
}

/**
 * Item icon by a RAW `assets.items` key — no items.json record needed (docs/ASSETS.md `items`). A 惊变 card
 * (config `modes[*].jibian.pool` entry → server cardView `id`) has neither an items.json record nor a bond, while
 * `data/assets.json` `items` registers one key per card that has its own art (`jibian_gaoluzhipiao`, …): this is how
 * the pick overlay's card face draws it. Deliberately NOT named `effectIconUrl` — that name is already taken below
 * by the `m.private.effects` entry resolver ({ iconKind, iconId }).
 * @param {any} m manifest @param {string} key an `assets.items` key (an effect / 惊变 card id)
 */
export function assetsItemIconUrl(m, key) {
  return typeof key === 'string' && key ? str(obj(obj(m)?.items)?.[key]) : null;
}

/** Enemy icon (manifest keeps fallbacks resolved). */
export function enemyIconUrl(m, enemyKey) {
  const e = enemyKey ? obj(obj(obj(m)?.enemies)?.[enemyKey]) : null;
  if (e?.icon) return str(e.icon);
  // `_2` / `_3` variants fall back to their base enemy
  const base = typeof enemyKey === 'string' ? enemyKey.replace(/_\d+$/, '') : null;
  return base && base !== enemyKey ? str(obj(obj(obj(m)?.enemies)?.[base])?.icon) : null;
}

/** Token avatar, falling back to its owner operator's avatar. */
export function tokenAvatarUrl(m, tokenId) {
  const tokens = obj(obj(m)?.tokens);
  const t = tokenId ? obj(tokens?.[tokenId]) : null;
  if (t?.avatar) return str(t.avatar);
  if (t?.owner) return str(obj(obj(obj(m)?.chars)?.[t.owner])?.avatar);
  return null;
}

/** Faction (特训敌人 type) icon: `enemyTypeIcon/<icon>`. */
export function factionIconUrl(m, iconId) {
  return iconId ? uiUrl(m, `enemyTypeIcon/${iconId}`) : null;
}

/** Title (评语) icon: `titleIcon/<picId>`. */
export function titleIconUrl(m, picId) {
  return picId ? uiUrl(m, `titleIcon/${picId}`) : null;
}

/** Greek type letters of some modules (ISW-α, …) → the Latin letter of the client's icon file names (isw-a). */
const GREEK = { 'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'Δ': 'd' };
/** Lower-cased key → path index of a local `groups.module` object (built once per manifest object). */
const moduleIconIndex = new WeakMap();

/**
 * Official module (uniequip) TYPE icon from the local-client art (DESIGN §13 / §16): `data/local-assets.json`
 * `groups.module[<type>]`, matched case-insensitively against the module's typeName ('MAR-X' → key 'mar-x', 'PRI-X' →
 * key 'PRI-X' — the client's file names are mixed case). null when the manifest, the group or the entry is missing
 * (callers draw the lettered tile / type text instead).
 * @param {any} local the local-art manifest (`data.get('local')`) or null
 * @param {string} typeName e.g. 'MAR-X'
 */
export function moduleTypeIconUrl(local, typeName) {
  const g = obj(obj(obj(local)?.groups)?.module);
  const t = str(typeName)?.trim();
  if (!g || !t) return null;
  const exact = str(obj(g[t])?.path);
  if (exact) return exact;
  let idx = moduleIconIndex.get(g);
  if (!idx) {
    idx = new Map();
    for (const [k, v] of Object.entries(g)) {
      const p = str(obj(v)?.path);
      if (p && !idx.has(k.toLowerCase())) idx.set(k.toLowerCase(), p);
    }
    moduleIconIndex.set(g, idx);
  }
  const key = t.replace(/[αβγδΔ]/g, (c) => GREEK[c]).toLowerCase();
  return idx.get(key) || null;
}

/**
 * Icon for an m.private.effects entry: { iconKind: 'band'|'choice'|'team'|'item'|'garrison', iconId }.
 * @param {any} m
 * @param {{ iconKind?: string, iconId?: string }} eff
 */
export function effectIconUrl(m, eff) {
  const kind = eff?.iconKind;
  const id = str(eff?.iconId);
  if (kind === 'band') return bandIconUrl(m, id) || (id && id.startsWith('icon_') ? bandIconUrl(m, `band_${id.slice(5)}`) : null);
  if (kind === 'item') return itemIconUrl(m, id);
  if (kind === 'garrison') return uiUrl(m, `garrisonTypeIcon/${id || 's_icon_bond'}`) || uiUrl(m, 'garrisonTypeIcon/s_icon_bond');
  if (kind === 'team') return uiUrl(m, `buffIcon/${id && id.startsWith('icon_') ? id : 'icon_team_buff'}`);
  if (kind === 'choice') return uiUrl(m, `buffIcon/${id && id.startsWith('icon_') ? id : 'icon_player_buff'}`);
  return id ? uiUrl(m, `buffIcon/${id}`) : null;
}
