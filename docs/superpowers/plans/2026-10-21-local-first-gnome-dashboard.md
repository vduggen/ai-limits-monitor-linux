# Local-first collection and GNOME dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acompanhar quotas de sessão/semanal via observações locais dos CLIs, reduzir consultas extras e apresentar origem, idade e recuperação em um menu GNOME nativo.

**Architecture:** Coletores passivos alimentam um coordenador por usuário, com seleção por janela e geração de perfil. O coordenador persiste estado não secreto e controla todo fallback remoto e pedido manual. GNOME e Cinnamon leem o snapshot versão 1; o novo menu GNOME é entregue depois do coletor e da compatibilidade mínima.

**Tech Stack:** Node.js 22+, TypeScript/ESM, node:test com tsx, Python 3/GTK3, GNOME Shell 46/GJS/St/Clutter, Cinnamon existente. Sem dependência nova de runtime ou transporte HTTP próprio.

**Spec:** `docs/superpowers/specs/2026-10-21-local-first-gnome-dashboard-design.md` — ler integralmente antes de executar.

## Global Constraints

- **GNOME Shell 46**, mantendo o Cinnamon funcional. O novo visual Cinnamon será uma entrega posterior.
- Preservar UUIDs, serviço `ai-limits-widget.service` e caminho de `usage.json`.
- Snapshot permanece versão 1 com metadados opcionais. Leitor novo aceita versão 1 antiga.
- Configuração opcional por conta: `collectionMode` (`hybrid` padrão, `local-only` ou `remote-only`) e `remotePollIntervalSeconds`.
- O intervalo remoto inicial será 600 s para Claude e 120 s para Codex; opção explícita `pollIntervalSeconds` legada continua válida.
- Fonte local há mais de 2 minutos sem evento será “último conhecido”; isso é uma convenção visual de atividade, não SLA do provedor.
- Para 429: maior entre prazo do CLI e backoff de 15, 30, 60 minutos, com jitter positivo de até 10%; timeout/falha transitória inicia espera de 5 minutos.
- Diretórios novos 0700, arquivos 0600, rename atômico; validação de proprietário, schema e caminhos.
- Não extrair cookies, copiar tokens, renovar credenciais para escapar de 429, fazer chamadas de inferência de teste ou alterar login/workspace.
- Nenhuma configuração de statusline será alterada na implementação sem uma ação específica do usuário para habilitar a integração.
- Não sobrescrever unidade systemd personalizada nem apagar as worktrees existentes.

## Review Focus

1. Sessão retomada após troca de conta: não atribuir quota antiga ao novo login; teste nas tarefas 2/5.
2. Arquivo regravado ou evento sem semanal: não rejuvenescer a amostra anterior; testes nas tarefas 1/4/7.
3. Reinício, dois processos e pedidos simultâneos: uma consulta no máximo, cooldown preservado; testes nas tarefas 2/6.
4. Statusline cancelada, com espaços/quoting ou exportador quebrado: não perder JSON nem alterar saída anterior; testes na tarefa 3.
5. Menu aberto durante atualizações, tema/escala e contas demais: preservar foco/scroll, texto e geometria; testes na tarefa 9 e smoke test na tarefa 10.

## Preparação e verificação comum

Executar em nova worktree isolada criada a partir de `main` com as correções já commitadas; não usar o diretório do daemon ativo para desenvolver. A criação da worktree ocorre na execução, não neste planejamento. `reports/` e `research_notes/` existentes são material de pesquisa: não descartar nem incluir em commits de código por acidente.

Dependências: `pnpm install --ignore-workspace --frozen-lockfile` se necessário; não alterar configuração PNPM do diretório pai nem aprovar scripts globalmente. Investigar falhas de instalação em vez de ocultá-las. Com dependências presentes, verificação comum por tarefa:

```bash
node --test
python3 -m unittest discover -s test -p 'test_*.py'
./node_modules/.bin/tsc --noEmit -p tsconfig.json
git diff --check
```

Testes TS seguem o padrão existente dos testes JS: registrar `tsx/esm/api` e importar o módulo real. Usar diretórios temporários privados em `/tmp/opencode`, relógio/RNG injetáveis e fixtures sintéticas; testes não consultam provedores, leem perfis pessoais ou enviam prompts. Commit explícito dos arquivos de cada tarefa, com mensagem proposta; nunca `git add .`.

