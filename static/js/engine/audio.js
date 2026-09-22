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
const FADE_STEP_MS = 25;
const DEFAULT_FADE_MS = 800;

function clamp01(k) {
  return k < 0 ? 0 : (k > 1 ? 1 : k);
}

// Кроссфейд равной мощности. При линейном сведении на середине проваливается
// суммарная громкость: два некоррелированных трека по 0.5 амплитуды дают не
// единицу, а корень из двух пополам. sin/cos держат сумму мощностей постоянной.
export function crossUp(k) {
  return Math.sin(clamp01(k) * Math.PI / 2);
}

// Через crossUp(1 − k), а не через cos: у косинуса cos(π/2) даёт 6e-17 вместо нуля,
// и последний тик фейда оставлял бы на затухшем треке остаток громкости.
export function crossDown(k) {
  return crossUp(1 - clamp01(k));
}

// Появление из тишины — другой случай: гасить нечего, и кривая равной мощности
// звучит как резкий рывок (на десятой доле фейда уже 16% громкости). Квадратичная
// начинается тихо и доходит до цели ровно, без ступеньки в конце.
export function fadeIn(k) {
  const t = clamp01(k);
  return t * t;
}

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

// Порядок боевых треков на забег: «мешок» — каждый трек звучит по разу, потом
// мешок перемешивается заново, и первый трек нового круга не равен последнему
// предыдущего (иначе на стыке одна тема играла бы две волны подряд). Сид — от
// сида забега, поэтому порядок разный от забега к забегу, но без Math.random.
// rng — engine/rng.js; waves — сколько номеров волн нужно покрыть.
export function waveMusicOrder(list, waves, rng) {
  const out = [];
  if (!Array.isArray(list) || !list.length) return out;
  while (out.length < waves) {
    const bag = list.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    if (bag.length > 1 && out.length && bag[0] === out[out.length - 1]) {
      const t = bag[0]; bag[0] = bag[bag.length - 1]; bag[bag.length - 1] = t;
    }
    for (const id of bag) out.push(id);
  }
  out.length = waves;
  return out;
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
  let pendingFade = 0;
  const defaultFade = num(cfg.fade_ms, DEFAULT_FADE_MS);
  // Где трек остановился в прошлый раз. Каждая волна начинала тему с нуля, и за
  // забег звучали только первые полминуты каждого трека — отсюда ощущение, что
  // музыка одна и та же. Теперь тема продолжается с места, где её прервали.
  const positions = {};

  function makeAudioEl(id) {
    const t = tracks[id];
    if (!t || !t.src || typeof globalThis.Audio !== 'function') return null;
    const a = new globalThis.Audio(t.src);
    a.loop = t.loop !== false;
    a.preload = 'auto';
    a.volume = 0;
    const at = positions[id];
    if (at > 0) {
      // До загрузки метаданных currentTime может не принять значение — ставим
      // и сразу, и по событию; если трек короче сохранённого места, с начала.
      const seek = () => {
        if (a.duration && at < a.duration - 1) a.currentTime = at;
      };
      try { a.currentTime = at; } catch (e) { /* ещё нет метаданных */ }
      a.addEventListener('loadedmetadata', seek, { once: true });
    }
    return a;
  }

  function targetVol(id) {
    const t = tracks[id];
    const gain = t && typeof t.gain === 'number' ? t.gain : 1;
    return muted ? 0 : Math.max(0, Math.min(1, musicVol * gain));
  }

  // Кроссфейд: старый трек гасим и выбрасываем, новый поднимаем до целевой.
  // Длительность приходит вызывающим: вход в волну тянется дольше обычной смены
  // темы, и число для этого лежит в конфиге, а не в коде.
  function fadeTo(next, nextId, fadeMs) {
    if (fadeTimer) { globalThis.clearInterval(fadeTimer); fadeTimer = 0; }
    const prev = el;
    const prevFrom = prev ? prev.volume : 0;
    if (prev && elId) positions[elId] = prev.currentTime || 0;
    el = next;
    elId = nextId;
    const steps = Math.max(1, Math.round(fadeMs / FADE_STEP_MS));
    let i = 0;
    fadeTimer = globalThis.setInterval(() => {
      i++;
      const k = i / steps;
      if (prev) {
        prev.volume = Math.max(0, prevFrom * crossDown(k));
        if (el) el.volume = targetVol(elId) * crossUp(k);
      } else if (el) {
        el.volume = targetVol(elId) * fadeIn(k);
      }
      if (k >= 1) {
        globalThis.clearInterval(fadeTimer);
        fadeTimer = 0;
        if (prev) { prev.pause(); prev.src = ''; }
      }
    }, FADE_STEP_MS);
  }

  // Включить трек по id. Повторный вызов с тем же id ничего не делает — иначе
  // музыка перезапускалась бы на каждой смене фазы внутри одной волны.
  function playMusic(id, fadeMs) {
    if (!id || !tracks[id]) return;
    if (elId === id && el && !el.paused) return;
    if (!unlocked) { pendingTrack = id; pendingFade = fadeMs; return; }
    const next = makeAudioEl(id);
    if (!next) return;
    const p = next.play();
    if (p && p.catch) p.catch(() => { pendingTrack = id; pendingFade = fadeMs; });
    fadeTo(next, id, fadeMs > 0 ? fadeMs : defaultFade);
  }

  function stopMusic() {
    pendingTrack = null;
    pendingFade = 0;
    if (fadeTimer) { globalThis.clearInterval(fadeTimer); fadeTimer = 0; }
    if (el) {
      if (elId) positions[elId] = el.currentTime || 0;
      el.pause();
      el.src = '';
    }
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
      const fade = pendingFade;
      pendingTrack = null;
      pendingFade = 0;
      playMusic(id, fade);
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
