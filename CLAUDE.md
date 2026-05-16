# Colorful Bookmarks — Contexto para Claude

## O que é

Extensão Firefox MV3 que gera CSS (`userChrome.css`) para colorir pastas de favoritos na barra de favoritos. Não acessa o DOM do browser diretamente (requer extensão privilegiada); em vez disso, gera CSS com seletores `toolbarbutton[label="..."]` que o usuário cola no perfil do Firefox.

## Arquivos

```
Colorful-Firefox/
├── manifest.json   — MV3, permissions: bookmarks + storage
├── background.js   — abre options_ui ao clicar no ícone
├── options.html    — UI completa (paletas, árvore de pastas, gerador CSS)
└── options.js      — toda a lógica
```

## Arquitetura de options.js

### Estado global
```js
const BUILTIN_PALETTES = [...]   // 5 paletas predefinidas
const SKIP_TITLES = new Set(["Mozilla Firefox"])  // pastas filtradas da UI
let folderTree = null            // BookmarkTreeNode raiz (de getTree())
let titleMap = new Map()         // id → title (para gerar CSS)
let customPalettes = []          // paletas customizadas (persistidas em storage)
```

### Modelo de dados (storage)
```js
// browser.storage.local
{
  folderColors: {
    "<bookmark-id>": {
      icon:   "#rrggbb" | null,   // cor de preenchimento do ícone SVG
      text:   "#rrggbb" | null,   // cor do texto (label)
      stroke: { color: "#rrggbb", width: 0.5|1|2 } | null  // borda do ícone
    }
  },
  customPalettes: [{ name: string, colors: string[] }]
}
```

### Funções principais

| Função | O que faz |
|--------|-----------|
| `renderFolderTree(folderColors)` | Recria a árvore de pastas no DOM a partir do storage. Salva/restaura estado de acordeão expandido. |
| `appendFolderRow(node, folderColors, container)` | Cria uma linha de pasta com drag-target, toggle accordeão, makeColorGroup × 2, makeStrokeGroup. |
| `makeColorGroup(type, id, savedColor)` | Cria grupo {label + checkbox + color picker} para "icon" ou "text". |
| `makeStrokeGroup(id, savedStroke)` | Cria grupo {label + checkbox + color picker + select de espessura} para borda. |
| `collectFolderColors()` | Lê estado atual dos checkboxes/pickers do DOM e retorna objeto folderColors. Usado só pelo botão "Salvar cores". |
| `mergePaletteIntoStored(folders, palette, stored)` | **Função central de paleta.** Carrega `stored` do storage, só sobrescreve `icon`/`text` cujo checkbox estiver marcado, preserva tudo mais. Atualiza picker no DOM também. |
| `applyPalette(palette)` | Clique numa paleta → aplica em TODAS as pastas recursivamente via `getAllFoldersFlat`. |
| `buildCSS(folderColors)` | Gera o CSS completo para copiar em userChrome.css. |
| `showCSS(css)` | Exibe o CSS na textarea e faz scroll. |
| `updateGlobalControls()` | Sincroniza os 3 checkboxes globais (Ícone/Texto/Borda) com o estado agregado das pastas. |
| `expandRows(ids)` | Abre o `children-container` das linhas com os IDs dados (toggle acordeão). |
| `flashRows(ids)` | Animação de flash (drop-flash) nas linhas afetadas. |
| `getAllFoldersFlat(targetNode)` | Retorna [targetNode, ...descendants] em depth-first, respeitando SKIP_TITLES. |
| `folderChildren(node)` | Filtra filhos que são pastas (têm `.children`), excluindo SKIP_TITLES. |

### Fluxo de drag & drop
1. Usuário arrasta paleta (draggable com JSON em `text/plain`) sobre uma folder-row
2. `drop` → `getAllFoldersFlat(targetNode)` → lista de todas as subpastas
3. `mergePaletteIntoStored(folders, palette, stored)` → salva no storage
4. Expande o `children-container` imediato do alvo (só 1 nível)
5. `flashRows` + flash de feedback

### Fluxo de clique numa paleta
1. `applyPalette(palette)` → `rootFolders.flatMap(getAllFoldersFlat)` = todas as pastas da árvore em depth-first
2. `mergePaletteIntoStored(allFolders, palette, stored)`
3. Salva, flash

