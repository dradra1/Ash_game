// Дебаг-оверлей по F3: fps, мс sim/render, шаги, сущности, сеть, роль, сид.
// Рисуется только когда visible — вне горячего пути.

const FONT = '12px monospace';
const LINE_H = 14;
const PAD = 6;
const BOX_W = 210;
const LINES = 9;

export function createDebug(loop, transport) {
  return {
    visible: false,

    toggle() {
      this.visible = !this.visible;
    },

    draw(ctx, extra) {
      const s = loop.stats;
      const entities = extra ? extra.entities | 0 : 0;
      const kbs = extra ? extra.kbs || 0 : 0;
      const ping = extra ? extra.ping || 0 : 0;
      const seed = extra ? extra.seed : 0;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, BOX_W, LINES * LINE_H + PAD * 2);
      ctx.font = FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#8fd8a0';

      let y = PAD;
      ctx.fillText('fps ' + s.fps.toFixed(0), PAD, y); y += LINE_H;
      ctx.fillText('sim ' + s.simMs.toFixed(2) + ' ms', PAD, y); y += LINE_H;
      ctx.fillText('render ' + s.renderMs.toFixed(2) + ' ms', PAD, y); y += LINE_H;
      ctx.fillText('steps ' + s.steps, PAD, y); y += LINE_H;
      ctx.fillText('entities ' + entities, PAD, y); y += LINE_H;
      ctx.fillText('net ' + kbs.toFixed(1) + ' KB/s', PAD, y); y += LINE_H;
      ctx.fillText('ping ' + ping.toFixed(0) + ' ms', PAD, y); y += LINE_H;
      ctx.fillText('role ' + transport.role, PAD, y); y += LINE_H;
      ctx.fillText('seed ' + seed, PAD, y);
    },
  };
}
