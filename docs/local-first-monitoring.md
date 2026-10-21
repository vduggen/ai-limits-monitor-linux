# Monitoramento local prioritário

O daemon combina observações locais dos CLIs com consultas de fallback. O dado
de sessão (normalmente 5 horas) e o semanal têm idades independentes. Publicar
um snapshot não confirma que o provedor mediu o uso novamente.

## Fontes e configuração

Claude Pro/Max pode fornecer `rate_limits.five_hour` e `seven_day` na statusline.
A disponibilidade depende da versão e do plano: Team pode precisar de consulta
remota. A ponte é opt-in; sem ela, a coleta híbrida usa o fallback. A ponte não
faz requisições próprias à API nem estima quota por tokens.

Codex usa eventos `event_msg/token_count/rate_limits` dos rollouts JSONL no
`homeDir` configurado. São lidos arquivos recentes e sessões acompanhadas, de
forma incremental e limitada. Eventos sem quota, buckets desconhecidos e
histórico comprimido não são tratados como quota zero. Não se usa o histórico
de outra pasta como substituto.

Cada conta aceita:

```json
{
  "id": "claude-pessoal",
  "label": "Claude pessoal",
  "provider": "claude",
  "configDir": "~/.claude",
  "displayMode": "remaining",
  "collectionMode": "hybrid",
  "remotePollIntervalSeconds": 600
}
```

- `hybrid`: local primeiro; observação local recente suprime a consulta automática
  por 120 segundos. A falta de eventos não significa que não houve uso externo.
- `local-only`: sem fallback remoto do monitor; sem observação válida, mostra
  desconhecido, nunca zero. Não garante que o próprio CLI não faça tráfego auxiliar.
- `remote-only`: ignora observações locais e usa consultas oficiais do CLI/SDK.
- Sem intervalo explícito: Claude 600 segundos, Codex 120 segundos. Um
  `pollIntervalSeconds` legado, inclusive 60, continua valendo. O editor oferece
  migração **por conta**; não muda automaticamente a configuração existente.
- `probeTimeoutSeconds` limita as operações remotas. Codex solicita a omissão dos
  detalhes de créditos e usa compatibilidade apenas se o CLI rejeitar esse campo.

## Integração Claude reversível

Compile o projeto e inicialize o daemon com sua configuração. Execute os comandos
no **mesmo checkout e ambiente** usados pelo serviço (`AI_LIMITS_CONFIG` e
`AI_LIMITS_CACHE`, se definidos). Substitua o ID pelo da conta desejada:

```bash
node dist/index.js integration preview --account claude-pessoal
node dist/index.js integration install --account claude-pessoal --confirm
node dist/index.js integration remove --account claude-pessoal --confirm
```

Revise o preview antes de instalar. A ponte preserva o objeto de statusline e
encaminha os bytes de entrada ao comando anterior, com stdout/stderr intactos,
sob `/bin/sh` e timeout de 2 segundos. Comandos dependentes de outro shell devem
ser adaptados conscientemente. Configuração de projeto pode substituir a
statusline de usuário. O editor mantém Salvar e Habilitar como ações distintas.
A remoção automática recusa sobrescrever uma statusline alterada posteriormente.

Opcionalmente, `externalUsagePath` pode apontar para uma exportação Claude
privada com `updated_at`, `five_hour` e `seven_day`, nos mesmos campos de quota.
O formato deve ser confirmado com a versão do exportador; não são importados
tokens ou estimativas. O arquivo deve pertencer ao usuário, ser regular e 0600.

## Idade, identidade e falhas

O snapshot continua na versão 1. Cada janela pode ter `source`, `observedAt`,
`sourceEventAt` e `fetchedAt`. Leitores antigos continuam aceitando o JSON;
leitores novos tratam a ausência de metadados como fonte/idade desconhecida.
`createdAt` é a publicação, não a idade da quota. `fetchedAt` só deve aparecer
quando a consulta confirma uma coleta remota; resposta do CLI pode ser cache.

