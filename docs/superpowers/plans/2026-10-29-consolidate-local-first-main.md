# Consolidar o dashboard local-first em `main` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar em `main` o trabalho exclusivo do dashboard local-first e da correção de contexto Claude, validar a integração e só então remover worktrees e branches auxiliares.

**Architecture:** Usar uma worktree Native isolada, em branch de integração baseada no `main` atual; preservar os históricos com merges, resolver conflitos sem descartar código recente e adaptar a view model local-first ao contrato compartilhado `shared/snapshot.js`. Após os testes e a árvore limpa, avançar `main` por fast-forward até o commit de integração. O sincronizador GTK continuará atômico e passará a copiar todos os arquivos GNOME exigidos pela extensão resultante.

**Tech Stack:** Git; Node.js 22+ e pnpm; TypeScript/ESM; GNOME Shell 46/GJS/St/Clutter; Cinnamon; Python 3/PyGObject/GTK3.

**Spec:** `docs/superpowers/specs/2026-10-29-branch-worktree-integration-design.md`

## Global Constraints

- Preservar o atualizador configurável e o fluxo **Verificar atualizações / Aplicar atualização** de `main`, incluindo as salvaguardas de clone limpo e confirmação.
- Manter `shared/snapshot.js` como contrato compartilhado entre GNOME e Cinnamon.
- A cópia do frontend deve continuar atômica e limitada ao frontend identificado.
- Não fazer push nem alterar referências remotas.
- Não sincronizar a extensão instalada nem recarregar/reiniciar a sessão GNOME nesta etapa.
- Não alterar contas, credenciais, cache ou serviços reais.
- Manter os cinco stashes intactos.
- Remover worktrees/branches somente depois dos testes e da confirmação de que os commits a preservar são alcançáveis por `main`; nunca usar `--force`.
- Preservar a versão atual de `package.json` (`0.3.0`) e de `gnome/metadata.json` (`6`), sem reverter para os valores mais antigos da worktree.

## Review Focus

1. **Conflito entre a recuperação Claude recente de `main` e o commit `c663df3`:** preservar o contexto de autenticação e os cooldowns; cobrir em Task 2 com `test/claude-provider-environment.test.js` e `test/claude-usage-recovery.test.js`.
2. **Snapshot legado ou novo sem proveniência, identidade ou idade:** manter comportamento da versão 1 e classificar amostras vencidas/futuras corretamente; cobrir em Task 4 com `test/gnome-snapshot.test.js`.
3. **Evento local de perfil incorreto, repetido ou atrasado e resultado remoto em voo:** não atribuir quota à identidade errada nem ignorar cooldown; cobrir em Task 3 com `test/collection-coordinator.test.js` e em Task 4 com `test/local-first.integration.test.js`.
4. **Atualizações do dashboard com o menu aberto:** preservar cartões sobreviventes, foco, rodapé e rolagem; cobrir em Task 4 com `test/gnome-dashboard.behavior.test.js`.
5. **Sincronização com recurso GNOME faltando ou falha parcial de cópia:** não deixar instalação incompleta, compilar ou reiniciar; cobrir em Task 5 com os testes de sincronização e rollback de `test/test_project_updates.py`.

---

## Mapa de arquivos

| Área | Arquivos principais | Responsabilidade na integração |
| --- | --- | --- |
| Provedor Claude | `src/providers/claude.ts`, `test/claude-provider-environment.test.js`, `test/claude-usage-recovery.test.js` | Preservar ambiente de autenticação e recuperação após 429/timeout. |
| Coleta local | `src/collection/*.ts`, `src/config.ts`, `src/cache.ts`, `src/index.ts`, `src/shared/types.ts`, `src/statusline.ts` | Integrar fontes locais, coordenação, estado privado e pedidos de atualização. |
| Adaptadores | `shared/snapshot.js`, `cinnamon/applet.js`, `cinnamon/account_config.py`, `cinnamon/configure.py` | Expor proveniência/idade sem quebrar o contrato ou a compatibilidade Cinnamon/GTK. |
| Dashboard GNOME | `gnome/extension.js`, `gnome/dashboard.js`, `gnome/refresh-request.js`, `gnome/stylesheet.css`, `gnome/metadata.json` | Renderizar o dashboard e encaminhar refresh correlacionado ao daemon. |
| Sincronização GTK | `cinnamon/project_updates.py`, `test/test_project_updates.py`, `package.json` | Copiar e validar atomicamente todos os artefatos runtime GNOME. |
| Documentação | `docs/adr/002-coleta-local-prioritaria-e-dashboard-gnome.md`, `README.md`, `gnome/README.md` | Registrar a decisão e as instruções efetivas. |

