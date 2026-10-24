import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as runtime from '@pixi-spine/runtime-3.8';
import { hasClipping, requiresExactClipping, pointInPolygon, SpineActor } from '../public/js/render/spine.js';

// Read the real official skeleton. Textureless attachments keep this regression independent of a GPU.
const loader = {};
for (const kind of ['Region', 'Mesh', 'BoundingBox', 'Path', 'Point', 'Clipping']) {
  loader[`new${kind}Attachment`] = (_skin, name) => new runtime[`${kind}Attachment`](name);
}
function skeleton(side, skin = true) {
  const stem = skin ? 'char_4183_mortis_avemujica_1' : 'char_4183_mortis';
  const folder = `public/assets/spine/op/char_4183_mortis/${skin ? `${stem}/` : ''}${side}/${stem}.skel`;
  return new runtime.SkeletonBinary(loader).readSkeletonData(new Uint8Array(readFileSync(folder)));
}
function actorFor(data) {
  const slots = data.defaultSkin.getAttachments().filter(e => e.attachment.type === 6).map(e => {
    const graphic = { name: e.attachment.name, renderable: false };
    return { currentGraphics: graphic, clippingContainer: { mask: graphic } };
  });
  return Object.assign(Object.create(SpineActor.prototype), {
    clipped: hasClipping(data), exactClipping: requiresExactClipping(data), clipOn: true,
    _clipHidden: new Set(), spine: { skeleton: { slots } },
  });
}

for (const side of ['front', 'back']) {
  test(`Mortis skin ${side}: mirror clips remain enabled when quality/crowd disables eyelid masks`, () => {
    const data = skeleton(side);
    const clips = data.defaultSkin.getAttachments().filter(e => e.attachment.type === 6);
    const mirrors = clips.filter(e => /F_Weapon_Side/.test(e.attachment.endSlot?.name));
    assert.equal(mirrors.length, 2, 'official skeleton contains the two mirror reflection masks');
    assert.ok(mirrors.every(e => e.attachment.worldVerticesLength === 12));
    const actor = actorFor(data);
    for (const budget of [false, true, false]) {
      actor.setClipping(budget);
      assert.equal(actor.clipOn, true);
      assert.ok(actor.spine.skeleton.slots.every(s => s.clippingContainer.mask === s.currentGraphics));
    }
  });

  test(`Mortis default ${side}: existing eyelid-only performance fallback remains available`, () => {
    const actor = actorFor(skeleton(side, false));
    assert.equal(actor.exactClipping, false);
    actor.setClipping(false);
    assert.equal(actor.clipOn, false);
    assert.ok(actor.spine.skeleton.slots.every(s => s.clippingContainer.mask === null));
    actor.setClipping(true);
    assert.equal(actor.clipOn, true);
    assert.ok(actor.spine.skeleton.slots.every(s => s.clippingContainer.mask === s.currentGraphics));
  });

  test(`Mortis skin ${side}: moving mirror clips stay valid through every animation`, () => {
    const data = skeleton(side);
    const skel = new runtime.Skeleton(data);
    let samples = 0;
    for (const animation of data.animations) {
      for (let i = 0; i <= 24; i++) {
        skel.setToSetupPose();
        animation.apply(skel, -1, animation.duration * i / 24, false, [], 1, 0, 0);
        skel.updateWorldTransform();
        for (const slot of skel.drawOrder) {
          const att = slot.getAttachment();
          if (att?.type !== 6 || !/F_Weapon_Side/.test(att.endSlot?.name)) continue;
          const vertices = new Float32Array(att.worldVerticesLength);
          att.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2);
          assert.ok([...vertices].every(Number.isFinite), `${animation.name}: valid animated mirror polygon`);
          samples++;
        }
      }
    }
    assert.ok(samples > 100, 'exercise the actual mirror masks through idle, skills, deploy and doll animations');
  });

  test(`Mortis skin ${side}: Idle at 6 seconds reproduces the strip that centre-point culling cannot crop`, () => {
    const data = skeleton(side);
    const skel = new runtime.Skeleton(data);
    data.findAnimation('Idle').apply(skel, -1, 6, false, [], 1, 0, 0);
    skel.updateWorldTransform();
    const slot = skel.slots.find(s => s.data.name === (side === 'front' ? 'Front3' : 'Front2'));
    const clip = slot.getAttachment();
    const poly = new Float32Array(clip.worldVerticesLength);
    clip.computeWorldVertices(slot, 0, poly.length, poly, 0, 2);
    const reflectionSlot = skel.slots[clip.endSlot.index];
    const reflection = reflectionSlot.getAttachment();
    const vertices = new Float32Array(reflection.worldVerticesLength);
    reflection.computeWorldVertices(reflectionSlot, 0, vertices.length, vertices, 0, 2);
    let cx = 0, cy = 0;
    for (let i = 0; i < vertices.length; i += 2) {
      cx += vertices[i]; cy += vertices[i + 1];
      assert.equal(pointInPolygon(vertices[i], vertices[i + 1], poly, poly.length / 2), false,
        'every corner of the reflection strip extends beyond the mirror');
    }
    assert.equal(pointInPolygon(cx / (vertices.length / 2), cy / (vertices.length / 2), poly, poly.length / 2), true,
      'old fallback shows the entire uncut strip because its centre is inside the mirror');
    assert.equal(requiresExactClipping(data), true, 'this real geometry must retain its exact stencil');
  });
}

test('an unrecognised non-eye clipping attachment cannot silently degrade to centre-point culling', () => {
  const data = { slots: [{ name: 'reflection-mask' }], skins: [{
    getAttachments: () => [{ slotIndex: 0, attachment: { type: 6, name: 'mask', endSlot: { name: 'reflection' } } }],
  }] };
  assert.equal(requiresExactClipping(data), true);
  assert.equal(requiresExactClipping({ skins: [] }), false);
});
