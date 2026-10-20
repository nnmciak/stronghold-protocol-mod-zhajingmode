// verify-cdn.mjs — end-to-end acceptance of the asset-CDN switchover, against the live server.
const LOCAL = process.argv[2] || 'http://127.0.0.1:3000';
const PUBLIC = process.argv[3] || 'http://59.57.233.35:3000';
const CDN = 'https://weishucdn.jiangjiangze.icu';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const get = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, headers: r.headers, text: await r.text() };
};

for (const base of [LOCAL, PUBLIC]) {
  console.log(`\n================ ${base} ================`);
  const health = await get(`${base}/healthz`);
  ok(health.status === 200 && /"ok":true/.test(health.text), `healthz 200 (${base})`);

  for (const name of ['assets.json', 'local-assets.json', 'emotes.json']) {
    const r = await get(`${base}/data/${name}`, { headers: { 'Accept-Encoding': 'gzip' } });
    ok(r.status === 200, `${name}: 200`);
    const hdr = r.headers.get('x-asset-cdn') || '';
    ok(/cdn/.test(hdr), `${name}: X-Asset-CDN = ${hdr}`);
    const cdnUrls = [...r.text.matchAll(new RegExp(`"${CDN}/(assets|fonts)/[^"]*"`, 'g'))].map((m) => m[0].slice(1, -1));
    const localUrls = [...r.text.matchAll(/"(\/(?:assets|fonts)\/[^"]*)"/g)].map((m) => m[1]);
    console.log(`      ${name}: ${cdnUrls.length} → CDN, ${localUrls.length} → 本机`);
    let json = null;
    try { json = JSON.parse(r.text); } catch {}
    ok(!!json, `${name}: 仍是合法 JSON`);
    // every rewritten URL must carry the version token
    ok(cdnUrls.every((u) => u.includes('?v=')), `${name}: 所有 CDN URL 都带 ?v= 令牌`);

    // spot-check both directions
    for (const u of cdnUrls.slice(0, 5)) {
      const h = await fetch(u, { method: 'HEAD' });
      ok(h.status === 200, `CDN 样本 200: ${u.replace(CDN, '').slice(0, 70)}`);
      ok(h.headers.get('access-control-allow-origin') === '*', `CDN 样本带 CORS: ${u.slice(-40)}`);
    }
    for (const u of localUrls.slice(0, 5)) {
      const h = await fetch(`${CDN}${u}`, { method: 'HEAD' });
      ok(h.status === 404, `本机样本在 CDN 上确实没有(404): ${u.slice(0, 70)}`);
      const l = await fetch(`${base}${u}`, { method: 'HEAD' });
      ok(l.status === 200, `本机样本本地可取(200): ${u.slice(0, 70)}`);
    }
  }

  // the page itself must still load
  const home = await get(base);
  ok(home.status === 200 && /STRONGHOLD PROTOCOL|卫戍协议/.test(home.text), `首页 200 且内容正常 (${base})`);
}

console.log(`\n================ ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} ================`);
process.exit(failures === 0 ? 0 : 1);