## Task 1: Commitar o plano aprovado

**Files:** `docs/superpowers/plans/2026-10-29-consolidate-local-first-main.md`

**Interfaces:**
- Consumes: spec aprovado e plano revisado pelo usuário.
- Produces: plano versionado na branch de integração; será incluído em `main` pelo fast-forward final.

- [ ] **Step 1: Conferir e stagear somente o plano.** Na branch `integration/consolidate-local-first-main`, executar `git status --short --branch`, `git add -- docs/superpowers/plans/2026-10-29-consolidate-local-first-main.md` e `git diff --cached --check`; o único arquivo staged deve ser o plano.
- [ ] **Step 2: Commitar o plano.** Executar `git commit -m "docs: plan local-first main consolidation"` antes de iniciar os merges.

## Task 2: Integrar a correção de contexto e recuperação Claude

**Files:**
- Merge: commit `c663df3d299647762da325969c1f406b47fc6700` (`chore/rename-project`)
- Modify during conflict resolution: `src/providers/claude.ts`, `gnome/README.md`, `shared/snapshot.js`
- Test: `test/claude-provider-environment.test.js`, `test/claude-usage-recovery.test.js`

**Interfaces:**
- Consumes: implementações atuais de Claude e o contrato `AiLimitsSnapshot` de `main`.
- Produces: histórico de `c663df3` alcançável pela branch de integração e, após o fast-forward final, por `main`; contexto Claude preservado sem regredir cooldowns, recuperação ou snapshot compartilhado.

- [ ] **Step 1: Iniciar o merge preservando o commit original.** Na branch de integração, executar `git merge --no-ff c663df3d299647762da325969c1f406b47fc6700`.
- [ ] **Step 2: Resolver conflitos de Claude e documentação.** Manter as correções recentes de `main` e incorporar a configuração de ambiente e os casos de recuperação do commit. Em `gnome/snapshot.js`, manter a remoção de `main` e registrar as mudanças sem equivalente para portar ao contrato compartilhado na Task 4.
- [ ] **Step 3: Verificar os casos de regressão Claude.** Executar `node --test test/claude-provider-environment.test.js test/claude-usage-recovery.test.js`. Esperado: todos os testes desses arquivos passam, incluindo ambiente/configuração Claude e recuperação limitada de uso.
- [ ] **Step 4: Verificar os arquivos resolvidos.** Executar `git diff --check` antes de concluir o merge.
- [ ] **Step 5: Concluir o merge commit.** Finalizar o merge sem alterar os stashes.
- [ ] **Step 6: Confirmar preservação.** Verificar que `git merge-base --is-ancestor c663df3d299647762da325969c1f406b47fc6700 main` retorna sucesso.

## Task 3: Integrar a coleta local-first e reconciliar o runtime

**Files:**
- Merge: commit `9756acaafa3449614331aa770b1150d5297233fe` (`local-first-gnome-dashboard`)
- Integrate: `src/collection/*.ts`, `src/providers/claude.ts`, `src/providers/codex.ts`, `src/config.ts`, `src/cache.ts`, `src/index.ts`, `src/shared/types.ts`, `src/statusline.ts`
- Compatibility: `cinnamon/applet.js`, `cinnamon/account_config.py`, `cinnamon/configure.py`
- Test: testes de `collection-*`, `local-sources`, `codex-rollouts`, `claude-statusline`, `claude-install`, `refresh-requests` e `local-first.integration`

**Interfaces:**
- Consumes: o commit Claude integrado na Task 2 e os contratos atuais de configuração, provedores e atualizador em `main`.
- Produces: commits exclusivos de `9756aca` alcançáveis pela branch de integração e, após o fast-forward final, por `main`; daemon/coletor local-first compatível com snapshots legados e com os provedores atuais.

