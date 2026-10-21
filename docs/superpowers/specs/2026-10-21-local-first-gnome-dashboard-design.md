# Coleta local prioritária e painel GNOME de limites

**Data:** 2026-10-21

**Status:** aprovada; implementação isolada com testes; revisão final e validação de sessão/implantação acompanhadas no plano.

## 1. Objetivo e decisões aprovadas

O usuário quer acompanhar principalmente a janela de sessão de 5 horas, mas
também o consumo semanal, enquanto trabalha nos CLIs Claude e Codex. Consultas
extras de uso a cada minuto têm produzido HTTP 429 no Claude; o Codex também
apresentou timeout, que não deve ser confundido com rate limit.

A direção aprovada é priorizar informações já recebidas pelas sessões locais,
usar rede como fallback coordenado e melhorar a interface com inspiração em
monitores open-source como CodexBar e claude-hud. A primeira interface será
**GNOME Shell 46**, mantendo o Cinnamon funcional. O novo visual Cinnamon será
uma entrega posterior.

Sucesso significa propagar prontamente uma observação local válida, reduzir
consultas extras e explicar fonte, idade e falhas. Não significa garantir quota
global atualizada a cada segundo: os provedores não oferecem esse contrato.

## 2. Alternativas e escolha

1. **Fontes locais prioritárias + fallback oficial — escolhida.** Claude entra
   por ponte de statusline e Codex por eventos de quota nos rollouts compatíveis.
   Reduz consultas durante o trabalho e mantém recuperação quando falta dado.
2. **Apenas aumentar o intervalo remoto.** Mudança menor, mas não atende ao
   acompanhamento durante a sessão nem garante eliminar 429.
3. **Cookies, scraping de Desktop ou inferência para medir quota.** Rejeitada:
   amplia acesso a segredos, acoplamento e consumo desnecessário.

Não serão copiados códigos GPL ou sem licença. As ideias da pesquisa serão
implementadas no projeto; eventual reutilização MIT exigirá atribuição.

## 3. Arquitetura e limites de responsabilidade

```text
Claude Code -> ponte opt-in da statusline -> entrada privada por perfil --+
                                                                      |
Codex CLI -> rollout JSONL compatível -> leitor incremental ------------+-> daemon
                                                                      |   |
CLIs oficiais -> fallback remoto por conta, coordenado e limitado ------+   |
                                                                          v
                                                          usage.json sanitizado
                                                               /         \
                                                        GNOME novo    Cinnamon
```

O daemon será o único escritor do snapshot publicado. Coletores produzem
observações; um normalizador valida unidades/janelas; um coordenador seleciona
dados e agenda consultas. GNOME/Cinnamon só leem métricas e atualizam a contagem
regressiva localmente. Falha ou demora de rede não pode bloquear eventos locais.

Um lock de usuário impedirá dois daemons de dispararem consultas em paralelo.
Consultas únicas e pedidos manuais deverão respeitar o mesmo estado persistido
de cooldown e exclusão mútua. A chegada de dado local não será bloqueada por 429.

### 3.1 Claude

- Ponte opcional recebe o JSON original da statusline; extrai somente janelas
  de quota e metadados mínimos. Não chama API nem envia prompt ao modelo.
- Usa `used_percentage` de 0–100 e `resets_at` em segundos Unix, com validação
  de campos independentes. Ausência não significa zero.
- Arquivo privado separado por perfil e sessão, evitando disputa entre contas
  e sessões concorrentes. Deduplicação não soma percentuais.
- Instalação será explícita, com preview da alteração, backup e remoção segura.
  Nenhuma configuração de statusline será alterada na implementação sem uma
  ação específica do usuário para habilitar a integração.
- Uma statusline existente receberá os bytes originais, preservando saída,
  ambiente, diretório, comando e opções. A falha do exportador não impedirá sua
  execução. Configurações desconhecidas serão recusadas, não reescritas por
  aproximação; overrides de projeto serão informados como limitação.
