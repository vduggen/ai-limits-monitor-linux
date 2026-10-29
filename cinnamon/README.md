# AI Limits Monitor for Linux — Cinnamon

O applet lê o snapshot gerado pelo daemon em:

```text
~/.cache/ai-limits-widget/usage.json
```

Depois de instalar as dependências e criar a configuração, execute o daemon em
outro terminal:

```bash
cd ~/ai-limits-monitor-linux
pnpm watch
```

Para instalar manualmente no Cinnamon:

```bash
TARGET="$HOME/.local/share/cinnamon/applets/ai-limits-widget@vlduggen"
mkdir -p "$TARGET"
cp cinnamon/metadata.json cinnamon/applet.js cinnamon/settings-schema.json \
  cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py \
  cinnamon/project_updates.py \
  cinnamon/claude.svg cinnamon/codex.svg "$TARGET/"
cp shared/snapshot.js "$TARGET/ai_limits_snapshot.js"
```

O comando acima deve ser executado a partir da raiz do projeto. Os módulos
`configure.py`, `config_paths.py`, `account_config.py` e `project_updates.py`
precisam ficar lado a lado no diretório instalado.

Depois, abra **Configurações do Sistema → Applets**, procure por **AI Limits Monitor for Linux** e
adicione-o ao painel. O menu de contexto do applet (**Configurar…**) permite
alterar o atalho global para abrir/fechar o popup. O padrão é `Super+Alt+A`, uma
combinação fácil no ABNT2 que usa a tecla A e não depende de pontuação.

O UUID `ai-limits-widget@vlduggen` identifica o applet. Se uma versão anterior
estiver instalada, remova-a antes de adicionar esta versão para evitar duas
entradas no Cinnamon.

## Gerenciar contas

Use o ícone de engrenagem no cabeçalho do popup para abrir o gerenciador GTK. Ele
detecta os perfis padrão `~/.claude` e `~/.codex` quando o CLI correspondente está
disponível e permite adicionar ou trocar pastas de perfil existentes. Na mesma
tela, você pode ativar/desativar/remover contas e editar rótulos e modo (`% restante` ou
`% usado`). A tela avisa quando o último snapshot observa o mesmo e-mail em mais
de um perfil. Mantenha pelo menos uma conta monitorada. **Salvar** grava tudo
junto e solicita uma única atualização do serviço do usuário.

A seção **Atualizações** verifica commits upstream do clone configurado. Você
pode escolher a pasta do projeto; essa preferência fica fora de `accounts.json`.
Aplicar exige confirmação, clone limpo e fast-forward possível; o configurador
instala dependências bloqueadas, compila, sincroniza este applet e reinicia o
serviço existente. Se uma etapa falhar depois do pull, não há rollback automático.
Para ativar JavaScript já carregado, talvez seja necessário recarregar a sessão
do Cinnamon.

Separadamente, **Sincronizar interface instalada** substitui, após confirmação,
todo o pacote runtime deste applet pelos arquivos atuais do clone. A ação só
prossegue com o clone limpo e atualizado; se houver commits upstream pendentes,
use **Aplicar atualização** primeiro. Ela não instala dependências, não compila e
não reinicia o serviço. Para ativar JavaScript já carregado, talvez seja necessário
recarregar a sessão do Cinnamon.

A autenticação é feita pelos CLIs oficiais (`claude auth login` e `codex login`).
O gerenciador não instala CLIs nem acessa tokens. Desativar ou remover uma conta
do monitor não apaga a pasta nem encerra a sessão do CLI. É necessário
que `config/accounts.json` já exista; siga a instalação rápida do README raiz
para criar a configuração inicial. Salvar alterações não exige logout da sessão.
Se o daemon estiver rodando no terminal com `pnpm watch`, sem a unidade systemd
instalada, o JSON será salvo mas o pedido de restart automático mostrará erro;
reinicie esse processo manualmente. Com `ai-limits-widget.service` instalado, o
gerenciador solicitará o restart do serviço.

O indicador mostra cada logo ao lado do percentual configurado por conta, sem
letras auxiliares. O popup organiza cada conta em um cartão com provedor e plano,
identificação da conta, barras para os percentuais e os horários de reset das
janelas disponíveis. Erros de consulta continuam visíveis no cartão. O ícone de
configuração abre um editor gráfico com uma opção real para cada conta.

O applet acompanha gravações do cache e atualiza o painel imediatamente, mantendo
uma leitura periódica como fallback. O popup identifica cache ausente, inválido
ou antigo e deixa contas com erro visíveis; leituras reutilizadas são marcadas
como antigas e incluem idade e fonte. Use o ícone de atualizar no cabeçalho para solicitar uma consulta ao
serviço do usuário; é necessário ter `ai-limits-widget.service` instalado e ativo
para essa ação.

No painel, cada conta utilizável aparece em uma entrada própria com o logo do
provedor, as iniciais do nome e os dois percentuais principais. O nome completo
continua disponível no popup detalhado.

Para configuração avançada, o campo também pode ser editado diretamente em
`config/accounts.json`. Cada conta pode usar:

```json
"displayMode": "remaining"
```

ou:

```json
"displayMode": "used"
```

O padrão é `remaining`. Contas com status `unsupported` continuam na
configuração para referência, mas não aparecem no popup de detalhes.

As fontes dos logomarks estão documentadas em `BRAND-SOURCES.md`.
