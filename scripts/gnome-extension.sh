#!/usr/bin/env bash
# Instala, recarrega e testa a extensão GNOME sem encerrar a sessão.
#
# A extensão usa um carregador versionado (docs/adr/003-carregador-versionado-gnome.md):
# cada instalação cria versions/<id>/ e a recarga ativa a versão nova na hora.
# A primeira instalação do carregador ainda precisa de um logout.
#
# Uso (na raiz do clone):
#   scripts/gnome-extension.sh install          # instala e recarrega se possível
#   scripts/gnome-extension.sh nested [LxA]     # testa num GNOME Shell aninhado
set -euo pipefail

UUID=ai-limits-monitor@vlduggen
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
DEV_DATA_HOME="${XDG_CACHE_HOME:-$HOME/.cache}/ai-limits-gnome-dev/data"

install_to() {
    python3 "$ROOT/cinnamon/project_updates.py" "$ROOT" "$1"
}

loader_active() {
    local pid
    pid="$(cat "$TARGET/.loader-pid" 2>/dev/null)" || return 1
    [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$(cat "/proc/$pid/comm" 2>/dev/null)" == gnome-shell ]]
}

install_extension() {
    local version
    version="$(install_to "$TARGET")"
    echo "Versão $version instalada em $TARGET."
    if loader_active; then
        gnome-extensions disable "$UUID"
        gnome-extensions enable "$UUID"
        echo "Extensão recarregada; a versão nova já está em uso."
    else
        echo "A sessão atual ainda roda a extensão anterior ao carregador."
        echo "Encerre a sessão uma vez; depois, as instalações serão aplicadas na hora."
    fi
}

run_nested() {
    local size="${1:-1366x768}"
    if [[ ! "$size" =~ ^[0-9]+x[0-9]+$ ]]; then
        echo "Tamanho inválido: $size (use LARGURAxALTURA)." >&2
        exit 2
    fi
    rm -rf "$DEV_DATA_HOME/gnome-shell/extensions/$UUID"
    install_to "$DEV_DATA_HOME/gnome-shell/extensions/$UUID" >/dev/null
    echo "Abrindo GNOME Shell aninhado ($size). Feche a janela para encerrar."
    # XDG_DATA_HOME isolado: só a cópia de teste é carregada. Cache e
    # configuração continuam os reais, então o popup mostra os dados atuais.
    XDG_DATA_HOME="$DEV_DATA_HOME" \
    MUTTER_DEBUG_DUMMY_MODE_SPECS="$size" \
        dbus-run-session -- gnome-shell --nested --wayland 2>&1 \
        | grep --line-buffered -iE "ai-limits|$UUID|JS ERROR|JS WARNING" || true
}

case "${1:-}" in
    install) install_extension ;;
    nested) run_nested "${2:-}" ;;
    *)
        sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