- Quando houver exportação claude-hud compatível, permitir importá-la por
  caminho explicitamente associado ao perfil, sem exigir instalar o claude-hud.
- Suporte documentado é Pro/Max. Team/Enterprise permanece com fallback remoto
  até a fonte local demonstrar campos válidos; nunca simular cobertura.
- Repetir a statusline ou mudar seu timer não comprova nova coleta remota.

### 3.2 Codex

- Ler apenas registros de quota de rollouts JSONL reconhecidos dentro dos homes
  configurados. Não persistir nem publicar mensagens, prompts ou respostas.
- Processar incrementalmente por offset, bufferizar linha incompleta e tratar
  truncate, rotação, sessões simultâneas e erros de arquivo isoladamente.
- Revarredura limitada de diretórios complementa notificações de filesystem;
  startup não deverá carregar todo o histórico em memória.
- `event_msg` / `token_count` / `rate_limits` é opcional. Aceitar snapshots
  válidos anteriores quando o evento seguinte não contém quota; não inferir
  percentuais de totais de tokens.
- Identificar janelas por duração e bucket; não presumir que todo `primary`
  representa 5 horas ou somar quotas de sessões paralelas.
- Histórico comprimido ou formato desconhecido será marcado como não suportado
  pela fonte local, com fallback, em vez de executar leitores arbitrários.
- Um app-server auxiliar não é listener global. O fallback continuará sendo
  `account/rateLimits/read`, com `excludeResetCreditDetails` quando suportado e
  timeout compatível com `probeTimeoutSeconds`, retirando o teto fixo de 3 s.

### 3.3 Identidade e troca de login

As entradas locais serão associadas a um perfil cadastrado, nunca por iniciais
ou apenas pelo e-mail. Um perfil de CLI não é uma garantia permanente de conta:
troca de login/workspace invalida a associação anterior.

O estado usará uma geração de vínculo por conta/perfil e identidade não secreta
quando exposta pelo CLI. A habilitação registra o vínculo explicitamente; fonte
sem confirmação suficiente será apresentada como **observação do perfil**, não
como identidade autenticada. Não ler tokens para resolver identidade.

Para Codex, `creator_account_id` é uma evidência de criação, não confirmação de
todos os resumes. Divergência conhecida rejeita a observação; logs antigos ou
resumidos sem vínculo confiável não preenchem silenciosamente uma conta atual.
Nesses casos o menu explica a lacuna e permite usar o fallback oficial. Resultados
em trânsito de uma geração anterior serão descartados.

## 4. Tempo, proveniência e estado dos dados

Cada janela terá metadados opcionais, mantendo os campos de percentuais atuais:

| Campo | Semântica |
| --- | --- |
| `source` | `claude-statusline`, `codex-rollout`, `claude-sdk` ou `codex-rpc` |
| `observedAt` | Quando o daemon recebeu aquela observação; não a releitura do arquivo |
| `sourceEventAt` | Timestamp original do evento/exportação, quando presente |
| `fetchedAt` | Conclusão de fetch comprovadamente não servido por fallback de cache; ausente se desconhecido |
| `identityConfidence` | Vínculo confirmado ou observação apenas do perfil |

Por conta: `lastAttemptAt`, `lastSuccessAt` de consulta remota quando conhecido,
`nextRetryAt`, erro operacional e revisão do resultado de consulta. `createdAt`
continua sendo publicação do snapshot, não medição de quota.

Estados visíveis por janela: **observado**, **último conhecido**, **reset vencido**
e **indisponível**. Estado operacional de conta é separado: aguardando integração,
consulta em andamento, falha temporária, 429 ou sem suporte confirmado.

- Falha remota preserva uma observação útil com seu timestamp e aviso.
- Repetir o mesmo arquivo não renova a observação; uma nova exportação pode
  registrar atividade local, mas não preenche `fetchedAt` remoto.
