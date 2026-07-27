// Ленивая загрузка спрайтов. Путь: /static/textures/<textureId>.png.
// Файла нет → failed, повторных запросов не делаем (кэш по textureId).
// Конвенция листа: 4 строки сверху вниз S, E, N, W; кадр квадратный,
// сторона = высота листа / 4; число кадров выводится из ширины.

const cache = new Map();

export function getSprite(textureId) {
  if (!textureId) return null;
  let s = cache.get(textureId);
  if (s) return s;
  if (typeof globalThis.Image !== 'function') return null;
  const img = new globalThis.Image();
  s = { img, ready: false, failed: false };
  img.onload = () => { s.ready = true; };
  img.onerror = () => { s.failed = true; };
  cache.set(textureId, s);
  img.src = '/static/textures/' + textureId + '.png';
  return s;
}

// Рисует одиночную иконку (оружие, предмет, UI) с центром в (x, y),
// вписывая всё изображение в квадрат size×size с сохранением пропорций.
// Возвращает true, если нарисовано; false — вызывающий рисует плейсхолдер.
export function drawIcon(ctx, textureId, x, y, size) {
  const s = getSprite(textureId);
  if (!s || !s.ready || s.failed) return false;
  const img = s.img;
  const maxSide = Math.max(img.width, img.height);
  if (maxSide <= 0) return false;
  const scale = size / maxSide;
  const dw = Math.round(img.width * scale);
  const dh = Math.round(img.height * scale);
  const dx = Math.round(x - dw / 2);
  const dy = Math.round(y - dh / 2);
  ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
  return true;
}

// Рисует кадр dir/frame листа с центром в (x, y), масштабируя до size.
// Возвращает true, если нарисовано; false — вызывающий рисует плейсхолдер.
// 9-slice на канвасе: HUD рисуется не в DOM, и border-image до него не достаёт.
// Углы кладутся как есть, стороны и середина растягиваются. Путь другой, чем у
// спрайтов: панели живут в /static/ui/, их не адресуют по texture-id из конфига.
const uiCache = new Map();

export function getUiSprite(name) {
  if (!name) return null;
  let s = uiCache.get(name);
  if (s) return s;
  if (!globalThis.Image) return null;          // headless: тесты без DOM
  const img = new globalThis.Image();
  s = { img, ready: false, failed: false };
  img.onload = () => { s.ready = true; };
  img.onerror = () => { s.failed = true; };
  img.src = '/static/ui/' + name + '.png';
  uiCache.set(name, s);
  return s;
}

export function draw9Slice(ctx, name, x, y, w, h, slice, border) {
  const s = getUiSprite(name);
  if (!s || !s.ready || s.failed) return false;
  const img = s.img;
  const sw = img.width;
  const sh = img.height;
  const c = Math.min(slice, (sw / 2) | 0, (sh / 2) | 0);
  const b = Math.min(border, (w / 2) | 0, (h / 2) | 0);
  if (c <= 0 || b <= 0 || w <= 0 || h <= 0) return false;

  const mw = Math.max(0, w - b * 2);
  const mh = Math.max(0, h - b * 2);
  const smw = Math.max(1, sw - c * 2);
  const smh = Math.max(1, sh - c * 2);

  // углы
  ctx.drawImage(img, 0, 0, c, c, x, y, b, b);
  ctx.drawImage(img, sw - c, 0, c, c, x + w - b, y, b, b);
  ctx.drawImage(img, 0, sh - c, c, c, x, y + h - b, b, b);
  ctx.drawImage(img, sw - c, sh - c, c, c, x + w - b, y + h - b, b, b);
  // стороны
  if (mw > 0) {
    ctx.drawImage(img, c, 0, smw, c, x + b, y, mw, b);
    ctx.drawImage(img, c, sh - c, smw, c, x + b, y + h - b, mw, b);
  }
  if (mh > 0) {
    ctx.drawImage(img, 0, c, c, smh, x, y + b, b, mh);
    ctx.drawImage(img, sw - c, c, c, smh, x + w - b, y + b, b, mh);
  }
  return true;
}

export function drawSheet(ctx, textureId, dir, frame, x, y, size) {
  const s = getSprite(textureId);
  if (!s || !s.ready || s.failed) return false;
  const img = s.img;
  // Квадратная картинка — это одиночный спрайт, а не лист направлений (ASSETS.md §5:
  // лист всегда 4 строки, то есть высота вчетверо больше стороны кадра). Так рисуются
  // ломаемые объекты арены: им четыре ракурса не нужны, они не поворачиваются.
  if (img.width === img.height) {
    const h = size / 2;
    ctx.drawImage(img, 0, 0, img.width, img.height,
      Math.round(x - h), Math.round(y - h), size, size);
    return true;
  }
  const side = img.height / 4;
  if (side <= 0) return false;
  const frames = Math.max(1, Math.floor(img.width / side));
  const sx = ((frame % frames) + frames) % frames * side;
  const sy = (dir & 3) * side;
  const half = size / 2;
  ctx.drawImage(img, sx, sy, side, side, Math.round(x - half), Math.round(y - half), size, size);
  return true;
}
