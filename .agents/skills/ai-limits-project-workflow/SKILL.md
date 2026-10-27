---
name: ai-limits-project-workflow
description: Orienta alterações, investigação e verificação no AI Limits Monitor for Linux. Use ao implementar, corrigir, revisar ou planejar mudanças no daemon TypeScript, provedores Claude e Codex, cache e snapshot, applet Cinnamon, extensão GNOME ou configuração Python/GTK.
---

# Fluxo do AI Limits Monitor for Linux

## Antes de alterar

1. Leia `AGENTS.md`, as instruções aplicáveis e os arquivos e testes pertinentes. Consulte ADRs existentes em `docs/adr/`, se houver.
2. Entenda o fluxo afetado: provedores e daemon em `src/`, cache local, modelo compartilhado em `shared/snapshot.js` e adaptadores visuais em `cinnamon/` e `gnome/`. O editor de contas Python/GTK fica em `cinnamon/`.
3. Verifique contratos e testes existentes antes de mudar formatos ou comportamento. Preserve a compatibilidade entre interfaces e as convenções de cada ambiente; JavaScript do Shell não é necessariamente executado como Node.
4. Prefira mudanças pequenas e legíveis, com testes de comportamento pertinentes. Não introduza padrões ou abstrações sem necessidade demonstrada.

## Segurança e dados locais

- As sessões e credenciais pertencem aos CLIs. Não exponha tokens, arquivos de perfil, e-mails ou dados de uso em logs, testes, exemplos ou respostas; use fixtures sintéticas.
- Não versione `config/accounts.json` nem cache. Não apague, altere ou consulte perfis reais sem necessidade e autorização compatível com a tarefa.
- Interfaces internas do Claude e do Codex podem mudar: valide os contratos e trate erros, indisponibilidade e dados inválidos sem assumir compatibilidade permanente.

## Verificações

Escolha conforme os arquivos e comportamentos alterados; execute os comandos a partir da raiz e informe resultados e limitações. O README documenta os pré-requisitos e o possível uso de `pnpm --ignore-workspace run` em workspaces aninhados.

| Área | Verificações relevantes |
| --- | --- |
| TypeScript, daemon ou provedores | `pnpm check`, `pnpm test`; `pnpm build` quando pertinente |
| Cinnamon ou snapshot compartilhado | `pnpm check:cinnamon`, `pnpm test` |
| GNOME ou snapshot compartilhado | `pnpm check:gnome`, `pnpm test` |
| Python/GTK | `xvfb-run -a python3 -m unittest discover -s test -v`; `python3 -m py_compile cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py` |

Para mudanças compartilhadas, considere as duas interfaces. Testes automatizados e verificações sintáticas não substituem validação real no Cinnamon, GNOME ou GTK; quando não for possível realizá-la, declare isso. Não instale dependências de sistema nem acesse serviços ou contas reais sem autorização apropriada.

## Decisões e entrega

Para decisões arquiteturais significativas, siga a política de ADR em `AGENTS.md`; distinga fatos conhecidos de hipóteses. Na entrega, resuma mudanças, verificações executadas e eventuais limitações sem alegar sucesso não observado.