- Janelas parciais mantêm idades independentes; atualizar sessão não rejuvenesce
  semanal. Observações antigas não substituem novas só por terminarem depois.
- Fonte local há mais de 2 minutos sem evento será “último conhecido”; isso é
  uma convenção visual de atividade, não SLA do provedor.
- Reset vencido não vira automaticamente 0% nem confirmação de acesso restaurado.
- Se só existe dado legado, mostrar idade remota desconhecida, não fabricar data.

## 5. Fallback e atualização manual

Configuração opcional por conta: `collectionMode` (`hybrid` padrão, `local-only`
ou `remote-only`) e `remotePollIntervalSeconds`. O intervalo remoto inicial será
600 s para Claude e 120 s para Codex, como política conservadora ajustável,
**não como quota segura oficial**. Novos eventos locais não esperam esse timer.

`pollIntervalSeconds` legado permanece aceito como opção explícita quando não
houver override por conta, mas seu significado e a recomendação de migração serão
exibidos no diagnóstico. A implantação atual deverá pedir aprovação antes de
alterar o valor 60 s presente no arquivo real.

Eventos locais recentes suspendem o fallback automático da conta; sem eventos
por 2 minutos, a conta volta a ser elegível, respeitando sempre o intervalo desde
a última tentativa e o cooldown. Não há sondagem remota adicional para verificar
se cada evento contém informação remotamente nova.

Para 429, persistir prazo e nível da espera por perfil/geração: aguardar o maior
entre prazo do CLI e backoff de 15, 30, 60 minutos, com jitter positivo de até
10%. Sem 429, timeout/falha transitória inicia espera de 5 minutos. Consulta
remota bem-sucedida sem diagnóstico de falha reinicia o nível. Estado persistido
contém somente metadados não secretos; reinício não ignora prazo.

“Atualizar agora” não reiniciará o serviço: enviará pedido privado ao daemon,
que primeiro relê fontes locais e consulta remotamente apenas contas elegíveis.
Pedidos terão ID, deduplicação e resultado explícito: atendido com nova
observação, consulta concluída, sem dado novo, bloqueado até um horário ou erro.
Novo `createdAt` sozinho não será sucesso. Um arquivo de pedido privado e
atômico, no diretório do cache, evita criar um serviço HTTP local.

## 6. Interface GNOME

### Painel compacto

Preservar logos, entradas por conta e dois percentuais. Adicionar no tooltip os
nomes completos e a ordem “Sessão · Semanal”. Não alterar modo usado/restante.
Sufixo discreto `~` indica último conhecido; `!` indica aviso operacional. Sem
dado utilizável, manter `--%` em vez de ocultar a conta. Cor nunca será a única
forma de comunicar estado; identidade completa continua no menu.

### Menu por conta

Blocos nativos com espaçamento consistente, largura limitada à tela e rolagem
para múltiplas contas. Cada bloco apresenta:

1. Logo, nome, plano e identidade confirmada ou indicação de perfil.
2. **Sessão (5h)** em destaque, percentual e modo; barra de progresso.
3. **Semanal** com os mesmos elementos, sem ocultação por padrão.
4. Countdown de reset e horário absoluto acessível.
5. Fonte e idade da observação de cada janela; detalhes agrupados quando iguais.
6. Aviso secundário de 429/timeout e próxima tentativa, preservando último dado.

As barras representam o modo escolhido e terão rótulo “usado” ou “restante”.
Severidade decorre do consumo: abaixo de 75% normal, 75–89% atenção, a partir de
90% crítico; 100% significa percentual reportado, não bloqueio comprovado. Usar
cores compatíveis com tema claro/escuro e texto acessível, sem depender de animação.

Rodapé: “Atualizar agora” e “Configurar…”, com estado de pedido e resultado
coerentes. Não reconstruir o menu inteiro a cada mudança de countdown, perdendo
foco, rolagem ou seleção. Limpar sinais, watchers e timers ao desabilitar.

