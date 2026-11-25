# Changelog

Mudanças notáveis do projeto, registradas por componente. Consulte
[`docs/VERSIONING.md`](docs/VERSIONING.md) para a política de versões e releases.

## Unreleased

### Serviço e interfaces compartilhadas

- Permite somente o script de build da versão bloqueada `esbuild@0.28.2` durante
  a instalação; os demais scripts de dependências continuam sujeitos à aprovação.
- Documenta que cada atualização entregue incrementa a versão dos componentes
  afetados, independentemente de uma release formal.
- Prioriza cotas recentes do status line Claude e limita o fallback OAuth por
  perfil com estado persistente; leituras reutilizadas mantêm origem, idade e aviso.
- Consulta o histórico local do Claude Desktop, associa organizações aos perfis
  Claude e seleciona a observação local válida mais recente antes do fallback OAuth.
- Não apresenta a espera normal após uma consulta OAuth bem-sucedida como erro;
  mantém a idade real da leitura e os avisos para falhas efetivas.

### GNOME e interfaces compartilhadas

- O popup GNOME passa a seguir o layout e as ações do applet Cinnamon: cabeçalho
  com Configurar, Atualizar agora e Reiniciar serviço; cartões com plano, e-mail,
  fonte, erro, nova tentativa e janelas empilhadas com duração, barra na cor do
  provedor, reset e detalhes no tooltip. Os textos dos cartões vêm de
  `buildAccountCardView` em `shared/snapshot.js`, usado pelas duas interfaces.
- No GNOME, o resultado de **Atualizar agora** é verificado a cada segundo, a
  notificação traz o mesmo resumo do Cinnamon e o cache é relido ao abrir o menu.
- A extensão GNOME passa a usar um carregador versionado (ADR-003): cada
  instalação vai para `versions/<id>/` e **Recarregar extensão** (ou
  `scripts/gnome-extension.sh install`) ativa a versão nova sem encerrar a sessão.
  A primeira instalação do carregador ainda exige um logout.
- `scripts/gnome-extension.sh nested` abre um GNOME Shell aninhado com uma cópia
  isolada da extensão para validar mudanças.
- Os cartões do popup seguem a ordem do painel (Claude e depois Codex) no Cinnamon
  e no GNOME. No GNOME, as margens laterais ficam simétricas, textos longos quebram
  linha em vez de serem cortados e as barras são desenhadas como no Cinnamon, sem
  "recarregar" ao reabrir o menu.
- No GNOME, os botões do cabeçalho ficam quadrados (32×32) também no hover, os
  tooltips aparecem acima do popup e dentro da tela, e a barra de rolagem cabe no
  espaço reservado à direita dos cartões, independentemente do tema.
- O popup GNOME abre alinhado à borda esquerda do indicador, como no Cinnamon,
  sem sair do monitor.
- Os popups GNOME e Cinnamon acompanham a largura do indicador que os abre, com
  450 px de lista de cartões como mínimo e 600 px como limite; o cálculo fica em
  `popupContentWidth`, no modelo compartilhado.
- Identifica leituras provenientes do Claude Desktop no menu de contas.
- O configurador GTK verifica atualizações do clone e, após confirmação, aplica
  fast-forward seguro, compila e sincroniza somente a extensão GNOME que o abriu.
- Adiciona uma ação independente para sincronizar a extensão GNOME instalada a
  partir de um clone limpo e atualizado, após confirmação e sem build/restart.
- Localiza o pnpm em `PNPM_HOME` ou no diretório padrão do usuário quando ele não
  está no `PATH` herdado pela sessão gráfica.
- Executa `pnpm rebuild --pending` após a instalação para recuperar builds que
  ficaram pendentes em uma tentativa anterior.

### Cinnamon

- O configurador GTK verifica atualizações do clone e, após confirmação, aplica
  fast-forward seguro, compila e sincroniza somente o applet Cinnamon que o abriu.
- Adiciona uma ação independente para sincronizar o applet Cinnamon instalado a
  partir de um clone limpo e atualizado, após confirmação e sem build/restart.
- Localiza o pnpm em `PNPM_HOME` ou no diretório padrão do usuário quando ele não
  está no `PATH` herdado pela sessão gráfica.
- Executa `pnpm rebuild --pending` após a instalação para recuperar builds que
  ficaram pendentes em uma tentativa anterior.
- Identifica leituras provenientes do Claude Desktop no cartão da conta.
- O popup passa a organizar cada conta em um cartão com plano, janelas de uso,
  barras de percentual e horários de reset, mantendo estados de erro e ações atuais.
- As ações de configurar e atualizar agora ficam como ícones no cabeçalho; os
  botões textuais do rodapé foram removidos.
- Os controles do cabeçalho têm dimensões quadradas fixas, alinhamento central e
  realce visual ao passar o mouse ou receber foco pelo teclado.
- O texto do popup ganha mais contraste, e os ícones clareiam no hover e no foco.
- Um atalho global editável abre/fecha o popup; o padrão é `Super+Alt+A`.
- O popup acompanha a largura do applet no painel, nos mesmos limites do GNOME, e
  os textos dos cartões ocupam a largura disponível.

## Cinnamon 0.2.1 — 2026-10-26

### Cinnamon

- Aproxima o painel e o menu do GNOME: ícones de 18 px alinhados ao centro,
  tipografia sem negrito no indicador e espaçamento/padding controlados pelo tema
  nativo do Cinnamon.

## Cinnamon 0.2.0 — 2026-10-26

### Interfaces compartilhadas

- O editor de contas pode ativar/desativar contas, trocar perfis existentes e
  sinalizar identidades repetidas observadas no último snapshot.
- GNOME e Cinnamon passam a usar o mesmo modelo de leitura, validação e
  apresentação do snapshot em `shared/snapshot.js`.

### Cinnamon

- O applet acompanha gravações do cache, sinaliza dados antigos e contas com
  erro, e oferece as ações **Atualizar agora** e **Configurar…**.

## GNOME 2 — 2026-10-26

### Interfaces compartilhadas

- O editor de contas pode ativar/desativar contas, trocar perfis existentes e
  sinalizar identidades repetidas observadas no último snapshot.
- GNOME e Cinnamon passam a usar o mesmo modelo de leitura, validação e
  apresentação do snapshot em `shared/snapshot.js`.

### GNOME

- A extensão passa a consumir o modelo compartilhado de snapshot sem mudar o
  formato do cache nem a política de consultas do daemon.