No GNOME, `~` indica último conhecido e `!` indica aviso. Reset vencido mantém
o percentual, mas atenua a barra e pede confirmação; não inventa zero. Modo usado
e restante têm preenchimentos complementares, mas a mesma severidade de consumo
(75% elevado; 90% crítico). A contagem local de 15 segundos não dispara consulta.

Uma pasta de perfil não prova qual login está ativo. Observações sem identidade
verificada aparecem como **perfil; identidade não confirmada**, sem e-mail
herdado. Não some percentuais entre sessões. Mantenha perfis separados para
logins diferentes; mudanças de pasta criam uma geração nova. Um evento local não
garante refletir uso feito fora do CLI, em outro computador ou em outra sessão.

HTTP 429 preserva o último dado útil com aviso. A espera é o maior prazo entre
o informado pelo CLI e 15/30/60 minutos progressivos, mais até 10% de jitter
positivo. Outras falhas aguardam pelo menos 5 minutos. Estado corrompido impõe
uma espera conservadora de 15 minutos. Reiniciar não é um mecanismo para burlar
cooldown; dados locais válidos continuam sendo recebidos durante a espera.

## Pedidos e diagnóstico

```bash
node dist/index.js refresh --json
node dist/index.js check --json
```

Com daemon ativo, os pedidos são coordenados por UUID e retornam resultados
`observed`, `queried`, `unchanged`, `blocked` ou `error`. No GNOME, Atualizar agora
não reinicia o serviço. Snapshot novo sem resultado correlacionado não confirma
o pedido. Um resultado processado não equivale a percentuais novos. Sem daemon,
`check` usa o mesmo lock para uma execução única; `refresh` pede iniciar o coletor.

Diretório padrão: `~/.cache/ai-limits-widget/`. `usage.json` é a apresentação;
`runtime-state.json` conserva gerações e cooldown; `inputs/` guarda exportações
sanitizadas; `requests/` guarda pedidos/resultados; `integration/` permite restaurar
a statusline. Arquivos novos são 0600 e diretórios novos 0700. Não compartilhe
esses arquivos publicamente: podem conter nomes de perfis, e-mails e comandos.

Para diagnosticar, confira `sourceEventAt`/`observedAt` por janela e
`collection.nextRetryAt`, não apenas `createdAt`. Se o dado não chega, confirme
modo da conta, pasta, disponibilidade dos campos e permissões. Consulte
`systemctl --user status ai-limits-widget.service` sem loops de sondagem remota.

## Atualização, rollback e validação de sessão

Mantenha a unidade personalizada e faça backup privado do código/configuração
antes de instalar. Não apague runtime, credenciais ou worktrees para atualizar.
Compile o checkout escolhido; copie também `dashboard.js`, `refresh-request.js`
e `stylesheet.css` conforme o [guia GNOME](../gnome/README.md). Reinicie o daemon
uma única vez após atualizar seu código. Re-enable da extensão pode não limpar
o cache de módulos GJS; nesse caso, uma **nova sessão voluntária** é necessária.
Nunca encerre automaticamente a sessão do usuário.

Para voltar, remova a ponte pelo comando acima antes de retirar seu executável,
restaure a versão anterior dos arquivos e o caminho original da unidade, e faça
um único restart. Preserve os arquivos de estado; versões antigas podem não
aplicar a política de cooldown nova. Não use rollback para forçar nova consulta.

Testes sintéticos exercitam propagação local em até 5 segundos, não latência do
provedor. A validação em sessão real ainda exige: GNOME 46, teclado, temas claro
e escuro, escala 100/200%, ao menos seis contas, foco/scroll durante atualização,
erro, reset vencido, fonte incerta e pedido bloqueado. Cinnamon também precisa
de smoke test de dados retidos. **Não validado em sessão nesta entrega.**

Instalar o código no checkout do serviço, habilitar a ponte de um perfil real e
substituir o intervalo legado são três autorizações separadas. A implementação
isolada não executa nenhuma dessas ações.