O visual será implementado com St/Clutter e CSS da extensão, sem dependência Web
ou janela Electron. Não haverá gráficos históricos, bandejas duplicadas,
notificações a cada evento, estimativa de tempo até esgotar ou configurações GTK4.

## 7. Compatibilidade, configuração e segurança

- Preservar UUIDs, serviço `ai-limits-widget.service` e caminho de `usage.json`.
- Snapshot permanece versão 1 com metadados opcionais. Leitor novo aceita versão
  1 antiga. Leitores legados mantêm campos essenciais.
- Atualização mínima do Cinnamon acompanha o daemon: indicar último conhecido e
  erros e respeitar o novo pedido manual onde aplicável. O layout atual permanece.
  Compatibilidade não pode mostrar um dado retido como atual sem qualquer aviso.
- Editor GTK3 preserva chaves extras e oferece controles essenciais de modo de
  coleta e integração; configurações existentes continuam carregando sem perda.
- Diretórios novos 0700, arquivos 0600, rename atômico, limite de tamanho,
  validação de proprietário, schema e caminhos; não seguir links que escapem das
  entradas configuradas. Sem dump de stdin, transcript ou stderr bruto no cache.
- Não extrair cookies, copiar tokens, renovar credenciais para escapar de 429,
  fazer chamadas de inferência de teste ou alterar login/workspace.

## 8. Entregas e validação

**Entrega 1:** contrato opcional de proveniência, coletor único, entradas locais,
fallback coordenado/persistido, pedido manual e compatibilidade mínima Cinnamon.

**Entrega 2:** novo menu GNOME, painel compacto e controles de integração; smoke
test GNOME 46. Instalação da ponte na configuração real é opt-in separado.

Critérios de aceitação:

- Evento válido disponível localmente aparece no snapshot e GNOME em até 5 s em
  testes controlados, sem depender da cadência remota. Não é garantia de servidor.
- Mesmo arquivo relido não rejuvenesce quota; sessão/semanal retêm idade própria.
- Sem dados locais, fallback funciona; 429 persiste entre reinícios, não bloqueia
  evento local e não gera falso sucesso manual.
- Duas sessões e dois perfis não somam percentuais nem vazam dados entre contas;
  troca de identidade invalida resultados antigos e casos ambíguos são visíveis.
- Statusline anterior mantém stdin/stdout e comportamento; integração instala,
  falha e desinstala sem sobrescrever alteração posterior feita pelo usuário.
- Testes com fixtures cobrem schema antigo/novo, linha parcial, rotação, janelas
  ausentes, timestamps futuros/antigos, reset, cooldown, concorrência e arquivo
  inválido. Não usar históricos pessoais como fixtures.
- 37% usado produz barra e rótulo coerentes; 63% restante representa o mesmo
  consumo e a mesma severidade. Teclado, tema, escala e múltiplas contas funcionam.
- Testes JS/Python, TypeScript, build e sintaxe GJS passam; smoke tests de sessão
  GNOME e regressão Cinnamon serão reportados separadamente de testes simulados.
- Não sobrescrever unidade systemd personalizada nem apagar as worktrees existentes.

## 9. Referências e andamento

Base factual: [estudo comparativo](../../../reports/Monitoramento%20local%20de%20limites%20IA.md),
[statusline Claude](https://code.claude.com/docs/en/statusline) e
[Codex App Server](https://developers.openai.com/codex/app-server/).

- [x] Explorar código e pesquisa existente.
- [x] Confirmar direção: coleta local e visual GNOME primeiro.
- [x] Registrar proposta e revisar escopo, compatibilidade e riscos.
- [x] Usuário revisar e aprovar esta especificação.
- [x] Criar plano de implementação e selecionar forma de execução (nativa).
- [x] Implementar com testes e revisão independente antes da instalação de teste.
- [ ] Validar menu em sessão GNOME nova e apresentação Cinnamon em sessão real.
