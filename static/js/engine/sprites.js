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

// Рисует кадр dir/frame листа с центром в (x, y), масштабируя до size.
// Возвращает true, если нарисовано; false — вызывающий рисует плейсхолдер.
export function drawSheet(ctx, textureId, dir, frame, x, y, size) {
  const s = getSprite(textureId);
  if (!s || !s.ready || s.failed) return false;
  const img = s.img;
  const side = img.height / 4;
  if (side <= 0) return false;
  const frames = Math.max(1, Math.floor(img.width / side));
  const sx = ((frame % frames) + frames) % frames * side;
  const sy = (dir & 3) * side;
  const half = size / 2;
  ctx.drawImage(img, sx, sy, side, side, Math.round(x - half), Math.round(y - half), size, size);
  return true;
}