## Mapa de arquivos e contratos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/shared/types.ts`, `src/config.ts` | Schema aditivo e configuração compatível |
| `src/collection/observations.ts` | Validação e seleção por janela/idade |
| `src/collection/identity.ts` | Vínculos de perfil e gerações não secretas |
| `src/collection/private-files.ts` | Leitura/gravação privada e validação de entradas |
| `src/collection/runtime-state.ts` | Lock de escritor e persistência de cooldown |
| `src/collection/claude-statusline.ts`, `src/statusline.ts` | Normalização e passthrough da statusline |
| `src/collection/claude-install.ts` | Preview, backup, instalação e remoção opt-in |
| `src/collection/codex-rollouts.ts` | Leitura incremental de quotas locais |
| `src/collection/remote.ts` | Adaptação dos probes existentes para resultado tipado |
| `src/collection/coordinator.ts`, `src/collection/refresh-requests.ts` | Agenda, estado e pedidos manuais |
| `src/index.ts`, `src/cache.ts` | Entrada CLI, ciclo do daemon e publicação |
| `shared/snapshot.js`, `gnome/dashboard.js`, `gnome/stylesheet.css` | View model compartilhada, widgets e visual GNOME |
| `gnome/extension.js`, `gnome/refresh-request.js` | Ciclo GJS, watchdog e pedido assíncrono |
| `cinnamon/applet.js`, `cinnamon/account_config.py`, `cinnamon/configure.py` | Compatibilidade e controles GTK3 |

Tipos novos em `src/shared/types.ts`:

- `CollectionMode = "hybrid" | "local-only" | "remote-only"`; `AccountConfig` recebe `collectionMode?`, `remotePollIntervalSeconds?` e `externalUsagePath?`. `AppConfig.pollIntervalSeconds` passa a opcional para distinguir opção explícita de default; todos os consumidores devem usar `resolveCollectionPolicy`.
- `UsageSource = "claude-statusline" | "codex-rollout" | "claude-sdk" | "codex-rpc"`.
- `ProfileBinding = { accountId: string; profilePath: string; generation: string; identityId?: string; boundAt: string }`.
- `QuotaObservation = { binding: ProfileBinding; sessionId?: string; identityConfidence: "confirmed" | "profile"; source: UsageSource; observedAt: string; sourceEventAt?: string; fetchedAt?: string; windows: readonly UsageWindow[] }`.
- `RemoteProbeResult = { usage: AccountUsage; failure?: "rate-limited" | "transient" | "unsupported"; retryAt?: string; fetchedAt?: string }`.
- `AccountCollectionState = { binding: ProfileBinding; windows: readonly UsageWindow[]; lastLocalEventAt?: string; lastAttemptAt?: string; lastSuccessAt?: string; nextRetryAt?: string; rateLimitLevel: number; error?: string; failure?: RemoteProbeResult["failure"]; revision: number }`.
- `RefreshRequest = { version: 1; id: string; createdAt: string; accountIds?: readonly string[] }`.
- `RefreshResult = { id: string; completedAt: string; accounts: readonly { accountId: string; outcome: "observed" | "queried" | "unchanged" | "blocked" | "error"; nextRetryAt?: string; error?: string }[] }`.

Adicionar a `UsageWindow` os metadados opcionais `source`, `observedAt`, `sourceEventAt`, `fetchedAt`, `identityConfidence` e `bindingGeneration`; conta ganha `collection?: { lastAttemptAt?: string; lastSuccessAt?: string; nextRetryAt?: string; failure?: RemoteProbeResult["failure"]; revision: number; identityConfidence?: "confirmed" | "profile" }`. Snapshot ganha `refreshResult?: RefreshResult`. Manter `checkedAt` como tentativa/observação original conhecida, nunca data de simples republicação.

---

## Marco 1 — coleta e contrato confiáveis

### Task 1: Schema compatível e seleção temporal por janela

**Files:** modificar `src/shared/types.ts`, `src/config.ts`; criar `src/collection/observations.ts`, `test/collection-observations.test.js`, `test/collection-config.test.js`.

**Interfaces:** `resolveCollectionPolicy(account: AccountConfig, config: AppConfig): { mode: CollectionMode; remoteIntervalSeconds: number; usesLegacyInterval: boolean }`; `mergeObservation(state: AccountCollectionState, observation: QuotaObservation): AccountCollectionState`; `windowState(window: UsageWindow, nowMs: number): "observed" | "last-known" | "expired" | "unavailable"`.

