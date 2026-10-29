# AI Limits Monitor for Linux

Monitor de limites de assinatura do Claude Code e Codex para o painel do Linux,
com suporte a múltiplas contas e períodos de uso.

> Projeto comunitário e experimental. Não é afiliado, endossado ou patrocinado
> pela Anthropic, OpenAI ou Linux Mint.

## Recursos

- Claude: combina observações locais recentes do Desktop e da statusline opt-in
  com `get_usage` do Claude Agent SDK como fallback coordenado por perfil;
- Codex: combina eventos locais dos rollouts com `account/rateLimits/read` do
  `codex app-server` como fallback;
- múltiplas contas Claude e Codex, isoladas por `CLAUDE_CONFIG_DIR` e `CODEX_HOME`;
- gerenciador GTK para adicionar ou trocar perfis, ativar/desativar/remover contas,
  editar rótulos/modo de exibição e sinalizar e-mails repetidos no último snapshot;
- percentual configurável por conta: `% restante` ou `% usado`;
- daemon separado do applet, cache local e atualização periódica;
- interfaces sinalizam cache ausente, inválido ou desatualizado; novas gravações
  atualizam o painel sem esperar o intervalo periódico;
- ação **Atualizar agora** solicita uma nova consulta ao serviço do usuário;
- seção **Atualizações** em **Configurar…** aplica commits do clone somente após
  confirmação e fast-forward seguro; também permite sincronizar separadamente os
  arquivos da interface instalada a partir de um clone limpo e atualizado;
- atalho global Cinnamon configurável para abrir/fechar o popup (padrão
  `Super+Alt+A`, sem depender de teclas de pontuação do layout ABNT2);
- painel com uma entrada por conta utilizável, mostrando o logo, as iniciais da
  conta e os dois principais períodos; o nome completo continua disponível no
  popup detalhado;
- Cinnamon e GNOME compartilham a validação do snapshot, os indicadores e os
  estados de atualização; só os adaptadores visuais são específicos de cada Shell;
- popup Cinnamon em cartões por conta, com plano, e-mail, percentuais em barras,
  janelas, duração e horários de reset;
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

O item **Configurar…** do applet Cinnamon ou da extensão GNOME abre esse editor.
Ele descobre `~/.claude` e `~/.codex` quando o CLI correspondente está instalado,
e permite selecionar ou trocar pastas de perfil já existentes, ativar/desativar
contas, editar rótulos/modo de exibição e remover perfis. Também sinaliza quando
o último snapshot mostra o mesmo e-mail em mais de um perfil. As alterações são
aplicadas juntas por **Salvar**, que solicita uma atualização do serviço do
usuário. A interface não instala CLIs, não inicia autenticação e não lê nem guarda
tokens: use os CLIs oficiais (`claude auth login` ou `codex login`) para preparar
cada perfil. Desativar/remover uma conta do monitor não apaga a pasta nem encerra
a sessão do CLI.

Em **Atualizações**, o editor GTK infere a pasta do clone quando o
`config/accounts.json` ativo está dentro dele; outra pasta pode ser escolhida e
fica salva em `~/.config/ai-limits-monitor-linux/settings.json` (ou em
`$XDG_CONFIG_HOME/ai-limits-monitor-linux/settings.json`). A verificação usa
`git fetch` sem alterar arquivos de trabalho.
Aplicar exige confirmação, fast-forward possível e clone limpo; instala as
dependências bloqueadas, compila, sincroniza somente o frontend que abriu o editor
e reinicia o serviço existente. Se uma etapa posterior ao pull falhar, o clone
permanece avançado: não há descarte de alterações nem rollback automático.

O gerenciador exige um `config/accounts.json` já existente. A configuração
inicial continua sendo criada durante a instalação com o exemplo abaixo; a
interface não instala o serviço nem cria o primeiro arquivo. Usar **Configurar…**
ou **Atualizar agora** não exige logout/login. Ao sincronizar uma nova versão de
JavaScript, uma recarga da sessão Cinnamon ou GNOME pode ser necessária para
carregar o código novo.

