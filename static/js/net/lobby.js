// Лобби комнаты: создание, вход по коду, готовность, выбор персонажа,
// выбор арены и сложности (за хостом), старт забега.
//
// Сервер здесь — только почтальон: он рассылает состояние комнаты и ничего
// о правилах игры не знает.

export function createLobby(socket) {
  const listeners = [];
  let room = null;
  let you = -1;

  socket.on('room:state', (msg) => {
    if (!msg || !msg.room) return;
    room = msg.room;
    emit('state', msg.event);
  });

  socket.on('room:start', (msg) => {
    if (msg && msg.room) room = msg.room;
    emit('start', msg);
  });

  socket.on('disconnect', () => emit('disconnect', null));
  socket.on('connect', () => emit('connect', null));

  function emit(kind, data) {
    for (let i = 0; i < listeners.length; i++) listeners[i](kind, data, room);
  }

  function call(event, payload) {
    return new Promise((resolve) => {
      socket.emit(event, payload || {}, (res) => resolve(res || {}));
    });
  }

  return {
    on(cb) { listeners.push(cb); },

    get room() { return room; },
    get you() { return you; },
    get isHost() {
      return !!(room && room.players[you] && room.players[you].host);
    },

    async create(character) {
      const res = await call('room:create', { character });
      if (res.ok) { room = res.room; you = res.you; emit('state', 'created'); }
      return res;
    },

    async join(code, character) {
      const res = await call('room:join', { code, character });
      if (res.ok) { room = res.room; you = res.you; emit('state', 'joined'); }
      return res;
    },

    leave() { return call('room:leave'); },
    ready(v) { return call('room:ready', { ready: v }); },
    character(id) { return call('room:character', { character: id }); },
    setup(arena, danger) { return call('room:setup', { arena, danger }); },
    start() { return call('room:start'); },

    // Замер пинга: круговой ход до сервера. В коопе он же уходит в дебаг-оверлей.
    ping() {
      const t0 = Date.now();
      return new Promise((resolve) => {
        socket.emit('net:ping', { t: t0 }, () => {
          const rtt = Date.now() - t0;
          socket.emit('net:ping', { ping: rtt });
          resolve(rtt);
        });
      });
    },
  };
}

// Ссылка-приглашение: /play?room=CODE
export function inviteLink(code) {
  const loc = globalThis.location;
  return `${loc.origin}/play?room=${code}`;
}

export function roomFromUrl() {
  const loc = globalThis.location;
  const m = /[?&]room=([A-Za-z0-9]+)/.exec(loc.search || '');
  return m ? m[1].toUpperCase() : null;
}
