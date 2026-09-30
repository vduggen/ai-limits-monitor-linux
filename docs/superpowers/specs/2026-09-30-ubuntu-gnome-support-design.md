# Especificação: suporte ao Ubuntu 24.04 LTS com GNOME

**Status:** proposta aprovada em conversa; aguardando revisão deste documento.
**Data:** 2026-09-30

## Objetivo

Adicionar suporte ao Ubuntu 24.04 LTS no ambiente GNOME padrão, mantendo o suporte
existente ao Linux Mint com Cinnamon. O usuário quer a mesma experiência principal
no painel: percentuais de uso visíveis e um menu com detalhes por conta.

O Ubuntu 24.04.5 é uma atualização pontual da série 24.04 LTS. O alvo de
compatibilidade desta primeira etapa é, portanto, Ubuntu 24.04 LTS com GNOME Shell
46, e não apenas a atualização pontual 24.04.5.

## Decisões de produto e repositório

- O trabalho será feito no repositório existente
  `vduggen/linux-mint-ai-limits-applet`.
- Não será criado fork nem repositório separado: Mint e Ubuntu compartilharão o
  mesmo coletor e formato de dados.
- A documentação e os nomes visíveis do produto deverão deixar de sugerir suporte
  exclusivo ao Linux Mint. A alteração do slug público do repositório não faz
  parte desta etapa; o nome comercial definitivo será escolhido antes de alterar
  os metadados visíveis.
- Permanecem suportados Linux Mint/Cinnamon e Ubuntu 24.04 LTS/GNOME 46. Outras
  versões do Ubuntu, versões futuras do GNOME e outras distribuições não fazem
  parte do compromisso inicial de compatibilidade.

## Arquitetura proposta

### Coletor compartilhado

O daemon Node.js/TypeScript atual continuará consultando os CLIs autenticados do
Claude e do Codex e escrevendo um snapshot local. A configuração de contas, as
credenciais geridas pelos CLIs e o formato de snapshot versão 1 permanecem
compartilhados entre as interfaces. A nova interface GNOME não fará consultas
diretas aos provedores nem armazenará credenciais.

O cache continuará em `~/.cache/ai-limits-widget/usage.json`, com as permissões
restritas já usadas pelo daemon. O serviço continuará sendo de usuário (`systemd
--user`), sem exigir execução como root.

### Interface Cinnamon existente

O applet em `cinnamon/` continuará funcional e consumindo o mesmo cache. Seu UUID
`ai-limits-widget@vlduggen` será preservado para não invalidar instalações
existentes. Mudanças na interface Cinnamon devem se limitar ao que for necessário
para a marca e documentação genéricas ou para corrigir compatibilidade descoberta
durante a validação.

### Nova interface GNOME

Será criada uma extensão GNOME independente em `gnome/`, direcionada inicialmente
ao GNOME Shell 46. Ela deverá:

- exibir no painel os indicadores de Claude e Codex presentes no snapshot;
- abrir um menu com contas, planos/e-mails disponíveis, períodos, percentuais,
  horários de reset e horário da última atualização;
- atualizar a leitura do cache periodicamente, sem iniciar consultas aos
  provedores;
- apresentar estados compreensíveis para cache ausente, inválido ou desatualizado
  e para contas com erro ou sem limites reportados;
- permitir abrir o editor de configuração já existente.

A extensão e o applet Cinnamon terão implementações visuais separadas, mas
consumirão o mesmo contrato de dados. A interface GNOME não deverá alterar o
formato do cache nem duplicar a lógica de consulta de uso.

### Configuração

A primeira versão reutilizará `cinnamon/configure.py`, que oferece a janela GTK 3
para editar o modo de exibição de cada conta. A instalação Ubuntu documentará e
garantirá as dependências Python/GI e GTK 3 necessárias para abrir esse editor.
Preferências GNOME nativas com GTK 4 ficam adiadas; não haverá uma segunda
implementação da tela de configuração nesta etapa.

## Instalação e compatibilidade

- A instalação continuará manual e por usuário, seguindo o modelo atual de clone,
  instalação das dependências, build e habilitação do serviço do usuário.
- A documentação Ubuntu explicará como instalar e habilitar a extensão GNOME e
  como configurar o daemon e suas dependências.
- A unidade de serviço de novas instalações deverá usar o diretório real de
  instalação, sem depender do slug antigo do repositório ou de um caminho
  incorreto. A atualização não deverá substituir nem renomear a unidade já
  instalada `ai-limits-widget.service`.
- O UUID Cinnamon, o caminho do cache e os caminhos de configuração existentes
  serão preservados para não quebrar usuários atuais.
- Não será produzido pacote `.deb` nesta etapa. Empacotamento Debian e publicação
  da extensão em um catálogo são possibilidades futuras, não requisitos da
  primeira entrega.

## Validação e critérios de aceitação

### Ubuntu 24.04 LTS / GNOME 46

1. Com o serviço de usuário ativo e contas autenticadas, a barra mostra os dados
   disponíveis para Claude e Codex sem exigir que a janela de configuração fique
   aberta.
2. O menu apresenta os detalhes por conta, períodos e resets, além da idade do
   snapshot.
3. Após uma nova gravação do cache pelo daemon, a extensão atualiza os valores
   dentro do intervalo de atualização configurado.
4. Cache inexistente, inválido ou antigo não causa falha da sessão GNOME; a
   interface comunica o estado sem exibir dados como atuais quando estão antigos.
5. O editor GTK 3 abre, salva o modo de exibição e continua reiniciando a unidade
   de usuário existente quando necessário.
6. A instalação, habilitação, atualização e remoção manual da extensão estão
   documentadas para o usuário atual.

### Linux Mint / Cinnamon

1. O applet existente continua lendo o snapshot compartilhado e mostrando os
   indicadores e detalhes já suportados.
2. UUID, serviço, cache e configuração existentes continuam válidos.

### Verificações de desenvolvimento

A validação incluirá os comandos de verificação e build do projeto, verificações
de sintaxe da extensão GNOME e do configurador Python, e testes para o consumo dos
estados relevantes do snapshot. Também será necessário um teste de fumaça no
Ubuntu 24.04 com GNOME 46 e uma regressão no ambiente Cinnamon suportado; uma
verificação apenas de sintaxe não substitui esses testes de sessão.

## Fora de escopo

- descontinuar ou substituir o applet Cinnamon;
- fork, novo repositório ou extração do coletor para um pacote compartilhado;
- suporte a versões do GNOME além da baseline Ubuntu 24.04/GNOME 46 sem validação
  específica;
- criar um pacote `.deb` ou publicar em catálogo de extensões;
- criar preferências GNOME próprias em GTK 4;
- alterar as interfaces experimentais/internas dos provedores Claude e Codex;
- executar o coletor como serviço de sistema ou exigir privilégios de root.

## Riscos e limites conhecidos

- Extensões GNOME dependem das APIs e versões do GNOME Shell; suporte a versões
  adicionais exigirá metadados e validação próprios.
- A configuração GTK 3 pode exigir dependências adicionais em uma instalação
  mínima do Ubuntu, embora o daemon e a extensão não devam depender dela para
  exibir dados.
- As interfaces de uso dos CLIs Claude e Codex já são experimentais ou podem
  mudar sem compatibilidade garantida; esta migração não elimina esse risco.
