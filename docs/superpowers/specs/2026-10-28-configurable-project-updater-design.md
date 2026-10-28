# Atualizador de projeto configurável — proposta de design

**Status:** proposta aprovada em conversa, aguardando revisão deste documento antes do plano de implementação.

## Objetivo

Adicionar ao configurador GTK uma forma manual e segura de verificar atualizações do clone configurado e, após confirmação explícita, aplicá-las ao serviço e ao frontend que abriu a tela.

## Requisitos acordados

- Incluir a funcionalidade no configurador GTK aberto pela ação **Configurar…**.
- Derivar o caminho inicial do projeto do `config/accounts.json` ativo quando esse arquivo estiver dentro do diretório `config/` de um clone válido.
- Permitir escolher outra pasta de projeto e persistir a escolha em preferências separadas da configuração de contas.
- Verificar atualizações sem alterar arquivos de trabalho. Havendo commits disponíveis, mostrar o resultado e pedir confirmação separada antes de aplicar.
- Aplicar a atualização do clone, instalar dependências bloqueadas, compilar, sincronizar os arquivos do frontend que abriu a tela e reiniciar o serviço de usuário.
- Nunca descartar alterações locais nem sobrescrever a unidade systemd instalada.
- Manter a janela responsiva e comunicar claramente sucesso, ausência de atualizações, bloqueios e falhas parciais.

## Contexto atual

- `cinnamon/configure.py` é o editor GTK usado pelo applet Cinnamon e também distribuído junto à extensão GNOME.
- O editor conhece o caminho de `accounts.json`, mas ainda não possui uma preferência para a raiz do clone.
- O clone contém o serviço TypeScript, os arquivos-fonte dos frontends e os comandos manuais para copiar o frontend instalado.
- O serviço de usuário existente é `ai-limits-widget.service`; suas unidades podem conter caminhos personalizados e não devem ser substituídas.
- Não há diretório `docs/adr/` nem ADRs existentes.

## Arquitetura escolhida

Adicionar um módulo Python independente, `cinnamon/project_updates.py`, responsável por resolver e validar o projeto, executar operações Git, instalar/buildar o projeto e sincronizar os arquivos do frontend atual. `configure.py` permanece responsável pela janela GTK e delega o trabalho a esse módulo.

Esta abordagem mantém operações locais no configurador, permite injetar o executor de comandos em testes e evita um novo protocolo no daemon. Uma chamada a um script de shell externo criaria outro artefato instalado; delegar ao daemon aumentaria o acoplamento e exigiria mudanças no protocolo sem necessidade funcional.

### Caminho do projeto e preferência

1. Se existir uma preferência personalizada, ela terá precedência.
2. Caso contrário, inferir a raiz apenas quando o arquivo ativo for `.../config/accounts.json`; aceitar como raiz o diretório pai de `config/` se ele for a raiz deste produto.
3. Validar a pasta escolhida como raiz Git e confirmar que seu `package.json` identifica `ai-limits-monitor-linux`. Rejeitar diretórios pais arbitrários, repositórios de outro projeto e caminhos que não resolvam para a raiz do clone.
4. Expor um seletor de pasta GTK e exibir o caminho atual na seção **Atualizações**.
5. Guardar a personalização em `$XDG_CONFIG_HOME/ai-limits-monitor-linux/settings.json`, usando `~/.config` como fallback, escrita atômica e permissões privadas. Não inserir `projectPath` em `accounts.json`.

### Verificação

- O botão **Verificar atualizações** executará `git fetch` no clone selecionado e comparará `HEAD` com o upstream configurado da branch atual.
- Nenhum `pull`, build, cópia de arquivos ou reinício ocorre durante a verificação.
- A tela informa quando o clone está atualizado, quantos commits estão disponíveis ou por que não foi possível verificar (por exemplo, falta de upstream, erro de rede, caminho inválido ou branch divergente).
- Se a árvore de trabalho estiver modificada, a verificação ainda poderá informar commits remotos, mas a aplicação ficará bloqueada até o usuário resolver as alterações manualmente.

### Aplicação confirmada

Quando houver commits remotos em fast-forward, a tela mostrará o caminho e a quantidade de commits e oferecerá **Aplicar atualização** com diálogo de confirmação. Após a confirmação, a aplicação revalidará que a árvore está limpa e que a branch continua apta a fast-forward, então:

