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

  function drawArena(arena) {
    ctx.fillStyle = WALL_COLOR;
    ctx.fillRect(-wallPad, -wallPad, arenaW + wallPad * 2, arenaH + wallPad * 2);
    let pattern = null;
    // Берём только первый тайл списка ground: вариации пришлось бы рисовать
    // по-тайлово drawImage'ами (тысячи вызовов на кадр) — за бюджетом рендера.
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
    drawArena,
    drawEntity,
    drawRect,
    drawDot,
    drawRing,
    drawText,
    view,
  };
}

const TAU = Math.PI * 2;