- [ ] **1. RED:** fixtures com sessão 37%, semanal 86%; publicar depois só sessão 40% e afirmar semanal 86% com timestamp inalterado. Repetir observação não incrementa `revision`; evento mais antigo e geração diferente não substituem dados. Rejeitar NaN, futuro >5 s, porcentagem fora de 0–100; preservar janela válida quando outra falha. Reset vencido retorna `expired`, sem zerar percentual.
- [ ] **2. RED:** políticas sem intervalo explícito: Claude 600 s/Codex 120 s; `pollIntervalSeconds:60` explícito conserva 60 e marca legado; override da conta vence. Validar modo e inteiros positivos, aceitar configuração antiga sem chaves novas e round-trip de chaves extras.
- [ ] **3. Verificar falha:** `node --test test/collection-observations.test.js test/collection-config.test.js` deve falhar por comportamento ausente.
- [ ] **4. GREEN:** implementar tipos/normalização e merge imutável por `id` de janela, comparando timestamp do evento quando presente, senão observação; empate conserva anterior. Sem evento confiável, registrar apenas `observedAt`; não preencher `fetchedAt`. Repetição do mesmo evento é idempotente. `windowState` usa reset primeiro e 120.000 ms para último conhecido; dado legado é último conhecido/idade desconhecida. Separar intervalo legado opcional do default atual em `loadConfig`.
- [ ] **5. Verificar e commit:** testes focados + verificação comum; commit `feat: track per-window quota provenance and collection policy`.

### Task 2: Entradas privadas, vínculo por perfil e runtime persistido

**Files:** criar `src/collection/private-files.ts`, `src/collection/identity.ts`, `src/collection/runtime-state.ts`, `test/collection-runtime.test.js`; adaptar `src/cache.ts`.

**Interfaces:** `readPrivateJson(path: string, root: string, maxBytes: number): Promise<unknown>`; `writePrivateJson(path: string, value: unknown): Promise<void>`; `resolveBinding(account: AccountConfig, previous?: ProfileBinding, identityId?: string): ProfileBinding`; `acquireCollectorLock(root: string): Promise<{ release(): Promise<void> }>`; `loadRuntimeState(root: string): Promise<readonly AccountCollectionState[]>`; `saveRuntimeState(root: string, states: readonly AccountCollectionState[]): Promise<void>`.

- [ ] **1. RED:** dois processos concorrentes conseguem somente um lock; crash permite recuperação apenas após dono comprovadamente morto. Testar PID reutilizado com marcador de início Linux `/proc/<pid>/stat`, lock parcial e lock vivo: nunca roubar lock incerto. Reiniciar leitor conserva deadline/nível e quota; JSON corrupto de runtime resulta em recuperação conservadora, sem repetição agressiva.
- [ ] **2. RED:** recusar symlink escapando da raiz, FIFO, owner diferente e arquivo >1 MiB; escrita/entrada privadas têm 0600, diretórios novos 0700. Vínculo sobrevive ao restart; mudança de identidade confirmada/caminho canônico gera UUID novo. Troca só de rótulo mantém geração; identidade desconhecida é `profile`, não confirmada por e-mail.
- [ ] **3. Verificar falha:** `node --test test/collection-runtime.test.js`.
- [ ] **4. GREEN:** criar diretórios `inputs/`, `requests/`, `integration/` sob a raiz do cache e arquivo `runtime-state.json`. Verificar handles abertos com no-follow/fstat e limites, gravar temporário exclusivo + rename; não chmod amplo de diretórios externos. Lock via mkdir exclusivo com dono UID/PID/início; recuperação não usa apenas timeout de mtime. Persistir somente dados de quota, vínculo e agenda; nunca tokens/transcript. Runtime inválido deixa fontes locais funcionando e aplica guarda inicial remota de 15 minutos com aviso diagnóstico até novo estado seguro.
- [ ] **5. Verificar e commit:** testes focados + verificação comum; commit `feat: persist private collector state and profile bindings`.

### Task 3: Ponte Claude com passthrough e instalação reversível

**Files:** criar `src/collection/claude-statusline.ts`, `src/collection/claude-install.ts`, `src/statusline.ts`, `test/claude-statusline.test.js`, `test/claude-install.test.js`; documentar contrato da ponte em `README.md`.

**Interfaces:** `parseClaudeStatusline(input: unknown, binding: ProfileBinding, observedAt: string): QuotaObservation | null`; `importClaudeHud(input: unknown, binding: ProfileBinding, observedAt: string): QuotaObservation | null`; `runStatuslineBridge(options: { binding: ProfileBinding; root: string; previousCommand?: string }, input: Buffer): Promise<number>`; `previewClaudeIntegration(settingsPath: string, binding: ProfileBinding, executablePath: string, root: string): Promise<{ settingsPath: string; root: string; binding: ProfileBinding; original: string | null; proposed: string; warnings: string[] }>`; `installClaudeIntegration(preview: Awaited<ReturnType<typeof previewClaudeIntegration>>): Promise<void>`; `removeClaudeIntegration(settingsPath: string, root: string): Promise<void>`.

