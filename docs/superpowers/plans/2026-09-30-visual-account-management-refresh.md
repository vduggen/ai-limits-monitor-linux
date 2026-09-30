# Gerenciamento visual de contas e atualização — Plano de implementação

> **Para agentes implementadores:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar este plano tarefa por tarefa. Os passos usam caixas de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** Cadastrar e administrar contas Claude/Codex pelo editor GTK existente e atualizar serviço/painel sem editar JSON manualmente nem encerrar a sessão para cada mudança.

**Arquitetura:** Extrair operações de configuração de contas para um módulo Python independente de GTK, coberto por testes, e transformá-lo na base do editor compartilhado Cinnamon/GNOME. Na extensão GNOME, adicionar a ação assíncrona de atualização e observar mudanças atômicas do cache, mantendo o timer existente como fallback. Salvar mudanças reinicia apenas o serviço do usuário; autenticação continua nos CLIs oficiais.

**Stack:** Python 3, GTK 3/PyGObject, `systemd --user`, GNOME Shell 46/GJS, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-09-30-visual-account-management-design.md`

## Restrições globais

- Manter a UI GTK 3 compartilhada pelos frontends Cinnamon e GNOME.
- Preservar `ai-limits-widget.service`, `~/.cache/ai-limits-widget/usage.json` e o formato de snapshot versão `1`.
- Não exigir root; operações do serviço usam `systemctl --user`.
- Não instalar CLIs, autenticar, ler/gravar tokens nem criar a configuração inicial quando não houver `accounts.json`.
- Salvar a configuração atomicamente com permissões `0600`, preservando configurações/campos que a tela não edita.
- Edições feitas pela UI só são aplicadas ao pressionar **Salvar**; uma gravação solicita no máximo um restart.
- O painel atualiza quando chega um snapshot; a latência de consulta do provedor não é instantânea.
- Instalar uma nova versão JavaScript da extensão pode exigir uma recarga de sessão uma vez; mudanças posteriores em contas/cache não podem exigir logout/login.
- Preservar alterações existentes no worktree — especialmente `gnome/extension.js`, `gnome/snapshot.js`, documentação e testes — sem resetar nem sobrescrever trabalho anterior.
- Testes e smoke tests não podem alterar o `config/accounts.json` real nem arquivos de autenticação do usuário.

## Foco de revisão

- CLI instalado sem o diretório padrão, ou diretório sem CLI: não oferecer perfil inválido e explicar como preparar a sessão; cobrir em `defaultProfileDiscoveryRequiresExecutableAndDirectory` na Task 1.
- Perfil/provedor duplicado, ID repetido, tentativa de remover a última conta configurada ou de deixar somente contas `enabled: false`: rejeitar sem corromper a configuração; cobrir em `accountCrudRejectsDuplicatesAndLastAccountRemoval` e `removeAccountRejectsLeavingOnlyDisabledAccounts`.
- JSON inválido ou campos futuros que a UI não conhece: falhar com segurança e preservar as configurações não editadas; cobrir em `loadConfigRejectsInvalidJson` e `saveConfigPreservesUnknownFieldsAndMode` na Task 1.
- `systemctl --user restart` falha depois de salvar: manter o arquivo salvo e apresentar erro, sem afirmar que a consulta terminou; cobrir em `restartFailureIsReportedAfterConfigIsPersisted` na Task 2.
- Cache substituído atomicamente ou outro arquivo alterado no diretório: atualizar somente para eventos de `usage.json`, limpar monitor/timers ao desabilitar e manter fallback periódico; cobrir em `cacheEventMatcherAcceptsTargetAndMovedInOnly` na Task 3 e no smoke test da Task 4.

---

### Task 1: Criar operações testáveis para perfis e configuração de contas

**Arquivos:**
- Criar: `cinnamon/account_config.py`
- Criar: `test/test_account_config.py`
- Usar: `cinnamon/config_paths.py` para resolver o caminho existente de configuração

**Interfaces:**
- `discover_default_profiles(home: Path, executable_lookup: Callable[[str], str | None] = shutil.which) -> list[dict[str, str]]` retorna candidatos somente quando o CLI (`claude`/`codex`) está no `PATH` e o perfil padrão existe; cada resultado contém `provider` e `profile_path`. Não inspeciona dados de autenticação.
- `provider_cli_available(provider: str, executable_lookup: Callable[[str], str | None] = shutil.which) -> bool` permite oferecer seleção de pasta extra mesmo quando o perfil padrão não existe; sem CLI, a UI mostra a instrução oficial.
- `load_config(path: Path) -> dict` lê e valida uma configuração existente sem descartar campos desconhecidos.
- `add_account(config: dict, provider: str, profile_path: str, label: str, display_mode: str) -> dict`, `update_account(config: dict, account_id: str, *, label: str, display_mode: str) -> dict` e `remove_account(config: dict, account_id: str) -> dict` retornam uma cópia validada; `remove_account` rejeita remover a última conta configurada ou deixar somente contas desativadas (`enabled: false`).
- Novas contas geram IDs no formato `<provider>-<uuid4 hex>`; Claude armazena o perfil em `configDir` e Codex em `homeDir`. Rejeitar IDs existentes e pares provedor/perfil duplicados após `Path.expanduser().resolve(strict=True)`.
- `save_config(path: Path, config: dict) -> None` escreve por arquivo temporário no mesmo diretório, faz `replace` atômico e define modo `0600`.

- [x] **Passo 1: Escrever testes RED** em `test/test_account_config.py` para `defaultProfileDiscoveryRequiresExecutableAndDirectory`, `providerCliAvailabilityIsCheckedWithoutReadingCredentials`, `accountCrudRejectsDuplicatesAndLastAccountRemoval`, `updateAccountPreservesProviderPaths`, `loadConfigRejectsInvalidJson`, `loadConfigRejectsInvalidAccountFields`, `saveConfigPreservesUnknownFieldsAndMode` e `saveFailureLeavesOriginalConfigIntact`. Usar diretórios temporários e um `executable_lookup` falso; verificar pares válidos/inválidos, mapeamento `configDir`/`homeDir`, unicidade, preservação de `pollIntervalSeconds`, `probeTimeoutSeconds` e campos desconhecidos, conteúdo após recarga, modo `0600` e arquivo original intacto se a substituição falhar.
- [x] **Passo 2: Executar os testes focados e confirmar falha** porque `cinnamon/account_config.py` ainda não existe.

  Run: `python3 -m unittest discover -s test -p 'test_account_config.py' -v`

  Expected: FAIL por importação ausente/funções não implementadas.
- [x] **Passo 3: Implementar as funções e validações** em `cinnamon/account_config.py`. Usar `pathlib`, `shutil.which`, `uuid.uuid4`, escrita temporária e `os.replace`; canonicalizar perfis existentes, manter campos desconhecidos e nunca abrir arquivos de autenticação.
- [x] **Passo 4: Reexecutar os testes focados** e confirmar todos PASS; executar também `python3 -m py_compile cinnamon/account_config.py`.
- [x] **Passo 5: Commit** somente `cinnamon/account_config.py` e `test/test_account_config.py` como `feat: add testable account configuration operations`.

### Task 2: Transformar o editor GTK em gerenciador visual

**Arquivos:**
- Modificar: `cinnamon/configure.py`
- Criar: `test/test_configure_ui.py`
- Usar: `cinnamon/account_config.py` e `cinnamon/config_paths.py`

**Interfaces:**
- A janela lista as contas atuais e mantém mudanças em rascunho até **Salvar**.
- Oferece detecção dos perfis padrão, adição de pasta alternativa por seletor GTK, edição de rótulo/modo e remoção sem permitir apagar a última conta configurada nem deixar o daemon sem contas habilitadas.
- Oferece inclusão rápida dos perfis padrão detectados; permite escolher pasta alternativa quando o CLI está no `PATH`, mesmo que o perfil padrão não exista. Sem CLI, mostra a instrução oficial de instalação/login.
- Task 2 adiciona `restart_user_service(runner: Callable[..., CompletedProcess] = subprocess.run) -> None` em `cinnamon/account_config.py`; solicita `systemctl --user restart ai-limits-widget.service` com timeout de `10` segundos e transforma retorno não-zero em erro exibível. A gravação precede o restart; falha no restart não reverte a configuração.
- `ConfigurationWindow(path, config, *, home=Path.home(), executable_lookup=shutil.which, restart_service=restart_user_service)` recebe dependências externas injetáveis para exercitar os sinais GTK sem CLI/serviço reais.

- [x] **Passo 1: Escrever testes RED** em `test/test_configure_ui.py` para `existingConfigurationShowsAccountFieldsAndAddActions`, `addAndRemoveAccountChangesDraftUntilSave`, `saveWritesAccountsAndRestartsOnce`, `restartFailureKeepsSavedConfigurationAndShowsError`, `restartTimeoutKeepsSavedConfigurationAndShowsError`, `missingCliShowsOfficialLoginGuidance`, `missingDefaultProfileShowsLoginGuidanceAndAllowsCustomFolder` e `missingConfigExplainsPrerequisiteWithoutCreatingInitialConfig`. Inicializar GTK, instanciar a janela com diretório temporário, exercitar botões/sinais reais, confirmar persistência apenas ao salvar, uma chamada de restart e orientação oficial sem acesso ao serviço/credenciais reais.
- [x] **Passo 2: Executar o teste focado e confirmar falha** porque o editor atual só expõe o seletor de modo de exibição. A primeira execução falhou com a injeção `home` ausente, confirmando a falta do gerenciador.

  Run: `xvfb-run -a python3 -m unittest discover -s test -p 'test_configure_ui.py' -v`

  Expected: FAIL nas asserções de gerenciamento de contas.
- [x] **Passo 3: Escrever teste Python para falha no restart** em `test/test_account_config.py`, chamado `restartFailureIsReportedAfterConfigIsPersisted`; injetar um runner que retorna código não-zero e confirmar que o arquivo salvo permanece válido enquanto `restart_user_service` sinaliza erro.
- [x] **Passo 4: Executar o teste Python e confirmar falha** porque `restart_user_service` ainda não existe; a importação falhou antes da implementação.

  Run: `python3 -m unittest discover -s test -p 'test_account_config.py' -v`

  Expected: FAIL pela função ausente.
- [x] **Passo 5: Implementar `restart_user_service` e a janela GTK**. Montar os widgets a partir de uma cópia em memória; detectar perfis no início, filtrar duplicados, validar tudo antes de salvar, aplicar todas as mudanças em uma única gravação e solicitar um restart. Mostrar erro de escrita ou restart na janela; manter a configuração salva se somente o restart falhar.
- [x] **Passo 6: Executar testes GTK/Python e compilação.**

  Run: `xvfb-run -a python3 -m unittest discover -s test -p 'test_configure_ui.py' -v && python3 -m unittest discover -s test -p 'test_account_config.py' -v && python3 -m py_compile cinnamon/configure.py cinnamon/account_config.py`

  Expected: todas as asserções e comandos PASS.
- [x] **Passo 7: Commit** somente os arquivos desta task como `feat: manage provider accounts in GTK settings`.

### Task 3: Adicionar atualização manual e observação do cache na extensão GNOME

**Arquivos:**
- Criar: `gnome/cache-events.js`
- Criar: `test/gnome-cache-events.test.js`
- Criar: `test/gnome-extension.behavior.test.js` (review follow-up: exercise refresh/cache behavior at runtime with controllable GNOME API doubles).
- Modificar: `gnome/extension.js`
- Modificar: `test/gnome-extension.test.js`
- Modificar: `package.json` para incluir `gnome/cache-events.js` em `check:gnome`
- Integrar as alterações GNOME preexistentes de renderização por conta: `gnome/snapshot.js`, `test/gnome-snapshot.test.js`, `gnome/README.md`, `gnome/claude.svg` e `gnome/codex.svg`; são necessárias para que a extensão/testes desta task permaneçam instaláveis e autocontidos.

**Interfaces:**
- `isUsageCacheEvent(cachePath, changedPath, otherPath = null) -> boolean` retorna `true` somente se um dos caminhos do evento corresponder ao cache observado; não depende de Gio para ser testável pelo Node.
- A extensão observa o diretório do cache para receber eventos de gravação e substituição atômica, filtra apenas `usage.json`, aplica debounce e chama `_refresh()`.
- **Atualizar agora** inicia `systemctl --user restart ai-limits-widget.service` via `Gio.Subprocess`, sem bloquear o Shell. Bloqueia novas ativações até novo `createdAt`, erro de subprocesso ou timeout; falhas são comunicadas via `Main.notify`.
- Ao desabilitar, remover timeout/debounce, desconectar o `Gio.FileMonitor` e destruir as referências; manter atualização periódica como fallback se o monitor não puder ser criado.

- [x] **Passo 1: Escrever testes RED** em `test/gnome-cache-events.test.js` para `cacheEventMatcherAcceptsTargetAndMovedInOnly` e `cacheEventMatcherIgnoresUnrelatedFiles`; verificar caminho alvo, caminho movido para o alvo e arquivo temporário não relacionado.
- [x] **Passo 2: Executar os testes focados e confirmar falha** porque `gnome/cache-events.js` ainda não existe.

  Run: `node --test test/gnome-cache-events.test.js`

  Expected: FAIL por importação ausente.
- [x] **Passo 3: Implementar `isUsageCacheEvent`** em `gnome/cache-events.js`, sem imports específicos de Node/GJS, e reexecutar os testes até PASS.
- [x] **Passo 4: Escrever testes de extensão RED** em `test/gnome-extension.test.js` para `GNOME menu exposes asynchronous manual refresh` e `GNOME extension monitorsCacheAndCleansUpOnDisable`; verificar item acionável, comando systemd exato, caminho monitorado, filtro do cache e limpeza de monitor/timers.
- [x] **Passo 5: Executar `node --test test/gnome-extension.test.js` e confirmar falha** nas novas asserções.
- [x] **Passo 6: Implementar o monitor e a ação** em `gnome/extension.js`. Monitorar o diretório pai (não apenas o inode do arquivo substituído); tentar estabelecer o monitor novamente se o diretório ainda não existir; preservar `_refresh()` e o timer atual. Aplicar debounce de `150 ms`. Para a ação, capturar o `createdAt` anterior, reportar falha de spawn/retorno não-zero e encerrar o estado pendente quando surgir snapshot novo ou expirar `60 s`.
- [x] **Passo 7: Executar testes GNOME e sintaxe.**

  Run: `node --test test/gnome-cache-events.test.js test/gnome-extension.test.js && pnpm --ignore-workspace run check:gnome`

  Expected: testes PASS e ambos os módulos GNOME sintaticamente válidos.
- [x] **Passo 8: Commit** somente os arquivos desta task como `feat: refresh GNOME usage on demand`.

### Follow-up após revisão de código

- [x] Confirmar a semântica de `enabled: false` em `src/shared/types.ts` e `src/index.ts`; adicionar testes RED no helper e na janela GTK para o caso de remover a última conta habilitada, observando ambas as falhas antes da implementação.
- [x] Impedir a remoção no helper e desabilitar o botão GTK quando a operação deixaria zero contas habilitadas; conservar também a rejeição da última conta configurada.
- [x] Complementar os testes de texto da extensão com `test/gnome-extension.behavior.test.js`, que executa os métodos da extensão com doubles de GJS e exercita ativação do menu, subprocesso assíncrono, sucesso/falha/timeout, eventos do cache, debounce e cleanup.
- [ ] Smoke test adicional: a sessão GNOME está ativa e a extensão instalada está `ACTIVE`, mas não foi possível abrir o menu via AT-SPI/`org.gnome.Shell.Eval`; o teste de comportamento acima cobre a lógica da extensão, não o clique visual no Shell real.

### Task 4: Documentar, integrar e validar sem tocar nos dados reais

**Arquivos:**
- Modificar: `README.md`
- Modificar: `cinnamon/README.md`
- Modificar: `gnome/README.md`
- Modificar: `test/compatibility.test.js`
- Atualizar na cópia instalada, após comparar antes/depois: `~/.local/share/gnome-shell/extensions/ai-limits-monitor@vlduggen/`

**Interfaces:**
- Instruções de instalação/atualização devem copiar `cinnamon/account_config.py` ao lado de `configure.py`/`config_paths.py` e `gnome/cache-events.js` junto da extensão.
- Documentação diferencia configuração visual de autenticação CLI; o acesso ao gerenciador e **Atualizar agora** não exige logout. Para carregar código JavaScript recém-instalado, pode ser necessário recarregar a sessão GNOME uma vez.
- A cópia instalada recebe `gnome/metadata.json`, `gnome/extension.js`, `gnome/snapshot.js`, `gnome/cache-events.js`, logos SVG, `cinnamon/configure.py`, `cinnamon/config_paths.py` e `cinnamon/account_config.py`; não alterar `config/accounts.json`, o cache nem arquivos de autenticação.

- [x] **Passo 1: Adicionar teste RED** `manualInstallCommandsIncludeAccountAndCacheHelpers` em `test/compatibility.test.js`; verificar que os comandos GNOME e Cinnamon copiam todos os novos módulos auxiliares.
- [x] **Passo 2: Executar `node --test test/compatibility.test.js` e confirmar falha** por ausência dos novos arquivos nos comandos documentados.
- [x] **Passo 3: Atualizar README raiz, Cinnamon e GNOME** com gestão visual, pré-requisito de CLI autenticado, detecção de perfis padrão, pastas extras, ação de atualização e comandos completos de instalação/atualização.
- [x] **Passo 4: Reexecutar `node --test test/compatibility.test.js`** e confirmar PASS.
- [x] **Passo 5: Rodar a suíte e verificações completas.**

  Run: `pnpm --ignore-workspace run check && pnpm --ignore-workspace run build && pnpm --ignore-workspace run test && pnpm --ignore-workspace run check:gnome && node --check cinnamon/applet.js && xvfb-run -a python3 -m unittest discover -s test -v && python3 -m py_compile cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py && git diff --check`

  Expected: todos os comandos terminam com código `0`.
- [x] **Passo 6: Instalar a nova cópia sem modificar dados de uso.** Comparar os arquivos de destino antes/depois; copiar apenas metadados, extensão/helpers, logos e módulos Python allowlisted. Os nove arquivos instalados coincidem com as fontes; nenhuma configuração, credencial ou unidade foi alterada.
- [ ] **Passo 7: Executar smoke test controlado.** O editor instalado abriu uma configuração existente e detectou perfis sem salvar; um restart controlado do serviço produziu novo `createdAt`. A extensão permaneceu `ACTIVE`, mas a ação do menu não pôde ser clicada com as ferramentas de input disponíveis (Shell `Eval` retornou `false`; AT-SPI não abriu o popup). Os métodos de refresh/cache foram exercitados por teste comportamental com doubles; a interação visual no Shell real permanece sem confirmação. Nenhum `accounts.json` ou token foi editado.
- [x] **Passo 8: Revisar `git diff --check`, o estado do worktree e o escopo dos commits**; preservar quaisquer alterações preexistentes não pertencentes às tasks.
- [ ] **Passo 9: Commit** da documentação/testes finais somente após revisão dos arquivos staged, como `docs: document visual account management and refresh`.