- [ ] **Step 1: Iniciar o merge completo da worktree.** Na branch de integração, executar `git merge --no-ff 9756acaafa3449614331aa770b1150d5297233fe`; preservar todos os commits originais da linha local-first.
- [ ] **Step 2: Resolver conflitos do coletor e dos provedores.** Reconciliar `src/config.ts`, `src/cache.ts`, `src/index.ts`, `src/providers/*` e `src/shared/types.ts`, mantendo o contrato de `main`, a recuperação Claude da Task 2 e todos os módulos novos em `src/collection/`. Resolver `gnome/snapshot.js` mantendo sua remoção em `main`; portar o comportamento necessário para `shared/snapshot.js` na Task 4.
- [ ] **Step 3: Resolver compatibilidade de configuração.** Integrar `collectionMode`, caminhos locais e modos por conta sem descartar campos desconhecidos, perfis existentes ou as ações atuais do GTK/Cinnamon.
- [ ] **Step 4: Verificar a coleta local com fixtures sintéticas.** Executar `node --test test/collection-observations.test.js test/collection-config.test.js test/collection-runtime.test.js test/claude-statusline.test.js test/claude-install.test.js test/codex-rollouts.test.js test/local-sources.test.js test/collection-coordinator.test.js test/collection-daemon.test.js test/refresh-requests.test.js test/collection-cli.test.js test/codex-provider.behavior.test.js`. Esperado: observações locais permanecem associadas ao perfil correto e cooldown persiste após reinício.
- [ ] **Step 5: Verificar tipos e build do daemon.** Executar `pnpm check` e `pnpm build`; ambos devem terminar com código zero.
- [ ] **Step 6: Verificar os arquivos resolvidos.** Executar `git diff --check` antes de concluir o merge.
- [ ] **Step 7: Concluir o merge commit.** Finalizar o merge, preservando todos os commits originais.
- [ ] **Step 8: Confirmar preservação.** Verificar que `git merge-base --is-ancestor 9756acaafa3449614331aa770b1150d5297233fe integration/consolidate-local-first-main` retorna sucesso.

## Task 4: Adaptar snapshot compartilhado e estabilizar o dashboard

**Files:**
- Modify: `shared/snapshot.js`, `gnome/extension.js`, `gnome/dashboard.js`, `cinnamon/applet.js`
- Test: `test/gnome-snapshot.test.js`, `test/gnome-dashboard.behavior.test.js`, `test/gnome-extension.behavior.test.js`, `test/gnome-extension.test.js`, `test/cinnamon-applet.behavior.test.js`

**Interfaces:**
- Consumes: `AiLimitsSnapshot` e view model atual de `shared/snapshot.js`.
- Produces: `AiLimitsSnapshot.windowObservationState(window, nowMs) -> "observed" | "last-known" | "expired"`; `AiLimitsSnapshot.buildWindowView(window, mode, nowMs) -> { id, kind, label, percent, mode, fillRatio, severity, state, sourceText, ageText, resetText, resetsAt, observedAt, accessibleText }`; `Dashboard(menu, onRefresh, onConfigure, iconForProvider, snapshotApi)` recebe explicitamente os helpers compartilhados, sem importar exports ESM de um módulo que também serve ao Cinnamon.

- [ ] **Step 1: Adicionar testes de contrato ao snapshot compartilhado.** Em `test/gnome-snapshot.test.js`, adicionar `sharedSnapshotBuildsLocalFirstCardViewAndKeepsLegacyMenuText` e `windowObservationStateUses120SecondFreshnessAndExpiresAtReset`; cobrir proveniência, idade desconhecida/futura, limite de 120.000 ms, reset vencido e preservação do campo textual usado pelo Cinnamon.
- [ ] **Step 2: Executar o teste para identificar a falha do contrato novo.** Executar `node --test test/gnome-snapshot.test.js`; os novos casos devem falhar porque a view compartilhada ainda não expõe o estado/view de janela local-first.
- [ ] **Step 3: Implementar o contrato aditivo em `shared/snapshot.js`.** Acrescentar `windowObservationState` e `buildWindowView` ao objeto `AiLimitsSnapshot`; estender `buildMenuView` com IDs estáveis, proveniência, idade, severidade e percentuais, mantendo `text` e as propriedades existentes consumidas por Cinnamon.
- [ ] **Step 4: Ligar o dashboard ao contrato compartilhado.** Remover imports nomeados de `./snapshot.js` em `gnome/dashboard.js`; receber `snapshotApi` pelo construtor e passá-lo às `AccountCard`s. Em `gnome/extension.js`, usar `globalThis.AiLimitsSnapshot` e manter o dashboard incremental para não recriar cartões, foco ou rolagem durante atualização.
- [ ] **Step 5: Verificar layout, atualização e compatibilidade.** Executar `node --test test/gnome-snapshot.test.js test/gnome-dashboard.behavior.test.js test/gnome-extension.behavior.test.js test/gnome-extension.test.js test/cinnamon-applet.behavior.test.js test/local-first.integration.test.js`. Esperado: cartão sessão/semanal, countdown, resultado correlacionado, foco/rolagem e consumidor Cinnamon passam; a integração sintética chega ao GNOME dentro de 5 s.
- [ ] **Step 6: Verificar a adaptação.** Executar `git diff --check`.
- [ ] **Step 7: Commitar a adaptação testada.** Commit explícito dos arquivos desta tarefa.

