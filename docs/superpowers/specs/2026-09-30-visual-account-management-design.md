# Gerenciamento visual de contas e atualização imediata

## Objetivo

Permitir cadastrar e administrar contas Claude/Codex pela ação **Configurar…**,
sem editar `config/accounts.json` à mão, e solicitar uma consulta imediata sem
encerrar a sessão GNOME. A autenticação continua pertencendo aos CLIs oficiais;
esta aplicação reutiliza os perfis locais já autenticados.

## Situação atual

- O editor GTK 3 compartilhado em `cinnamon/configure.py` só altera
  `displayMode` das contas que já existem.
- O daemon usa `config/accounts.json`, consulta novamente as contas no ciclo de
  monitoramento (60 segundos no ambiente observado) e grava
  `~/.cache/ai-limits-widget/usage.json`.
- A extensão GNOME lê o cache a cada 30 segundos. Alterações do cache não são
  observadas por evento.
- O serviço ativo deste ambiente usa
  `config/accounts.json` da worktree Ubuntu/GNOME e atualmente contém somente
  uma conta Codex habilitada. O caminho também é gravado no snapshot como
  `configPath`.
- A UI é compartilhada pelos frontends Cinnamon e GNOME; mudanças no editor
  continuarão compatíveis com ambos.

## Experiência de configuração

Transformar o editor existente em um gerenciador de contas:

- Listar contas configuradas com provedor, rótulo, perfil local e modo de
  exibição (`% restante` ou `% usado`).
- Detectar perfis padrão quando o CLI correspondente está disponível e o
  diretório padrão existe: `claude` com `~/.claude`, `codex` com `~/.codex`.
- Permitir adicionar perfis extras escolhendo uma pasta existente, para suportar
  múltiplas contas por provedor; pedir o rótulo e o modo de exibição.
- Permitir editar o rótulo/modo e remover uma conta. Não alterar IDs de contas
  existentes; criar IDs exclusivos para novas contas e impedir duplicação do
  mesmo provedor/perfil. Não permitir remover a última conta configurada.
- Manter edições em rascunho até **Salvar**; uma ação de gravação aplica todas as
  mudanças juntas e solicita no máximo um restart, sem reiniciar o serviço a cada
  tecla ou controle alterado.
- Se o CLI ou perfil esperado não estiver disponível, orientar a pessoa a
  instalar/autenticar pelo comando oficial (`claude auth login` ou `codex
  login`). A interface não instala CLIs, não inicia OAuth e não solicita,
  apresenta, lê ou armazena tokens.
- Uma conta adicionada permanece configurada mesmo se a consulta descobrir que
  ela ainda não está autenticada; o resultado e o erro da conta são apresentados
  pelos detalhes já existentes.

O caminho de configuração será resolvido pelo mecanismo compartilhado existente
(`AI_LIMITS_CONFIG`, caminho no snapshot e fallbacks conhecidos). Se não houver
uma configuração existente, esta funcionalidade não instalará o daemon nem
criará a configuração inicial; essa condição deverá ser comunicada com uma
orientação acionável.

## Salvar e atualizar

- Salvar a configuração atomicamente, manter permissões `0600` e preservar as
  demais configurações de nível superior (`pollIntervalSeconds`,
  `probeTimeoutSeconds`) e campos que a tela não edita.
- Após salvar mudanças de conta ou modo, solicitar `systemctl --user restart
  ai-limits-widget.service`. Exibir sucesso/erro do pedido em vez de ignorar o
  código de saída; não perder a configuração salva se o serviço não puder
  reiniciar.
- Adicionar **Atualizar agora** ao menu GNOME. A ação executa o mesmo restart de
  forma assíncrona, evita ativações duplicadas enquanto está em curso e informa
  falhas sem bloquear o Shell.
- Observar mudanças do cache no diretório que contém `usage.json` (incluindo
  substituição atômica do arquivo), aplicar debounce e chamar o renderizador
  existente quando um snapshot novo chegar. Desconectar e cancelar o monitor ao
  desabilitar a extensão. Manter o timer atual como fallback.
- A atualização inclui o tempo necessário para consultar os CLIs/provedores; não
  promete resposta instantânea da rede. Salvar pela UI e usar **Atualizar agora**
  não exige logout/login GNOME.
- Edições externas a `accounts.json` não provocarão restart automático. Elas
  serão lidas no próximo ciclo do daemon, ou imediatamente quando a pessoa usar
  **Atualizar agora**.

## Segurança e tratamento de erros

- Nunca abrir ou serializar os arquivos de autenticação dos CLIs; consultar
  apenas existência de diretório/executável para descoberta local.
- Validar provider, caminhos, campos obrigatórios e IDs antes de salvar.
- Erro ao gravar a configuração deve deixar o arquivo anterior intacto. Erro ao
  reiniciar o serviço deve ser mostrado claramente, mantendo o arquivo salvo.
- Falha na consulta fica no estado/erro operacional da conta, sem apagar a conta
  nem impedir que outras contas sejam exibidas.
- Não modificar formato do cache, protocolo de consulta dos provedores ou nome da
  unidade systemd (`ai-limits-widget.service`).

## Testes e critérios de aceitação

- Testes Python para detectar diretórios padrão, criar/editar/remover contas,
  impedir duplicações e remoção da última conta, preservar configurações não
  editadas, gravação atômica e permissões `0600`; usar diretórios temporários,
  sem credenciais reais.
- Testes da extensão para presença/ativação de **Atualizar agora**, execução
  assíncrona do serviço e refresh em resposta à mudança do cache.
- Regressão dos testes de projeção do snapshot, do menu GNOME e da resolução de
  caminhos de configuração.
- Smoke test manual: adicionar um perfil Claude já autenticado pela UI, salvar,
  confirmar que o serviço produziu snapshot com a conta e que painel/menu
  atualizaram sem encerrar sessão; repetir com **Atualizar agora** e com uma
  falha simulada de CLI/serviço.

## Fora de escopo

- Instalação/configuração inicial do daemon ou criação da configuração quando
  ainda não há `accounts.json`.
- Instalação dos CLIs, autenticação, login/logout, gestão ou migração de tokens.
- Alterações no formato do cache, no daemon de consulta ou na unidade systemd.
- Atualização automática/restart em resposta a edição manual externa do JSON.