- [ ] **1. RED:** parsear `used_percentage:37`, `resets_at:1792382400` como 37% e ISO correspondente; sessão ausente não cria zero. Duas sessões escrevem arquivos distintos; input inválido/oversized não sai para cache. Importar claude-hud apenas pelo caminho explicitamente associado, `updated_at` nunca vira fetch remoto.
- [ ] **2. RED:** executar subprocesso sintético que calcula hash de stdin e escreve stdout/stderr/cwd/variável de ambiente; comparar execução direta e via ponte byte a byte, incluindo comando com espaços/quoting e opções extras da statusline. Exportação sem permissão não impede comando anterior nem imprime mensagens no stdout. Cancelar ponte termina filho; timeout de 2 s não deixa processo órfão. Dois writers da mesma sessão não corrompem JSON.
- [ ] **3. RED:** preview não grava; settings inexistente (`original:null`) é aceito sem fingir backup existente. Instalação preserva todas as chaves e opções, backup é privado e única instalação é idempotente. Recusar tipo de statusline desconhecido. Remoção restaura somente se valor atual ainda é nosso; alteração posterior do usuário permanece intacta. JSON concorrente modificado após preview provoca recusa, não overwrite.
- [ ] **4. Verificar falha:** `node --test test/claude-statusline.test.js test/claude-install.test.js`.
- [ ] **5. GREEN:** ponte lê stdin até 1 MiB, minimiza campos e grava `inputs/<binding-generation>/<session-hash>.json` em modo privado. IDs sem fonte explícita usam namespace de processo/sessão local, não dados de prompts. Passar JSON original via stdin ao shell original sem interpolar payload; usar shell do CLI em Linux quando conhecido, senão recusar comando dependente de shell não suportado. Fail-open na exportação; saída anterior é única saída. Installer guarda manifesto de binding/settings/executável e digest original/proposto no diretório `integration/`; não executar instalação contra perfis reais nos testes. Cli `src/statusline.ts` recebe caminho do manifesto, nunca tokens.
- [ ] **6. Verificar e commit:** testes focados + verificação comum; commit `feat: collect Claude quota through an opt-in statusline bridge`.

### Task 4: Leitor incremental Codex e watch local

**Files:** criar `src/collection/codex-rollouts.ts`, `src/collection/local-sources.ts`, `test/codex-rollouts.test.js`, `test/local-sources.test.js`, fixtures em `test/fixtures/local-quota/`.

**Interfaces:** `parseCodexQuotaEvent(line: unknown, binding: ProfileBinding, observedAt: string): QuotaObservation | null`; `watchLocalSources(accounts: readonly AccountConfig[], bindings: readonly ProfileBinding[], root: string, onObservation: (value: QuotaObservation) => void, onDiagnostic: (accountId: string, message: string) => void): Promise<{ rescan(): Promise<void>; close(): Promise<void> }>`; leitor mantém estado privado de inode/offset/buffer, não o transcript.

- [ ] **1. RED:** fixture `event_msg/token_count/rate_limits` com janelas 300/10.080 min normaliza sessão/semanal. Nulo, tokens sem quota e bucket desconhecido não apagam observação útil. Janela de 1.440 min não recebe rótulo 5h. Duas sessões paralelas selecionam por evento, nunca somam 37+40; mesma linha relida não gera novo evento.
- [ ] **2. RED:** linhas partidas, UTF-8 atravessando chunk, rename, truncate, evento atrasado, arquivo removido e JSON inválido não paralisam watcher. Arquivo >1 MiB pode ser lido em chunks limitados, mas linha >1 MiB é descartada até newline. Comprimido gera diagnóstico de formato não suportado. Fontes de perfil A não entram em B.
- [ ] **3. RED:** `creator_account_id` divergente recusa; metadata de criação isolada não promove resume a `confirmed`. Testar binding mudado com leitura em voo e log anterior à geração. Sem identidade suficiente, publicar como observação do perfil com rótulo explícito, nunca nome/email confirmado herdado. Mudança nova no arquivo Claude válido chega ao callback em até 2 s no teste de filesystem.
- [ ] **4. Verificar falha:** `node --test test/codex-rollouts.test.js test/local-sources.test.js`.
- [ ] **5. GREEN:** watch de diretórios + rescan local a cada 2 s, sem rede; para Codex varrer datas de hoje/ontem em UTC e arquivos ativos, máximo 64 arquivos por perfil, tail inicial de 1 MiB por arquivo; ler prefixo limitado apenas para metadados. Em descoberta, quota histórica anterior ao binding não é atual. Logs fora desses limites resultam em diagnóstico/fallback, não varredura total. Reter offsets apenas em memória; restart reavalia bounded tails preservando timestamps. Claude watcher deduplica por conteúdo/revisão de origem, não mtime isolado. `observedAt` do primeiro consumo não muda em releitura.
- [ ] **6. Verificar e commit:** testes focados + verificação comum; commit `feat: watch local Claude snapshots and Codex quota events`.

