# Ubuntu GNOME Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um indicador ao painel do GNOME no Ubuntu 24.04 LTS, mantendo o applet Cinnamon e o daemon de uso existentes.

**Architecture:** Manter compartilhados o daemon Node.js, a configuração e o cache versão 1. Adicionar uma extensão GNOME Shell 46 que lê o cache e implementa sua própria interface de painel/menu; manter a interface Cinnamon existente. Preservar a instalação manual por usuário e os identificadores de compatibilidade.

**Tech Stack:** Node.js 22+, TypeScript, test runner nativo do Node, GNOME Shell 46/GJS, GTK 3/PyGObject, `systemd --user`.

**Spec:** `docs/superpowers/specs/2026-09-30-ubuntu-gnome-support-design.md`

## Global Constraints

- Trabalhar no repositório existente `vduggen/linux-mint-ai-limits-applet`; não criar fork nem segundo repositório.
- Manter suporte a Linux Mint/Cinnamon e adicionar Ubuntu 24.04 LTS/GNOME Shell 46 como alvo inicial para Ubuntu.
- Manter o snapshot compartilhado na versão `1` e em `~/.cache/ai-limits-widget/usage.json`.
- Preservar o UUID Cinnamon `ai-limits-widget@vlduggen` e o nome da unidade instalada `ai-limits-widget.service`.
- Manter o serviço no escopo do usuário (`systemd --user`); não exigir root.
- Reutilizar o editor GTK 3 existente; não adicionar preferências GNOME nativas em GTK 4 nesta entrega.
- Manter a instalação manual por usuário; não criar pacote `.deb`.
- A extensão GNOME lê o cache; não consulta Claude/Codex nem armazena credenciais.
- Generalizar os nomes apresentados ao usuário sem alterar o slug público do repositório nem os identificadores legados de cache/serviço.

## Review Focus

- Cache ausente, JSON inválido ou versão de snapshot desconhecida deve resultar em estado seguro de ausente/inválido; testar com `missingAndInvalidSnapshotsReturnExplicitStates`.
- Valores `createdAt` inválidos, futuros ou antigos não podem ser apresentados como dados atuais; testar com `staleAndInvalidTimestampsAreClassifiedSafely`.
- Contas/janelas malformadas e status `error`/`unsupported` não podem derrubar a extensão nem gerar indicadores inválidos; testar com `malformedAccountsAndStatusesAreHandledSafely` e no teste de fumaça GNOME.
- Modos `displayMode` mistos e horários de reset ausentes/inválidos devem preservar a regra do indicador mais restritivo e o texto de fallback; testar com `mixedDisplayModesChooseMostConstrainedIndicators` e `invalidResetTimesUseFallbackText`.
- O editor GTK deve localizar as contas depois que a extensão for copiada para fora da árvore-fonte; uma falha ao abrir o configurador não pode derrubar o indicador. Testar caminhos com `configPathResolutionUsesCacheAndInstallFallbacks` e verificar o isolamento da falha no teste de fumaça Ubuntu.

---

### Task 1: Criar projeção do snapshot testável e independente da interface

**Files:**
- Create: `gnome/snapshot.js`
- Create: `test/gnome-snapshot.test.js`
- Modify: `package.json`

**Interfaces:**
- Produz `buildSnapshotView(text, nowMs = Date.now(), staleAfterMs = 120_000)`, que retorna `{ state, createdAt, ageMs, accounts, indicators }`. `state` pode ser `missing`, `invalid`, `ready` ou `stale`; `indicators` contém listas para `claude` e `codex`.
- Cada conta normalizada contém `id`, `label`, `provider`, `status`, `displayMode`, `plan`, `email` e `windows`. Ignorar registros malformados de conta/janela; usar `remaining` quando `displayMode` estiver ausente ou inválido; manter contas válidas `error` e `unsupported` para a interface decidir como exibi-las.
- Considerar conta válida somente se `id`/`label` forem texto, `provider` for `claude` ou `codex` e `status` for `ok`, `error` ou `unsupported`. Preservar `plan`/`email` somente quando forem texto. Considerar janela válida somente se `id`/`label` forem texto, `kind` for `session`, `weekly`, `monthly` ou `other`, e ambos os percentuais forem números finitos entre `0` e `100`. Estados `missing`/`invalid` retornam listas vazias, `createdAt: null` e `ageMs: null`.
- Produz `formatReset(resetsAt, nowMs = Date.now())`, que retorna texto localizado do reset ou `reset não informado` para datas ausentes/inválidas.
- Cada indicador tem o formato `{ kind, label, value, mode }`, onde `mode` é `used` ou `remaining`.

