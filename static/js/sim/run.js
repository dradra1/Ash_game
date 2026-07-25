// Состояние забега (M0): движение игроков по вводу, приходящему ТОЛЬКО через
// транспорт. Симуляция не знает, соло это или кооп. Рандом — из createRng(seed).

import { createRng } from '../engine/rng.js';
import { CH } from '../net/transport.js';

// dir: 0=S, 1=E, 2=N, 3=W
export function createRun({ config, seed, transport, players }) {
  const rng = createRng(seed);
  const arenaW = config.arena.size[0];
  const arenaH = config.arena.size[1];
  const pad = config.arena.wall_padding;
  const speed = config.player.move_speed;
  const baseHp = config.player.base.max_hp;

  const state = { wave: 1, phase: 'wave', time: 0, seed, players: [] };

  for (let i = 0; i < players.length; i++) {
    state.players.push({
      id: players[i].id,
      name: players[i].name,
      character: players[i].character,
      // небольшой детерминированный разброс точек спавна от сида
      x: arenaW / 2 + rng.range(-1, 1) * config.player.radius * (i + 1),
      y: arenaH / 2 + rng.range(-1, 1) * config.player.radius * (i + 1),
      vx: 0,
      vy: 0,
      hp: baseHp,
      maxHp: baseHp,
      dir: 0,
      alive: true,
    });
  }

  function findPlayer(id) {
    for (let i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  // Последний ввод игрока → его текущая скорость. Вектор длины ≤ 1.
  function applyInput(playerId, input) {
    const p = findPlayer(playerId);
    if (!p || !p.alive || !input) return;
    let x = input.x || 0;
    let y = input.y || 0;
    const len = Math.sqrt(x * x + y * y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    p.vx = x * speed;
    p.vy = y * speed;
  }

  transport.on(CH.INPUT, (payload, fromId) => {
    if (!payload) return;
    const pid = payload.id !== undefined ? payload.id : fromId;
    applyInput(pid, payload);
  });

  function step(dt) {
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (!p.alive) continue;
      if (p.vx !== 0 || p.vy !== 0) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < pad) p.x = pad; else if (p.x > arenaW - pad) p.x = arenaW - pad;
        if (p.y < pad) p.y = pad; else if (p.y > arenaH - pad) p.y = arenaH - pad;
        // направление по доминирующей оси вектора движения
        if (p.vx * p.vx > p.vy * p.vy) p.dir = p.vx > 0 ? 1 : 3;
        else p.dir = p.vy > 0 ? 0 : 2;
      }
    }
    state.time += dt;
  }

  // Переиспользуемый объект снапшота (M0: мир — это только игроки)
  const snap = { wave: 1, phase: 'wave', time: 0, seed, players: state.players };

  function snapshot() {
    snap.wave = state.wave;
    snap.phase = state.phase;
    snap.time = state.time;
    return snap;
  }

  const stats = { entities: state.players.length };

  return { state, step, applyInput, snapshot, stats };
}