### Task 5: Probes remotos tipados e agenda central

**Files:** criar `src/collection/remote.ts`, `src/collection/coordinator.ts`, `test/collection-coordinator.test.js`, `test/codex-provider.behavior.test.js`; modificar `src/providers/claude.ts`, `src/providers/codex.ts`, testes de recuperação existentes.

**Interfaces:** `probeRemote(account: AccountConfig, timeoutSeconds: number): Promise<RemoteProbeResult>`; `createCoordinator(options: { accounts: readonly AccountConfig[]; config: AppConfig; initial: readonly AccountCollectionState[]; probe: typeof probeRemote; now: () => number; random: () => number; publish: (states: readonly AccountCollectionState[]) => Promise<void> }): { observe(value: QuotaObservation): void; tick(): Promise<void>; refresh(request: RefreshRequest): Promise<RefreshResult>; reconfigure(accounts: readonly AccountConfig[], config: AppConfig): void; states(): readonly AccountCollectionState[]; close(): Promise<void> }`.

- [ ] **1. RED:** relógio falso: local há 119.999 ms suspende automático, há 120.000 ms libera apenas se intervalo/deadline permite. Local novo é publicado durante probe remoto pendente. `local-only` nunca chama probe; `remote-only` não incorpora local. Manual não ultrapassa cooldown, mas pode antecipar intervalo normal sem 429; single-flight coalesce requisições, não inicia segunda consulta.
- [ ] **2. RED:** 429 com prazo 756 s e RNG 0 agenda 900 s; repetido agenda 1.800 s e depois 3.600 s. Prazo do CLI maior vence; RNG1 soma no máximo 10% ao maior prazo. Timeout gera 300 s sem ser rotulado 429. Local recebido durante espera atualiza sem apagar deadline, falha remota não apaga janelas. Sucesso sem erro reinicia nível.
- [ ] **3. RED:** mudar geração enquanto probe está pendente descarta resultado e não aplica seu cooldown à identidade nova. Repetição de atividade sem quotas válidas não suprime fallback para sempre. Falta de semanal preserva semanal anterior/idade; falta de ambas não cria observação vazia como sucesso.
- [ ] **4. RED:** fake executável Codex responde JSON-RPC lentamente (3,1 s dentro de timeout configurado 5 s) e deve passar. Verificar parâmetros `excludeResetCreditDetails:true`; erro de parâmetro desconhecido permite somente uma repetição sem campo, não em 429/timeout/erro de rede.
- [ ] **5. Verificar falha:** `node --test test/collection-coordinator.test.js test/codex-provider.behavior.test.js`.
- [ ] **6. GREEN:** mover autoridade de cooldown do map privado Claude para coordenador; manter wrappers legados de leitura que retornam `AccountUsage` para compatibilidade dos testes/consumidores. Probe Claude continua drenando stderr antes de classificar cache/429 e fornece retry tipado sem reparse da mensagem localizada. `fetchedAt` Claude só com evidência de fetch de sucesso nos diagnósticos; ausência fica desconhecida. Probe Codex usa timeout configurado e params suportados. Estado é atualizado/publicado por fila curta, sem esperar rede; merge por janela e geração da tarefa 1. `refresh` retorna resultados por conta, sem confundir observação recebida com consulta remota provadamente nova.
- [ ] **7. Verificar e commit:** testes focados + verificação comum; commit `feat: coordinate local-first quota collection and persistent retry policy`.

### Task 6: Runtime único, CLI e pedidos manuais

**Files:** criar `src/collection/refresh-requests.ts`, `src/collection/daemon.ts`, `test/collection-daemon.test.js`, `test/refresh-requests.test.js`; modificar `src/index.ts`, `src/cache.ts`.

**Interfaces:** `submitRefresh(root: string, request: RefreshRequest): Promise<void>`; `watchRefreshRequests(root: string, handle: (request: RefreshRequest) => Promise<RefreshResult>): Promise<{ close(): Promise<void> }>`; `runDaemon(configFile: string, cacheFile: string, signal: AbortSignal): Promise<void>`; pedido em `requests/<UUID>.json`, resultado persistido `requests/<UUID>.result.json` e último resultado no snapshot.

