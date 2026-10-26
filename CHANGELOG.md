# Changelog

Mudanças notáveis do projeto, registradas por componente. Consulte
[`docs/VERSIONING.md`](docs/VERSIONING.md) para a política de versões e releases.

## Unreleased

### Interfaces compartilhadas

- O editor de contas pode ativar/desativar contas, trocar perfis existentes e
  sinalizar identidades repetidas observadas no último snapshot.
- GNOME e Cinnamon passam a usar o mesmo modelo de leitura, validação e
  apresentação do snapshot em `shared/snapshot.js`.

### Cinnamon

- O applet acompanha gravações do cache, sinaliza dados antigos e contas com
  erro, e oferece as ações **Atualizar agora** e **Configurar…**.

### GNOME

- A extensão passa a consumir o modelo compartilhado de snapshot sem mudar o
  formato do cache nem a política de consultas do daemon.