As interfaces utilizadas pelo Claude Agent SDK e pelo Codex app-server podem
mudar sem compatibilidade garantida.

Se este clone estiver dentro de outro workspace pnpm e o `pnpm install` não
criar as dependências locais, use `pnpm --ignore-workspace install` e prefixe os
scripts deste repositório com `pnpm --ignore-workspace run`.

## Instalação rápida

Clone o projeto no diretório usado pelo serviço de exemplo:

```bash
git clone https://github.com/vduggen/ai-limits-monitor-linux.git ~/ai-limits-monitor-linux
cd ~/ai-limits-monitor-linux
pnpm install
cp config/accounts.example.json config/accounts.json
pnpm check
pnpm build
```

O arquivo `config/accounts.json` é ignorado pelo Git de propósito. Depois de
instalar o serviço e o applet/extensão, use **Configurar…** para selecionar os
perfis já autenticados e ajustar as contas sem editar o JSON à mão.

## Configuração de contas

Para mudanças cotidianas, use o gerenciador **Configurar…**. Os exemplos a seguir
mostram como preparar perfis extras pelos CLIs oficiais; os objetos JSON são uma
referência para configuração manual avançada.

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
`remaining`. `collectionMode` aceita `hybrid` (padrão), `local-only` ou
`remote-only`. Sem intervalo explícito, a política remota usa 600 segundos para
Claude e 120 para Codex. `remotePollIntervalSeconds` substitui esse padrão por
conta; o `pollIntervalSeconds` global legado continua aceito quando explícito.
`probeTimeoutSeconds` controla o tempo máximo de cada consulta.

### Claude: fontes locais e fallback OAuth

O monitor lê o histórico local do Claude Desktop em
`~/.config/Claude/plan-usage-history.json`, quando disponível, associando cada
organização ao `oauthAccount.organizationUuid` do `.claude.json` do perfil.
Não usa percentuais para adivinhar a conta. Entre Desktop e status line, usa a
observação local válida mais recente; uma leitura OAuth bem-sucedida mais nova
não é substituída por uma amostra local mais antiga. `claudeDesktopMaxAgeSeconds` (padrão: 1200)
define sua validade; o Desktop pode atualizar o histórico aproximadamente a
cada 15 minutos. O histórico não informa horários de reset, portanto eles não
são exibidos para essa leitura. O formato é interno ao Desktop e pode mudar.
Se houver um horário de reset futuro obtido anteriormente por OAuth ou status
line para o mesmo perfil e janela, ele é mantido junto ao percentual mais recente
do Desktop. A interface identifica a origem e a idade desse horário; resets
vencidos ou de outro perfil nunca são reaproveitados.

Para evitar consultas repetidas à API de uso, o daemon tenta primeiro a leitura
local do `statusLine` do Claude Code. O recurso é opcional e precisa ser habilitado
em cada perfil Claude: adicione ao `settings.json` daquele perfil (mesclando com
as demais configurações existentes) um comando como:

O Claude Code só inclui essas janelas para assinaturas Pro/Max e depois da
primeira resposta da sessão. Até a leitura local aparecer, o daemon pode recorrer
ao fallback OAuth dentro dos intervalos configurados.

```json
{
  "statusLine": {
    "type": "command",
    "command": "AI_LIMITS_STATUS_FILE=\"$HOME/.cache/ai-limits-widget/status/claude-default.json\" node \"$HOME/ai-limits-monitor-linux/scripts/claude-statusline-collector.mjs\""
  }
}
```

O caminho do script deve apontar para este clone. Para perfis adicionais, use
outro arquivo de saída e configure o mesmo caminho em `statusLinePath` na conta
correspondente de `config/accounts.json`; por exemplo:

```json
{
  "id": "claude-default",
  "label": "Claude pessoal",
  "provider": "claude",
  "displayMode": "remaining",
  "configDir": "~/.claude",
  "statusLinePath": "~/.cache/ai-limits-widget/status/claude-default.json"
}
```

