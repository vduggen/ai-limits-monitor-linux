# Linux Mint AI Limits Applet

O applet lê o snapshot gerado pelo daemon em:

```text
~/.cache/ai-limits-widget/usage.json
```

Depois de instalar as dependências e criar a configuração, execute o daemon em
outro terminal:

```bash
cd ~/linux-mint-ai-limits-applet
pnpm watch
```

Para instalar manualmente no Cinnamon:

```bash
TARGET="$HOME/.local/share/cinnamon/applets/ai-limits-widget@vlduggen"
mkdir -p "$TARGET"
cp cinnamon/metadata.json cinnamon/applet.js cinnamon/settings-schema.json cinnamon/configure.py cinnamon/claude.svg cinnamon/codex.svg "$TARGET/"
```

O comando acima presume que o projeto foi clonado em `~/linux-mint-ai-limits-applet`; se
ele estiver em outro diretório, execute o `cp` a partir da raiz do projeto ou
substitua os caminhos dos arquivos.

Depois, abra **Configurações do Sistema → Applets**, procure por **Linux Mint AI Limits Applet** e
adicione-o ao painel.

O UUID `ai-limits-widget@vlduggen` identifica o applet. Se uma versão anterior
estiver instalada, remova-a antes de adicionar esta versão para evitar duas
entradas no Cinnamon.

O indicador mostra cada logo ao lado do percentual configurado por conta, sem
letras auxiliares. O popup separa as contas por provedor e exibe as janelas
disponíveis dentro de cada conta. O botão de configuração abre um editor
gráfico com uma opção real para cada conta.

No painel, cada conta utilizável aparece em uma entrada própria com o logo do
provedor, as iniciais do nome e os dois percentuais principais. O nome completo
continua disponível no popup detalhado.

Também é possível editar o campo diretamente no `config/accounts.json`. Cada
conta pode usar:

```json
"displayMode": "remaining"
```

ou:

```json
"displayMode": "used"
```

O padrão é `remaining`. Contas com status `unsupported` continuam na
configuração para referência, mas não aparecem no popup de detalhes.

As fontes dos logomarks estão documentadas em `BRAND-SOURCES.md`.
