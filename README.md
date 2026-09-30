# AI Limits Monitor for Linux

Monitor de limites de assinatura do Claude Code e Codex para o painel do Linux,
com suporte a múltiplas contas e períodos de uso.

> Projeto comunitário e experimental. Não é afiliado, endossado ou patrocinado
> pela Anthropic, OpenAI ou Linux Mint.

## Recursos

- Claude: consulta o `get_usage` do Claude Agent SDK usando uma sessão autenticada
  do Claude Code;
- Codex: inicia `codex app-server` e consulta `account/rateLimits/read`;
- múltiplas contas Claude e Codex, isoladas por `CLAUDE_CONFIG_DIR` e `CODEX_HOME`;
- percentual configurável por conta: `% restante` ou `% usado`;
- daemon separado do applet, cache local e atualização periódica;
- painel com uma entrada por conta utilizável, mostrando o logo, as iniciais da
  conta e os dois principais períodos; o nome completo continua disponível no
  popup detalhado;
- popup com contas, planos, e-mails, janelas e horários de reset;
- contas sem limites de assinatura são marcadas como `unsupported` e não aparecem
  no popup operacional.

O projeto consulta sessões autenticadas dos aplicativos locais; ele não usa API
keys para representar assinaturas e não salva senhas ou tokens próprios. As
credenciais continuam sendo gerenciadas pelos respectivos CLIs. O cache local
contém dados de uso, e-mail/plano quando fornecidos pelo provedor e o caminho da
configuração; ele deve permanecer fora do controle de versão.

## Pré-requisitos

- Linux Mint 21.3+ com Cinnamon 5.4 ou mais recente;
- Ubuntu 24.04 LTS com GNOME Shell 46;
- Node.js 22 ou mais recente;
- pnpm;
- `claude` instalado e autenticado com `claude auth login`;
- `codex` instalado e autenticado com `codex login`.

O editor gráfico de contas usa GTK 3 e PyGObject. No Ubuntu, instale as
dependências com:

```bash
sudo apt install python3-gi gir1.2-gtk-3.0
```

Esse editor só é necessário para alterar o modo de exibição pela interface; as
contas também podem ser editadas diretamente em `config/accounts.json`.

As interfaces utilizadas pelo Claude Agent SDK e pelo Codex app-server podem
mudar sem compatibilidade garantida.

Se este clone estiver dentro de outro workspace pnpm e o `pnpm install` não
criar as dependências locais, use `pnpm --ignore-workspace install` e prefixe os
scripts deste repositório com `pnpm --ignore-workspace run`.

## Instalação rápida

Clone o projeto no diretório usado pelo serviço de exemplo:

```bash
git clone <URL-DO-REPOSITÓRIO> ~/ai-limits-monitor
cd ~/ai-limits-monitor
pnpm install
cp config/accounts.example.json config/accounts.json
pnpm check
pnpm build
```

Edite `config/accounts.json` para informar as contas autenticadas. O arquivo
`config/accounts.json` é ignorado pelo Git de propósito.

## Configuração de contas

Para uma segunda conta Claude:

```bash
mkdir -p ~/.claude-trabalho
CLAUDE_CONFIG_DIR=~/.claude-trabalho claude auth login
```

Para uma segunda conta Codex:

```bash
mkdir -p ~/.codex-trabalho
CODEX_HOME=~/.codex-trabalho codex login
```

Exemplo de conta adicional:

```json
{
  "id": "claude-trabalho",
  "label": "Claude trabalho",
  "provider": "claude",
  "displayMode": "remaining",
  "configDir": "~/.claude-trabalho"
}
```

Para Codex, use `homeDir` no lugar de `configDir`:

```json
{
  "id": "codex-trabalho",
  "label": "Codex trabalho",
  "provider": "codex",
  "displayMode": "used",
  "homeDir": "~/.codex-trabalho"
}
```

