import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './fixture.js';
import {
  swingPose, trailAlpha, makePose,
  SWEEP, SLAM, THRUST, SPIN, LASH, RIP, SAW,
} from '../../static/js/engine/weapon_anim.js';

const KINDS = [SWEEP, SLAM, THRUST, SPIN, LASH, RIP, SAW];
const HALF = Math.PI / 3;

test('поза всегда конечна и в разумных пределах', () => {
  const out = makePose();
  for (const kind of KINDS) {
    for (let i = 0; i <= 40; i++) {
      swingPose(kind, i / 40, HALF, out);
      for (const key of ['angle', 'dist', 'tilt', 'scale']) {
        assert.ok(Number.isFinite(out[key]), `${kind}.${key} не число при k=${i / 40}`);
      }
      assert.ok(out.dist >= 0 && out.dist <= 1.6, `${kind}: вынос ${out.dist}`);
      assert.ok(out.scale > 0.3 && out.scale < 2, `${kind}: масштаб ${out.scale}`);
    }
  }
});

test('прогресс за границами зажимается, а не ломает позу', () => {
  const a = makePose();
  const b = makePose();
  for (const kind of KINDS) {
    swingPose(kind, 0, HALF, a);
    swingPose(kind, -3, HALF, b);
    assert.deepEqual(b, a, `${kind}: k<0 не приравнялся к 0`);
    swingPose(kind, 1, HALF, a);
    swingPose(kind, 9, HALF, b);
    assert.deepEqual(b, a, `${kind}: k>1 не приравнялся к 1`);
  }
});

test('поза непрерывна: соседние кадры не прыгают', () => {
  const a = makePose();
  const b = makePose();
  for (const kind of KINDS) {
    for (let i = 0; i < 60; i++) {
      swingPose(kind, i / 60, HALF, a);
      const prevAngle = a.angle;
      const prevDist = a.dist;
      swingPose(kind, (i + 1) / 60, HALF, b);
      assert.ok(Math.abs(b.angle - prevAngle) < 0.9,
        `${kind}: скачок угла на ${Math.abs(b.angle - prevAngle)} при k=${i / 60}`);
      assert.ok(Math.abs(b.dist - prevDist) < 0.4,
        `${kind}: скачок выноса при k=${i / 60}`);
    }
  }
});

test('дуга идёт от одного края сектора к другому', () => {
  const out = makePose();
  swingPose(SWEEP, 0, HALF, out);
  assert.ok(Math.abs(out.angle + HALF) < 1e-9, 'начало не у левого края сектора');
  swingPose(SWEEP, 1, HALF, out);
  assert.ok(Math.abs(out.angle - HALF) < 1e-9, 'конец не у правого края сектора');
});

test('выпад идёт строго по оси прицела', () => {
  const out = makePose();
  for (let i = 0; i <= 20; i++) {
    swingPose(THRUST, i / 20, HALF, out);
    assert.equal(out.angle, 0);
  }
});

test('выпад выбрасывает оружие вперёд и возвращает', () => {
  const out = makePose();
  swingPose(THRUST, 0, HALF, out);
  const start = out.dist;
  swingPose(THRUST, 0.35, HALF, out);
  const peak = out.dist;
  swingPose(THRUST, 1, HALF, out);
  const end = out.dist;
  assert.ok(peak > start, 'нет выброса вперёд');
  assert.ok(end < peak, 'нет возврата');
});

test('вертушка делает ровно один полный оборот', () => {
  const out = makePose();
  swingPose(SPIN, 0, HALF, out);
  assert.equal(out.angle, 0);
  swingPose(SPIN, 1, HALF, out);
  assert.ok(Math.abs(out.angle - Math.PI * 2) < 1e-9);
});

test('когти делают два прохода, а не один', () => {
  const out = makePose();
  const angles = [];
  for (let i = 0; i <= 20; i++) {
    swingPose(RIP, i / 20, HALF, out);
    angles.push(out.angle);
  }
  // Два прохода — знак углового смещения меняется хотя бы дважды
  let flips = 0;
  for (let i = 1; i < angles.length; i++) {
    if (angles[i] === 0 || angles[i - 1] === 0) continue;
    if (Math.sign(angles[i]) !== Math.sign(angles[i - 1])) flips++;
  }
  assert.ok(flips >= 1, 'порез один, а должно быть два');
});

test('след вспыхивает и гаснет к концу замаха', () => {
  assert.equal(trailAlpha(0), 0);
  assert.ok(trailAlpha(0.15) > 0.99, 'вспышка не достигает максимума');
  assert.ok(trailAlpha(1) < 1e-9, 'след не погас к концу');
  for (let i = 0; i <= 20; i++) {
    const v = trailAlpha(i / 20);
    assert.ok(v >= 0 && v <= 1, `альфа вне 0..1: ${v}`);
  }
});

// Кривая берётся по ключу из конфига — код не должен падать на опечатке
test('неизвестная кривая деградирует в дугу, а не в ошибку', () => {
  const a = makePose();
  const b = makePose();
  swingPose('нет-такой', 0.5, HALF, a);
  swingPose(SWEEP, 0.5, HALF, b);
  assert.deepEqual(a, b);
});

test('каждое ближнее оружие в конфиге имеет известную кривую и след', () => {
  const config = loadConfig();
  const known = new Set(KINDS);
  for (const [id, w] of Object.entries(config.weapons)) {
    if (w.shape.type !== 'arc') continue;
    assert.ok(known.has(w.shape.anim), `${id}: неизвестная кривая ${w.shape.anim}`);
    assert.ok(w.shape.anim_time > 0, `${id}: нет длительности замаха`);
    assert.ok(w.shape.fx, `${id}: нет спрайта следа`);
  }
});

test('каждое стреляющее оружие имеет свой снаряд и режим поворота', () => {
  const config = loadConfig();
  const spins = new Set(['heading', 'none', 'spin']);
  const byTexture = {};
  for (const [id, w] of Object.entries(config.weapons)) {
    if (w.shape.type === 'arc') continue;
    assert.ok(w.shape.texture, `${id}: нет спрайта снаряда`);
    assert.ok(spins.has(w.shape.spin), `${id}: режим поворота ${w.shape.spin}`);
    assert.ok(w.color, `${id}: нет запасного цвета снаряда`);
    const fam = id.replace(/_\d+$/, '');
    (byTexture[w.shape.texture] ||= new Set()).add(fam);
  }
  // Смысл всей затеи: в бою видно, чей выстрел летит
  for (const [tex, fams] of Object.entries(byTexture)) {
    assert.equal(fams.size, 1, `${tex} делят семейства: ${[...fams].join(', ')}`);
  }
});