- [ ] **Step 1: Escrever os testes que falham** em `test/gnome-snapshot.test.js`: `missingAndInvalidSnapshotsReturnExplicitStates`, `staleAndInvalidTimestampsAreClassifiedSafely`, `malformedAccountsAndStatusesAreHandledSafely`, `mixedDisplayModesChooseMostConstrainedIndicators` e `invalidResetTimesUseFallbackText`. Verificar que texto ausente resulta em `missing`; JSON malformado, versão desconhecida ou data inválida resulta em `invalid`; dados antigos resultam em `stale` sem perder valores; datas futuras têm idade zero; contas/janelas malformadas não causam exceções; status diferente de `ok` não contribui para indicadores; modos mistos escolhem a maior pressão de uso; a ordenação respeita tipo de janela e limita a dois indicadores por provedor; e resets inválidos usam o texto de fallback.
- [ ] **Step 2: Executar os testes focados e confirmar a falha** porque `gnome/snapshot.js` ainda não existe.

  Run: `node --test test/gnome-snapshot.test.js`

  Expected: FAIL por importação não resolvida de `../gnome/snapshot.js`.
- [ ] **Step 3: Implementar `buildSnapshotView` e `formatReset`** em `gnome/snapshot.js`. Validar versão `1`, `createdAt` e o array de contas; normalizar campos por conta com segurança; classificar como antigo o snapshot com mais de 120 segundos; e calcular indicadores como em `cinnamon/applet.js` (agrupar por tipo de janela, escolher o valor mais restritivo em modos mistos, ordenar sessão/semanal/mensal/outro e retornar no máximo dois indicadores por provedor).
- [ ] **Step 4: Adicionar o script `test`** em `package.json` com o comando `node --test` e executar toda a suíte.

  Run: `pnpm test`

  Expected: todos os testes do snapshot PASS.
- [ ] **Step 5: Commit** como `test: add GNOME snapshot projection coverage`.

### Task 2: Implementar a extensão de painel GNOME Shell 46

**Files:**
- Create: `gnome/metadata.json`
- Create: `gnome/extension.js`
- Modify: `package.json`

**Interfaces:**
- Consome `buildSnapshotView` e `formatReset` de `gnome/snapshot.js`.
- Fornece metadados com UUID `ai-limits-monitor@vlduggen` e `shell-version: ["46"]`.
- Fornece indicador de painel com valores Claude/Codex e menu com idade do snapshot e detalhes de contas/janelas.

- [ ] **Step 1: Criar `gnome/metadata.json`** com o UUID e a compatibilidade GNOME Shell 46 acima, nome genérico do produto, descrição e versão inteira da extensão.
- [ ] **Step 2: Implementar o ciclo de vida do painel/menu** em `gnome/extension.js`, usando o padrão GNOME Shell `PanelMenu.Button`, `PopupMenu` e `Main.panel.addToStatusArea`. Ao habilitar, criar os valores Claude/Codex, ler o cache imediatamente e atualizar a cada 30 segundos. Ao desabilitar/destruir, remover o temporizador GLib e destruir o indicador.
- [ ] **Step 3: Renderizar estados do snapshot e detalhes das contas.** Usar o caminho compartilhado do cache. Marcar dados antigos como antigos; mostrar erros por conta; omitir contas `unsupported` dos detalhes operacionais, como faz o applet Cinnamon; mostrar estado vazio quando nenhuma conta utilizável restar; incluir plano/e-mail quando disponíveis; e usar `formatReset` para os resets.
- [ ] **Step 4: Adicionar `check:gnome`** usando `node --check gnome/snapshot.js && node --check gnome/extension.js` e `node --input-type=module -e 'import { readFile } from "node:fs/promises"; JSON.parse(await readFile("gnome/metadata.json", "utf8"));'`.
- [ ] **Step 5: Executar verificações de sintaxe e testes.**

  Run: `pnpm check:gnome && pnpm test`

  Expected: ambos os comandos terminam com código `0`.
- [ ] **Step 6: Commit** como `feat: add GNOME Shell usage indicator`.

### Task 3: Integrar configuração e instalação por usuário

