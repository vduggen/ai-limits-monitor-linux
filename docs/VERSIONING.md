# Política de versionamento

O repositório entrega componentes independentes. Cada trabalho deve aparecer no
histórico Git e no `CHANGELOG.md`; as versões de release avançam por componente,
sem obrigar Cinnamon, GNOME e o serviço a receberem o mesmo número.

## Fontes das versões

| Componente | Fonte da versão | Formato atual |
| --- | --- | --- |
| Serviço e projeto compartilhado | `package.json` → `version` | SemVer (`0.1.0`) |
| Applet Cinnamon | `cinnamon/metadata.json` → `version` | SemVer (`0.1.0`) |
| Extensão GNOME | `gnome/metadata.json` → `version` | Inteiro crescente (`1`) |

O GNOME mantém um inteiro no manifesto para compatibilidade com o mecanismo de
extensões. Não substituir esse campo por uma string SemVer; registre a versão e
as notas da entrega no changelog e use o inteiro seguinte ao publicar uma nova
versão GNOME.

## Quando atualizar cada versão

- **Serviço/projeto compartilhado:** mudanças em `src/`, dependências ou contratos
  do daemon. Aplicar SemVer: `PATCH` para correções compatíveis, `MINOR` para
  funcionalidades compatíveis e `MAJOR` para mudanças incompatíveis.
- **Cinnamon:** mudanças específicas do applet ou no pacote Cinnamon. Avançar
  `cinnamon/metadata.json` sem alterar a versão GNOME se ela não foi afetada.
- **GNOME:** mudanças específicas da extensão. Incrementar o inteiro em
  `gnome/metadata.json` sem alterar a versão Cinnamon se ela não foi afetada.
- **Código compartilhado pelas duas interfaces**, como `shared/snapshot.js`:
  avançar as versões Cinnamon e GNOME, pois os dois pacotes instalados incluem
  esse código. Só avançar a versão do serviço se o daemon ou seu contrato também
  mudou.
- **Formato do cache:** versionar o contrato separadamente em
  `UsageSnapshot.version`; alterações incompatíveis exigem migração ou suporte
  explícito a versões anteriores e testes de compatibilidade.

Uma alteração que afeta vários componentes pode produzir mais de uma versão no
mesmo commit. Componentes não afetados mantêm seu número.

## Rotina para cada trabalho e release

1. Registre cada trabalho em `CHANGELOG.md`, na seção `Unreleased` e sob todos os
   componentes afetados.
2. Mantenha mudanças coerentes em commits Git separados quando forem entregas
   independentes; siga o padrão Conventional Commits já usado no repositório.
3. **Não incremente a versão a cada commit.** Ao preparar uma entrega, mova as
   notas correspondentes para uma seção datada, atualize somente os manifestos
   afetados e valide os comandos de teste/build antes de criar a tag.
4. Use tags Git independentes para identificar publicações: `core/vX.Y.Z`,
   `cinnamon/vX.Y.Z` e `gnome/vN` (em que `N` corresponde ao inteiro do manifesto
   GNOME). Se vários componentes forem publicados juntos, crie uma tag para cada
   um no mesmo commit.
5. Não reutilize nem reescreva tags publicadas; faça uma nova versão para corrigir
   uma entrega já publicada.

As mudanças que ainda estão em andamento permanecem em `Unreleased`; os números
dos manifestos só mudam quando a entrega correspondente for preparada para
release.
