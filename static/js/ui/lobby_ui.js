// Экран лобби: код комнаты, список игроков, выбор персонажа, арена и сложность
// (за хостом), предупреждение об отвале хоста, кнопки «Готов» и «Начать забег».

import { inviteLink } from '../net/lobby.js';

export function createLobbyUi(root, config, t) {
  const doc = root.ownerDocument;

  const panel = doc.createElement('div');
  panel.id = 'lobby';
  panel.className = 'modal wide';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="modal-title"></div>'
    + '<div class="lobby-code"><span class="code"></span>'
    + '<button type="button" class="btn copy"></button></div>'
    + '<div class="lobby-warn"></div>'
    + '<div class="shop-cols">'
    + '<div class="col"><div class="col-title"></div><div class="lobby-players"></div></div>'
    + '<div class="col"><div class="col-title"></div><div class="lobby-chars"></div></div>'
    + '<div class="col"><div class="col-title"></div><div class="lobby-setup"></div></div>'
    + '</div>'
    + '<div class="shop-top"><div class="ash"></div>'
    + '<button type="button" class="btn ready"></button>'
    + '<button type="button" class="btn go start"></button></div>';
  root.appendChild(panel);

  const q = (s) => panel.querySelector(s);
  const titleEl = q('.modal-title');
  const codeEl = q('.code');
  const copyBtn = q('.copy');
  const warnEl = q('.lobby-warn');
  const cols = panel.querySelectorAll('.col-title');
  const playersEl = q('.lobby-players');
  const charsEl = q('.lobby-chars');
  const setupEl = q('.lobby-setup');
  const readyBtn = q('.ready');
  const startBtn = q('.start');

  cols[0].textContent = t('ui.lobby.code');
  cols[1].textContent = t('ui.select.character');
  cols[2].textContent = t('ui.select.arena');
  copyBtn.textContent = t('ui.lobby.copy');
  warnEl.textContent = t('ui.lobby.host_warning');

  let ctx = null;   // {lobby, onStart}

  function renderPlayers(room, you) {
    playersEl.innerHTML = '';
    for (let i = 0; i < room.players.length; i++) {
      const p = room.players[i];
      const chCfg = p.character ? config.characters[p.character] : null;
      const row = doc.createElement('div');
      row.className = 'inv-cell' + (p.gone ? ' empty' : '');
      row.innerHTML =
        `<span class="inv-name" style="color:${chCfg ? chCfg.color : '#c9c4b8'}">`
        + `${p.name}${p.host ? ' ★' : ''}${i === you ? ' ←' : ''}</span>`
        + `<span>${chCfg ? chCfg.name : '—'}</span>`
        + `<span style="color:${p.ready ? '#a8d07a' : '#7a7568'}">`
        + `${p.ready ? '✓' : '…'}</span>`
        + `<span style="color:#7a7568">${p.ping} мс</span>`;
      playersEl.appendChild(row);
    }
  }

  function renderCharacters(room, you) {
    charsEl.innerHTML = '';
    const mine = room.players[you] ? room.players[you].character : null;
    for (const id in config.characters) {
      const c = config.characters[id];
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'inv-cell' + (id === mine ? ' locked' : '');
      btn.style.setProperty('--accent', c.color);
      btn.innerHTML = `<span class="inv-name" style="color:${c.color}">${c.name}</span>`;
      btn.addEventListener('click', () => ctx.lobby.character(id));
      charsEl.appendChild(btn);
    }
  }

  function renderSetup(room) {
    setupEl.innerHTML = '';
    cols[2].textContent = t('ui.select.arena');

    const arena = room.arena && config.arenas[room.arena];
    const arenaRow = doc.createElement('div');
    arenaRow.className = 'inv-cell locked';
    arenaRow.innerHTML = `<span class="inv-name">${arena ? arena.name : '—'}</span>`;
    setupEl.appendChild(arenaRow);

    const dTitle = doc.createElement('div');
    dTitle.className = 'col-title';
    dTitle.textContent = t('ui.select.danger');
    setupEl.appendChild(dTitle);

    let dangerName = '—';
    for (let i = 0; i < config.danger.length; i++) {
      if (config.danger[i].id === room.danger) {
        dangerName = config.danger[i].name;
        break;
      }
    }
    const dRow = doc.createElement('div');
    dRow.className = 'inv-cell locked';
    dRow.innerHTML = `<span class="inv-name">${dangerName}</span>`;
    setupEl.appendChild(dRow);

    const curses = room.curses || [];
    if (curses.length > 0) {
      const cTitle = doc.createElement('div');
      cTitle.className = 'col-title';
      cTitle.textContent = t('ui.setup.curses');
      setupEl.appendChild(cTitle);
      for (let i = 0; i < curses.length; i++) {
        const c = config.curses && config.curses[curses[i]];
        const row = doc.createElement('div');
        row.className = 'inv-cell locked';
        row.innerHTML = `<span class="inv-name">${c ? c.name : curses[i]}</span>`;
        setupEl.appendChild(row);
      }
    }
  }

  function render() {
    if (!ctx) return;
    const room = ctx.lobby.room;
    if (!room) return;
    const you = ctx.lobby.you;
    const isHost = ctx.lobby.isHost;

    titleEl.textContent = t('ui.menu.coop');
    codeEl.textContent = room.code;
    readyBtn.textContent = t('ui.lobby.ready');
    startBtn.textContent = t('ui.lobby.start');
    startBtn.style.display = isHost ? '' : 'none';

    renderPlayers(room, you);
    renderCharacters(room, you);
    renderSetup(room);
  }

  copyBtn.addEventListener('click', () => {
    const room = ctx && ctx.lobby.room;
    if (!room) return;
    const link = inviteLink(room.code);
    const nav = doc.defaultView.navigator;
    if (nav && nav.clipboard) nav.clipboard.writeText(link).catch(() => {});
    copyBtn.textContent = link;
  });

  readyBtn.addEventListener('click', () => {
    const room = ctx.lobby.room;
    const me = room && room.players[ctx.lobby.you];
    ctx.lobby.ready(!(me && me.ready));
  });

  startBtn.addEventListener('click', () => ctx.lobby.start());

  return {
    show(lobby) {
      ctx = { lobby };
      render();
      panel.style.display = '';
    },
    hide() { panel.style.display = 'none'; },
    get visible() { return panel.style.display !== 'none'; },
    refresh: render,
  };
}
