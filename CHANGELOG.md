# Changelog

Mudanças notáveis do projeto, registradas por componente. Consulte
[`docs/VERSIONING.md`](docs/VERSIONING.md) para a política de versões e releases.

## Unreleased

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