- [ ] **1. RED:** daemon com lock conserva single writer; `check` concorrente encaminha pedido e não sonda por fora. IDs repetidos retornam resultado existente. Pedido parcial, antigo (>60 s), futuro (>5 s), symlink, conta desconhecida e arquivo >64 KiB são recusados com erro seguro. Resultados/pedidos concluídos expiram após 24 h; ID de pedido não permite path traversal.
- [ ] **2. RED:** reinício mantém cooldown; local continua chegando durante fallback pendente. `refresh` bloqueado produz `blocked` com deadline, sem falso sucesso por `createdAt`. Duas solicitações simultâneas e startup não triplicam chamadas. Alterar config atualiza rótulos/modos sem geração nova; remover perfil cancela watcher e descarta resultado antigo.
- [ ] **3. RED:** teste de ponta a ponta com roots temporários, sem API: publicar quota local gera `usage.json` em até 3 s; watcher de UI da tarefa 9 deverá manter total até 5 s. SIGTERM solta locks/timers/watches e não corrompe runtime; reinício sem arquivo de quota aceita snapshot conhecido com idade preservada.
- [ ] **4. Verificar falha:** `node --test test/collection-daemon.test.js test/refresh-requests.test.js`.
- [ ] **5. GREEN:** `watch` usa daemon; CLI `refresh [--json]` envia pedido e aguarda resultado até 60 s. `check` com daemon ativo segue o mesmo caminho; sem daemon obtém lock, carrega runtime, faz uma rodada respeitando deadline e publica/persiste antes de soltar. `check --provider` faz merge das contas não consultadas no snapshot, não as apaga. Guardar resultado individual por ID evita disputa entre UI e CLI. `watch` recarrega configuração por watch + rescan local. Publicar em no máximo 250 ms após observação aceita. Rotear preview/install/remove da tarefa 3 como subcomandos `integration preview|install|remove --account <id>`; install exige confirmação explícita, caminhos absolutos com espaços funcionam.
- [ ] **6. Verificar e commit:** testes focados + verificação comum; commit `feat: run a single collector with coordinated refresh requests`.

### Task 7: Contrato visual e compatibilidade Cinnamon

**Files:** modificar `shared/snapshot.js`, `cinnamon/applet.js`, `test/gnome-snapshot.test.js`; criar `test/cinnamon-applet.behavior.test.js`.

**Interfaces:** manter no contrato `AiLimitsSnapshot` as operações `buildSnapshotView`, `buildPanelLabels`, `buildMenuView` e `buildWindowView`; enriquecer janela da view com `{ id, kind, label, percent, mode, fillRatio, severity, state, sourceText, ageText, resetText, accessibleText }`. Conta da view inclui `id`, `title`, `metadata`, `warning`, `nextRetryAt`, `windows`. Usar chaves de dados estáveis, não texto localizado como ID. GNOME importa o script compartilhado como `snapshot.js`; Cinnamon continua usando seu adaptador atual.

- [ ] **1. RED:** versão1 antiga continua renderizando, fonte é desconhecida. Publicação nova com janela antiga não muda idade. Dados 37% usados e 63% restantes geram fillRatio 0,37/0,63 e mesma severidade normal. Limiares 75/90, 100 sem mensagem de bloqueio comprovado. Sem janelas: conta permanece `--%` salvo unsupported confirmado.
- [ ] **2. RED:** última observação útil + 429 produz números com `~`/`!` e texto de próxima tentativa, não esconde conta. Expirado não exibe barra como atual nem inventa zero. Identidade `profile` não mostra email herdado como confirmado; tooltip tem nomes e “Sessão · Semanal”. Snapshot inválido/futuro não quebra nenhum consumidor.
- [ ] **3. Verificar falha:** `node --test test/gnome-snapshot.test.js test/cinnamon-applet.behavior.test.js`.
- [ ] **4. GREEN:** GNOME normaliza somente metadados permitidos e constrói view pura com relógio injetável. Cinnamon mantém layout textual, mas inclui idade/avisos/sufixos; não marcar retained windows como atuais por `status:ok` legado. Compatibilidade mínima vem antes de disponibilizar daemon que retém janelas. Ambos exibem semáforo por texto e não apenas cor.
- [ ] **5. Verificar e commit — Marco 1:** verificação comum; commit `feat: expose quota freshness without breaking Cinnamon`.

## Marco 2 — GNOME e controles de integração

### Task 8: GTK3, modos de coleta e gestão opt-in

**Files:** modificar `cinnamon/account_config.py`, `cinnamon/configure.py`, `test/test_account_config.py`, `test/test_configure_ui.py`; atualizar instruções GNOME/Cinnamon.

**Interfaces:** Python `update_collection_settings(config, account_id, *, collection_mode, remote_poll_interval_seconds, external_usage_path=None) -> dict`; `preview_integration(account_id) -> dict` via CLI JSON; install/remove via subcomandos da tarefa 6. Opcional `externalUsagePath` na conta Claude para claude-hud. Preservar API `update_account` e chaves desconhecidas.

