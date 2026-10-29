# ADR-002: Coleta local prioritária e dashboard GNOME

**Status:** Aceito
**Data:** 2026-10-29

## Contexto

Consultas remotas frequentes podem receber HTTP 429 no Claude ou timeout no
Codex. Ao mesmo tempo, os CLIs podem expor observações locais úteis durante uma
sessão. A interface precisa mostrar a idade e a origem de cada janela sem tratar
a publicação de um snapshot como uma nova medição, nem expor identidade não
confirmada.

O projeto também mantém uma extensão GNOME e um applet Cinnamon que consomem o
mesmo cache. A coleta nova e o dashboard não devem quebrar o contrato do snapshot,
as ações existentes do Cinnamon ou o fluxo de atualização manual do editor GTK.

## Decisão

1. Usar coleta **local prioritária** no modo híbrido: aceitar observações locais
   válidas do Claude (statusline opt-in e histórico local disponível) e do Codex
   (eventos de quota de rollouts), recorrendo a consultas oficiais coordenadas
   quando apropriado. Manter os modos somente local e somente remoto por conta.
2. Usar um daemon como escritor único do snapshot. Preservar idade, origem,
   identidade e cooldown por janela/conta; consultas bloqueadas ou falhas não
   transformam valores retidos em medições atuais. O refresh manual é
   correlacionado por pedido e não reinicia o serviço.
3. Reutilizar `shared/snapshot.js` como contrato de view model entre GNOME e
   Cinnamon. O GNOME instala essa fonte como `snapshot.js`; o Cinnamon continua
   usando o mesmo arquivo sob seu nome de módulo atual. A implementação não
   restaura `gnome/snapshot.js`.
4. Integrar o dashboard GNOME e os módulos runtime associados sem remover ações
   de perfis, configuração ou atualização já disponíveis no Cinnamon/GTK. A
   sincronização do frontend instalado copia atomicamente os recursos referidos
   pela extensão, sem build nem restart.
5. Tratar dados locais vinculados apenas a um perfil como identidade não
   confirmada; não inferir login a partir de e-mail herdado nem combinar quotas
   de sessões distintas.

Esta decisão complementa [ADR-001 — Atualizador configurável do clone do
projeto](001-atualizador-de-projeto-configuravel.md): não substitui nem altera o
fluxo **Verificar atualizações / Aplicar atualização** e suas salvaguardas.

## Alternativas consideradas

- **Somente consultas remotas:** mais simples, mas não aproveita dados que os
  próprios CLIs já observaram e mantém consultas desnecessárias durante sessões.
- **Somente dados locais:** reduz dependência de rede, mas deixa períodos sem
  dados quando a fonte local não oferece quota ou não está habilitada.
- **View model GNOME independente:** separaria os consumidores, mas duplicaria
  validação e poderia divergir do comportamento compatível do Cinnamon; foi
  rejeitado em favor do contrato compartilhado.
- **Scraping de sessão, cookies ou inferência de quota por tokens:** amplia o
  acesso a dados sensíveis ou apresenta estimativas como limites; foi rejeitado.

## Consequências

- `shared/snapshot.js` é a fonte do contrato visual. O instalador manual copia-a
  para a extensão como `snapshot.js` e para o applet como
  `ai_limits_snapshot.js`.
- O pacote runtime GNOME inclui `metadata.json`, `extension.js`,
  `cache-events.js`, `dashboard.js`, `refresh-request.js`, `stylesheet.css` e os
  ícones Claude/Codex; os arquivos Python compartilhados do editor permanecem
  instalados ao lado da extensão.
- O daemon conserva cooldowns e permite que dados locais continuem chegando
  durante falhas remotas. A interface comunica estados desconhecidos, antigos,
  expirados e bloqueados em vez de inventar zero ou frescor.
- A compatibilidade automatizada não substitui smoke tests nas sessões GNOME,
  Cinnamon ou GTK. A instalação/sincronização real da extensão e a validação em
  sessão permanecem ações separadas, com autorização própria.

## Referências

- [Especificação de coleta local prioritária e dashboard GNOME](../superpowers/specs/2026-10-21-local-first-gnome-dashboard-design.md)
- [Plano de coleta local prioritária e dashboard GNOME](../superpowers/plans/2026-10-21-local-first-gnome-dashboard.md)
- [Monitoramento local prioritário](../local-first-monitoring.md)
- [ADR-001 — Atualizador configurável do clone do projeto](001-atualizador-de-projeto-configuravel.md)
