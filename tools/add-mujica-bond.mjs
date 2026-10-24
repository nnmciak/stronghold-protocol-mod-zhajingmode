// Custom 炸惊 rules supplied by the project owner; official operator records are imported separately.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const write = (p, v) => fs.writeFileSync(path.join(root, p), JSON.stringify(v, null, 2) + '\n');
const bonds = read('data/bonds.json');
const codes = ['oblvns', 'mortis', 'dolris', 'amoris', 'tmoris'];
const members = codes.map((c) => `chess_zj_${c}_a`);
const bb = { base_attack_speed: bonds.siracusaShip.bb.base_attack_speed,
  attack_speed_per_stack: bonds.siracusaShip.bb.attack_speed_per_stack,
  base_atk: bonds.yanShip.bb.base_atk, atk_per_stack: bonds.yanShip.bb.atk_per_stack };
const desc = '【颂乐人偶】干员攻击速度提升（受层数影响）\n每刷新6次，获得1名阶级不超过调度中心的随机【颂乐人偶】干员\n<在场3名不同【颂乐人偶】干员>每次开启技能，使已激活的【颂乐人偶】层数+2\n<在场4名不同【颂乐人偶】干员>攻击力提升（受层数影响）\n<在场5名不同【颂乐人偶】干员>每次开启技能使Fever+10';
const effect = desc.replace('攻击速度提升（受层数影响）', '攻击速度+{0:0.0}（受层数影响）')
  .replace('攻击力提升（受层数影响）', '攻击力+{1:0%}（受层数影响）');
bonds.mujicaShip = {
  bondId: 'mujicaShip', name: '颂乐人偶', identifier: 28, isCore: true, zjOnly: true,
  bondType: 'REGULAR', bondOrder: 101, powerIdList: ['mujica'], iconId: 'icon_mujicaShip',
  activeCount: 2, thresholds: [2, 3, 4, 5], maxCount: 5, thresholdTemplate: 'count_threshold_upward',
  countMode: 'BOARD', countsHand: false, countsGoldenOnly: false, activeType: 'BATTLE',
  isActiveInDeck: false, noStack: false, weight: 10, maxInactiveBondCount: -1, layerMilestones: [],
  desc, descRaw: desc, effectId: 'bondeffect_mujica', effectName: '颂乐人偶',
  effectDesc: effect, effectDescRaw: effect,
  effectDescParams: [
    { index: 0, format: '0.0', base: 'base_attack_speed', perStack: 'attack_speed_per_stack' },
    { index: 1, format: '0%', base: 'base_atk', perStack: 'atk_per_stack' },
  ],
  bb, bbStr: {}, buffs: [], baseParams: ['base_attack_speed', 'base_atk'],
  perStackParams: ['attack_speed_per_stack', 'atk_per_stack'], members, visibleMembers: members,
  zj: { members, visibleMembers: members },
};
write('data/bonds.json', bonds);
const descriptions = {
  oblvns: '<战斗开始时>获得等于【颂乐人偶】层数一半的Fever（不超过Fever上限）；【颂乐人偶】每叠加3层，本干员攻击力+2%',
  mortis: '【颂乐人偶】【不屈】每叠加3层，本干员攻击附带相当于攻击力2%的凋亡损伤；若目标处于凋亡损伤爆发期间，还将额外附带相当于攻击力2%的元素伤害（每满3层递增一档）',
  dolris: '<战斗中>每次治疗干员时，使自身已激活的盟约层数+2',
  amoris: '<休整期结束时>使下个休整期额外获得2资金（若已激活【颂乐人偶】，此特质在整备区也有效）；<部署时>使自身已激活的盟约层数+2',
  tmoris: '<刷新时>使已激活的【颂乐人偶】【迅捷】层数+2，每次休整期最多触发5次',
};
const garrisons = read('data/garrisons.json');
for (const code of codes) {
  const garrisonId = `garrison_mujica_${code}`;
  const eventType = code === 'amoris' ? 'SERVER_PREP_FIN' : code === 'tmoris' ? 'SERVER_REFRESH_SHOP' : 'IN_BATTLE';
  garrisons[garrisonId] = { garrisonId, desc: descriptions[code], descRaw: descriptions[code],
    eventType, eventTypeDesc: eventType === 'IN_BATTLE' ? '作战能力' : '整备能力',
    eventTypeIcon: eventType === 'IN_BATTLE' ? 'icon_battle' : 'icon_server', effectType: 'GAIN_BUFF',
    effectKey: `MUJICA_${code.toUpperCase()}`, charLevel: 0, bb: {},
    bbStr: code === 'tmoris' ? { conditionkey: 'character_target_inboard' } : {},
    owners: ['a', 'b'].map((suffix) => `chess_zj_${code}_${suffix}`),
  };
}
write('data/garrisons.json', garrisons);
console.log('Wrote 颂乐人偶 and five custom garrisons.');
