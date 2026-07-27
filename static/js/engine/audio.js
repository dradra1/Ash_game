// Звук на WebAudio: короткие синтезированные эффекты и лимит одновременных
// инстансов на каждый вид, плюс фоновая музыка из файлов.
//
// Почему эффекты синтезируются, а не грузятся: ТЗ разрешает только CC0/CC-BY с
// указанием авторства, а до подбора библиотеки игра должна звучать. Голоса
// генерируются осциллятором — ни лицензии, ни загрузки, ни трафика.
//
// Музыка, наоборот, файловая: config.audio.tracks задаёт id → {src, title, author,
// license, url}. Все треки — CC0 с opengameart.org, авторы перечислены в CREDITS.md
// и показываются в настройках звука. Играется через <audio> с зацикливанием и
// кроссфейдом: декодировать многоминутный трек в буфер ради этого незачем.
//
// Громкости раздельные (music_volume / sfx_volume) и переживают перезапуск в
// localStorage: настройки звука — единственное, что игрок правит почти сразу.

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

const STORE_KEY = 'ash_audio';
const FADE_MS = 800;
const FADE_STEP_MS = 50;

function loadPrefs() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;                 // приватный режим/запрет хранилища — не повод падать
  }
}

function savePrefs(p) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch (e) { /* см. выше */ }
}

export function createAudio(config) {
  const cfg = config.audio || {};
  const limit = cfg.sfx_instance_limit || 4;
  let ctx = null;
  let master = null;
  let muted = false;
  const playing = {};      // id → сколько сейчас звучит

  const saved = loadPrefs() || {};
  let musicVol = num(saved.music, num(cfg.music_volume, 0.5));
  let sfxVol = num(saved.sfx, num(cfg.sfx_volume, 0.7));
  muted = !!saved.muted;

  // --- Музыка ---------------------------------------------------------------
  const tracks = cfg.tracks || {};
  let el = null;             // сейчас звучащий <audio>
  let elId = null;
  let fadeTimer = 0;
  let unlocked = false;
  let pendingTrack = null;   // что включить, как только браузер разрешит звук

  function makeAudioEl(id) {
    const t = tracks[id];
    if (!t || !t.src || typeof globalThis.Audio !== 'function') return null;
    const a = new globalThis.Audio(t.src);
    a.loop = t.loop !== false;
    a.preload = 'auto';
    a.volume = 0;
    return a;
  }

  function targetVol(id) {
    const t = tracks[id];
    const gain = t && typeof t.gain === 'number' ? t.gain : 1;
    return muted ? 0 : Math.max(0, Math.min(1, musicVol * gain));
  }

  // Кроссфейд: старый трек гасим и выбрасываем, новый поднимаем до целевой.
  function fadeTo(next, nextId) {
    if (fadeTimer) { globalThis.clearInterval(fadeTimer); fadeTimer = 0; }
    const prev = el;
    const prevFrom = prev ? prev.volume : 0;
    el = next;
    elId = nextId;
    const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS));
    let i = 0;
    fadeTimer = globalThis.setInterval(() => {
      i++;
      const k = Math.min(1, i / steps);
      if (prev) prev.volume = Math.max(0, prevFrom * (1 - k));
      if (el) el.volume = targetVol(elId) * k;
      if (k >= 1) {
        globalThis.clearInterval(fadeTimer);
        fadeTimer = 0;
        if (prev) { prev.pause(); prev.src = ''; }
      }
    }, FADE_STEP_MS);
  }

  // Включить трек по id. Повторный вызов с тем же id ничего не делает — иначе
  // музыка перезапускалась бы на каждой смене фазы внутри одной волны.
  function playMusic(id) {
    if (!id || !tracks[id]) return;
    if (elId === id && el && !el.paused) return;
    if (!unlocked) { pendingTrack = id; return; }
    const next = makeAudioEl(id);
    if (!next) return;
    const p = next.play();
    if (p && p.catch) p.catch(() => { pendingTrack = id; });
    fadeTo(next, id);
  }

  function stopMusic() {
    pendingTrack = null;
    if (fadeTimer) { globalThis.clearInterval(fadeTimer); fadeTimer = 0; }
    if (el) { el.pause(); el.src = ''; }
    el = null;
    elId = null;
  }

  function applyMusicVolume() {
    if (el && !fadeTimer) el.volume = targetVol(elId);
  }

  // Список треков с авторами и лицензиями для экрана настроек: требование CC-BY,
  // и хорошая манера даже для CC0.
  function credits() {
    const out = [];
    for (const id in tracks) {
      const t = tracks[id];
      out.push({
        id, title: t.title || id, author: t.author || '',
        license: t.license || '', url: t.url || '',
      });
    }
    return out;
  }

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
    const vol = v.gain * sfxVol;
    if (vol <= 0) return;
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
    unlocked = true;
    if (pendingTrack) {
      const id = pendingTrack;
      pendingTrack = null;
      playMusic(id);
    }
  }

  function persist() {
    savePrefs({ music: musicVol, sfx: sfxVol, muted });
  }

  return {
    play,
    unlock,
    playMusic,
    stopMusic,
    credits,
    get currentTrack() { return elId; },
    get muted() { return muted; },
    setMuted(v) {
      muted = !!v;
      applyMusicVolume();
      persist();
    },
    get musicVolume() { return musicVol; },
    setMusicVolume(v) {
      musicVol = Math.max(0, Math.min(1, num(v, musicVol)));
      applyMusicVolume();
      persist();
    },
    get sfxVolume() { return sfxVol; },
    setSfxVolume(v) {
      sfxVol = Math.max(0, Math.min(1, num(v, sfxVol)));
      persist();
    },
    setVolume(v) {
      if (master) master.gain.value = Math.max(0, Math.min(1, v));
    },
  };
}