1. Executará `git pull --ff-only` sem shell intermediário.
2. Executará `pnpm install --frozen-lockfile` e `pnpm build` na raiz do clone.
3. Se o configurador tiver sido aberto da instalação Cinnamon ou GNOME conhecida, copiará somente os artefatos daquele frontend, incluindo `project_updates.py` para que a próxima abertura mantenha a funcionalidade. Se for aberto fora de uma instalação reconhecida, não copiará frontend.
4. Solicitará `systemctl --user restart ai-limits-widget.service` pelo mecanismo de restart já usado pelo configurador.

Não alterar a unidade systemd, configuração de contas, autenticação dos CLIs, cache ou dados dos perfis. A cópia dos arquivos de frontend não reiniciará o Shell; a tela avisará que uma recarga de sessão poderá ser necessária para ativar JavaScript já carregado. Se uma etapa posterior ao `git pull` falhar, não executar reset, limpeza nem rollback automático; informar explicitamente que o checkout avançou e qual etapa precisa de atenção. Se a cópia funcionar mas o restart falhar, informar que os arquivos foram atualizados, mas o daemon não foi confirmado como reiniciado.

### Execução e erros

- Usar listas de argumentos com `subprocess`, sem interpolar caminhos em shell; aplicar timeouts às chamadas externas e limitar a saída exibida.
- Fazer fetch/build/restart em worker para não bloquear GTK; desabilitar ações duplicadas enquanto a operação está ativa e atualizar widgets pela thread principal GTK.
- Bloquear aplicação se o clone estiver sujo, sem upstream, divergente, for de outro produto, ou se comandos necessários como `git`/`pnpm` estiverem indisponíveis.
- Não afirmar sucesso total se build, cópia do frontend ou restart falhar. Apresentar status específico da etapa e instrução segura para recuperação manual.

## Testes e verificação

- Criar testes unitários para resolução do caminho padrão, validação de projeto, persistência privada da preferência e classificação das situações Git.
- Criar testes do fluxo Git com repositórios temporários locais (incluindo remoto bare), sem rede nem clone real.
- Injetar executor nos testes para garantir que instalação, build, cópia e restart só ocorram após confirmação, e que falhas interrompam etapas subsequentes sem rollback destrutivo.
- Cobrir na UI o seletor, os estados de verificação, a confirmação e a apresentação de falhas.
- Executar os testes GTK existentes e novos com `xvfb-run -a python3 -m unittest discover -s test -v`, compilar os módulos Python, rodar `pnpm test`, `pnpm check:cinnamon`, `pnpm check:gnome` e `git diff --check`.
- Não executar o updater contra o clone de trabalho, serviços de usuário, rede ou instalação real durante testes automatizados.
- Atualizar as verificações de compatibilidade dos comandos de instalação para exigir que `project_updates.py` seja copiado junto de `configure.py` nos pacotes Cinnamon e GNOME.
- Atualizar os comandos de instalação documentados em `README.md`, `cinnamon/README.md` e `gnome/README.md` para copiar o módulo `project_updates.py`.

## Versionamento, documentação e decisão

Como o editor GTK compartilhado é distribuído em ambos os frontends, atualizar os manifestos Cinnamon e GNOME de acordo com `docs/VERSIONING.md` e registrar a funcionalidade sob `Unreleased` para os dois componentes no `CHANGELOG.md`. Não avançar a versão do daemon se não houver alteração em seu código ou contrato.

Criar um ADR em português em `docs/adr/` registrando a decisão de executar atualizações somente após confirmação, exigir fast-forward e bloquear clones modificados, com alternativas e consequências. O ADR deverá distinguir a decisão aprovada das limitações operacionais observadas durante a implementação.

## Fora de escopo

- Atualização periódica ou automática em segundo plano.
- Atualização de CLIs Claude/Codex, instalação de dependências de sistema, autenticação ou migração do cache.
- Alteração, criação ou reinstalação da unidade systemd.
- Reset/rebase/merge não fast-forward, descarte de alterações locais ou rollback automático do checkout.
- Publicação de release, criação de tags Git ou atualização de outro frontend além daquele que abriu o configurador.
