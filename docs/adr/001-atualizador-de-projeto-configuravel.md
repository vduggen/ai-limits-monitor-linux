# ADR-001: Atualizador configurável do clone do projeto

**Status:** Aceito

**Data:** 2026-10-28

## Contexto

O editor GTK de contas é compartilhado pelo applet Cinnamon e pela extensão
GNOME. Atualizar manualmente um clone exige identificar commits remotos, executar
instalação e build e copiar os arquivos da interface instalada. Uma atualização
sem confirmação ou que descarte alterações locais poderia modificar trabalho do
usuário ou reiniciar o serviço sem aviso.

O caminho ativo de `config/accounts.json` pode indicar a raiz do clone quando o
arquivo está em `config/`; outras instalações precisam permitir a escolha da pasta
do projeto sem misturar essa preferência com as contas monitoradas.

## Decisão

Adicionar ao configurador GTK uma seção **Atualizações** que verifica
manualmente o upstream e só aplica commits depois de confirmação explícita. A
preferência do caminho fica em
`$XDG_CONFIG_HOME/ai-limits-monitor-linux/settings.json`, com `~/.config` como
fallback, separada de `accounts.json`.

A aplicação só é permitida para uma árvore limpa e quando a branch local pode
avançar por fast-forward. A confirmação fica vinculada aos SHAs de `HEAD` e do
upstream exibidos; se eles mudarem, a operação é interrompida para nova
verificação e confirmação. Após revalidar, o configurador executa
`git merge --ff-only <sha-confirmado>`, `pnpm install --frozen-lockfile` e
`pnpm build`, sincroniza somente o frontend reconhecido que abriu a janela e
solicita o restart do serviço de usuário existente. A verificação usa
`git fetch` e não altera arquivos de trabalho. O merge usa o objeto já buscado
em vez de `git pull`, cujo fetch implícito poderia avançar o upstream entre a
confirmação e a aplicação.

## Alternativas consideradas

- **Atualização automática ou periódica:** rejeitada para não alterar o clone,
  iniciar builds ou reiniciar o serviço sem uma solicitação explícita.
- **Forçar a versão remota com reset, rebase ou merge:** rejeitada porque poderia
  descartar ou combinar trabalho local; só fast-forward em árvore limpa é aceito.
- **Guardar a pasta do projeto em `accounts.json`:** rejeitada para manter
  preferências do atualizador separadas dos perfis de provedores.
- **Delegar a atualização ao daemon ou criar um script externo:** rejeitada por
  exigir um protocolo ou artefato de instalação adicional sem benefício para o
  fluxo manual.

## Consequências

- A pessoa usuária vê os commits disponíveis antes de confirmar instalação,
  compilação, sincronização e restart.
- O `git fetch` requer acesso ao remoto; aplicar também requer `git`, `pnpm` e as
  dependências necessárias para compilar.
- Se install, build, cópia ou restart falhar depois do pull, o checkout permanece
  avançado. Não há rollback automático; a interface informa a etapa e o estado
  parcial para permitir recuperação manual.
- A cópia altera somente os arquivos do frontend que abriu o configurador. O
  Shell pode precisar recarregar a sessão para usar JavaScript já carregado.
- A unidade systemd existente, `accounts.json`, cache e perfis dos CLIs não são
  modificados pelo atualizador.

## Referência

- [Proposta de design do atualizador configurável](../superpowers/specs/2026-10-28-configurable-project-updater-design.md)
