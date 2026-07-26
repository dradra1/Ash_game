// Звук на WebAudio: короткие синтезированные эффекты и лимит одновременных
// инстансов на каждый вид.
//
// Почему синтез, а не файлы: ТЗ разрешает только CC0/CC-BY с указанием авторства,
// а до подбора библиотеки игра должна звучать. Голоса генерируются осциллятором —
// ни лицензии, ни загрузки, ни трафика. Когда появятся звуковые файлы, сюда
// добавится ветка загрузки по `config.audio.sfx[id].src`, интерфейс не меняется.

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export function createAudio(config) {
  const cfg = config.audio || {};
  const limit = cfg.sfx_instance_limit || 4;
  let ctx = null;
  let master = null;
  let muted = false;
  const playing = {};      // id → сколько сейчас звучит

  function ensure() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = num(cfg.master, 0.8);
    master.connect(ctx.destination);
    return ctx;
  }

  // Голоса: тип волны, частота, длительность, огибающая
  const VOICES = {
    hit: { type: 'square', f0: 220, f1: 90, dur: 0.07, gain: 0.18 },
    crit: { type: 'square', f0: 420, f1: 140, dur: 0.10, gain: 0.24 },
    shoot: { type: 'sawtooth', f0: 520, f1: 260, dur: 0.05, gain: 0.12 },
    death: { type: 'triangle', f0: 160, f1: 50, dur: 0.16, gain: 0.20 },
    pickup: { type: 'sine', f0: 660, f1: 990, dur: 0.06, gain: 0.14 },
    levelup: { type: 'sine', f0: 440, f1: 880, dur: 0.28, gain: 0.22 },
    buy: { type: 'triangle', f0: 300, f1: 600, dur: 0.09, gain: 0.18 },
    hurt: { type: 'sawtooth', f0: 180, f1: 70, dur: 0.13, gain: 0.26 },
    wave: { type: 'sine', f0: 220, f1: 330, dur: 0.35, gain: 0.20 },
    boss: { type: 'sawtooth', f0: 90, f1: 60, dur: 0.6, gain: 0.28 },
  };

  function play(id) {
    if (muted) return;
    const v = VOICES[id];
    if (!v) return;
    const ac = ensure();
    if (!ac) return;
    // Лимит одновременных инстансов: в коопе десяток выстрелов в кадр
    // превращается в кашу и подъедает CPU
    if ((playing[id] || 0) >= limit) return;
    playing[id] = (playing[id] || 0) + 1;

    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = v.type;
    const now = ac.currentTime;
    osc.frequency.setValueAtTime(v.f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, v.f1), now + v.dur);
    // Громкость лежит в sfx_volume: ключ `sfx` занят таблицей звуков, и
    // умножение на объект давало NaN, от которого WebAudio падает.
    const vol = v.gain * num(cfg.sfx_volume, 0.7);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + v.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + v.dur);
    osc.onended = () => { playing[id] = Math.max(0, (playing[id] || 1) - 1); };
  }

  // Браузеры не дают запустить звук до жеста пользователя
  function unlock() {
    const ac = ensure();
    if (ac && ac.state === 'suspended') ac.resume();
  }

  return {
    play,
    unlock,
    get muted() { return muted; },
    setMuted(v) { muted = !!v; },
    setVolume(v) {
      if (master) master.gain.value = Math.max(0, Math.min(1, v));
    },
  };
}