## Task 5: Sincronizar todos os artefatos runtime GNOME

**Files:**
- Modify: `cinnamon/project_updates.py`, `test/test_project_updates.py`, `package.json`, `gnome/README.md`

**Interfaces:**
- Consumes: lista de recursos efetivamente importados por `gnome/extension.js` e `gnome/dashboard.js`.
- Produces: sincronização atômica incluindo `dashboard.js`, `refresh-request.js`, `stylesheet.css` e os arquivos já copiados; comandos de verificação sintática incluem ambos os módulos JavaScript novos.

- [ ] **Step 1: Escrever teste de regressão para o pacote GNOME completo.** Estender `test_syncCurrentFrontendCopiesFullGnomePackageWithoutBuildOrRestart` para exigir correspondência byte a byte de `dashboard.js`, `refresh-request.js` e `stylesheet.css`, além dos arquivos atuais; afirmar zero chamadas a `pnpm` e restart.
- [ ] **Step 2: Rodar o teste e confirmar a falha.** Executar `xvfb-run -a python3 -m unittest discover -s test -p 'test_project_updates.py' -v`; o novo caso de pacote GNOME deve falhar porque o sincronizador ainda não copia os três artefatos.
- [ ] **Step 3: Estender a lista de cópia em `cinnamon/project_updates.py`.** Adicionar somente arquivos existentes e referenciados pela extensão resultante; conservar pré-validação, staging, rollback, permissões e exclusão do restart/build.
- [ ] **Step 4: Atualizar o check GNOME.** Estender `check:gnome` em `package.json` para executar `node --check` em `gnome/dashboard.js` e `gnome/refresh-request.js`, mantendo versão `0.3.0`; manter `gnome/metadata.json` versão `6`.
- [ ] **Step 5: Verificar sucesso e falha parcial.** Executar `xvfb-run -a python3 -m unittest discover -s test -p 'test_project_updates.py' -v`; confirmar os casos `test_syncInstalledFrontendChecksAllSourcesBeforeReplacingFiles` e `test_syncCurrentFrontendRollsBackReplacedFilesWhenCopyFails` além do pacote GNOME completo.
- [ ] **Step 6: Verificar a sincronização.** Executar `pnpm check:gnome` e `git diff --check`.
- [ ] **Step 7: Commitar a sincronização e os testes.** Commit explícito dos arquivos desta tarefa.

## Task 6: Consolidar documentação e registrar ADR

**Files:**
- Create: `docs/adr/002-coleta-local-prioritaria-e-dashboard-gnome.md`
- Reconcile: `README.md`, `gnome/README.md`, `docs/local-first-monitoring.md`, `docs/superpowers/specs/2026-10-21-local-first-gnome-dashboard-design.md`, `docs/superpowers/plans/2026-10-21-local-first-gnome-dashboard.md`, `docs/superpowers/specs/2026-10-29-branch-worktree-integration-design.md`

**Interfaces:**
- Consumes: implementação final integrada e especificação aprovada de 2026-10-21.
- Produces: ADR português com contexto, decisão, alternativas, consequências e links; documentação descreve o caminho real do snapshot compartilhado e arquivos incluídos na sincronização.

- [ ] **Step 1: Atualizar instruções contraditórias.** Remover referências à origem `gnome/snapshot.js` quando a origem de build/cópia for `shared/snapshot.js`; documentar os artefatos do dashboard sincronizados.
- [ ] **Step 2: Criar ADR-002 em português.** Registrar a coleta local prioritária e o dashboard GNOME como decisão aceita; referenciar ADR-001 como decisão complementar, não substituída.
- [ ] **Step 3: Revisar links e conteúdo.** Verificar caminhos existentes, UUID/serviço/cache preservados e ausência de credenciais/dados pessoais. Atualizar o estado observado da spec de integração para refletir o commit local `35d03c6` à frente de `origin/main` e registrar a aprovação/revisão do texto; executar `git diff --check`.
- [ ] **Step 4: Commitar a documentação.** Commit explícito do ADR e dos documentos reconciliados.

