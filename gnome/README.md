# AI Limits Monitor for Linux — GNOME Shell

Este guia cobre a instalação manual por usuário no Ubuntu 24.04 LTS com GNOME
Shell 46. A extensão lê `~/.cache/ai-limits-widget/usage.json`; o serviço do
usuário continua sendo `ai-limits-widget.service` para preservar compatibilidade.

## Pré-requisitos

- o repositório clonado em `~/ai-limits-monitor`;
- Node.js 22+, pnpm, `claude` e `codex` instalados e autenticados;
- Python 3, PyGObject e GTK 3 para abrir o editor de contas:

  ```bash
  sudo apt install python3-gi gir1.2-gtk-3.0
  ```

O daemon é independente do GNOME Shell e deve estar ativo como serviço do
usuário. Na raiz do clone, instale as dependências, crie `config/accounts.json`
e gere a compilação:

```bash
cd ~/ai-limits-monitor
pnpm install
cp config/accounts.example.json config/accounts.json
pnpm check
pnpm build
mkdir -p ~/.config/systemd/user
cp systemd/linux-mint-ai-limits-applet.service.example \
  ~/.config/systemd/user/ai-limits-widget.service
```

O template usa `~/.local/bin/node`. Nesta validação Ubuntu 24.04.5, Node.js
22.22.2 está em `~/.nvm/versions/node/v22.22.2/bin/node` e o link
`~/.local/bin/node` não existe. O systemd não carrega os arquivos de inicialização
do shell; se usar NVM, ajuste a unidade copiada antes de habilitar: use o caminho
de `command -v node` em `ExecStart` e acrescente o diretório `bin` correspondente
ao `PATH`:

```ini
Environment=PATH=%h/.nvm/versions/node/v22.22.2/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/.nvm/versions/node/v22.22.2/bin/node %h/ai-limits-monitor/dist/index.js watch
```

Depois, habilite o serviço de usuário:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ai-limits-widget.service
```

Edite `config/accounts.json` para corresponder às sessões autenticadas dos CLIs.
Após o daemon gravar o primeiro snapshot, ele inclui `configPath`, usado pelo
editor para localizar essa configuração.

## Instalar e habilitar

Copie a extensão e o editor compartilhado para o diretório de extensões do
usuário. `configure.py` e `config_paths.py` precisam ficar lado a lado:

```bash
UUID=ai-limits-monitor@vlduggen
TARGET="$HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$TARGET"
cp gnome/metadata.json gnome/extension.js gnome/snapshot.js \
  gnome/claude.svg gnome/codex.svg "$TARGET/"
cp cinnamon/configure.py cinnamon/config_paths.py "$TARGET/"
```

Na primeira instalação, encerre e inicie novamente a sessão GNOME para que o
Shell descubra a nova extensão. Depois habilite-a:

```bash
gnome-extensions enable ai-limits-monitor@vlduggen
```

Cada conta utilizável aparece em uma entrada horizontal com o logo do provedor,
as iniciais do nome e até dois percentuais, respeitando `% restante` ou `% usado`
da configuração daquela conta. Contas sem limites utilizáveis não ocupam espaço
no painel. Clique nele para ver a idade do snapshot, contas, planos, períodos e
horários de reset. Snapshots antigos são marcados como **antigo** no painel e
como desatualizados no menu. **Configurar…** abre o editor GTK 3 sem bloquear o
GNOME Shell. A extensão só lê o cache; as consultas continuam sendo feitas pelo
daemon.

## Atualizar

Na raiz do clone atualizado, copie novamente os arquivos para o mesmo diretório:

```bash
UUID=ai-limits-monitor@vlduggen
TARGET="$HOME/.local/share/gnome-shell/extensions/$UUID"
gnome-extensions disable "$UUID"
cp gnome/metadata.json gnome/extension.js gnome/snapshot.js \
  gnome/claude.svg gnome/codex.svg "$TARGET/"
cp cinnamon/configure.py cinnamon/config_paths.py "$TARGET/"
gnome-extensions enable "$UUID"
```

Atualize o daemon separadamente com `pnpm install`, `pnpm build` e reinicie
`systemctl --user restart ai-limits-widget.service` se o código do daemon mudou.
Não substitua a unidade instalada se ela tiver caminhos próprios para uma
instalação anterior.

## Remover

Desabilite e remova apenas a extensão GNOME:

```bash
UUID=ai-limits-monitor@vlduggen
gnome-extensions disable "$UUID"
rm -r "$HOME/.local/share/gnome-shell/extensions/$UUID"
```

Isso não remove o serviço, o cache ou `config/accounts.json`. Para também parar o
daemon, use `systemctl --user disable --now ai-limits-widget.service` e remova
manualmente a unidade de usuário somente se não precisar mais dela.

## Teste de fumaça manual

1. Confirme que `systemctl --user is-active ai-limits-widget.service` retorna
   `active` e que `~/.cache/ai-limits-widget/usage.json` contém `configPath`.
2. Confirme que o cache contém dados de uso e que suas permissões são restritas
   (`stat -c '%a' ~/.cache/ai-limits-widget/usage.json` deve retornar `600`).
3. Confira os valores Claude/Codex no painel e abra o menu para verificar contas,
   detalhes dos períodos e horário da última atualização.
4. Use **Configurar…**, altere o modo de exibição de uma conta e confirme a
   mensagem de salvamento. Verifique que
   `systemctl --user show ai-limits-widget.service -p ActiveEnterTimestamp`
   avançou após o reinício solicitado pelo editor.
5. Aguarde uma nova atualização e confirme que o indicador reflete o snapshot.
   Também confirme o estado de cache ausente em um usuário de teste sem cache e
   que um snapshot com mais de dois minutos seja sinalizado como antigo.

Não é necessário habilitar o serviço como root; tanto a extensão como o daemon
pertencem à sessão do usuário.
