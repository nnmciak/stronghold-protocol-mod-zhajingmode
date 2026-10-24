import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../public/js/audio.js';

// Fake only the browser's Web Audio boundary. The actual AudioManager and event
// routing run unchanged, including its asynchronous decode and field lifecycle.
class AudioParam {
  value = 1;
  calls = [];
  setTargetAtTime(value, time, constant) { this.value=value;this.calls.push(['target',value,time,constant]); }
  setValueAtTime(value,time) { this.value=value;this.calls.push(['value',value,time]); }
  linearRampToValueAtTime(value,time) { this.value=value;this.calls.push(['ramp',value,time]); }
  cancelScheduledValues() {}
}
class Gain {
  gain = new AudioParam();
  connect(target) { this.target=target; }
  disconnect() { this.disconnected=true; }
}
class Source {
  loop = false;
  starts = [];
  stops = [];
  connect(target) { this.target=target; }
  disconnect() { this.disconnected=true; }
  start(...args) { this.starts.push(args); }
  stop(...args) { this.stops.push(args);this.onended?.(); }
}
class Context {
  currentTime = 100;
  state = 'running';
  sampleRate = 48000;
  destination = {};
  sources = [];
  createGain() { return new Gain(); }
  createBufferSource() { const s=new Source();this.sources.push(s);return s; }
  createBuffer(channels,length,rate) { return {duration:length/rate,getChannelData:()=>new Float32Array(length)}; }
  addEventListener() {}
  resume() { return Promise.resolve(); }
}
const flush = async () => { await Promise.resolve();await Promise.resolve();await Promise.resolve(); };
const fever = (changes={}) => ({playerId:'p1',active:true,performing:true,vocal:false,value:0,max:450,remaining:20,...changes});
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
function setup({locked=false,decode=null}={}) {
  const manager=new AudioManager({
    getManifest:()=>({audio:{mujicaFever:{instrumental:'/inst.mp3',vocal:'/vocal.mp3'}}}),
    win:{AudioContext:Context,document:{hidden:false},addEventListener(){},removeEventListener(){}},
  });
  if(!locked){manager.ctx=new Context();manager.bgmGain=new Gain();}
  const bgm=new Gain();manager.bgm={gain:bgm,nodes:[]};
  const decoded=[];
  manager._buffer=url=>{decoded.push(url);return decode?decode(url):Promise.resolve({duration:20,url});};
  manager._warn=()=>{};
  return {manager,bgm,decoded};
}

test('Fever replaces BGM, repeated state does not restart, and vocal switches at the same sample position',async()=>{
  const {manager,bgm,decoded}=setup();
  manager.setMujicaFever(fever());await flush();
  const inst=manager.mujicaMusic;
  assert.equal(bgm.gain.value,0);
  assert.deepEqual(inst.starts,[[0,0]]);
  manager.ctx.currentTime=104.25;
  manager.setMujicaFever(fever({remaining:15.75}));await flush();
  assert.equal(manager.mujicaMusic,inst);assert.deepEqual(decoded,['/inst.mp3']);
  manager.setMujicaFever(fever({remaining:15.75,vocal:true}));await flush();
  assert.equal(inst.stops.length,1);
  assert.deepEqual(manager.mujicaMusic.starts,[[0,4.25]]);
  assert.equal(manager.mujicaMusic.buffer.url,'/vocal.mp3');
  manager.ctx.currentTime=107;
  manager.setMujicaFever(fever({remaining:13,vocal:false}));await flush();
  assert.deepEqual(manager.mujicaMusic.starts,[[0,7]]);
});

test('field replacement stops Fever audio and restores the battle music bus',async()=>{
  const {manager,bgm}=setup();
  manager.setMujicaFever(fever());await flush();
  const src=manager.mujicaMusic;
  manager.setFieldUnits([]);await flush();
  assert.equal(src.stops.length,1);
  assert.equal(manager.mujicaMusic,null);
  assert.equal(manager.mujicaStates.size,0);
  assert.equal(bgm.gain.value,1);
});

test('a decode finishing after Fever ended or after field replacement cannot start stale music',async()=>{
  for(const clear of ['end','field']) {
    const pending=deferred();
    const {manager,bgm}=setup({decode:()=>pending.promise});
    manager.setMujicaFever(fever());
    if(clear==='end')manager.setMujicaFever(fever({active:false,remaining:0}));
    else manager.setFieldUnits([]);
    pending.resolve({duration:20});await flush();
    assert.equal(manager.ctx.sources.length,0,clear);
    assert.equal(bgm.gain.value,1,clear);
  }
});

