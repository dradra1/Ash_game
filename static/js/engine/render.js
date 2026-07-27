// Рендер на одном canvas: камера с запаздыванием, целочисленный масштаб,
// devicePixelRatio, никаких shadowBlur/filter в горячем пути.

import { drawSheet, getSprite } from './sprites.js';

const TEXT_FONT = '12px monospace';

// arenaSize — фактический размер арены этого забега: в коопе он масштабируется
// числом игроков, и брать его из конфига напрямую нельзя.
export function createRenderer(canvas, config, arenaSize) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Цвета — из конфига, как и всё остальное содержимое (см. AGENTS.md §3.1)
  const BG_COLOR = config.render.bg_color;
  const WALL_COLOR = config.render.wall_color;

  const arenaW = (arenaSize && arenaSize[0]) || config.arena.size[0];
  const arenaH = (arenaSize && arenaSize[1]) || config.arena.size[1];
  const wallPad = config.arena.wall_padding;
  const cameraLag = config.arena.camera_lag;
  // Вертикальная видимая область в мировых единицах ≈ радиус обзора из конфига
  const viewRef = (config.net && config.net.view_radius) || 900;

  const camera = { x: arenaW / 2, y: arenaH / 2 };
  const view = { w: 0, h: 0, zoom: 1 };
  let dpr = 1;

  function resize() {
    dpr = globalThis.devicePixelRatio || 1;
    const w = canvas.clientWidth || globalThis.innerWidth || arenaW;
    const h = canvas.clientHeight || globalThis.innerHeight || arenaH;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view.w = w;
    view.h = h;
    view.zoom = Math.max(1, Math.floor(h / viewRef));
    ctx.imageSmoothingEnabled = false;
  }

  function clampCamera() {
    const hw = view.w / (2 * view.zoom);
    const hh = view.h / (2 * view.zoom);
    camera.x = arenaW >= hw * 2 ? Math.min(Math.max(camera.x, hw), arenaW - hw) : arenaW / 2;
    camera.y = arenaH >= hh * 2 ? Math.min(Math.max(camera.y, hh), arenaH - hh) : arenaH / 2;
  }

  // Следование за целью с запаздыванием camera_lag
  function follow(x, y, dt) {
    const k = cameraLag > 0 ? Math.min(1, dt / cameraLag) : 1;
    camera.x += (x - camera.x) * k;
    camera.y += (y - camera.y) * k;
    clampCamera();
  }

  function begin() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.translate(view.w / 2, view.h / 2);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(-camera.x, -camera.y);
  }

  // Возврат в экранные координаты (для оверлеев)
  function end() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen(x, y, out) {
    out.x = (x - camera.x) * view.zoom + view.w / 2;
    out.y = (y - camera.y) * view.zoom + view.h / 2;
    return out;
  }

  // Кэш паттернов пола: texture-id → готовый CanvasPattern. Создаётся один раз,
  // когда спрайт впервые готов; createPattern на кадр — это аллокация в горячем цикле.
  const groundPatterns = {};

  // Пол печётся целиком в offscreen-холст один раз за забег: ~4 тысячи drawImage
  // однократно вместо тысяч на каждый кадр. В кадре остаётся один drawImage
  // видимого прямоугольника — это дешевле прежней заливки паттерном.
  let layout = null;
  let floor = null;
  let floorTried = false;

  function setArenaLayout(next) {
    layout = next || null;
    floor = null;
    floorTried = false;
  }

  // Спрайт «решён», если он загрузился или окончательно не смог: ждать вечно
  // отсутствующий PNG нельзя, иначе пол не запечётся никогда.
  function spriteResolved(id) {
    const s = getSprite(id);
    return !s || s.failed || s.ready;
  }

  function layoutResolved() {
    for (let i = 0; i < layout.ground.length; i++) {
      if (!spriteResolved(layout.ground[i])) return false;
    }
    for (let i = 0; i < layout.decals.length; i++) {
      if (!spriteResolved(layout.decals[i].texture)) return false;
    }
    return true;
  }

  function bakeFloor() {
    const doc = globalThis.document;
    if (!doc || !doc.createElement) return false;
    const c = doc.createElement('canvas');
    c.width = layout.width;
    c.height = layout.height;
    const g = c.getContext('2d');
    if (!g) return false;
    g.imageSmoothingEnabled = false;

    // Подложка: если тайла нет, под ним всё равно не должно просвечивать
    g.fillStyle = layout.groundColor || BG_COLOR;
    g.fillRect(0, 0, layout.width, layout.height);

    const tile = layout.tile;
    const ground = layout.ground;
    const tiles = layout.tiles;
    for (let row = 0; row < layout.rows; row++) {
      const base = row * layout.cols;
      for (let col = 0; col < layout.cols; col++) {
        const s = getSprite(ground[tiles[base + col]]);
        if (!s || !s.ready || s.failed) continue;
        g.drawImage(s.img, col * tile, row * tile, tile, tile);
      }
    }

    // Декали плоские, поэтому уезжают в тот же холст и в кадре не стоят ничего
    for (let i = 0; i < layout.decals.length; i++) {
      const d = layout.decals[i];
      const s = getSprite(d.texture);
      if (!s || !s.ready || s.failed) continue;
      const half = d.size / 2;
      g.globalAlpha = d.alpha;
      if (d.flip) {
        g.save();
        g.translate(d.x, d.y);
        g.scale(-1, 1);
        g.drawImage(s.img, -half, -half, d.size, d.size);
        g.restore();
      } else {
        g.drawImage(s.img, d.x - half, d.y - half, d.size, d.size);
      }
    }
    g.globalAlpha = 1;

    floor = c;
    return true;
  }

  function drawArena(arena) {
    ctx.fillStyle = WALL_COLOR;
    ctx.fillRect(-wallPad, -wallPad, arenaW + wallPad * 2, arenaH + wallPad * 2);

    if (!floor && layout && !floorTried && layoutResolved()) {
      floorTried = !bakeFloor();
    }

    if (floor) {
      // Только видимый кусок: блитить холст 2272×1704 целиком незачем
      const hw = view.w / (2 * view.zoom);
      const hh = view.h / (2 * view.zoom);
      let sx = Math.floor(camera.x - hw);
      let sy = Math.floor(camera.y - hh);
      let sw = Math.ceil(hw * 2) + 2;
      let sh = Math.ceil(hh * 2) + 2;
      if (sx < 0) { sw += sx; sx = 0; }
      if (sy < 0) { sh += sy; sy = 0; }
      if (sx + sw > floor.width) sw = floor.width - sx;
      if (sy + sh > floor.height) sh = floor.height - sy;
      if (sw > 0 && sh > 0) {
        ctx.drawImage(floor, sx, sy, sw, sh, sx, sy, sw, sh);
        return;
      }
    }

    // Деградация: пока тайлы не загрузились — паттерн первого, потом сплошной цвет
    let pattern = null;
    const groundId = arena.ground && arena.ground.length ? arena.ground[0] : null;
    if (groundId) {
      pattern = groundPatterns[groundId] || null;
      if (!pattern) {
        const s = getSprite(groundId);
        if (s && s.ready && !s.failed) {
          pattern = ctx.createPattern(s.img, 'repeat');
          if (pattern) groundPatterns[groundId] = pattern;
        }
      }
    }
    ctx.fillStyle = pattern || arena.ground_color;
    ctx.fillRect(0, 0, arenaW, arenaH);
  }

  // Препятствия: между полом и сущностями, с отсечением по камере. Их десятки,
  // не сотни, поэтому обычный цикл с проверкой границ здесь уместен.
  function drawProps(props) {
    const hw = view.w / (2 * view.zoom);
    const hh = view.h / (2 * view.zoom);
    const x0 = camera.x - hw;
    const x1 = camera.x + hw;
    const y0 = camera.y - hh;
    const y1 = camera.y + hh;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      const half = p.size / 2;
      if (p.x + half < x0 || p.x - half > x1 || p.y + half < y0 || p.y - half > y1) continue;
      if (drawSprite(p.texture, p.x, p.y, p.size, 0, p.flip)) continue;
      ctx.fillStyle = PROP_COLOR;                    // плейсхолдер, пока нет PNG
      ctx.fillRect(Math.round(p.x - p.r), Math.round(p.y - p.r), p.r * 2, p.r * 2);
    }
  }

  // Одиночный спрайт с поворотом. Оружие в руке, снаряды, декор, VFX — всё сюда.
  // Без поворота и отражения идёт быстрый путь без трансформа: на 600 снарядах
  // разница между drawImage и save/rotate/restore уже заметна.
  function drawSprite(textureId, x, y, size, angle, flip) {
    const s = getSprite(textureId);
    if (!s || !s.ready || s.failed) return false;
    const img = s.img;
    const half = size / 2;
    if (!angle && !flip) {
      ctx.drawImage(img, Math.round(x - half), Math.round(y - half), size, size);
      return true;
    }
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    if (flip) ctx.scale(1, -1);
    ctx.drawImage(img, -half, -half, size, size);
    ctx.restore();
    return true;
  }

  function drawRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  // Спрайт с деградацией: сначала лист движения (<texture>_walk), если он есть,
  // потом idle-лист, и только потом цветной квадрат-плейсхолдер.
  function drawEntity(textureId, dir, frame, x, y, size, color, altId) {
    if (altId && drawSheet(ctx, altId, dir, frame, x, y, size)) return;
    if (drawSheet(ctx, textureId, dir, 0, x, y, size)) return;
    const half = size / 2;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x - half), Math.round(y - half), size, size);
  }

  // Неподвижный объект мира одной картинкой: ломаемые бочки и урны. Отдельно от
  // drawEntity, потому что у них НЕТ листа направлений — четыре ракурса объекту,
  // который не поворачивается, не нужны. Различать лист и одиночную картинку по
  // геометрии нельзя: лист ходьбы 4×4 квадратный, как и одиночный спрайт.
  function drawObject(textureId, x, y, size, color) {
    if (drawSprite(textureId, x, y, size, 0, false)) return;
    const half = size / 2;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x - half), Math.round(y - half), size, size);
  }

  // Круглая метка (прах, снаряд без спрайта)
  function drawDot(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // Эллипс под спрайтом цветом игрока — в куче из восьми это главный ориентир
  function drawRing(x, y, r, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.55, r, r * 0.4, 0, 0, TAU);
    ctx.stroke();
  }

  function drawText(text, x, y, color, align) {
    ctx.font = TEXT_FONT;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  resize();

  return {
    camera,
    ctx,
    resize,
    begin,
    end,
    follow,
    worldToScreen,
    setArenaLayout,
    drawArena,
    drawProps,
    drawSprite,
    drawEntity,
    drawObject,
    drawRect,
    drawDot,
    drawRing,
    drawText,
    view,
  };
}

const TAU = Math.PI * 2;
const PROP_COLOR = '#2b2f38';
