// HUD боя: HP, волна и таймер, прах, опыт, иконки оружия с кулдаунами.
// Рисуется на том же canvas в экранных координатах (после renderer.end()).
// Все подписи — только через t('ui.hud.*'), ни одной строки текста в коде.

import { drawIcon } from '../engine/sprites.js';

export function createHud(config, t) {
  const h = config.render.hud;
  const pad = h.pad;

  function bar(ctx, x, y, w, hh, frac, bg, fill) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, hh);
    const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    if (f > 0) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, Math.round(w * f), hh);
    }
  }

  function label(ctx, text, x, y, color, align, font) {
    ctx.font = font || FONT;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // run — объект из createRun, me — свой игрок, view — {w, h} экрана
  function draw(ctx, run, me, view) {
    const state = run.state;
    ctx.save();

    // --- левый верх: HP и опыт
    let y = pad;
    const hpFrac = me.maxHp > 0 ? me.hp / me.maxHp : 0;
    bar(ctx, pad, y, h.bar_w, h.bar_h, hpFrac, h.hp_bg,
      hpFrac < LOW_HP ? h.hp_low : h.hp_fill);
    label(ctx, Math.ceil(me.hp) + ' / ' + me.maxHp, pad + h.bar_w / 2, y + 2,
      h.text, 'center');
    y += h.bar_h + 4;

    const xpFrac = me.xpNext > 0 ? me.xp / me.xpNext : 0;
    bar(ctx, pad, y, h.bar_w, XP_H, xpFrac, h.xp_bg, h.xp_fill);
    label(ctx, t('ui.hud.level') + ' ' + me.level, pad, y + XP_H + 3, h.dim);
    y += XP_H + 18;

    // --- иконки оружия с кулдаунами
    const slots = me.slots;
    let sx = pad;
    const sy = y;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      ctx.fillStyle = h.slot_bg;
      ctx.fillRect(sx, sy, h.slot, h.slot);
      ctx.strokeStyle = slot && slot.flash > 0 ? h.crit : h.slot_border;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, h.slot - 1, h.slot - 1);

      if (slot && slot.cfg) {
        const w = slot.cfg;
        if (!drawIcon(ctx, w.texture, sx + h.slot / 2, sy + h.slot / 2, h.slot - 6)) {
          ctx.fillStyle = config.shop.tier_color[w.tier - 1] || h.text;
          ctx.fillRect(sx + 8, sy + 8, h.slot - 16, h.slot - 16);
        }
        // Затемнение снизу вверх по остатку кулдауна
        const total = w.cooldown > 0 ? w.cooldown : 1;
        const frac = slot.cd > 0 ? Math.min(1, slot.cd / total) : 0;
        if (frac > 0) {
          ctx.fillStyle = h.cd_fill;
          ctx.fillRect(sx, sy + h.slot * (1 - frac), h.slot, h.slot * frac);
        }
      }
      sx += h.slot + 4;
    }

    // --- правый верх: волна и таймер
    const right = view.w - pad;
    label(ctx, t('ui.hud.wave') + ' ' + state.wave + ' / ' + config.run.waves,
      right, pad, h.text, 'right', FONT_BIG);
    // В соло лавка ждёт игрока бесконечно — вместо таймера пишем, что идёт лавка
    if (isFinite(state.phaseTime)) {
      const left = state.phaseTime > 0 ? state.phaseTime : 0;
      label(ctx, formatTime(left), right, pad + 20, h.dim, 'right', FONT_BIG);
    } else {
      label(ctx, t('ui.hud.shop'), right, pad + 20, h.dim, 'right', FONT_BIG);
    }

    // --- правый верх ниже: прах
    label(ctx, t('ui.hud.ash') + ' ' + Math.floor(me.ash), right, pad + 44, h.ash, 'right');
    if (state.players.length > 1) {
      label(ctx, t('ui.hud.pot') + ' ' + Math.floor(state.pot), right, pad + 60, h.dim, 'right');
      label(ctx, t('ui.hud.share') + ' ' + Math.floor(state.pot / state.players.length),
        right, pad + 76, h.dim, 'right');
    }

    // --- панель союзников (кооп)
    if (state.players.length > 1) {
      let ay = sy + h.slot + 16;
      for (let i = 0; i < state.players.length; i++) {
        const p = state.players[i];
        if (p.id === me.id) continue;
        // У клиента персонаж союзника приходит из лобби и может ещё не дойти
        const chCfg = config.characters[p.character];
        const color = chCfg ? chCfg.color : h.text;
        label(ctx, p.name, pad, ay, p.alive ? h.text : h.dim);
        bar(ctx, pad, ay + 13, ALLY_BAR_W, 6,
          p.maxHp > 0 ? p.hp / p.maxHp : 0, h.hp_bg, p.alive ? color : h.dim);
        if (!p.alive) label(ctx, t('ui.hud.dead'), pad + ALLY_BAR_W + 6, ay, h.dim);
        ay += 26;
      }
    }

    ctx.restore();
  }

  return { draw };
}

function formatTime(sec) {
  const s = Math.ceil(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? m + ':' + (r < 10 ? '0' : '') + r : String(r);
}

const FONT = '12px monospace';
const FONT_BIG = '16px monospace';
const XP_H = 6;
const LOW_HP = 0.3;
const ALLY_BAR_W = 90;
