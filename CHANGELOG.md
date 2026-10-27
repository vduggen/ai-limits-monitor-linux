# Changelog

Mudanças notáveis do projeto, registradas por componente. Consulte
[`docs/VERSIONING.md`](docs/VERSIONING.md) para a política de versões e releases.

## Unreleased

### Serviço e interfaces compartilhadas

- Documenta que cada atualização entregue incrementa a versão dos componentes
  afetados, independentemente de uma release formal.
- Prioriza cotas recentes do status line Claude e limita o fallback OAuth por
  perfil com estado persistente; leituras reutilizadas mantêm origem, idade e aviso.
- Consulta o histórico local do Claude Desktop, associa organizações aos perfis
  Claude e seleciona a observação local válida mais recente antes do fallback OAuth.
- Não apresenta a espera normal após uma consulta OAuth bem-sucedida como erro;
  mantém a idade real da leitura e os avisos para falhas efetivas.

### GNOME e interfaces compartilhadas

- Identifica leituras provenientes do Claude Desktop no menu de contas.

### Cinnamon

- Identifica leituras provenientes do Claude Desktop no cartão da conta.
- O popup passa a organizar cada conta em um cartão com plano, janelas de uso,
  barras de percentual e horários de reset, mantendo estados de erro e ações atuais.
- As ações de configurar e atualizar agora ficam como ícones no cabeçalho; os
  botões textuais do rodapé foram removidos.
- Os controles do cabeçalho têm dimensões quadradas fixas, alinhamento central e
  realce visual ao passar o mouse ou receber foco pelo teclado.
- O texto do popup ganha mais contraste, e os ícones clareiam no hover e no foco.
- Um atalho global editável abre/fecha o popup; o padrão é `Super+Alt+A`.

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
