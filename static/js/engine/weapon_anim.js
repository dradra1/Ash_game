// Кривые замаха ближнего оружия.
//
// Оружие — один спрайт в боковой проекции, клиент вращает его трансформом
// (ASSETS.md §5), поэтому анимация удара тут процедурная: не листы кадров, а поза,
// посчитанная от прогресса удара. Каждое семейство бьёт по-своему — тесак рубит
// дугой, пика колет, кадило крутится, — и различает их только эта функция.
//
// Модуль чистый: ни DOM, ни канваса, ни рандома. Поза пишется в переданный объект,
// аллокаций на кадр нет (CLAUDE.md §4).

export const SWEEP = 'sweep';
export const SLAM = 'slam';
export const THRUST = 'thrust';
export const SPIN = 'spin';
export const LASH = 'lash';
export const RIP = 'rip';
export const SAW = 'saw';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

// Быстро в начале, мягко в конце: удар должен «выстреливать», а не разгоняться
function easeOut(k) {
  const t = 1 - k;
  return 1 - t * t * t;
}

// Выпад: вперёд быстро, назад медленнее. Пик на fraction прогресса.
function outAndBack(k, peak) {
  return k < peak
    ? easeOut(k / peak)
    : 1 - easeOut((k - peak) / (1 - peak));
}

/**
 * Поза оружия в момент удара.
 *
 * @param kind    тип кривой (константы выше); неизвестный — как SWEEP
 * @param k       прогресс удара 0..1
 * @param halfArc половина сектора оружия в радианах (из shape.angle)
 * @param out     переиспользуемый объект: angle, dist, tilt, scale
 *
 * angle — угловое смещение от направления на цель;
 * dist  — вынос от центра игрока, доля радиуса замаха;
 * tilt  — доворот спрайта относительно его радиуса;
 * scale — множитель размера (ракурс: замах над головой ближе к камере).
 */
export function swingPose(kind, k, halfArc, out) {
  const t = k < 0 ? 0 : k > 1 ? 1 : k;

  switch (kind) {
    case SLAM: {
      // Удар сверху: замах назад, потом обрушивается по оси прицела.
      const wind = 0.3;
      if (t < wind) {
        const w = t / wind;
        out.angle = -0.5 * w;
        out.dist = 0.45 - 0.15 * w;
        out.tilt = -1.2 * w;
        out.scale = 1 + 0.18 * w;
      } else {
        const d = easeOut((t - wind) / (1 - wind));
        out.angle = -0.5 + 0.5 * d;
        out.dist = 0.3 + 0.75 * d;
        out.tilt = -1.2 + 1.6 * d;
        out.scale = 1.18 - 0.28 * d;
      }
      return out;
    }

    case THRUST: {
      // Выпад строго по оси: угол не меняется, меняется только вынос.
      const p = outAndBack(t, 0.35);
      out.angle = 0;
      out.dist = 0.25 + 0.9 * p;
      out.tilt = 0;
      out.scale = 1 + 0.1 * p;
      return out;
    }

    case SPIN: {
      // Полный оборот вокруг игрока — для 360-градусного оружия.
      out.angle = t * TAU;
      out.dist = 0.85;
      out.tilt = HALF_PI;
      out.scale = 1;
      return out;
    }

    case LASH: {
      // Хлыст: выброс дальше радиуса, изгиб в сторону и щелчок назад.
      const p = outAndBack(t, 0.3);
      out.angle = Math.sin(t * Math.PI * 1.5) * halfArc * 0.8;
      out.dist = 0.2 + 1.05 * p;
      out.tilt = out.angle * 0.6;
      out.scale = 1;
      return out;
    }

    case RIP: {
      // Два коротких быстрых пореза: пила из двух проходов по сектору.
      const half = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const dir = t < 0.5 ? 1 : -1;
      out.angle = dir * (halfArc * (1 - 2 * easeOut(half)));
      out.dist = 0.65 + 0.2 * Math.sin(half * Math.PI);
      out.tilt = HALF_PI;
      out.scale = 1;
      return out;
    }

    case SAW: {
      // Короткая дуга с дрожью: цепь идёт, оружие вибрирует.
      const d = easeOut(t);
      out.angle = -halfArc * 0.7 + halfArc * 1.4 * d;
      out.dist = 0.7 + 0.06 * Math.sin(t * 40);
      out.tilt = HALF_PI + 0.12 * Math.sin(t * 52);
      out.scale = 1;
      return out;
    }

    default: {
      // Дуга поперёк сектора: лезвие идёт от одного края к другому.
      const d = easeOut(t);
      out.angle = -halfArc + 2 * halfArc * d;
      out.dist = 0.7 + 0.25 * Math.sin(t * Math.PI);
      out.tilt = HALF_PI;
      out.scale = 1 + 0.08 * Math.sin(t * Math.PI);
      return out;
    }
  }
}

// Прозрачность следа удара: вспыхивает мгновенно, гаснет к концу замаха
export function trailAlpha(k) {
  const t = k < 0 ? 0 : k > 1 ? 1 : k;
  return t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
}

export function makePose() {
  return { angle: 0, dist: 0, tilt: 0, scale: 1 };
}