### Regras críticas de comportamento
- **Nunca alterar checkboxes programaticamente durante aplicação de paleta.** Só ler o estado atual.
- **`mergePaletteIntoStored` sempre carrega do storage primeiro.** Sobrescreve só os canais cujo checkbox estiver marcado. Assim é possível aplicar paleta Terra no ícone e Oceano no texto em passos separados sem perder nenhuma.
- **`collectFolderColors()` só é chamado pelo botão "Salvar cores".** Não usar para salvar após paleta (zeraria canais desmarcados).
- **`renderFolderTree` não é chamado após paleta.** Chamá-lo recriaria checkboxes do storage e perderia estado UI não salvo.

### Geração de CSS
```css
/* Para cada pasta com icon ou stroke definido: */
#PersonalToolbar toolbarbutton[label="<title>"],
#PlacesToolbar toolbarbutton[label="<title>"] {
  color: <text> !important;                   /* se text definido */
  list-style-image: url("data:image/svg+xml,...") !important;  /* se icon ou stroke */
}
/* Se icon definido, reforça com context-properties: */
#PersonalToolbar toolbarbutton[label="<title>"] .toolbarbutton-icon,
#PlacesToolbar toolbarbutton[label="<title>"] .toolbarbutton-icon {
  -moz-context-properties: fill, fill-opacity;
  fill: <icon> !important;
}
```

O SVG do ícone usa `viewBox="-1 -1 18 18"` (expandido 1px para stroke não clipar).

### UI — controles globais
A linha "Todas:" no topo da lista tem 3 checkboxes: Ícone / Texto / Borda.
- Clique → marca/desmarca todos os checkboxes individuais daquele tipo
- Estado indeterminado (-) quando algumas pastas estão marcadas e outras não
- Atualizado por `updateGlobalControls()` a cada mudança de checkbox individual

### Paletas customizadas
Modal `#palette-modal` — nome + lista de color pickers. Salvas em `customPalettes[]` no storage. Têm botão × para deletar. Draggable igual às builtin.

## Decisões de design tomadas

| Decisão | Motivo |
|---------|--------|
| userChrome.css em vez de experiment_apis | experiment_apis requer extensão privilegiada; não funciona no Firefox Release |
| `SKIP_TITLES = ["Mozilla Firefox"]` | Pasta built-in do Firefox que polui a lista |
| `viewBox="-1 -1 18 18"` no SVG | Stroke grosso clipava nas bordas com viewBox original |
| Não chamar `renderFolderTree` após paleta | Recriaria DOM, perderia estado UI, resetaria checkboxes |
| `mergePaletteIntoStored` com load do storage | Único jeito de acumular paletas diferentes em canais diferentes sem sobrescrever |
| `collectFolderColors()` só no "Salvar cores" | Lê só canais marcados → zeraria canais desmarcados se chamado após paleta |

## Bug conhecido — subpastas não coloridas (pendente)

**Sintoma:** ao aplicar paleta (clique ou drag/drop) em uma pasta que tem subpastas, as subpastas não ficam coloridas visualmente, mesmo que `getAllFoldersFlat` retorne todas elas corretamente.

**Causa provável:** subpastas nunca configuradas têm checkboxes desmarcados por default (`cb.checked = Boolean(null) = false`). `mergePaletteIntoStored` só atualiza canais com checkbox marcado → nenhum canal atualizado → nada colorido. O código está correto pela lógica, mas o fluxo UX está quebrado para pastas virgens.

**O que já foi tentado e revertido:**
- Chamar `renderFolderTree` após paleta → resetava checkboxes, apagava stroke
- Chamar `expandRows(allFolders)` → expandia TUDO recursivamente, inutilizável
- Preservar `prev.icon` do storage quando desmarcado → reconhecia valor antigo como "ativo"

**Solução esperada (não implementada):**
Quando `mergePaletteIntoStored` processa uma subpasta sem nenhuma configuração prévia (entry inexistente no storage E sem nenhum checkbox marcado), aplicar a cor de paleta nos canais icon + text E marcar os checkboxes correspondentes. Ou seja: para pastas virgens, o drop/clique de paleta age como "primeira configuração" (enable + colorir). Para pastas já configuradas, respeitar os checkboxes como está hoje.

**Arquivos a mexer:** `mergePaletteIntoStored` em `options.js` (~linha 532).

## O que ainda pode ser melhorado (não implementado)

- Persistência do estado de acordeão entre sessões (fecha tudo ao reabrir)
- Preview do CSS inline (só na seção "CSS gerado")