- [ ] **1. RED:** editar rótulo/modo não perde novos campos; local-only, intervalo por conta e import path sobrevivem a salvar/carregar. Entrada inválida/futura não grava. CLI ausente fornece erro útil, sem mudar auth. Preview/cancelar não altera statusline; instalar tem confirmação distinta de Salvar, remover não sobrescreve alteração posterior.
- [ ] **2. RED:** salvar continua compatível com restart legado, mas cooldown persiste; tela identifica origem do intervalo explícito 60 s e oferece migrar, nunca troca sozinho. Conta Team avisa que fonte local pode faltar; editor não promete suporte garantido.
- [ ] **3. Verificar falha:** `python3 -m unittest discover -s test -p 'test_*.py'`.
- [ ] **4. GREEN:** controles por conta com rótulos “Híbrido”, “Somente local”, “Somente consultas”; segundos validados e opção usar default/legado. Botões “Visualizar integração…”, “Habilitar…” e “Remover…” usam CLI assíncrono/limitado e preview de diferenças; não executar shell construído com labels. Paths configurados não são comandos. Testar com runners injetados e settings temporárias, nunca no perfil real.
- [ ] **5. Verificar e commit:** verificação comum; commit `feat: configure collection modes and reversible Claude integration`.

### Task 9: Dashboard GNOME e refresh sem restart

**Files:** criar `gnome/dashboard.js`, `gnome/refresh-request.js`, `gnome/stylesheet.css`, `test/gnome-dashboard.behavior.test.js`; modificar `gnome/extension.js`, `test/gnome-extension.behavior.test.js`, `test/gnome-extension.test.js`, scripts de instalação/checagem nos READMEs e `package.json`.

**Interfaces:** `AccountCard(view, clock)` com `update(view)`, `updateTime(nowMs)`, `destroy()`; `Dashboard(menu, onRefresh, onConfigure)` com `update(view)`, `updateTime(nowMs)`, `destroy()`; injetar fronteiras GI no harness, sem métodos apenas de teste em produção. GJS `submitRefreshRequest(root, request, callback)` e `readRefreshResult(root, id)` usam mesmo schema/paths da tarefa 6, sem imports Node.

- [ ] **1. RED:** harness com widgets registra fillRatio, accessibleText, estilo severity e IDs. Verificar cartões sessão/semanal, fonte e idade, aviso 429 e modo restante; ordem estável por conta. Rótulo 5h só quando duration300; outras janelas mantêm duração correta. Valores controlados 37/86 aparecem nos dois modos e sem vazamento de contas.
- [ ] **2. RED:** abrir menu, focar Atualizar/rolar conta; atualizar countdown e mesmo conjunto de contas preserva objetos/foco/scroll. Alterar quota atualiza widgets existentes; inserir/remover conta só altera card afetado. Timer de 15 s é local e não envia rede; desabilitar elimina todos os sinais e fontes.
- [ ] **3. RED:** refresh grava pedido privado assíncrono, sem `systemctl restart`; resultado mesmo ID `blocked` informa prazo, não “limites atualizados”. Snapshot novo sem resultado não conclui pedido. Duplo clique gera um ID, timeout60s libera botão com erro, ID diferente não confirma. Mudança de `configPath` não executa arquivo arbitrário.
- [ ] **4. Verificar falha:** `node --test test/gnome-dashboard.behavior.test.js test/gnome-extension.behavior.test.js`.
- [ ] **5. GREEN:** cartões nativos St.BoxLayout + PopupBaseMenuItem não interativo e barras desenhadas com CSS/alocação, não controles ajustáveis; acessibilidade textual completa. Usar scroll do menu nativo e largura alvo 360 px limitada à workarea/escala. Tema claro/escuro herda cores e usa classes normal/warning/critical, texto além de cor. Tooltip dos itens do painel implementado e destruído no lifecycle. Reconciliar por ID; contador local não removeAll. Watch de cache150ms preservado com fallback30s; timer15s só atualiza texto de tempo. Pedido com Gio async, arquivo privado/atômico e resultado correlacionado; manter launch GTK3 existente. Estender `check:gnome` e cópias manuais com módulos/CSS novos.
- [ ] **6. Verificar e commit:** verificação comum + `npm run check:gnome`; commit `feat: add native GNOME quota cards and coordinated refresh`.

### Task 10: Integração, documentação e implantação controlada

**Files:** criar `test/local-first.integration.test.js`, `docs/local-first-monitoring.md`; atualizar `README.md`, `gnome/README.md`, `cinnamon/README.md`, `test/compatibility.test.js` e checklists da spec/plano.

**Interfaces:** usar schemas e APIs anteriores; nenhuma interface nova. Documentar diagnóstico e opt-in por comandos exatos já implementados, não pseudo-comandos.

