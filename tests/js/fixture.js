// Загрузка настоящего конфига игры в node-тесты. Тесты проверяют формулы ПРОТИВ
// конфига, а не против выдуманных чисел — иначе они разъедутся с балансом.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function loadConfig() {
  return JSON.parse(readFileSync(join(here, '../../config/game_config.json'), 'utf8'));
}

// Транспорт-заглушка: sim подписывается на CH.INPUT, в тестах ввод не нужен
export function stubTransport() {
  return {
    id: 0,
    isHost: true,
    role: 'host',
    send() {},
    on() {},
    off() {},
    close() {},
  };
}

export function makePlayers(n, character) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: i, name: 'p' + i, character });
  return out;
}
