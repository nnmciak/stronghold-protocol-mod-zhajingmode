import { matchJibianPlan, HORDE_COUNT_MUL, MATCH_CARDS } from '../server/sim/content/ejibian.js';
console.log('MATCH_CARDS.horde:', MATCH_CARDS.horde);
console.log('单卡 countMul:', JSON.stringify(matchJibianPlan(null, 3, [MATCH_CARDS.horde])?.countMul));
console.log('叠加量变→质变:', JSON.stringify(matchJibianPlan(null, 3, [MATCH_CARDS.horde, MATCH_CARDS.countUp])?.countMul));
console.log('无卡:', JSON.stringify(matchJibianPlan(null, 3, [])));
console.log('HORDE_COUNT_MUL:', HORDE_COUNT_MUL);
