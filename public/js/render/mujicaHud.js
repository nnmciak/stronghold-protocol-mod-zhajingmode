// Fever values come from the deterministic simulation; no independent UI clock.
export function createMujicaHud(host) {
  const root = document.createElement('div');
  root.className = 'mujica-fever-hud';
  root.hidden = true;
  root.style.cssText = 'position:absolute;right:16px;bottom:20%;z-index:8;pointer-events:none;display:grid;gap:6px;max-width:230px;font:12px Bender,Arial,sans-serif;color:#fff;';
  const rows = new Map();
  host.appendChild(root);
  return {
    update(s) {
      if (!s || s.playerId == null) return;
      root.hidden = false;
      let row = rows.get(s.playerId);
      if (!row) {
        const el = document.createElement('div');
        el.style.cssText = 'width:200px;padding:9px 12px;background:rgba(17,12,28,.88);border:1px solid #88769c;border-radius:3px;box-shadow:0 2px 12px #0008;';
        const label = document.createElement('div');
        const progress = document.createElement('div');
        progress.style.cssText = 'height:5px;background:#34263f;margin-top:7px;overflow:hidden';
        const fill = document.createElement('div');
        fill.style.cssText = 'height:100%;background:linear-gradient(90deg,#8760be,#ffcae8);transition:width .15s linear';
        progress.appendChild(fill); el.append(label, progress); root.appendChild(el);
        row = { el, label, fill }; rows.set(s.playerId, row);
      }
      const percent = s.active ? Math.max(0, Math.min(1, s.remaining / 20)) : Math.max(0, Math.min(1, s.value / (s.max || 450)));
      row.label.textContent = s.active ? `FEVER!  ${Math.max(0, s.remaining).toFixed(1)}s${s.vocal ? ' · Ave Mujica' : ''}`
        : `颂乐人偶  FEVER ${Math.floor(s.value)} / ${s.max || 450}`;
      row.fill.style.width = `${percent * 100}%`;
      row.el.style.borderColor = s.active ? '#ffc2e8' : '#88769c';
    },
    clear() { root.hidden = true; root.replaceChildren(); rows.clear(); },
    destroy() { root.remove(); rows.clear(); },
  };
}
