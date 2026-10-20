import { fxAtlas } from './textures.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class StatusAura {
  constructor(P, parent, hud) {
    const textures = fxAtlas().tex;
    this.root = new P.Container();
    // ★ 2026-10-18 移植适配：本项目的 hud 容器挂在 ctx.layers.bars 上、不是 root 的子节点，
    //   所以 indexOf 会返回 -1 —— 有就插在 hud 之前，没有就直接追加到 parent 末尾。
    const at = hud ? parent.children.indexOf(hud) : -1;
    if (at >= 0) parent.addChildAt(this.root, at);
    else parent.addChild(this.root);
    this.smoke = Array.from({ length: 3 }, () => {
      const dark = new P.Sprite(textures.soft);
      dark.anchor.set(0.5);
      dark.tint = 0x050607;
      dark.blendMode = P.BLEND_MODES.NORMAL;
      const mist = new P.Sprite(textures.smoke);
      mist.anchor.set(0.5);
      mist.tint = 0x383d42;
      mist.blendMode = P.BLEND_MODES.NORMAL;
      const edge = new P.Sprite(textures.soft);
      edge.anchor.set(0.5);
      edge.tint = 0x252b30;
      edge.blendMode = P.BLEND_MODES.NORMAL;
      this.root.addChild(edge, dark, mist);
      return { dark, mist, edge };
    });
    this.hexes = Array.from({ length: 3 }, () => {
      const sprite = new P.Sprite(textures.hex);
      sprite.anchor.set(0.5);
      sprite.tint = 0xa955ee;
      sprite.blendMode = P.BLEND_MODES.ADD;
      this.root.addChild(sprite);
      return sprite;
    });
  }

  update(time, tileSize, bodyHeight, stealth, refraction, quality, loadLevel) {
    this.root.visible = stealth || refraction;
    if (!this.root.visible) return;

    const height = clamp(bodyHeight, tileSize * 0.7, tileSize * 3.2);
    const width = clamp(tileSize * 0.8, 32, 180);
    const reduced = quality === 'low' || loadLevel >= 2;

    for (let index = 0; index < this.smoke.length; index++) {
      const { dark, mist, edge } = this.smoke[index];
      dark.visible = mist.visible = edge.visible = stealth && (!reduced || index < 2);
      if (!dark.visible) continue;
      const phase = (time * 0.32 + index / this.smoke.length) % 1;
      const fade = Math.sin(Math.PI * phase);
      const size = width * (0.64 + phase * 0.12) / 128;
      dark.position.set(width * (index - 1) * 0.15 + Math.sin(time * 0.9 + index * 2) * width * 0.05,
        -height * (0.24 + phase * 0.5));
      dark.scale.set(size, size * 1.15);
      dark.alpha = 0.68 * fade;
      edge.position.set(dark.position.x + width * (index - 1) * 0.04, dark.position.y - height * 0.02);
      edge.scale.set(size, size * 1.1);
      edge.alpha = 0.24 * fade;
      mist.position.set(dark.position.x + width * 0.03, dark.position.y - height * 0.02);
      mist.scale.set(size, size * 1.2);
      mist.alpha = 0.5 * fade;
      mist.rotation = Math.sin(time * 0.35 + index) * 0.2;
    }

    for (let index = 0; index < this.hexes.length; index++) {
      const sprite = this.hexes[index];
      sprite.visible = refraction && (!reduced || index < 2);
      if (!sprite.visible) continue;
      const phase = (time * 0.68 + index / this.hexes.length) % 1;
      const fade = Math.sin(Math.PI * phase);
      const size = width * (0.42 + 0.08 * Math.sin(index * 3)) / 128;
      sprite.position.set(width * (index - 1) * 0.24 + Math.sin(time * 1.3 + index) * width * 0.04,
        -height * (0.18 + phase * 0.64));
      sprite.scale.set(size * 0.7, size * 1.4);
      sprite.alpha = 0.95 * fade;
      sprite.rotation = 0.18 + Math.sin(time * 0.5 + index) * 0.05;
    }
  }
}
