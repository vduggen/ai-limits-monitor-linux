# AI Limits Monitor for Linux — GNOME Shell

Este guia cobre a instalação manual por usuário no Ubuntu 24.04 LTS com GNOME
Shell 46. A extensão lê `~/.cache/ai-limits-widget/usage.json`; o serviço do
usuário continua sendo `ai-limits-widget.service` para preservar compatibilidade.

## Pré-requisitos

- o repositório clonado em `~/ai-limits-monitor-linux`;
- Node.js 22+, pnpm, `claude` e `codex` instalados e autenticados;
- Python 3, PyGObject e GTK 3 para abrir o editor de contas:

  ```bash
  sudo apt install python3-gi gir1.2-gtk-3.0
  ```

Autentique os perfis pelos comandos oficiais `claude auth login` e `codex login`.
A extensão não instala os CLIs nem inicia ou armazena autenticação.

O daemon é independente do GNOME Shell e deve estar ativo como serviço do
usuário. Na raiz do clone, instale as dependências, crie `config/accounts.json`
e gere a compilação:

```bash
cd ~/ai-limits-monitor-linux
pnpm install
cp config/accounts.example.json config/accounts.json
pnpm check
pnpm build
mkdir -p ~/.config/systemd/user
cp systemd/ai-limits-monitor-linux.service.example \
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
ExecStart=%h/.nvm/versions/node/v22.22.2/bin/node %h/ai-limits-monitor-linux/dist/index.js watch
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
usuário. `configure.py`, `config_paths.py` e `account_config.py` precisam ficar
lado a lado:

```bash
UUID=ai-limits-monitor@vlduggen
TARGET="$HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$TARGET"
cp gnome/metadata.json gnome/extension.js gnome/snapshot.js gnome/cache-events.js \
  gnome/claude.svg gnome/codex.svg "$TARGET/"
cp cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py "$TARGET/"
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
como desatualizados no menu. A extensão só lê o cache; as consultas continuam
sendo feitas pelo daemon.

**Configurar…** abre o gerenciador visual de contas. Ele detecta os perfis padrão
dos CLIs e permite adicionar pastas existentes, editar rótulos/modos ou remover
contas. É necessário ter uma configuração existente; a interface não cria o
primeiro `config/accounts.json`. **Salvar** grava as alterações e reinicia o
serviço uma única vez. Nenhuma dessas ações exige logout/login.

## Atualizar

Na raiz do clone atualizado, copie novamente os arquivos para o mesmo diretório:

```bash
UUID=ai-limits-monitor@vlduggen
TARGET="$HOME/.local/share/gnome-shell/extensions/$UUID"
gnome-extensions disable "$UUID"
cp gnome/metadata.json gnome/extension.js gnome/snapshot.js gnome/cache-events.js \
  gnome/claude.svg gnome/codex.svg "$TARGET/"
cp cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py "$TARGET/"
gnome-extensions enable "$UUID"
```

Atualize o daemon separadamente com `pnpm install`, `pnpm build` e reinicie
`systemctl --user restart ai-limits-widget.service` se o código do daemon mudou.
Não substitua a unidade instalada se ela tiver caminhos próprios para uma
instalação anterior.

O item **Atualizar agora** no menu GNOME reinicia o serviço do usuário sem
bloquear o Shell. A extensão observa o cache e redesenha o painel/menu quando um
snapshot novo chega; o timer de 30 segundos continua como fallback. A ação fica
desabilitada enquanto aguarda o resultado e informa falhas/timeout. Não é preciso
fazer logout para alterar contas ou solicitar uma consulta. Ao instalar código
JavaScript novo, use o fluxo de atualização acima; se o Shell mantiver o módulo
antigo carregado, uma recarga da sessão poderá ser necessária uma única vez.

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
4. Abra **Configurar…** e confirme que contas, rótulos, modos e ações disponíveis
   correspondem à configuração, sem pressionar **Salvar** ao testar com dados
   reais.
5. Use **Atualizar agora**. Confirme que `createdAt` do cache avança e que o
   painel/menu se atualizam sem encerrar a sessão. Verifique também no menu os
   estados de cache ausente e snapshot antigo em uma conta de teste isolada.
6. Para verificar erros de CLI ou serviço, use uma configuração/serviço de teste;
   não altere credenciais nem a configuração real apenas para provocar falhas.

Não é necessário habilitar o serviço como root; tanto a extensão como o daemon
pertencem à sessão do usuário.
