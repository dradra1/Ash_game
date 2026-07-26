// Партиклы: попадания, смерти, подбор праха. Чистая косметика, поэтому первое,
// что деградирует при переполнении — пул фиксированный, лишнее просто не рождается.

export function createParticles(config) {
  const cap = config.sim.max_particles;
  const items = new Array(cap);
  for (let i = 0; i < cap; i++) {
    items[i] = { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: '#fff' };
  }
  let count = 0;

  function spawn(x, y, vx, vy, life, size, color) {
    if (count >= cap) return null;      // деградация, а не рост
    const p = items[count++];
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.max = life; p.size = size; p.color = color;
    return p;
  }

  // Брызги в стороны от точки попадания
  function burst(x, y, n, color, rng, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = rng.float() * Math.PI * 2;
      const s = speed * (0.4 + rng.float() * 0.6);
      if (!spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
        life * (0.6 + rng.float() * 0.6), size, color)) return;
    }
  }

  function step(dt) {
    for (let i = count - 1; i >= 0; i--) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) {
        const last = items[count - 1];
        items[count - 1] = p;
        items[i] = last;
        count--;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= DRAG;
      p.vy *= DRAG;
    }
  }

  function draw(ctx) {
    for (let i = 0; i < count; i++) {
      const p = items[i];
      const k = p.life / p.max;
      ctx.globalAlpha = k < 1 ? k : 1;
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + k * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function clear() {
    count = 0;
  }

  return { spawn, burst, step, draw, clear, get count() { return count; } };
}

const DRAG = 0.92;