- [ ] **1. RED:** teste com daemon, bridge sintética, rollouts, request e leitor GNOME: quota publicada/renderizada em até5s sem probe remoto; semanal conserva idade em evento só de sessão; rede bloqueada não impede local; reboot não adianta retry; remoção/rebind de perfil descarta atraso; sem dado válido fica desconhecido, nunca0. Teste de atraso é propagação local, não latência do provedor.
- [ ] **2. Verificar falha:** `node --test test/local-first.integration.test.js`; se teste já passa, justificar como integração dos comportamentos cobertos em RED e não criar mudança artificial.
- [ ] **3. Documentar limites:** Pro/Max vs Team, unsupported formats/identity, uso externo ao CLI, observação vs fetch, snapshot version1, instruções rollback do código sem apagar estado/credenciais. Mitigação de módulos GJS em cache: cópia+re-enable pode exigir nova sessão, nunca encerrar sessão do usuário automaticamente. Não anunciar ausência total de tráfego auxiliar dos CLIs.
- [ ] **4. Verificar entrega completa:** verificação comum + `npm run check:gnome` + `./node_modules/.bin/tsc -p tsconfig.json` + `node --check cinnamon/applet.js`. Solicitar revisão independente de identidade, cooldown, statusline e lifecycle antes de merge/instalação.
- [ ] **5. Smoke tests autorizados:** GNOME46 real com teclado, tema claro/escuro, escala100/200%, ≥6 contas sintéticas, foco/scroll durante updates; erro/expirado/fonte incerta e refresh bloqueado. Cinnamon real para não mostrar retido como atual. Se ambiente não disponível, reportar explicitamente “não validado em sessão”, não substituir por syntax check.
- [ ] **6. Implantação separada:** pedir autorização específica para (a) levar branch validada ao checkout do serviço ou mudar seu caminho, (b) habilitar ponte em perfil escolhido, (c) trocar 60 s legado pelos defaults. Nenhuma dessas autorizações é presumida pela aprovação do plano. Comparar cópias instaladas antes de sobrescrever, backup privado, preservar runtime e unidade personalizada; instalar arquivos/CSS; restart único daemon e re-enable GNOME. Verificar snapshot e resultado real sem loops de sondagem; só alegar número atual se fonte o forneceu.
- [ ] **7. Commit e conclusão:** commit `test: validate local-first monitoring and document rollout`; relatar SHAs, arquivos, testes, smoke tests pendentes, mudanças opt-in realizadas e limites conhecidos. Sem push/merge presumidos.

## Auto-revisão e handoff

- [x] Cobertura: fontes, identidade, relógios, fallback, pedido manual, UI e compatibilidade têm tarefas explícitas.
- [x] Cinco riscos de Review Focus estão vinculados a testes nas tarefas responsáveis.
- [x] Interfaces compartilhadas usam os mesmos tipos e campos; parser GJS não importa runtime Node.
- [x] Dois marcos dependentes, com Cinnamon adaptado antes de disponibilizar dados retidos.
- [x] Plano não altera credenciais nem configurações reais; implantação exige autorizações específicas.
- [x] Usuário revisar o plano e selecionar execução nativa ou dirigida por subagentes (nativa).
- [x] Execução e validação automatizada; inspeção visual de sessão continua separada.

### Estado de entrega (2026-10-21)

- [x] Tarefas 1–9 implementadas em commits isolados com testes por tarefa.
- [x] Tarefa 10: integração sintética e documentação; 69 testes JS, 23 Python,
  TypeScript, build e sintaxe GNOME/Cinnamon verificados.
- [x] Revisão independente da branch; nove achados importantes e um achado de
  frescor reclassificado corrigidos com regressões RED→GREEN. Verificação final:
  80 testes JS e 24 Python, TypeScript, build e sintaxe GNOME/Cinnamon.
- [ ] Smoke tests em sessão GNOME 46/Cinnamon (não autorizados nesta execução).
- [ ] Instalação, ponte real e migração do intervalo (autorizações separadas).

O usuário autorizou instalação de teste neste computador, com backup, após a
revisão/correções. Ponte real e alteração dos 60 segundos continuam não autorizadas.

### Instalação de teste

- [x] Backup privado, comparação de hashes e cópia dos artefatos compilados e
  da extensão versão 2, sem merge nem alteração da unidade personalizada.
- [x] Daemon ativo; três contas/seis janelas preservadas; pedido UUID vazio
  processado para testar transporte sem forçar consulta remota.
- [x] Configuração original e intervalo de 60 segundos preservados; ponte real
  não habilitada e segundo computador não alterado.
- [ ] GNOME ainda carrega a versão 1 em memória; nova sessão voluntária do usuário
  necessária para carregar a versão 2 e validar o menu. Sessão não encerrada.
