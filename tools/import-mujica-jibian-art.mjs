// Reuse the original E2 face crops and faction glyph; no duplicated or recoloured PNG files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash } from './assets/manifest.mjs';

export function addMujicaJibianArt(assets) {
  const aliases = {
    jibian_yinhezhanjian: assets.bonds?.mujicaShip,
    jibian_yiwangnvshen: assets.chars?.char_4182_oblvns?.avatarE2,
    jibian_duoshouyeshou: assets.chars?.char_4183_mortis?.avatarE2,
  };
  for (const [id, url] of Object.entries(aliases)) {
    if (typeof url !== 'string' || !url.startsWith('/assets/')) throw new Error(`Missing original art: ${id}`);
  }
  Object.assign(assets.items ||= {}, aliases);
  if (assets.stats) assets.stats.items = Object.keys(assets.items).length;
  const { version, hash, generator, stats, ...body } = assets;
  assets.hash = contentHash(body);
  return aliases;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(root, 'data/assets.json');
  const assets = JSON.parse(fs.readFileSync(file, 'utf8'));
  const aliases = addMujicaJibianArt(assets);
  fs.writeFileSync(file, JSON.stringify(assets, null, 2) + '\n');
  console.log(JSON.stringify({ aliases, hash: assets.hash }));
}
