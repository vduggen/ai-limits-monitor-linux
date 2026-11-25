# ADR-003: Carregador versionado da extensão GNOME

**Status:** Aceito
**Data:** 2026-11-25

## Contexto

No GNOME Shell 46 com Wayland, os módulos ES de uma extensão ficam em cache pela
URL durante toda a sessão. Substituir os arquivos instalados e executar
`gnome-extensions disable` e `enable` reutiliza o código antigo; o Shell só lê o
código novo após encerrar a sessão. Não há forma suportada de reiniciar apenas o
Shell no Wayland.

Isso obrigava a um logout a cada atualização da interface, inclusive pelo botão
**Sincronizar interface instalada** do configurador GTK. O applet Cinnamon não tem
essa limitação: o Cinnamon recarrega um applet isoladamente.

Havia ainda um efeito colateral: ao bloquear e desbloquear a tela, o Shell
desativa e reativa a extensão e relê `stylesheet.css` do disco, mas mantém o JS
antigo. Depois de uma cópia sem logout, a interface podia combinar JS antigo e CSS
novo.

Em teste com GJS 1.80, módulos com o mesmo conteúdo em diretórios diferentes são
carregados como módulos distintos.

## Decisão

1. `gnome/extension.js` passa a ser um carregador estável. Ele lê
   `current-version` na raiz da extensão e importa `versions/<id>/main.js`, além
   de carregar `versions/<id>/stylesheet.css` no tema e descarregá-lo ao
   desativar.
2. O código do painel (`main.js`, `dashboard.js`, `cache-events.js`,
   `refresh-request.js`, `snapshot.js`, `stylesheet.css` e ícones) é instalado
   em `versions/<id>/`, com `<id>` derivado do hash do conteúdo. Uma versão nova
   ocupa outro diretório e, portanto, outra URL, sem cache.
3. A raiz mantém `metadata.json`, o carregador e o editor GTK, que roda como
   processo separado e não sofre com o cache.
4. `install_gnome_extension` em `cinnamon/project_updates.py` é o único
   instalador. Ele é usado pelo configurador GTK e por
   `scripts/gnome-extension.sh`, grava `current-version` atomicamente por último
   e mantém a versão atual e a anterior.
5. Ao ativar, o carregador registra o PID do Shell em `.loader-pid`. O
   configurador só oferece **Recarregar extensão** (`gnome-extensions disable` e
   `enable`) quando esse PID pertence a um `gnome-shell` em execução. Um Shell
   iniciado antes do carregador ainda roda o código antigo e precisa de um
   logout.
6. Na transição, o instalador remove o JS antigo da raiz, mas mantém o
   `stylesheet.css` da raiz para o código antigo ainda em memória. O carregador o
   descarrega e apaga ao assumir.

## Alternativas consideradas

- **Continuar exigindo logout:** é o comportamento padrão do GNOME, inclusive
  para extensões do extensions.gnome.org, mas impede atualizar a interface no meio
  do trabalho.
- **Query string na URL do import:** não foi adotada; o diretório por versão é
  comportamento verificado e não depende de detalhes do resolvedor de módulos.
- **Publicar no extensions.gnome.org:** atualizações também só valem no próximo
  login, e o carregamento dinâmico de código, o editor Python e o uso de
  `systemctl` tendem a ser questionados na revisão.
- **Testar só no GNOME Shell aninhado:** útil para validar, e mantido em
  `scripts/gnome-extension.sh nested`, mas não atualiza a sessão em uso.

## Consequências

- Depois de um logout com o carregador, instalar e recarregar a extensão não
  exige nova sessão.
- Cada recarga mantém o código da versão anterior na memória do Shell até o
  próximo login, o que é aceitável para atualizações ocasionais.
- O pacote instalado deixa de ser uma cópia plana de `gnome/`; instalações
  manuais devem usar `scripts/gnome-extension.sh install`.
- A extensão não é adequada para o extensions.gnome.org sem rever esta decisão.
- O applet Cinnamon não muda.

## Referências

- [ADR-002 — Coleta local prioritária e dashboard GNOME](002-coleta-local-prioritaria-e-dashboard-gnome.md):
  o pacote runtime listado nas consequências passa a ser instalado em
  `versions/<id>/`.
- [Instalação GNOME](../../gnome/README.md)
