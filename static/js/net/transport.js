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

// Кооп: тот же интерфейс поверх socket.io. Сервер только релеит — он не знает
// ни содержимого сообщений, ни правил игры.
//
// Каналы ложатся на события сокета: INPUT → net:input (адресно хосту),
// SNAPSHOT → net:snapshot (хост → комнате), EVENT → net:event (в обе стороны),
// LOBBY → room:state.
export function createSocketTransport(socket, opts) {
  const subs = {};
  for (const k in CH) subs[CH[k]] = [];
  const o = opts || {};

  const api = {
    role: o.isHost ? 'host' : 'client',
    id: o.id === undefined ? -1 : o.id,
    isHost: !!o.isHost,
    socket,
    // Счётчики трафика для дебаг-оверлея: бюджет из ТЗ проверяется вживую
    bytesIn: 0,
    bytesOut: 0,
    ping: 0,

    send(ch, payload) {
      const size = byteLength(payload);
      api.bytesOut += size;
      if (ch === CH.INPUT) socket.emit('net:input', payload);
      else if (ch === CH.SNAPSHOT) socket.emit('net:snapshot', payload);
      else socket.emit('net:event', payload);
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
      socket.off('net:input', onInput);
      socket.off('net:snapshot', onSnapshot);
      socket.off('net:event', onEvent);
    },
  };

  function fire(ch, payload) {
    api.bytesIn += byteLength(payload);
    const list = subs[ch];
    for (let i = 0; i < list.length; i++) list[i](payload, -1);
  }

  function onInput(p) { fire(CH.INPUT, p); }
  function onSnapshot(p) { fire(CH.SNAPSHOT, p); }
  function onEvent(p) { fire(CH.EVENT, p); }

  socket.on('net:input', onInput);
  socket.on('net:snapshot', onSnapshot);
  socket.on('net:event', onEvent);

  return api;
}

function byteLength(payload) {
  if (!payload) return 0;
  if (payload.byteLength !== undefined) return payload.byteLength;
  if (typeof payload === 'string') return payload.length;
  return 64;                       // грубая оценка для объектов
}
