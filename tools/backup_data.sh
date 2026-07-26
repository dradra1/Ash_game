#!/bin/sh
# Бэкап volume data/: аккаунты, мета, живой конфиг, ключ сессий.
#
# Прогресс игрока живёт только здесь и ничем не восстанавливается — потеря
# users.db означает потерю всех реликвий и открытий у всех игроков.
#
#   tools/backup_data.sh              в data/backups
#   tools/backup_data.sh /mnt/backup  в указанный каталог
#
# В cron: 17 4 * * *  /opt/sites/ash-and-iron/tools/backup_data.sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ASH_DATA:-$ROOT/data}"
DEST="${1:-$SRC/backups}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ -d "$SRC" ] || { echo "нет каталога данных: $SRC" >&2; exit 1; }
mkdir -p "$DEST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# SQLite копируем через .backup, а не cp: на живой базе копия файла может
# застать её посреди транзакции и оказаться битой.
if [ -f "$SRC/users.db" ]; then
    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "$SRC/users.db" ".backup '$TMP/users.db'"
    elif command -v python3 >/dev/null 2>&1; then
        # У python есть тот же онлайн-бэкап, что и у утилиты sqlite3
        python3 - "$SRC/users.db" "$TMP/users.db" <<'PYEOF'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
with sqlite3.connect(src) as s, sqlite3.connect(dst) as d:
    s.backup(d)
PYEOF
    else
        cp "$SRC/users.db" "$TMP/users.db"
        echo "предупреждение: ни sqlite3, ни python3 — копия обычным cp" >&2
    fi
fi
[ -f "$SRC/game_config.json" ] && cp "$SRC/game_config.json" "$TMP/"
[ -f "$SRC/secret_key" ] && cp "$SRC/secret_key" "$TMP/"

OUT="$DEST/ash-data-$STAMP.tar.gz"
tar -czf "$OUT" -C "$TMP" .
chmod 600 "$OUT"
echo "$OUT ($(du -h "$OUT" | cut -f1))"

# Держим последние $KEEP архивов
ls -1t "$DEST"/ash-data-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old"
    echo "удалён старый: $old"
done
