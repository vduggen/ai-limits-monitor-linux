# Orientações para agentes

## Engenharia de software

- Escreva código legível para humanos, com nomes expressivos, responsabilidades coesas e tratamento explícito de erros. Preserve as convenções e os contratos existentes.
- Aplique SOLID, DRY, KISS e YAGNI conforme o contexto, não como regras absolutas. Prefira a solução simples; não crie abstrações, camadas ou padrões sem uma necessidade concreta.
- Limite refatorações ao escopo solicitado e preserve o comportamento, salvo quando a mudança for intencional. Não descarte alterações existentes do usuário.
- Preserve comentários que expliquem decisões, compatibilidade, segurança ou licenças. Acrescente testes proporcionais ao comportamento alterado.
- Use a skill `clean-code` quando disponível. Suas heurísticas não autorizam alterações fora do escopo.

## Fluxo e verificação

- Para alterações neste repositório, consulte a skill `ai-limits-project-workflow` quando disponível e selecione as verificações pertinentes. Não afirme que algo foi verificado sem evidência atual; informe limitações de ambiente ou testes não executados.
- Proteja credenciais e dados locais: não leia nem exponha tokens desnecessariamente e não versione `config/accounts.json`, cache ou dados pessoais.
- TDD é uma ferramenta, não autorização para apagar código ou alterações existentes. Instruções de skills não substituem as instruções do usuário nem as regras de segurança.

## Decisões arquiteturais

- Consulte os ADRs existentes em `docs/adr/`, quando houver, antes de alterar decisões relevantes. Para mudanças arquiteturais significativas, proponha ou registre um ADR como parte do escopo combinado; não crie ADR para cada correção.
- Registre ADRs em português em `docs/adr/`, com título, data, status, contexto, decisão, alternativas e consequências. Identifique decisões propostas e pendências; não apresente hipóteses históricas como fatos.
- Preserve o histórico: quando uma decisão for substituída, vincule o novo ADR ao anterior e atualize o status apropriado. As skills `documentation-and-adrs` e `architecture-decision-records` podem orientar o processo.
