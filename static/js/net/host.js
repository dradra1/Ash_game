// Хост: считает авторитетную симуляцию, принимает ввод, рассылает снапшоты.
//
// Снапшоты идут с частотой net.snapshot_hz, а не каждый кадр, и содержат только
// сущности в радиусе видимости КОНКРЕТНОГО клиента. Снаряды не синхронизируются
// покадрово — на их спавн шлётся событие, клиент экстраполирует полёт сам.

import { CH } from './transport.js';
import { createInputCodec, createSnapshotCodec, buildTypeIndex, MSG_EVENT } from './protocol.js';
import { shopSnapshot, localAdapter } from '../ui/shop_adapter.js';

export function createHost(run, transport, config) {
  const inputCodec = createInputCodec();
  const snapCodec = createSnapshotCodec(config);
  const types = buildTypeIndex(config);
  const period = 1 / config.net.snapshot_hz;

  let acc = 0;
  let seq = 0;
  const stats = { bytesOut: 0, kbs: 0, sent: 0 };
  let window = 0;
  let windowBytes = 0;

  // Ввод от клиентов: применяем к состоянию забега. Хост — авторитет,
  // клиент может только просить, а не двигать себя в чужой симуляции.
  function onInput(payload) {
    const dec = inputCodec.decode(payload);
    if (!dec) return;
    const p = run.state.players[dec.playerIdx];
    if (!p) return;
    run.applyInput(p.id, dec);
  }

  transport.on(CH.INPUT, onInput);

  // Лавка клиента живёт у хоста: ассортимент и кошелёк — часть авторитетного
  // состояния. Клиенту уходит снимок, обратно приходят действия.
  // Отправитель указывает свой индекс сам: авторитет у хоста, доверие внутри
  // комнаты (ТЗ §2) — подделка индекса даёт лишь возможность потратить свою же долю.
  function onClientEvent(msg) {
    if (!msg || msg.t !== 'shop_act') return;
    const player = run.state.players[msg.p];
    if (!player) return;
    const shop = run.shopFor(player.id);
    if (!shop) return;
    const adapter = localAdapter(run, player, shop, config, () => run.readyUp(player.id));
    adapter.act(msg.kind, msg.a);
    sendShopTo(msg.p);
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

  function broadcastShops() {
    for (let i = 0; i < run.state.players.length; i++) sendShopTo(i);
  }

  let lastPhase = run.state.phase;

  function step(dt) {
    // Смена фазы на лавку — момент разослать всем их ассортимент
    if (run.state.phase !== lastPhase) {
      lastPhase = run.state.phase;
      if (lastPhase === 'shop') broadcastShops();
    }

    acc += dt;
    window += dt;
    if (acc < period) return;
    acc -= period;
    seq = (seq + 1) & 0xffff;

    // Каждому клиенту — свой срез мира вокруг его персонажа
    const players = run.state.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const packed = snapCodec.encode(run, p.x, p.y, seq, types.toIdx);
      // Копия нужна: буфер кодека переиспользуется, а socket.io отправляет асинхронно
      const copy = packed.slice();
      transport.send(CH.SNAPSHOT, copy);
      stats.bytesOut += copy.byteLength;
      windowBytes += copy.byteLength;
      stats.sent++;
    }

    // Накопленные события забега уходят надёжным каналом
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
    transport.off(CH.INPUT, onInput);
    transport.off(CH.EVENT, onClientEvent);
  }

  return { step, stats, close, types };
}
