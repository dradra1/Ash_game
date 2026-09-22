// Ввод: клавиатура (WASD + стрелки), виртуальный джойстик на touch и геймпад.
// move — переиспользуемый объект, новый на кадр не создаётся.

// Радиус виртуального джойстика, px. Значение по умолчанию; createInput принимает
// config и берёт config.render.joystick_radius, если тот передан.
const JOYSTICK_RADIUS_DEFAULT = 48;
const DEADZONE_DEFAULT = 0.25;

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

// Символические коды для edge-detect кнопок геймпада (consumePressed)
const PAD_ACTION_CODES = {
  buy: 'GamepadBuy',
  lock: 'GamepadLock',
  merge: 'GamepadMerge',
  reroll: 'GamepadReroll',
  ready: 'GamepadReady',
  focus_prev: 'GamepadFocusPrev',
  focus_next: 'GamepadFocusNext',
  // Меню — списки сверху вниз, поэтому кроме «влево-вправо» лавки паду нужны
  // «вверх-вниз» и «назад» (ui/focus.js).
  focus_up: 'GamepadFocusUp',
  focus_down: 'GamepadFocusDown',
  cancel: 'GamepadCancel',
};

const DEFAULT_PAD_BUTTONS = {
  buy: 0, cancel: 1, lock: 2, merge: 3, reroll: 4, ready: 9,
  focus_up: 12, focus_down: 13, focus_prev: 14, focus_next: 15,
};

export function createInput(canvas, config) {
  const JOYSTICK_RADIUS =
    (config && config.render && config.render.joystick_radius) || JOYSTICK_RADIUS_DEFAULT;
  const deadzone = (config && config.input && config.input.gamepad_deadzone) || DEADZONE_DEFAULT;
  const padButtons = (config && config.input && config.input.gamepad_buttons)
    || DEFAULT_PAD_BUTTONS;

  const move = { x: 0, y: 0 };
  const held = Object.create(null);    // code → true, удерживаемые
  const framePressed = Object.create(null); // code → true, нажатые с прошлого consume
  const touch = { active: false, tap: false, x: 0, y: 0 };

  let joyId = -1;
  let joyOx = 0;
  let joyOy = 0;
  let padMoveActive = false;
  const padBtnPrev = Object.create(null); // action → wasPressed
  let axisLeftHeld = false;
  let axisRightHeld = false;
  let axisUpHeld = false;
  let axisDownHeld = false;

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
      if (joyId < 0 && !padMoveActive) recomputeFromKeys();
    }
  }

  function onKeyUp(e) {
    if (held[e.code]) {
      held[e.code] = false;
      if (joyId < 0 && !padMoveActive) recomputeFromKeys();
    }
  }

  function onBlur() {
    for (const code in held) held[code] = false;
    if (joyId < 0 && !padMoveActive) recomputeFromKeys();
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
          padMoveActive = false;
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

  function edgePadAction(action, pressed) {
    const prev = !!padBtnPrev[action];
    padBtnPrev[action] = pressed;
    if (pressed && !prev) {
      const code = PAD_ACTION_CODES[action];
      if (code) framePressed[code] = true;
    }
  }

  function pollGamepad() {
    const nav = globalThis.navigator;
    if (!nav || typeof nav.getGamepads !== 'function') return;
    const pads = nav.getGamepads();
    let pad = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) {
        pad = pads[i];
        break;
      }
    }
    if (!pad) {
      if (padMoveActive && joyId < 0) {
        padMoveActive = false;
        recomputeFromKeys();
      }
      axisLeftHeld = false;
      axisRightHeld = false;
      for (const action in PAD_ACTION_CODES) padBtnPrev[action] = false;
      return;
    }

    // Кнопки: edge → framePressed
    const btns = pad.buttons;
    for (const action in padButtons) {
      const idx = padButtons[action];
      const b = btns[idx];
      const pressed = !!(b && (b.pressed || b.value > 0.5));
      edgePadAction(action, pressed);
    }

    // Стик влево/вправо → фокус слотов лавки, вверх/вниз → пункты меню
    // (edge по выходу из deadzone)
    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    const leftNow = ax < -deadzone;
    const rightNow = ax > deadzone;
    const upNow = ay < -deadzone;
    const downNow = ay > deadzone;
    if (leftNow && !axisLeftHeld) framePressed.GamepadFocusPrev = true;
    if (rightNow && !axisRightHeld) framePressed.GamepadFocusNext = true;
    if (upNow && !axisUpHeld) framePressed.GamepadFocusUp = true;
    if (downNow && !axisDownHeld) framePressed.GamepadFocusDown = true;
    axisLeftHeld = leftNow;
    axisRightHeld = rightNow;
    axisUpHeld = upNow;
    axisDownHeld = downNow;

    // Движение: тач > геймпад > клавиатура
    if (joyId >= 0) return;

    let dx = pad.axes[0] || 0;
    let dy = pad.axes[1] || 0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > deadzone) {
      const scale = len > 1 ? 1 / len : 1;
      // Мягкий выход из deadzone: нормализуем остаток
      const t = (len - deadzone) / (1 - deadzone);
      const mag = t > 1 ? 1 : t;
      move.x = dx * scale * mag;
      move.y = dy * scale * mag;
      padMoveActive = true;
    } else if (padMoveActive) {
      padMoveActive = false;
      recomputeFromKeys();
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

    poll() {
      pollGamepad();
    },

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

    // Тап по правой половине: читает и сбрасывает флаг. Стрельба автоматическая,
    // поэтому тап — не «выстрел», а «закрыть подсказку».
    consumeTap() {
      if (touch.tap) {
        touch.tap = false;
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