test('a stale instrumental decode cannot replace a newer vocal selection',async()=>{
  const inst=deferred(),vocal=deferred();
  const {manager}=setup({decode:url=>url==='/inst.mp3'?inst.promise:vocal.promise});
  manager.setMujicaFever(fever());
  manager.ctx.currentTime=103;
  manager.setMujicaFever(fever({vocal:true,remaining:17}));
  vocal.resolve({duration:20,url:'/vocal.mp3'});await flush();
  const current=manager.mujicaMusic;
  inst.resolve({duration:20,url:'/inst.mp3'});await flush();
  assert.equal(manager.ctx.sources.length,1);
  assert.equal(manager.mujicaMusic,current);
  assert.deepEqual(current.starts,[[0,3]]);
});

test('null and rejected decoding restore BGM and permit retry of the same active state',async()=>{
  for(const fail of [()=>Promise.resolve(null),()=>Promise.reject(new Error('decode failed'))]) {
    let calls=0;
    const {manager,bgm}=setup({decode:()=>++calls===1?fail():Promise.resolve({duration:20})});
    manager.setMujicaFever(fever());await flush();
    assert.equal(bgm.gain.value,1);
    assert.equal(manager.mujicaMusic,null);
    manager.setMujicaFever(fever({remaining:19}));await flush();
    assert.equal(calls,2);
    assert.ok(manager.mujicaMusic);
    assert.equal(bgm.gain.value,0);
  }
});

test('Fever received before a user gesture is retained and played after audio unlock',async()=>{
  const {manager}=setup({locked:true});
  manager.handleBattleEvents([['fx','mujicaFever',0,0,fever()]]);
  assert.equal(manager.mujicaStates?.get('p1')?.active,true);
  assert.equal(manager.ctx,null);
  manager._unlock();await flush();
  const sources=manager.ctx.sources.filter(s=>s.buffer?.url==='/inst.mp3');
  assert.equal(sources.length,1);
  assert.equal(manager.mujicaMusic,sources[0]);
});

test('the Fever recording plays once, and finishing it restores BGM without restarting on updates',async()=>{
  const {manager,bgm}=setup();
  manager.setMujicaFever(fever());await flush();
  const source=manager.mujicaMusic;
  assert.equal(source.loop,false,'the official excerpt is one-shot');
  manager.ctx.currentTime=120;
  source.onended();
  assert.equal(bgm.gain.value,1);
  manager.setMujicaFever(fever({remaining:10}));await flush();
  assert.equal(manager.ctx.sources.length,1,'no restart within the same Fever');
  manager.setMujicaFever(fever({active:false,remaining:0}));
  manager.setMujicaFever(fever());await flush();
  assert.equal(manager.ctx.sources.length,2,'a new Fever may play again');
});

test('a decoded excerpt whose timeline already finished must not wrap around and replay',async()=>{
  const pending=deferred();
  const {manager,bgm}=setup({decode:()=>pending.promise});
  manager.setMujicaFever(fever());
  manager.ctx.currentTime=125;
  pending.resolve({duration:20});await flush();
  assert.equal(manager.ctx.sources.filter(s=>s.starts.length).length,0);
  assert.equal(bgm.gain.value,1);
});

test('losing the last performer stops this excerpt permanently until the next Fever',async()=>{
  const {manager,bgm}=setup();
  manager.setMujicaFever(fever());await flush();
  const source=manager.mujicaMusic;
  manager.ctx.currentTime=104;
  manager.setMujicaFever(fever({performing:false,remaining:16}));
  assert.equal(source.stops.length,1);
  assert.equal(bgm.gain.value,1);
  manager.ctx.currentTime=105;
  manager.setMujicaFever(fever({performing:true,remaining:15}));await flush();
  assert.equal(manager.ctx.sources.filter(s=>s.starts.length).length,1);
  assert.equal(bgm.gain.value,1);
});

test('battle BGM decoded after Fever started stays muted rather than mixing with the excerpt',async()=>{
  const pending=deferred();
  const {manager}=setup({decode:url=>url==='/battle.mp3'?pending.promise:Promise.resolve({duration:20,url})});
  manager.bgm=null;
  const creating=manager._startBgm('combat',{intro:null,loop:'/battle.mp3'},manager.bgmToken);
  manager.setMujicaFever(fever());await flush();
  assert.ok(manager.mujicaMusic);
  pending.resolve({duration:60,url:'/battle.mp3'});await creating;
  assert.ok(manager.bgm);
  assert.equal(manager.bgm.gain.gain.value,0);
  manager.setMujicaFever(fever({active:false,remaining:0}));
  assert.equal(manager.bgm.gain.gain.value,1);
});
