# Источники и лицензии

Весь визуал игры — оригинальный, сгенерирован через pixellab по промптам из
`tools/assets.json` (правила и реестр — `ASSETS.md`). Сторонние ассеты берутся
только под **CC0 или CC-BY** с указанием авторства (`CLAUDE.md` §6).

Этот файл — единственный реестр заимствований. Добавляешь чужой ассет —
дописываешь строку сюда, иначе его в репозитории быть не должно.

## Музыка

Все треки — **CC0 1.0** (public domain) с [opengameart.org](https://opengameart.org).
CC0 не требует указания авторства юридически; перечисляем авторов, потому что это
условие, под которым мы вообще берём чужое, и потому что так правильно.

Те же данные лежат в `config.audio.tracks` и показываются игроку на экране
настроек звука.

| Файл | Трек | Автор | Лицензия | Источник |
|---|---|---|---|---|
| `static/audio/mu_menu.ogg` | EmptyCity | yd | CC0 1.0 | https://opengameart.org/content/emptycity-background-music |
| `static/audio/mu_wave_a.ogg` | Post Apocalyptic Wastelands | SubspaceAudio (Juhani Junkala) | CC0 1.0 | https://opengameart.org/content/horror-atmosphere |
| `static/audio/mu_wave_b.ogg` | Dark Shrine Loop | qubodup | CC0 1.0 | https://opengameart.org/content/dark-shrine-loop |
| `static/audio/mu_wave_c.ogg` | Fast fight / battle music | XCVG | CC0 1.0 | https://opengameart.org/content/fast-fight-battle-music-looped |
| `static/audio/mu_boss.ogg` | Boss Battle #2 (Symphonic Metal) | nene | CC0 1.0 | https://opengameart.org/content/boss-battle-2-symphonic-metal |

Файлы перекодированы в Ogg Vorbis q2 (`ffmpeg -c:a libvorbis -q:a 2`): исходники
шли до 350 кбит/с и весили до 14 МБ на трек, что для браузерной игры неприемлемо.
Сама музыка не изменена — только битрейт.

**Сознательно НЕ взято**: материалы под CC-BY-SA (share-alike распространяется на
производные) и под GPL. Если понадобится трек под CC-BY — формат записи тот же,
меняется только колонка «Лицензия»; интерфейс настроек уже её показывает.

## Звуковые эффекты

Файлов нет: эффекты синтезируются осциллятором в `static/js/engine/audio.js`
(таблица `VOICES`). Ни лицензии, ни загрузки, ни трафика.

## Шрифты

См. `static/fonts/` и `ASSETS.md`.