**Files:**
- Modify: `gnome/extension.js`
- Modify: `cinnamon/configure.py`
- Create: `cinnamon/config_paths.py`
- Create: `test/test_config_paths.py`
- Modify: `cinnamon/README.md`
- Modify: `systemd/linux-mint-ai-limits-applet.service.example`
- Modify: `README.md`
- Create: `gnome/README.md`

**Interfaces:**
- A ação **Configurar…** no menu GNOME abre a cópia instalada do `configure.py` existente usando `python3`.
- Novas instalações manuais usam `~/ai-limits-monitor`; a unidade continua instalada como `ai-limits-widget.service` e usa os caminhos do Node e do projeto documentados para essa instalação.
- `resolve_config_path(configured_path, cache_path, candidates) -> Path | None` expande `~` e resolve, nesta ordem: caminho de ambiente existente, `configPath` válido no cache, e primeiro candidato existente da lista ordenada (árvore-fonte, `~/ai-limits-monitor/config/accounts.json`, `~/linux-mint-ai-limits-applet/config/accounts.json`, `~/ai-limits-widget/config/accounts.json`). A função não importa GTK. `configure.py` importa o `config_paths.py` irmão; os dois arquivos são copiados para o diretório instalado do applet/extensão.

- [ ] **Step 1: Escrever o teste unitário que falha** `configPathResolutionUsesCacheAndInstallFallbacks` em `test/test_config_paths.py`. Cobrir precedência do caminho de ambiente existente, ignorar caminho de ambiente inexistente, precedência do `configPath` em cache existente, ignorar cache inválido, o novo candidato `~/ai-limits-monitor/config/accounts.json`, os fallbacks existentes `~/linux-mint-ai-limits-applet` e `~/ai-limits-widget`, respeitar a ordem dos candidatos e retornar `None` quando nenhum candidato existe.
- [ ] **Step 2: Executar o teste focado e confirmar a falha** porque `cinnamon/config_paths.py` ainda não existe.

  Run: `python3 -m unittest discover -s test -p 'test_config_paths.py' -v`

  Expected: FAIL por importação não resolvida de `cinnamon.config_paths`.
- [ ] **Step 3: Implementar `resolve_config_path`** em `cinnamon/config_paths.py` usando `pathlib.Path` e leitura JSON. Refatorar `cinnamon/configure.py` para fornecer os caminhos candidatos existentes, incluindo o novo caminho de instalação, sem alterar imports GTK nem comportamento da janela.
- [ ] **Step 4: Adicionar a ação de configuração GNOME** ao menu. Resolver `configure.py` com `this.dir.get_child("configure.py")`, iniciá-lo sem bloquear o Shell usando `Gio.Subprocess.new`, observar a saída de forma assíncrona e reportar falha ao iniciar/retorno diferente de zero via `Main.notify`, mantendo o indicador ativo.
- [ ] **Step 5: Atualizar o exemplo da unidade de usuário** para usar `~/ai-limits-monitor` em novas instalações e uma descrição genérica, mantendo o nome instalado `ai-limits-widget.service`. Não alterar automaticamente unidades já instaladas pelos usuários.
- [ ] **Step 6: Documentar instalação, habilitação, atualização e remoção GNOME** em `gnome/README.md`; documentar a configuração do daemon por usuário e as dependências GTK 3/PyGObject no `README.md` raiz; atualizar os comandos de instalação Cinnamon em `cinnamon/README.md` e `README.md` raiz para copiar `config_paths.py` ao lado de `configure.py`. Copiar os dois arquivos Python para o diretório da extensão GNOME. Incluir teste de fumaça que abre o editor depois de o daemon gravar `configPath` no cache, salva um modo de exibição e confirma o reinício do serviço do usuário.
- [ ] **Step 7: Executar testes e verificações de sintaxe.**

  Run: `python3 -m unittest discover -s test -p 'test_config_paths.py' -v && python3 -m py_compile cinnamon/configure.py cinnamon/config_paths.py && pnpm check:gnome`

  Expected: todos os testes e verificações PASS.
- [ ] **Step 8: Commit** como `feat: install GNOME frontend for the current user`.

### Task 4: Generalizar a identidade do projeto e concluir a documentação de compatibilidade

