# Linux Mint AI Limits Applet

Applet para Cinnamon no Linux Mint que acompanha limites de assinatura do Claude
Code e do Codex, com suporte a múltiplas contas e múltiplos períodos de uso.

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
  conta e os dois principais períodos;
- popup com contas, planos, e-mails, janelas e horários de reset;
- contas sem limites de assinatura são marcadas como `unsupported` e não aparecem
  no popup operacional.

O projeto consulta sessões autenticadas dos aplicativos locais; ele não usa API
keys para representar assinaturas e não salva senhas ou tokens próprios. As
credenciais continuam sendo gerenciadas pelos respectivos CLIs. O cache local
contém dados de uso, e-mail/plano quando fornecidos pelo provedor e o caminho da
configuração; ele deve permanecer fora do controle de versão.

## Pré-requisitos

- Linux Mint com Cinnamon 5.4 ou mais recente;
- Node.js 22 ou mais recente;
- pnpm;
- `claude` instalado e autenticado com `claude auth login`;
- `codex` instalado e autenticado com `codex login`.

As interfaces utilizadas pelo Claude Agent SDK e pelo Codex app-server podem
mudar sem compatibilidade garantida.

## Instalação rápida

Clone o projeto no diretório usado pelo serviço de exemplo:

```bash
git clone <URL-DO-REPOSITÓRIO> ~/linux-mint-ai-limits-applet
cd ~/linux-mint-ai-limits-applet
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
o Node esteja instalado em outro local. Em seguida:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ai-limits-widget.service
systemctl --user status ai-limits-widget.service
```

O arquivo local ainda se chama `ai-limits-widget.service` para preservar
instalações anteriores; o nome público do projeto é `linux-mint-ai-limits-applet`.

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
  cinnamon/configure.py cinnamon/claude.svg cinnamon/codex.svg "$TARGET/"
chmod +x "$TARGET/configure.py"
```

Depois, abra **Configurações do Sistema → Applets**, procure por **Linux Mint AI Limits Applet** e
adicione-o ao painel. O item **Configurar…** do applet abre o editor gráfico para
escolher `% restante` ou `% usado` por conta.

O UUID e o diretório de instalação do applet são
`ai-limits-widget@vlduggen`. Se você tinha uma versão anterior instalada, remova
essa entrada antiga do Cinnamon e adicione este applet novamente.

## Desenvolvimento

```bash
pnpm check
pnpm build
node --check cinnamon/applet.js
python3 -m py_compile cinnamon/configure.py
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