Em perfis não padrão, edite o `settings.json` dentro do `configDir` daquele perfil.
O coletor mantém a saída de status line (`5h`/`7d`) e grava somente as janelas de
cota (`used_percentage` e `resets_at`) e o horário da coleta, com permissões
restritas; converte os resets Unix para datas no snapshot e não persiste sessão,
transcript, e-mail ou token. Se você já usa um `statusLine` próprio, configure
`AI_LIMITS_STATUSLINE_COMMAND` com o comando anterior no wrapper para integrá-lo,
ou substitua-o pelo coletor para exibir apenas as cotas. O applet não altera
configurações do Claude Code automaticamente. Ao preservar um comando, o coletor
encaminha a ele o mesmo JSON de entrada, ambiente e diretório, e repassa
stdout/stderr; uma falha ao gravar a observação não impede o comando anterior. Por
exemplo, substitua `node "$HOME/.claude/statusline.js"` pelo comando atual:

```json
{
  "statusLine": {
    "type": "command",
    "command": "AI_LIMITS_STATUS_FILE=\"$HOME/.cache/ai-limits-widget/status/claude-default.json\" AI_LIMITS_STATUSLINE_COMMAND='node \"$HOME/.claude/statusline.js\"' node \"$HOME/ai-limits-monitor-linux/scripts/claude-statusline-collector.mjs\""
  }
}
```

`claudeStatusLineMaxAgeSeconds` (padrão: 180) define por quanto tempo a leitura
local é considerada recente. Quando ela falta ou envelhece, o fallback OAuth
bem-sucedido é limitado por `claudeOAuthMinIntervalSeconds` (padrão: 900) por
perfil. O intervalo e os backoffs informados após erros são persistidos em
`<caminho-do-cache>.state.json`, sem credenciais. Enquanto uma fonte aguarda, o
painel mantém a leitura OAuth bem-sucedida até a próxima consulta agendada,
mostrando sua idade real. Em caso de falha, conserva a última cota utilizável
como antiga e exibe o motivo da espera. O coletor local depende do status line
do Claude Code; outros clientes não garantem sua atualização. Erros transitórios aguardam 5 minutos; HTTP 429 usa
15/30/60 minutos com jitter positivo de até 10%, respeitando também o prazo do
CLI. Não tenta fontes de rede em cascata no mesmo ciclo.

**Atualizar agora** solicita uma leitura OAuth imediata, mesmo durante o intervalo
normal após uma consulta bem-sucedida. A ação não ignora um backoff de falha ou
HTTP 429. A consulta continua sendo uma leitura de cotas, sem gerar uma resposta
de modelo; o intervalo automático permanece conservador para reduzir chamadas e
evitar rate limits.

O cabeçalho informa quando o cache do painel foi atualizado; cada cartão informa
a idade da leitura de cotas. São tempos diferentes: a atualização periódica do
serviço não torna automaticamente mais novo o dado recebido do provedor. A
status line é a fonte local mais útil durante sessões Claude Code ativas, pois
inclui os horários de reset sem uma consulta adicional. Ela não consegue buscar
limites novos quando não há uma sessão Claude Code recebendo respostas.

Não configure `statusLine.refreshInterval` apenas para tentar atualizar cotas:
essa opção executa o script novamente com o último JSON recebido, não solicita
uma leitura nova à Anthropic. Como o coletor registra o momento da execução,
reexecuções periódicas poderiam fazer uma amostra antiga parecer recente.
Veja [monitoramento local prioritário](docs/local-first-monitoring.md) para modos
de coleta, integração reversível, cooldown, diagnóstico e implantação controlada.

## Executar e instalar o serviço

A integração local Claude (opt-in) recebe apenas os percentuais de quota da
statusline e escreve snapshots privados por perfil/sessão. Ela não consulta a
API, não lê tokens e preserva o JSON original para o comando anterior. O
instalador exige preview e confirmação; não habilite sem revisar a compatibilidade
do comando anterior com `/bin/sh`. A gravação local não confirma uma medição
remota nova. Configurações de projeto podem substituir a integração de usuário.

