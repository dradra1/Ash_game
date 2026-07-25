// Абстракция транспорта. Код симуляции работает только через этот интерфейс
// и не знает, соло это (LocalTransport) или кооп (SocketTransport).

export const CH = { INPUT: 'input', SNAPSHOT: 'snapshot', EVENT: 'event', LOBBY: 'lobby' };

// Соло: комната из одного игрока, петля вызовов в одном процессе.
// send немедленно доставляет подписчикам той же стороны.
export function createLocalTransport() {
  const subs = {};
  for (const k in CH) subs[CH[k]] = [];

  return {
    role: 'host',
    id: 0,
    isHost: true,

    send(ch, payload, toId) {
      const list = subs[ch];
      if (!list) return;
      for (let i = 0; i < list.length; i++) list[i](payload, 0);
    },

    on(ch, cb) {
      const list = subs[ch];
      if (list && list.indexOf(cb) < 0) list.push(cb);
    },

    off(ch, cb) {
      const list = subs[ch];
      if (!list) return;
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    },

    close() {
      for (const k in subs) subs[k].length = 0;
    },
  };
}

// Кооп: заглушка этапа M3. Каркас (поля, подписки) на месте,
// сетевые методы бросают Error('M3').
export function createSocketTransport(url) {
  const subs = {};
  for (const k in CH) subs[CH[k]] = [];

  return {
    role: 'client',
    id: -1,
    isHost: false,
    url,

    send(ch, payload, toId) {
      throw new Error('M3');
    },

    on(ch, cb) {
      const list = subs[ch];
      if (list && list.indexOf(cb) < 0) list.push(cb);
    },

    off(ch, cb) {
      const list = subs[ch];
      if (!list) return;
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    },

    close() {
      for (const k in subs) subs[k].length = 0;
    },
  };
}
