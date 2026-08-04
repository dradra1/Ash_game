// Экраны: menu — это город (ui/city_ui.js), game — панель скрыта, играет canvas.
// Все тексты — только через t(key) из config.i18n.

import { createCity } from './city_ui.js';

export function createScreens(root, config, t) {
  let handlers = {};

  // Город строится один раз, а набор колбэков приходит с каждым show('menu'),
  // поэтому ему отдаются стабильные обёртки, зовущие актуальные обработчики.
  const city = createCity(root, config, null, t, {
    play: () => handlers.onPlay && handlers.onPlay(),
    meta: (tabs) => handlers.onMeta && handlers.onMeta(tabs),
    lodge: () => handlers.onLodge && handlers.onLodge(),
    coop: () => handlers.onCoop && handlers.onCoop(),
    join: (code) => (handlers.onJoin ? handlers.onJoin(code) : null),
    audio: () => handlers.onAudio && handlers.onAudio(),
    admin: () => handlers.onAdmin && handlers.onAdmin(),
    logout: () => handlers.onLogout && handlers.onLogout(),
  });

  const screens = {
    current: 'menu',

    // Показать причину прямо в городе. Нужно на случай осечки старта забега:
    // мастер настройки к этому моменту уже спрятался, и без строчки текста
    // игрок видит только необъяснимый возврат в меню.
    error(text) {
      city.error(text);
    },

    show(name, data) {
      screens.current = name;
      if (name === 'menu') {
        if (data) handlers = data;
        city.setAdminVisible(!!(data && data.onAdmin));
        if (data && data.invited) city.setCode(data.invited);
        city.show(data && data.profile);
      } else {
        city.hide();
      }
    },
  };

  return screens;
}
