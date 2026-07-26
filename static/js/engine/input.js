// Ввод: клавиатура (WASD + стрелки) и виртуальный джойстик на touch.
// move — переиспользуемый объект, новый на кадр не создаётся.

// Радиус виртуального джойстика, px. Значение по умолчанию; createInput принимает
// config и берёт config.render.joystick_radius, если тот передан.
const JOYSTICK_RADIUS_DEFAULT = 48;

// Коды клавиш направления → вектор
const DIRS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

const PREVENT = {
  ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
  Space: 1, F3: 1, Escape: 1, F4: 1,
};

export function createInput(canvas, config) {
  const JOYSTICK_RADIUS =
    (config && config.render && config.render.joystick_radius) || JOYSTICK_RADIUS_DEFAULT;
  const move = { x: 0, y: 0 };
  const held = Object.create(null);    // code → true, удерживаемые
  const framePressed = Object.create(null); // code → true, нажатые с прошлого consume
  const touch = { active: false, tap: false, x: 0, y: 0 };

  let joyId = -1;
  let joyOx = 0;
  let joyOy = 0;

  function recomputeFromKeys() {
    let x = 0;
    let y = 0;
    for (const code in DIRS) {
      if (held[code]) {
        x += DIRS[code][0];
        y += DIRS[code][1];
      }
    }
    const len = Math.sqrt(x * x + y * y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    move.x = x;
    move.y = y;
  }

  function onKeyDown(e) {
    if (PREVENT[e.code]) e.preventDefault();
    if (!e.repeat) framePressed[e.code] = true;
    if (!held[e.code]) {
      held[e.code] = true;
      if (joyId < 0) recomputeFromKeys();
    }
  }

  function onKeyUp(e) {
    if (held[e.code]) {
      held[e.code] = false;
      if (joyId < 0) recomputeFromKeys();
    }
  }

  function onBlur() {
    for (const code in held) held[code] = false;
    if (joyId < 0) recomputeFromKeys();
  }

  // Левая половина экрана — джойстик, правая — тап
  function onTouchStart(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < globalThis.innerWidth / 2) {
        if (joyId < 0) {
          joyId = t.identifier;
          joyOx = t.clientX;
          joyOy = t.clientY;
          touch.active = true;
          touch.x = joyOx;
          touch.y = joyOy;
          move.x = 0;
          move.y = 0;
        }
      } else {
        touch.tap = true;
      }
    }
    e.preventDefault();
  }

  function onTouchMove(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joyId) {
        let dx = (t.clientX - joyOx) / JOYSTICK_RADIUS;
        let dy = (t.clientY - joyOy) / JOYSTICK_RADIUS;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        move.x = dx;
        move.y = dy;
        touch.x = t.clientX;
        touch.y = t.clientY;
      }
    }
    e.preventDefault();
  }

  function onTouchEnd(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joyId) {
        joyId = -1;
        touch.active = false;
        recomputeFromKeys();
      }
    }
  }

  const win = globalThis;
  win.addEventListener('keydown', onKeyDown);
  win.addEventListener('keyup', onKeyUp);
  win.addEventListener('blur', onBlur);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('touchcancel', onTouchEnd);

  return {
    move,
    touch,

    down(code) {
      return !!held[code];
    },

    pressed(code) {
      return !!framePressed[code];
    },

    // «Нажали в этом кадре»: читает и сбрасывает флаг
    consumePressed(code) {
      if (framePressed[code]) {
        framePressed[code] = false;
        return true;
      }
      return false;
    },

    destroy() {
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
      win.removeEventListener('blur', onBlur);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    },
  };
}