**Files:**
- Modify: `package.json`
- Modify: `src/index.ts`
- Modify: `src/providers/codex.ts`
- Modify: `gnome/metadata.json`
- Modify: `gnome/README.md`
- Modify: `cinnamon/metadata.json`
- Modify: `cinnamon/settings-schema.json`
- Modify: `cinnamon/applet.js`
- Modify: `cinnamon/configure.py`
- Modify: `cinnamon/README.md`
- Modify: `README.md`
- Modify: `systemd/linux-mint-ai-limits-applet.service.example`
- Create: `test/compatibility.test.js`

**Interfaces:**
- Usar o nome provisório `AI Limits Monitor for Linux` nos títulos/descrições visíveis; manter o slug público do repositório.
- Preservar exatamente `ai-limits-widget@vlduggen`, `ai-limits-widget.service` e `~/.cache/ai-limits-widget/usage.json`.

- [ ] **Step 1: Substituir textos visíveis que impliquem suporte exclusivo ao Mint** pelo nome genérico no nome do pacote (`ai-limits-monitor-for-linux`) e descrição, saída do CLI, título do cliente Codex app-server, títulos dos metadados/configuração GNOME e Cinnamon, tooltip, título do configurador e READMEs dos desktops. Manter o aviso de não afiliação ao Linux Mint; não remover identificadores legados nem renomear o repositório.
- [ ] **Step 2: Separar os pré-requisitos e a instalação por desktop** no README raiz. Documentar Linux Mint/Cinnamon e Ubuntu 24.04 LTS/GNOME 46 como alvos; manter Node.js 22+, pnpm e CLIs Claude/Codex autenticados; explicar GTK 3/PyGObject como dependências do configurador. Direcionar clones novos para `~/ai-limits-monitor` e explicar que instalações existentes mantêm seu diretório e unidade atuais.
- [ ] **Step 3: Adicionar `legacyCompatibilityIdentifiersRemainStable`** em `test/compatibility.test.js`. Ler `cinnamon/metadata.json` e verificar o UUID `ai-limits-widget@vlduggen`; ler `src/config.ts`, `cinnamon/configure.py` e o exemplo systemd para verificar que o caminho padrão de cache `~/.cache/ai-limits-widget/usage.json` e o nome da unidade `ai-limits-widget.service` continuam inalterados.
- [ ] **Step 4: Executar todas as verificações automatizadas.**

  Run: `pnpm check && pnpm build && pnpm test && pnpm check:gnome && node --check cinnamon/applet.js && python3 -m py_compile cinnamon/configure.py`

  Expected: todos os comandos terminam com código `0`.
- [ ] **Step 5: Commit** como `docs: document Ubuntu GNOME support and generic branding`.

### Task 5: Validar os dois ambientes de desktop de ponta a ponta

**Files:**
- Nenhum arquivo de código adicional; validação usa os arquivos das Tasks 1–4.

**Interfaces:**
- A validação Ubuntu cobre a nova extensão GNOME e o daemon/configurador existentes.
- A validação Mint cobre o applet Cinnamon existente com o cache e identificadores preservados.

- [ ] **Step 1: Executar teste de fumaça no Ubuntu 24.04 LTS/GNOME Shell 46** em uma sessão GNOME real. Instalar a extensão em `~/.local/share/gnome-shell/extensions/ai-limits-monitor@vlduggen`, habilitá-la com `gnome-extensions` e verificar valores no painel, menu de detalhes, atualização de 30 segundos, estados de cache ausente/antigo, ação de configuração e persistência após logout/login. Em uma cópia de teste da extensão, remover temporariamente `configure.py` para forçar uma falha e confirmar que o indicador continua ativo; restaurar o arquivo depois. Confirmar permissões `0600` no cache e serviço de usuário ativo sem root.
- [ ] **Step 2: Executar regressão Linux Mint/Cinnamon.** Verificar que o UUID existente carrega, indicadores e detalhes dos dois provedores continuam funcionando e a alteração de `displayMode` pelo editor GTK atualiza o mesmo serviço/cache.
- [ ] **Step 3: Registrar nos documentos dependências específicas** encontradas no Ubuntu 24.04, especialmente GTK 3/PyGObject e caminhos do Node 22; não adicionar pacote `.deb` nem ampliar a versão GNOME suportada.
- [ ] **Step 4: Reexecutar as verificações automatizadas** da Task 4 e executar `git diff --check`; esperado: verificações aprovadas e nenhum erro de whitespace.
- [ ] **Step 5: Commit** como `test: validate Ubuntu GNOME and Mint Cinnamon support`.
- [ ] **Step 6: Verificar o worktree final** com `git status --short`; esperado: nenhuma alteração não commitada.
