// Снаряды: полёт по прямой, ttl, пробитие, попадания через spatial hash.
// Снаряды врагов помечены hostile и бьют игроков, снаряды игроков — врагов.

export function makeProjectile() {
  return {
    x: 0, y: 0, vx: 0, vy: 0,
    ttl: 0, dmg: 0, pierce: 0, size: 0,
    hostile: false, crit: false, texture: null, color: null,
    ownerId: -1, knockback: 0,
    hitCount: 0, hitIds: null,
    alive: false,
  };
}

export function resetProjectile(p) {
  p.alive = false;
  p.hitCount = 0;
  p.crit = false;
  if (!p.hitIds) p.hitIds = new Int32Array(8);
}

// В hitIds лежат СТАБИЛЬНЫЕ uid врагов, а не индексы пула: release() делает
// swap-remove, и индекс между кадрами начинает указывать на другого врага —
// пробивающий снаряд бил бы уже задетую цель и пропускал новую.
function alreadyHit(p, id) {
  for (let i = 0; i < p.hitCount; i++) {
    if (p.hitIds[i] === id) return true;
  }
  return false;
}

function markHit(p, id) {
  if (p.hitCount < p.hitIds.length) p.hitIds[p.hitCount++] = id;
}

// Шаг всех снарядов.
// deps: {config, enemyPool, enemyGrid, queryBuf, players, damageEnemy, hitPlayer}
export function stepProjectiles(pool, dt, deps) {
  const config = deps.config;
  const w = config.arena.size[0];
  const h = config.arena.size[1];
  const margin = config.arena.spawn_margin * 2;

  for (let i = pool.count - 1; i >= 0; i--) {
    const p = pool.items[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ttl -= dt;

    let dead = p.ttl <= 0
      || p.x < -margin || p.x > w + margin
      || p.y < -margin || p.y > h + margin;

    if (!dead && p.hostile) {
      // Снаряд врага: игроков мало, перебор дешевле сетки
      const players = deps.players;
      for (let k = 0; k < players.length; k++) {
        const pl = players[k];
        if (!pl.alive) continue;
        const dx = pl.x - p.x;
        const dy = pl.y - p.y;
        const r = pl.radius + p.size;
        if (dx * dx + dy * dy <= r * r) {
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          deps.hitPlayer(pl, p.dmg, dx / d, dy / d);
          dead = true;
          break;
        }
      }
    } else if (!dead) {
      // Снаряд игрока: соседи — только через сетку, никаких O(N²)
      const n = deps.enemyGrid.query(p.x, p.y, p.size + deps.maxEnemySize, deps.queryBuf);
      for (let k = 0; k < n; k++) {
        const idx = deps.queryBuf[k];
        if (idx >= deps.enemyPool.count) continue;
        const e = deps.enemyPool.items[idx];
        if (!e.alive || alreadyHit(p, e.uid)) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const r = e.size + p.size;
        if (dx * dx + dy * dy <= r * r) {
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          deps.damageEnemy(idx, p.dmg, p.crit, dx / d, dy / d, p.knockback, p.ownerId);
          markHit(p, e.uid);
          if (p.pierce <= 0) { dead = true; break; }
          p.pierce -= 1;
        }
      }
    }

    if (dead) {
      resetProjectile(p);
      pool.release(i);
    }
  }
  return pool.count;
}