## Task 7: Verificação completa e prova de preservação

**Files:** nenhum novo arquivo; verificar `main`, testes e referências Git.

**Interfaces:**
- Consumes: merges e commits das Tasks 1–6.
- Produces: evidência de funcionalidade, compatibilidade, alcançabilidade dos commits e árvore limpa antes da limpeza.

- [ ] **Step 1: Executar as verificações de ponta a ponta.** Rodar `pnpm check`, `pnpm build`, `pnpm test`, `pnpm check:cinnamon`, `pnpm check:gnome`, `xvfb-run -a python3 -m unittest discover -s test -v`, `python3 -m py_compile cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py` e `git diff --check`; todas devem passar.
- [ ] **Step 2: Provar a preservação na integração.** Confirmar que os dois commits-alvo são ancestrais de `integration/consolidate-local-first-main`; comparar `git stash list --format='%H %s'` com o registro feito antes dos merges.
- [ ] **Step 3: Conferir as árvores antes do fast-forward.** Exigir `git status --porcelain` vazio na branch de integração e nas três worktrees-fonte; confirmar que `main` não tem alterações alheias. Se algum teste falhar ou qualquer árvore estiver suja, parar aqui e manter worktrees/branches.
- [ ] **Step 4: Preparar e avançar `main`.** Confirmar que o plano commitado na branch de integração tem o mesmo conteúdo do arquivo não rastreado criado nesta execução em `/home/vlduggen/projects/linux-mint-ai-limits-applet/docs/superpowers/plans/2026-10-29-consolidate-local-first-main.md`; remover somente essa cópia redundante, confirmar `main` limpo e executar `git -C /home/vlduggen/projects/linux-mint-ai-limits-applet merge --ff-only integration/consolidate-local-first-main`.
- [ ] **Step 5: Provar o estado final antes da limpeza.** Confirmar que os commits-alvo são ancestrais de `main`, que os cinco stashes mantêm os mesmos hashes e que `main` está limpo.

## Task 8: Remover somente worktrees e branches auxiliares já preservadas

**Files:** metadados Git de worktrees e refs locais.

**Interfaces:**
- Consumes: commits alcançáveis por `main` e resultado verde da Task 7.
- Produces: apenas a worktree/branch `main` local, refs remotos existentes intactos e os cinco stashes preservados.

- [ ] **Step 1: Remover a worktree de sincronização.** Executar `git worktree remove /home/vlduggen/.local/share/opencode/worktree/714574/independent-frontend-sync` sem `--force`.
- [ ] **Step 2: Remover a worktree local-first.** Executar `git worktree remove /home/vlduggen/.local/share/opencode/worktree/714574/local-first-gnome-dashboard` sem `--force`.
- [ ] **Step 3: Remover a worktree da correção Claude.** Executar `git worktree remove /home/vlduggen/projects/linux-mint-ai-limits-applet/.worktrees/ubuntu-gnome-support` sem `--force`.
- [ ] **Step 4: Remover a branch local de sincronização.** Executar `git branch -d feat/independent-frontend-sync`.
- [ ] **Step 5: Remover a branch local Ubuntu já ancestral.** Executar `git branch -d feat/ubuntu-gnome-support`.
- [ ] **Step 6: Remover a branch Claude já integrada.** Executar `git branch -d chore/rename-project` sem `--force`.
- [ ] **Step 7: Voltar à worktree principal.** Mover a sessão para `/home/vlduggen/projects/linux-mint-ai-limits-applet` depois de confirmar o fast-forward e antes de remover a worktree de integração.
- [ ] **Step 8: Remover a worktree de integração já incorporada.** Executar `git worktree remove /home/vlduggen/.local/share/opencode/worktree/714574/consolidate-local-first-main` sem `--force`.
- [ ] **Step 9: Remover a branch de integração já incorporada.** Executar `git branch -d integration/consolidate-local-first-main`.
- [ ] **Step 10: Verificar o estado final.** `git worktree list` deve listar apenas o worktree principal; `git branch -avv` não deve mostrar branches locais auxiliares; `git status --short --branch` deve mostrar `main` limpo; `git stash list` deve continuar com os mesmos cinco itens.