Para uma consulta única ou execução contínua:

```bash
pnpm check:usage
pnpm watch
```

Para instalar o daemon como serviço do usuário:

```bash
pnpm build
mkdir -p ~/.config/systemd/user
cp systemd/ai-limits-monitor-linux.service.example ~/.config/systemd/user/ai-limits-widget.service
```

O arquivo de exemplo usa `~/.local/bin/node`. Ajuste `PATH` e `ExecStart` caso
o Node esteja instalado em outro local. O exemplo aponta para
`~/ai-limits-monitor-linux` e destina-se a instalações novas. Instalações
existentes não precisam ser reinstaladas; não copie o exemplo por cima de uma
unidade personalizada. Se você mover o clone existente para outro diretório,
edite a unidade instalada e atualize `WorkingDirectory` e `ExecStart` para o novo
caminho do clone. Depois, aplique a alteração com:

```bash
systemctl --user daemon-reload
systemctl --user restart ai-limits-widget.service
```

Para uma instalação nova, habilite o serviço:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ai-limits-widget.service
systemctl --user status ai-limits-widget.service
```

O arquivo local ainda se chama `ai-limits-widget.service` para preservar
instalações anteriores. O nome do produto é **AI Limits Monitor for Linux** e o
slug público do repositório é `ai-limits-monitor-linux`.

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
  cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py \
  cinnamon/project_updates.py \
  cinnamon/claude.svg cinnamon/codex.svg "$TARGET/"
cp shared/snapshot.js "$TARGET/ai_limits_snapshot.js"
chmod +x "$TARGET/configure.py"
```

Depois, abra **Configurações do Sistema → Applets**, procure por **AI Limits Monitor for Linux** e
adicione-o ao painel. Use **Configurar…** no menu de contexto do applet para
editar o atalho de teclado. A engrenagem no popup abre o editor gráfico de contas,
onde se escolhe `% restante` ou `% usado` por conta.

O UUID e o diretório de instalação do applet são
`ai-limits-widget@vlduggen`. Se você tinha uma versão anterior instalada, remova
essa entrada antiga do Cinnamon e adicione este applet novamente.

No gerenciador de contas, **Sincronizar interface instalada** substitui, após
confirmação, o pacote do applet pelos arquivos atuais do clone. O clone precisa
estar limpo e sem commits pendentes do upstream; aplique primeiro qualquer
atualização disponível. Essa ação não compila o projeto nem reinicia o serviço.
Se o Shell já tiver carregado JavaScript antigo, recarregue a sessão.

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
pnpm check:cinnamon
sudo apt install python3-gi gir1.2-gtk-3.0 xvfb
xvfb-run -a python3 -m unittest discover -s test -v
python3 -m py_compile cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py cinnamon/project_updates.py
```

## Versionamento

Registre cada trabalho no [`CHANGELOG.md`](CHANGELOG.md). As versões do serviço,
do applet Cinnamon e da extensão GNOME são independentes; incremente as versões
dos componentes afetados em cada atualização entregue, mesmo sem preparar uma
release formal. Consulte a [política de versionamento](docs/VERSIONING.md).

As fontes dos logomarks locais e as informações de terceiros estão documentadas
em [`cinnamon/BRAND-SOURCES.md`](cinnamon/BRAND-SOURCES.md).

## Limitações conhecidas

- as APIs de uso usadas pelo Claude Agent SDK e pelo Codex app-server são
  experimentais ou internas e podem mudar;
- observações locais não garantem refletir uso externo ao CLI; a fonte e a idade
  por janela devem ser consideradas, não apenas a publicação do snapshot;
- a disponibilidade dos períodos depende do que cada provedor reporta;
- contas autenticadas somente por API key não expõem limites de assinatura e são
  tratadas como `unsupported`.
