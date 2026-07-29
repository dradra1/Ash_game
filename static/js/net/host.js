// Хост: считает авторитетную симуляцию, принимает ввод, рассылает снапшоты.
//
// Снапшоты идут с частотой net.snapshot_hz, а не каждый кадр, и содержат только
// сущности в радиусе видимости КОНКРЕТНОГО клиента. Снаряды не синхронизируются
// покадрово — на их спавн шлётся событие, клиент экстраполирует полёт сам.

import { CH } from './transport.js';
import {
  createInputCodec, createSnapshotCodec, createSpawnCodec, createSwingCodec,
  createPickupCodec, createTurretCodec,
  buildTypeIndex, buildWeaponIndex, buildProjectileIndex, MSG_EVENT,
} from './protocol.js';
import { shopSnapshot, loadoutSnapshot, localAdapter } from '../ui/shop_adapter.js';

export function createHost(run, transport, config) {
  const inputCodec = createInputCodec();
  const snapCodec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const weapons = buildWeaponIndex(config);
  const projTex = buildProjectileIndex(config);
  const spawnCodec = createSpawnCodec(config);
  const swingCodec = createSwingCodec(config);
  const pickupCodec = createPickupCodec(config);
  const turretCodec = createTurretCodec(config);
  const period = 1 / config.net.snapshot_hz;
  const pickupPeriod = 1 / config.net.pickup_hz;
  // Величина кучки праха задаёт только размер спрайта. Порог — из конфига:
  // «крупная кучка» это вопрос баланса дропа, а не константа рендера.
  const bigAsh = config.render.ash_big_amount;

  // Копить события спавна и замахов имеет смысл только когда есть кому их слать
  run.spawns.on = true;
  run.swings.on = true;

  let acc = 0;
  let pickupAcc = 0;
  let seq = 0;
  // Своё место в комнате: себе снапшот не шлём. Сервер копию хосту всё равно не
  // доставлял, а кодирование стоило ровно столько же, сколько для настоящего
  // клиента, — при восьмерых это восьмая часть всей сетевой работы кадра.
  const selfIdx = transport.isHost && typeof transport.id === 'number' && transport.id >= 0
    ? transport.id : -1;
  const stats = { bytesOut: 0, kbs: 0, sent: 0 };

  // Размерный класс кучки праха для рендера у клиента: сумма ему не нужна.
  function ashTier(p) {
    return p.amount >= bigAsh ? 1 : 0;
  }
  let window = 0;
  let windowBytes = 0;

  function onInput(payload) {
    const dec = inputCodec.decode(payload);
    if (!dec) return;
    const p = run.state.players[dec.playerIdx];
    if (!p) return;
    run.applyInput(p.id, dec);
  }

  transport.on(CH.INPUT, onInput);

  function onClientEvent(msg) {
    if (!msg) return;
    if (msg.t === 'shop_act') {
      const player = run.state.players[msg.p];
      if (!player) return;
      const shop = run.shopFor(player.id);
      if (!shop) return;
      const adapter = localAdapter(run, player, shop, config, () => run.readyUp(player.id));
      adapter.act(msg.kind, msg.a);
      sendShopTo(msg.p);
      sendLoadoutTo(msg.p);
      // Готовность соседа видна всем: ростер в лавке рисуется по этим флагам
      if (msg.kind === 'ready') broadcastShops();
      return;
    }
    if (msg.t === 'levelup_act') {
      const player = run.state.players[msg.p];
      if (!player) return;
      run.applyLevelPick(player.id, msg.idx | 0);
      sendLevelUpTo(msg.p);
      sendLoadoutTo(msg.p);
      return;
    }
    if (msg.t === 'pause_req') {
      run.setPaused(!!msg.on);
      return;
    }
  }

  transport.on(CH.EVENT, onClientEvent);

  function sendShopTo(idx) {
    const player = run.state.players[idx];
    if (!player) return;
    const shop = run.shopFor(player.id);
    if (!shop) return;
    transport.send(CH.EVENT, {
      t: 'shop', p: idx, snap: shopSnapshot(run, player, shop, config),
    });
  }

  function sendLevelUpTo(idx) {
    const player = run.state.players[idx];
    if (!player) return;
    const choices = run.choicesFor(player.id);
    transport.send(CH.EVENT, {
      t: 'levelup',
      p: idx,
      pending: player.pendingLevels,
      choices: choices,
      level: player.level,
    });
  }

  function sendLoadoutTo(idx) {
    const player = run.state.players[idx];
    if (!player) return;
    transport.send(CH.EVENT, { t: 'loadout', p: idx, snap: loadoutSnapshot(player) });
  }

  function broadcastShops() {
    for (let i = 0; i < run.state.players.length; i++) sendShopTo(i);
  }

  function broadcastLoadouts() {
    for (let i = 0; i < run.state.players.length; i++) sendLoadoutTo(i);
  }

  function broadcastLevelUps() {
    for (let i = 0; i < run.state.players.length; i++) sendLevelUpTo(i);
  }

  let lastPhase = run.state.phase;
  // Первая рассылка экипировки: без неё клиент до первой лавки не знает ни своих
  // стволов, ни статов, а предсказание движения идёт базовой скоростью.
  let bootSent = false;

  function step(dt) {
    if (!bootSent) {
      bootSent = true;
      broadcastLoadouts();
    }
    if (run.state.phase !== lastPhase) {
      lastPhase = run.state.phase;
      if (lastPhase === 'shop') broadcastShops();
      if (lastPhase === 'levelup') broadcastLevelUps();
      // Старт волны лечит всех и мог изменить maxHp — экипировка едет на любой смене фазы
      broadcastLoadouts();
    }

    // Расстановка турелей: редкое сообщение, поэтому уходит сразу и вне такта
    // снапшота. Оно должно доехать раньше первого замаха турели — иначе клиент
    // получит пульс от установки, которой у него ещё нет.
    if (run.engineering && run.turretsDirty) {
      run.clearTurretsDirty();
      const packed = turretCodec.encode(run.turretPool, weapons);
      const copy = packed.slice();
      transport.send(CH.SNAPSHOT, copy);
      stats.bytesOut += copy.byteLength;
      windowBytes += copy.byteLength;
    }

    acc += dt;
    pickupAcc += dt;
    window += dt;
    if (acc < period) return;
    acc -= period;
    seq = (seq + 1) & 0xffff;

    const players = run.state.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      // Хосту снапшот не нужен: он и есть источник истины, а сервер его копию
      // всё равно выбрасывал. При восьмерых это восьмая часть исходящего.
      if (i === selfIdx) continue;
      const packed = snapCodec.encode(run, p.x, p.y, seq, types.toIdx);
      const copy = packed.slice();
      // Адресно: снапшот собран под радиус видимости именно этого игрока
      transport.send(CH.SNAPSHOT, copy, i);
      stats.bytesOut += copy.byteLength;
      windowBytes += copy.byteLength;
      stats.sent++;
    }

    // Снаряды: только факт рождения, дальше клиент ведёт полёт сам
    const spawns = run.spawns;
    if (spawns.count > 0) {
      const packed = spawnCodec.encode(spawns.items, spawns.count, projTex.toIdx);
      const copy = packed.slice();
      transport.send(CH.SNAPSHOT, copy);
      stats.bytesOut += copy.byteLength;
      windowBytes += copy.byteLength;
      spawns.count = 0;
    }

    // Замахи: то же самое для ударов, которые не рождают снаряда
    const swings = run.swings;
    if (swings.count > 0) {
      const packed = swingCodec.encode(swings.items, swings.count, weapons);
      const copy = packed.slice();
      transport.send(CH.SNAPSHOT, copy);
      stats.bytesOut += copy.byteLength;
      windowBytes += copy.byteLength;
      swings.count = 0;
    }

    // Прах: своя частота (net.pickup_hz) и свой отбор по радиусу видимости.
    // Куча на полу почти не движется, гнать её наравне с врагами незачем.
    if (pickupAcc >= pickupPeriod) {
      pickupAcc = 0;
      for (let i = 0; i < players.length; i++) {
        if (i === selfIdx) continue;
        const p = players[i];
        const packed = pickupCodec.encode(run.pickupPool, p.x, p.y, ashTier);
        const copy = packed.slice();
        transport.send(CH.SNAPSHOT, copy, i);
        stats.bytesOut += copy.byteLength;
        windowBytes += copy.byteLength;
      }
    }

    const events = run.events;
    if (events.length > 0) {
      transport.send(CH.EVENT, { t: MSG_EVENT, list: events.slice() });
      events.length = 0;
    }

    if (window >= 1) {
      stats.kbs = windowBytes / 1024 / window;
      window = 0;
      windowBytes = 0;
    }
  }

  function close() {
    run.spawns.on = false;
    run.swings.on = false;
    transport.off(CH.INPUT, onInput);
    transport.off(CH.EVENT, onClientEvent);
  }

  return {
    step, stats, close, types, weapons, projTex,
    broadcastLevelUps, sendLevelUpTo, broadcastLoadouts, sendLoadoutTo,
  };
}
