# Colorful Bookmarks

Extensão Firefox MV3. Gera CSS para colorir pastas de favoritos via `userChrome.css`.

## Estrutura

```
Colorful-Firefox/
├── manifest.json    ← MV3, permissions: bookmarks + storage
├── background.js    ← abre options_ui ao clicar no ícone
├── options.html     ← página de opções (árvore de pastas + gerador de CSS)
└── options.js       ← lógica da página de opções
```

## Instalação

1. `about:debugging` → **Este Firefox** → **Carregar extensão temporária…** → selecione `manifest.json`

## Uso

1. Clique no ícone da extensão (ou `about:addons` → extensão → Preferências)
2. Marque as pastas que quer colorir, escolha as cores
3. Clique **Salvar cores** → **Gerar CSS** → **Copiar CSS**
4. Siga as instruções exibidas na própria página de opções

## Setup userChrome.css (único por perfil)

| Passo | O que fazer |
|-------|------------|
| `about:config` | Ativar `toolkit.legacyUserProfileCustomizations.stylesheets` = `true` |
| `about:support` | Abrir pasta do perfil |
| Na pasta do perfil | Criar `chrome/userChrome.css` com o CSS gerado |
| Reiniciar Firefox | As cores aparecem na barra de favoritos |
