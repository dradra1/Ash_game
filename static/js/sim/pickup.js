// Прах: падает с врага, притягивается магнитом, подбирается касанием.
// В конце волны остаток собирается автоматически (фаза collect в run.js).

export function makePickup() {
  return { x: 0, y: 0, vx: 0, vy: 0, amount: 0, xp: 0, magnet: false, alive: false };
}

export function resetPickup(p) {
  p.alive = false;
  p.vx = 0;
  p.vy = 0;
  p.magnet = false;
}

// Уронить прах в точке. При переполнении пула сливаем в ближайшую стопку,
// а не отбрасываем — иначе на 450 врагах игрок перестал бы получать валюту.
export function dropAsh(pool, x, y, amount, xp, config) {
  const p = pool.spawn();
  if (!p) {
    if (pool.count > 0) {
      const stack = pool.items[pool.count - 1];
      stack.amount += amount * config.sim.pickup_stack_merge;
      stack.xp += xp;
    }
    return null;
  }
  p.alive = true;
  p.x = x;
  p.y = y;
  p.amount = amount;
  p.xp = xp;
  p.magnet = false;
  return p;
}

// Шаг подборов. collectAll — фаза сбора в конце волны: тянем всё к ближайшему игроку.
// deps: {config, players, onCollect(player, amount, xp)}
export function stepPickups(pool, dt, deps, collectAll) {
  const config = deps.config;
  const players = deps.players;
  const magnetR = config.sim.pickup_magnet_radius;
  const magnetR2 = magnetR * magnetR;
  const pullSpeed = config.player.move_speed * PULL_FACTOR;

  for (let i = pool.count - 1; i >= 0; i--) {
    const p = pool.items[i];

    // Ближайший живой игрок (их максимум 8)
    let target = null;
    let bestD = Infinity;
    for (let k = 0; k < players.length; k++) {
      const pl = players[k];
      if (!pl.alive) continue;
      const dx = pl.x - p.x;
      const dy = pl.y - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; target = pl; }
    }
    if (!target) continue;

    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const pickR = target.pickupRadius;

    if (bestD <= pickR * pickR) {
      deps.onCollect(target, p.amount, p.xp);
      resetPickup(p);
      pool.release(i);
      continue;
    }

    if (collectAll || p.magnet || bestD <= magnetR2) {
      p.magnet = true;
      const d = Math.sqrt(bestD) || 1;
      const speed = collectAll ? pullSpeed * COLLECT_BOOST : pullSpeed;
      p.x += (dx / d) * speed * dt;
      p.y += (dy / d) * speed * dt;
    }
  }
  return pool.count;
}

const PULL_FACTOR = 2.2;      // магнит тянет быстрее, чем бегает игрок
const COLLECT_BOOST = 2.5;    // в фазе сбора — ещё быстрее, чтобы уложиться в таймер