Use `displayMode: "used"` para mostrar o percentual consumido ou
`displayMode: "remaining"` para mostrar o percentual restante. O padrão é
`remaining`. `pollIntervalSeconds` controla a frequência das consultas, e
`probeTimeoutSeconds` controla o tempo máximo de cada conta.

## Executar e instalar o serviço

Para uma consulta única ou execução contínua:

```bash
pnpm check:usage
pnpm watch
```

Para instalar o daemon como serviço do usuário:

```bash
pnpm build
mkdir -p ~/.config/systemd/user
cp systemd/linux-mint-ai-limits-applet.service.example ~/.config/systemd/user/ai-limits-widget.service
```

O arquivo de exemplo usa `~/.local/bin/node`. Ajuste `PATH` e `ExecStart` caso
o Node esteja instalado em outro local. O exemplo aponta para `~/ai-limits-monitor`
e destina-se a instalações novas.
Instalações existentes devem manter o diretório e os caminhos da unidade que já
está em uso; não copie o exemplo por cima de uma unidade personalizada sem
ajustá-la. Em seguida:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ai-limits-widget.service
systemctl --user status ai-limits-widget.service
```

O arquivo local ainda se chama `ai-limits-widget.service` para preservar
instalações anteriores. O nome do produto é **AI Limits Monitor for Linux**; o
slug público do repositório continua `linux-mint-ai-limits-applet`.

O cache padrão fica em `~/.cache/ai-limits-widget/usage.json`. O nome
`ai-limits-widget` é um identificador legado mantido para preservar instalações
existentes. Os caminhos podem ser substituídos com `AI_LIMITS_CONFIG` e
`AI_LIMITS_CACHE`:

```bash
AI_LIMITS_CONFIG=/caminho/accounts.json \
AI_LIMITS_CACHE=/caminho/usage.json \
pnpm check:usage
```

## Applet Cinnamon

Com o daemon em execução, instale os arquivos do applet:

```bash
TARGET="$HOME/.local/share/cinnamon/applets/ai-limits-widget@vlduggen"
mkdir -p "$TARGET"
cp cinnamon/metadata.json cinnamon/applet.js cinnamon/settings-schema.json \
  cinnamon/configure.py cinnamon/config_paths.py \
  cinnamon/claude.svg cinnamon/codex.svg "$TARGET/"
chmod +x "$TARGET/configure.py"
```

Depois, abra **Configurações do Sistema → Applets**, procure por **AI Limits Monitor for Linux** e
adicione-o ao painel. O item **Configurar…** do applet abre o editor gráfico para
escolher `% restante` ou `% usado` por conta.

O UUID e o diretório de instalação do applet são
`ai-limits-widget@vlduggen`. Se você tinha uma versão anterior instalada, remova
essa entrada antiga do Cinnamon e adicione este applet novamente.

## Extensão GNOME

Para Ubuntu 24.04 LTS/GNOME Shell 46, siga o guia de instalação, atualização e
remoção em [`gnome/README.md`](gnome/README.md). A extensão lê o mesmo cache e
usa o serviço de usuário já documentado acima.

## Desenvolvimento

```bash
pnpm check
pnpm build
pnpm test
pnpm check:gnome
node --check cinnamon/applet.js
python3 -m py_compile cinnamon/configure.py cinnamon/config_paths.py
```

As fontes dos logomarks locais e as informações de terceiros estão documentadas
em [`cinnamon/BRAND-SOURCES.md`](cinnamon/BRAND-SOURCES.md).

## Limitações conhecidas

- as APIs de uso usadas pelo Claude Agent SDK e pelo Codex app-server são
  experimentais ou internas e podem mudar;
- o daemon faz uma consulta completa por conta em cada ciclo;
- a disponibilidade dos períodos depende do que cada provedor reporta;
- contas autenticadas somente por API key não expõem limites de assinatura e são
  tratadas como `unsupported`.
