# Consolidação do dashboard local-first em `main`

**Data:** 2026-10-29
**Status:** Desenho aprovado em conversa; revisão do documento pendente.

## Objetivo

Integrar em `main` o trabalho exclusivo das branches e worktrees locais, incluindo
o coletor local-first e o novo dashboard GNOME, preservar o histórico dos commits
e remover branches/worktrees auxiliares somente depois da integração e validação.

## Estado observado

- `main` e `origin/main` estão limpos e alinhados em `64a26c2`.
- `feat/independent-frontend-sync` aponta para o mesmo commit de `main`.
- `feat/ubuntu-gnome-support` aponta para `e69d316`, ancestral de `main`; não tem
  commits exclusivos.
- A worktree `local-first-gnome-dashboard` está limpa, detached em `9756aca` e
  diverge de `main`: 15 commits exclusivos nela e 18 exclusivos em `main`.
- A worktree `.worktrees/ubuntu-gnome-support` está limpa na branch
  `chore/rename-project`, em `c663df3`: um commit exclusivo e 24 commits atrás;
  seu upstream remoto foi removido.
- Existem cinco stashes. Por decisão explícita, permanecem intactos e fora desta
  integração.
- A previsão de merge indicou conflitos em arquivos de documentação,
  configurador/contas Cinnamon, extensão GNOME, metadados, pacote, provedores,
  coletor e testes. Também há conflito modify/delete em `gnome/snapshot.js`.

## Estratégia aprovada

Preservar os commits originais por merges, sem reset, squash ou force-push:

1. Integrar em `main` os commits de `chore/rename-project` que ainda não estejam
   contidos em `main`.
2. Integrar a linha completa de `local-first-gnome-dashboard` sobre o `main`
   atual, resolvendo conflitos de forma deliberada e mantendo os dois históricos
   alcançáveis.
3. Não criar merges vazios para branches que já sejam iguais a `main` ou ancestrais
   dele; essas referências serão removidas apenas no passo de limpeza.

Alternativas consideradas: reaplicar todos os commits por rebase/cherry-pick,
com conflitos repetidos por commit, ou consolidar por squash, que perderia a
proveniência detalhada. A integração por merge foi escolhida para preservar o
histórico solicitado.

## Reconciliação de código e contratos

- Manter o atualizador configurável e o fluxo **Verificar atualizações / Aplicar
  atualização** de `main`, incluindo suas salvaguardas de clone limpo e confirmação.
- Manter `shared/snapshot.js` como contrato compartilhado entre GNOME e Cinnamon.
  Adaptar a view model necessária ao dashboard nesse contrato; não restaurar
  automaticamente o antigo `gnome/snapshot.js`, removido de `main`.
- Integrar a extensão GNOME e os módulos do dashboard local-first, preservando a
  compatibilidade do Cinnamon e reconciliando as mudanças de provedores do
  coletor com o commit exclusivo de `chore/rename-project`.
- Atualizar `sync_installed_frontend()` e seus testes para incluir todos os
  recursos runtime que a extensão resultante realmente referenciar, como
  `dashboard.js`, `refresh-request.js`, CSS e, quando usados, preferências e
  schemas. A cópia deve continuar atômica e limitada ao frontend identificado.
- Registrar a decisão arquitetural local-first em um novo ADR em português,
  vinculando a especificação de design existente e distinguindo decisões de
  hipóteses históricas.

## Verificação

Executar após resolver os conflitos:

- `pnpm check` e `pnpm test`;
- `pnpm check:cinnamon` e `pnpm check:gnome`;
- `xvfb-run -a python3 -m unittest discover -s test -v`;
- `python3 -m py_compile cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py`;
- `git diff --check`.

Antes de remover qualquer worktree ou branch, confirmar que todos os commits
exclusivos a preservar são ancestrais de `main`, que as worktrees estão limpas e
que o conjunto de verificações passou. Remover apenas worktrees/branches locais
auxiliares, sem `--force`; manter `main`, `origin/main` e os cinco stashes. Se
houver conflito não resolvido, falha de verificação ou alteração inesperada,
interromper a limpeza e preservar o estado para revisão.

## Limites

- Não fazer push nem alterar referências remotas.
- Não sincronizar a extensão instalada nem recarregar/reiniciar a sessão GNOME
  nesta etapa; implantação é uma ação separada.
- Não alterar contas, credenciais, cache ou serviços reais.
