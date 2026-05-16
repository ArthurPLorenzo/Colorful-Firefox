"use strict";

// ── Constants ──────────────────────────────────────────────────────────────

const BUILTIN_PALETTES = [
  { name: "Pastel",    colors: ["#ffadad","#ffd6a5","#fdffb6","#caffbf","#9bf6ff","#a0c4ff","#bdb2ff"] },
  { name: "Neon",      colors: ["#ff0080","#ff6600","#ffe600","#00cc44","#00ccff","#3399ff","#aa00ff"] },
  { name: "Terra",     colors: ["#a0522d","#cd853f","#d2691e","#8b4513","#bc8a5f","#6b3a2a","#deb887"] },
  { name: "Oceano",    colors: ["#0077b6","#0096c7","#00b4d8","#48cae4","#90e0ef","#023e8a","#03045e"] },
  { name: "Floresta",  colors: ["#1b4332","#2d6a4f","#40916c","#52b788","#74c69d","#95d5b2","#b7e4c7"] },
];

// ── State ──────────────────────────────────────────────────────────────────

let folderTree    = null;       // root BookmarkTreeNode from getTree()
let titleMap      = new Map();  // guid → title
let customPalettes = [];        // loaded from storage

// ── Diagnostic helpers ──────────────────────────────────────────────────────

const listEl = document.getElementById("folder-list");

function showStep(n, msg) {
  listEl.innerHTML =
    `<div class="empty-state"><strong>Iniciando [${n}/4]:</strong> ${msg}</div>`;
}

function showError(title, detail) {
  listEl.innerHTML =
    `<div class="empty-state" style="color:var(--danger);text-align:left;">` +
    `<strong>ERRO: ${title}</strong>` +
    (detail ? `<br><br><code style="font-size:11px;white-space:pre-wrap;">${detail}</code>` : "") +
    `</div>`;
}

// ── Browser API guard (runs before everything else) ────────────────────────

showStep(1, "Script carregado.");

if (typeof browser === "undefined") {
  showError(
    "browser API nao disponivel",
    "Abra via about:addons → Colorful Bookmarks → Preferencias,\n" +
    "ou clique no icone da extensao na barra do Firefox.\n\n" +
    "NAO abra options.html diretamente (file://)."
  );
  throw new Error("[Colorful Bookmarks] browser ausente");
}

if (!browser.bookmarks) {
  showError(
    "browser.bookmarks nao disponivel",
    "Verifique se a permissao 'bookmarks' esta no manifest.json."
  );
  throw new Error("[Colorful Bookmarks] browser.bookmarks ausente");
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

showStep(2, "Chamando browser.bookmarks.getTree()...");

browser.bookmarks
  .getTree()
  .then((tree) => {
    folderTree = tree[0];
    buildTitleMap(folderTree);
    showStep(3, "Carregando configuracoes salvas...");
    return browser.storage.local.get(["folderColors", "customPalettes"]);
  })
  .then(({ folderColors = {}, customPalettes: cp = [] }) => {
    customPalettes = cp;
    showStep(4, "Renderizando...");
    renderPalettes();
    renderFolderTree(folderColors);
  })
  .catch((err) => {
    showError("Falha ao carregar", String(err) + (err.stack ? "\n\n" + err.stack : ""));
    console.error("[Colorful Bookmarks]", err);
  });

// ── Tree helpers ───────────────────────────────────────────────────────────

function buildTitleMap(node) {
  if (node.title) titleMap.set(node.id, node.title);
  (node.children || []).forEach(buildTitleMap);
}

const SKIP_TITLES = new Set(["Mozilla Firefox"]);

function hasFolderChildren(node) {
  return (node.children || []).some(
    (c) => Array.isArray(c.children) && !SKIP_TITLES.has(c.title)
  );
}

function folderChildren(node) {
  return (node.children || []).filter(
    (c) => Array.isArray(c.children) && !SKIP_TITLES.has(c.title)
  );
}

function findNodeById(node, id) {
  if (node.id === id) return node;
  for (const child of (node.children || [])) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

function getAllDescendantIds(node) {
  const ids = [node.id];
  for (const child of folderChildren(node)) {
    ids.push(...getAllDescendantIds(child));
  }
  return ids;
}

// Return a flat list: [targetNode, ...all descendant folders depth-first].
// Uses node.children existence (truthy) as the folder test — more permissive
// than Array.isArray, handles edge cases in Firefox's BookmarkTreeNode.
function getAllFoldersFlat(targetNode) {
  const result = [targetNode];
  function traverse(children) {
    for (const child of children) {
      if (child.children !== undefined && !SKIP_TITLES.has(child.title)) {
        result.push(child);
        traverse(child.children);
      }
    }
  }
  if (targetNode.children) traverse(targetNode.children);
  return result;
}

// ── Accordion state ────────────────────────────────────────────────────────

function saveExpandedState() {
  const expanded = new Set();
  document.querySelectorAll(".folder-row[data-node-id]").forEach((row) => {
    const cc = row.nextElementSibling;
    if (cc?.classList.contains("children-container") && cc.classList.contains("open")) {
      expanded.add(row.dataset.nodeId);
    }
  });
  return expanded;
}

function restoreExpandedState(expanded) {
  if (expanded.size === 0) return;
  document.querySelectorAll(".folder-row[data-node-id]").forEach((row) => {
    if (!expanded.has(row.dataset.nodeId)) return;
    const cc = row.nextElementSibling;
    if (cc?.classList.contains("children-container")) {
      cc.classList.add("open");
      const btn = row.querySelector(".toggle-btn");
      if (btn) btn.textContent = "▼";
    }
  });
}

function flashRows(ids) {
  ids.forEach((id) => {
    const row = document.querySelector(`.folder-row[data-node-id="${id}"]`);
    if (!row) return;
    row.classList.remove("drop-flash");
    void row.offsetWidth;
    row.classList.add("drop-flash");
    row.addEventListener("animationend", () => row.classList.remove("drop-flash"), { once: true });
  });
}

function expandRows(ids) {
  const idSet = new Set(ids.map(String));
  document.querySelectorAll(".folder-row[data-node-id]").forEach((row) => {
    if (!idSet.has(row.dataset.nodeId)) return;
    const cc = row.nextElementSibling;
    if (cc?.classList.contains("children-container") && !cc.classList.contains("open")) {
      cc.classList.add("open");
      const btn = row.querySelector(".toggle-btn:not(.leaf)");
      if (btn) btn.textContent = "▼";
    }
  });
}

// ── Global controls ────────────────────────────────────────────────────────

function updateGlobalControls() {
  const iconCbs   = [...document.querySelectorAll('.enable-check[data-color-type="icon"]')];
  const textCbs   = [...document.querySelectorAll('.enable-check[data-color-type="text"]')];
  const strokeCbs = [...document.querySelectorAll('.enable-check[data-color-type="stroke"]')];
  const globalIconCb   = document.getElementById("global-icon-cb");
  const globalTextCb   = document.getElementById("global-text-cb");
  const globalStrokeCb = document.getElementById("global-stroke-cb");
  if (!globalIconCb || !globalTextCb) return;
  const iconOn   = iconCbs.filter((c) => c.checked).length;
  const textOn   = textCbs.filter((c) => c.checked).length;
  const strokeOn = strokeCbs.filter((c) => c.checked).length;
  globalIconCb.checked = iconCbs.length > 0 && iconOn === iconCbs.length;
  globalIconCb.indeterminate = iconOn > 0 && iconOn < iconCbs.length;
  globalTextCb.checked = textCbs.length > 0 && textOn === textCbs.length;
  globalTextCb.indeterminate = textOn > 0 && textOn < textCbs.length;
  if (globalStrokeCb) {
    globalStrokeCb.checked = strokeCbs.length > 0 && strokeOn === strokeCbs.length;
    globalStrokeCb.indeterminate = strokeOn > 0 && strokeOn < strokeCbs.length;
  }
}

// ── Palette rendering ──────────────────────────────────────────────────────

function renderPalettes() {
  const row = document.getElementById("palette-row");
  row.innerHTML = "";

  const all = [
    ...BUILTIN_PALETTES.map((p) => ({ ...p, builtin: true })),
    ...customPalettes.map((p) => ({ ...p, builtin: false })),
  ];

  for (let i = 0; i < all.length; i++) {
    row.appendChild(makePaletteBtn(all[i], i));
  }
}

function makePaletteBtn(palette, index) {
  const btn = document.createElement("button");
  btn.className = "palette-btn";
  btn.title = `Aplicar paleta "${palette.name}" nas pastas raiz`;

  const swatches = document.createElement("div");
  swatches.className = "palette-swatches";
  palette.colors.slice(0, 6).forEach((c) => {
    const dot = document.createElement("div");
    dot.className = "palette-swatch";
    dot.style.background = c;
    swatches.appendChild(dot);
  });

  const label = document.createElement("div");
  label.className = "palette-label";
  label.textContent = palette.name;

  btn.append(swatches, label);
  btn.draggable = true;
  btn.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ name: palette.name, colors: palette.colors }));
    e.dataTransfer.effectAllowed = "copy";
  });
  btn.addEventListener("click", () => applyPalette(palette));

  if (!palette.builtin) {
    const del = document.createElement("button");
    del.className = "palette-del";
    del.textContent = "×";
    del.title = "Remover esta paleta";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCustomPalette(index - BUILTIN_PALETTES.length);
    });
    btn.appendChild(del);
  }

  return btn;
}

// ── Folder tree rendering ──────────────────────────────────────────────────

function renderFolderTree(folderColors) {
  const expanded = saveExpandedState();
  const gc = document.getElementById("global-controls");
  if (gc) gc.style.display = "none";
  listEl.innerHTML = "";

  if (!folderTree || !folderTree.children) {
    listEl.innerHTML = '<div class="empty-state">Nenhuma pasta encontrada.</div>';
    return;
  }

  let first = true;
  for (const section of folderTree.children) {
    const sectionFolders = folderChildren(section);
    if (sectionFolders.length === 0) continue;

    const header = document.createElement("div");
    header.className = "section-header";
    if (first) header.style.borderTop = "none";
    header.textContent = section.title;
    listEl.appendChild(header);
    first = false;

    for (const folder of sectionFolders) {
      appendFolderRow(folder, folderColors, listEl);
    }
  }

  if (listEl.children.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Nenhuma pasta encontrada.</div>';
    return;
  }

  restoreExpandedState(expanded);
  if (gc) { gc.style.display = "flex"; updateGlobalControls(); }
}

function appendFolderRow(node, folderColors, container) {
  const saved = folderColors[node.id] || {};
  const childFolders = folderChildren(node);
  const hasKids = childFolders.length > 0;

  // ── Row ──────────────────────────────────────────────────
  const row = document.createElement("div");
  row.className = "folder-row";
  row.dataset.nodeId = node.id;

  // ── Drag-target events ────────────────────────────────────
  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    row.classList.add("drag-over");
  });

  row.addEventListener("dragleave", (e) => {
    // Ignore if moving to a child element inside this row.
    if (e.relatedTarget && row.contains(e.relatedTarget)) return;
    row.classList.remove("drag-over");
  });

  row.addEventListener("drop", async (e) => {
    e.preventDefault();
    row.classList.remove("drag-over");

    let palette;
    try {
      palette = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (!palette?.colors?.length) return;

    const targetNode = findNodeById(folderTree, node.id);
    if (!targetNode) return;

    const { folderColors: stored = {} } = await browser.storage.local.get("folderColors");
    const folders = getAllFoldersFlat(targetNode);
    mergePaletteIntoStored(folders, palette, stored);
    await browser.storage.local.set({ folderColors: stored });

    // Expand only the immediate children of the drop target so the user can
    // see the first level of subfolders without cascading all nested folders open.
    const targetRow = document.querySelector(`.folder-row[data-node-id="${node.id}"]`);
    if (targetRow) {
      const cc = targetRow.nextElementSibling;
      if (cc?.classList.contains("children-container") && !cc.classList.contains("open")) {
        cc.classList.add("open");
        const btn = targetRow.querySelector(".toggle-btn:not(.leaf)");
        if (btn) btn.textContent = "▼";
      }
    }
    flashRows(folders.map((f) => f.id));
    flash("save-feedback", `Paleta "${palette.name}" aplicada — ${folders.length} pasta(s). Clique em Salvar.`, "#2ac3a2");
  });

  const toggleBtn = document.createElement("button");
  toggleBtn.className = hasKids ? "toggle-btn" : "toggle-btn leaf";
  toggleBtn.textContent = "▶";

  const icon = document.createElement("span");
  icon.className = "folder-icon";
  icon.textContent = "📁";

  const name = document.createElement("span");
  name.className = "folder-name";
  name.textContent = node.title;
  name.title = node.title;

  const sep = document.createElement("div");
  sep.className = "color-sep";

  const sep2 = document.createElement("div");
  sep2.className = "color-sep";

  row.append(
    toggleBtn, icon, name, sep,
    makeColorGroup("icon", node.id, saved.icon || null),
    makeColorGroup("text", node.id, saved.text || null),
    sep2,
    makeStrokeGroup(node.id, saved.stroke || null)
  );
  container.appendChild(row);

  // ── Children container ────────────────────────────────────
  if (hasKids) {
    const childrenEl = document.createElement("div");
    childrenEl.className = "children-container";

    for (const child of childFolders) {
      appendFolderRow(child, folderColors, childrenEl);
    }
    container.appendChild(childrenEl);

    toggleBtn.addEventListener("click", () => {
      const open = childrenEl.classList.toggle("open");
      toggleBtn.textContent = open ? "▼" : "▶";
    });
  }
}

function makeColorGroup(type, id, savedColor) {
  const group = document.createElement("div");
  group.className = "color-group";

  const lbl = document.createElement("span");
  lbl.className = "color-group-label";
  lbl.textContent = type === "icon" ? "Ícone" : "Texto";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "enable-check";
  cb.dataset.id = id;
  cb.dataset.colorType = type;
  cb.checked = Boolean(savedColor);

  const pick = document.createElement("input");
  pick.type = "color";
  pick.className = "color-pick";
  pick.dataset.id = id;
  pick.dataset.colorType = type;
  pick.value = savedColor || (type === "text" ? "#000000" : "#0060df");
  pick.disabled = !savedColor;

  cb.addEventListener("change", () => {
    pick.disabled = !cb.checked;
    updateGlobalControls();
  });

  group.append(lbl, cb, pick);
  return group;
}

function makeStrokeGroup(id, savedStroke) {
  const group = document.createElement("div");
  group.className = "color-group";

  const lbl = document.createElement("span");
  lbl.className = "color-group-label";
  lbl.textContent = "Borda";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "enable-check";
  cb.dataset.id = id;
  cb.dataset.colorType = "stroke";
  cb.checked = Boolean(savedStroke?.color);

  const pick = document.createElement("input");
  pick.type = "color";
  pick.className = "color-pick";
  pick.dataset.id = id;
  pick.dataset.colorType = "stroke";
  pick.value = savedStroke?.color || "#000000";
  pick.disabled = !savedStroke?.color;

  const widthSel = document.createElement("select");
  widthSel.className = "stroke-width-sel";
  widthSel.dataset.id = id;
  widthSel.disabled = !savedStroke?.color;
  [["0.5", "Fino"], ["1", "Médio"], ["2", "Grosso"]].forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    opt.selected = String(savedStroke?.width ?? 1) === val;
    widthSel.appendChild(opt);
  });

  cb.addEventListener("change", () => {
    pick.disabled = !cb.checked;
    widthSel.disabled = !cb.checked;
    updateGlobalControls();
  });

  group.append(lbl, cb, pick, widthSel);
  return group;
}

// ── Collect current UI state ───────────────────────────────────────────────

function collectFolderColors() {
  const folderColors = {};

  document.querySelectorAll(".enable-check").forEach((cb) => {
    const { id, colorType } = cb.dataset;
    if (!folderColors[id]) folderColors[id] = { icon: null, text: null, stroke: null };

    if (!cb.checked) return;

    if (colorType === "stroke") {
      const pick = document.querySelector(`.color-pick[data-id="${id}"][data-color-type="stroke"]`);
      const widthSel = document.querySelector(`.stroke-width-sel[data-id="${id}"]`);
      folderColors[id].stroke = {
        color: pick?.value || "#000000",
        width: parseFloat(widthSel?.value || "1"),
      };
    } else {
      const pick = document.querySelector(`.color-pick[data-id="${id}"][data-color-type="${colorType}"]`);
      if (pick) folderColors[id][colorType] = pick.value;
    }
  });

  // Drop entries where all three are null.
  for (const [id, pair] of Object.entries(folderColors)) {
    if (!pair.icon && !pair.text && !pair.stroke) delete folderColors[id];
  }

  return folderColors;
}

// ── Palette application ────────────────────────────────────────────────────

// Merge palette colors into `stored` for each folder, touching only checked
// channels. Updates DOM pickers in-place. `stored` is mutated directly.
function mergePaletteIntoStored(folders, palette, stored) {
  folders.forEach((folder, i) => {
    const color  = palette.colors[i % palette.colors.length];
    const entry  = { icon: null, text: null, stroke: null, ...(stored[folder.id] || {}) };
    const iconCb = document.querySelector(`.enable-check[data-id="${folder.id}"][data-color-type="icon"]`);
    const textCb = document.querySelector(`.enable-check[data-id="${folder.id}"][data-color-type="text"]`);
    if (iconCb?.checked) {
      entry.icon = color;
      const pick = document.querySelector(`.color-pick[data-id="${folder.id}"][data-color-type="icon"]`);
      if (pick) pick.value = color;
    }
    if (textCb?.checked) {
      entry.text = color;
      const pick = document.querySelector(`.color-pick[data-id="${folder.id}"][data-color-type="text"]`);
      if (pick) pick.value = color;
    }
    if (entry.icon || entry.text || entry.stroke?.color) {
      stored[folder.id] = entry;
    } else {
      delete stored[folder.id];
    }
  });
}

async function applyPalette(palette) {
  if (!folderTree) return;

  const rootFolders = folderTree.children.flatMap((section) =>
    folderChildren(section)
  );
  const allFolders = rootFolders.flatMap((root) => getAllFoldersFlat(root));

  const { folderColors: stored = {} } = await browser.storage.local.get("folderColors");
  mergePaletteIntoStored(allFolders, palette, stored);

  await browser.storage.local.set({ folderColors: stored });
  flashRows(allFolders.map((f) => f.id));
  flash("save-feedback", `Paleta "${palette.name}" aplicada em ${allFolders.length} pasta(s). Clique em Salvar.`, "#2ac3a2");
}

// ── Custom palette modal ───────────────────────────────────────────────────

document.getElementById("create-palette-btn").addEventListener("click", openPaletteModal);
document.getElementById("cancel-palette-modal").addEventListener("click", closePaletteModal);
document.getElementById("add-palette-color").addEventListener("click", () => addPaletteColorInput());
document.getElementById("save-custom-palette").addEventListener("click", saveCustomPalette);

// Close modal when clicking outside the box.
document.getElementById("palette-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closePaletteModal();
});

function openPaletteModal() {
  document.getElementById("new-palette-name").value = "";
  const grid = document.getElementById("new-palette-colors");
  grid.innerHTML = "";
  // Start with 5 color inputs.
  ["#ff6188","#fc9867","#ffd866","#a9dc76","#78dce8"].forEach(addPaletteColorInput);
  document.getElementById("palette-modal").classList.add("open");
}

function closePaletteModal() {
  document.getElementById("palette-modal").classList.remove("open");
}

function addPaletteColorInput(color = "#0060df") {
  const grid = document.getElementById("new-palette-colors");
  const item = document.createElement("div");
  item.className = "palette-color-item";

  const pick = document.createElement("input");
  pick.type = "color";
  pick.value = color;

  const rm = document.createElement("button");
  rm.className = "rm-color";
  rm.textContent = "×";
  rm.title = "Remover cor";
  rm.addEventListener("click", () => item.remove());

  item.append(pick, rm);
  grid.appendChild(item);
}

async function saveCustomPalette() {
  const name = document.getElementById("new-palette-name").value.trim();
  if (!name) { alert("Digite um nome para a paleta."); return; }

  const colors = [
    ...document.querySelectorAll("#new-palette-colors input[type=color]"),
  ].map((p) => p.value);
  if (colors.length === 0) { alert("Adicione pelo menos uma cor."); return; }

  customPalettes.push({ name, colors });
  await browser.storage.local.set({ customPalettes });
  renderPalettes();
  closePaletteModal();
  flash("save-feedback", `Paleta "${name}" criada.`, "#2ac3a2");
}

async function deleteCustomPalette(index) {
  if (!confirm("Remover esta paleta?")) return;
  customPalettes.splice(index, 1);
  await browser.storage.local.set({ customPalettes });
  renderPalettes();
}

// ── Global checkbox handlers ────────────────────────────────────────────────

document.getElementById("global-icon-cb").addEventListener("change", (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.enable-check[data-color-type="icon"]').forEach((cb) => {
    cb.checked = checked;
    const pick = document.querySelector(`.color-pick[data-id="${cb.dataset.id}"][data-color-type="icon"]`);
    if (pick) pick.disabled = !checked;
  });
});

document.getElementById("global-text-cb").addEventListener("change", (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.enable-check[data-color-type="text"]').forEach((cb) => {
    cb.checked = checked;
    const pick = document.querySelector(`.color-pick[data-id="${cb.dataset.id}"][data-color-type="text"]`);
    if (pick) pick.disabled = !checked;
  });
});

document.getElementById("global-stroke-cb").addEventListener("change", (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.enable-check[data-color-type="stroke"]').forEach((cb) => {
    cb.checked = checked;
    const pick = document.querySelector(`.color-pick[data-id="${cb.dataset.id}"][data-color-type="stroke"]`);
    if (pick) pick.disabled = !checked;
    const sel = document.querySelector(`.stroke-width-sel[data-id="${cb.dataset.id}"]`);
    if (sel) sel.disabled = !checked;
  });
});

// ── Save / Reset ───────────────────────────────────────────────────────────

document.getElementById("save-btn").addEventListener("click", async () => {
  const folderColors = collectFolderColors();
  await browser.storage.local.set({ folderColors });
  flash("save-feedback", "Cores salvas.", "#2ac3a2");
});

document.getElementById("reset-btn").addEventListener("click", async () => {
  if (!confirm("Remover todas as cores salvas?")) return;
  await browser.storage.local.set({ folderColors: {} });
  document.querySelectorAll(".enable-check").forEach((cb) => { cb.checked = false; });
  document.querySelectorAll(".color-pick").forEach((p) => { p.disabled = true; p.value = "#0060df"; });
  updateGlobalControls();
  flash("save-feedback", "Cores removidas. Atualize o userChrome.css.", "#e07c3a");
});

// ── Generate CSS ───────────────────────────────────────────────────────────

function folderIconUrl(iconColor, stroke = null) {
  let pathAttrs = `fill='${iconColor || "none"}'`;
  if (stroke?.color) {
    pathAttrs += ` stroke='${stroke.color}' stroke-width='${stroke.width || 1}'`;
  }
  // viewBox extended by 1px on each side so thick strokes don't clip at edges.
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='-1 -1 18 18'>` +
    `<path ${pathAttrs} d='M14 4H8L6 2H2C.9 2 0 2.9 0 4v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function buildCSS(folderColors) {
  const entries = Object.entries(folderColors).filter(
    ([, p]) => p && (p.icon || p.text || p.stroke?.color)
  );
  if (entries.length === 0) return null;

  let css = "/* Colorful Bookmarks - userChrome.css */\n";
  css += "/* Gerado em: " + new Date().toLocaleString("pt-BR") + " */\n\n";

  for (const [guid, { icon, text, stroke }] of entries) {
    const title = titleMap.get(guid);
    if (!title) continue;

    const label = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const needsIconSvg = icon || stroke?.color;

    css += `/* ${title} */\n`;
    css += `#PersonalToolbar toolbarbutton[label="${label}"],\n`;
    css += `#PlacesToolbar toolbarbutton[label="${label}"] {\n`;
    if (text) css += `  color: ${text} !important;\n`;
    if (needsIconSvg) {
      css += `  list-style-image: ${folderIconUrl(icon || "none", stroke)} !important;\n`;
    }
    css += `}\n`;

    if (icon) {
      css += `#PersonalToolbar toolbarbutton[label="${label}"] .toolbarbutton-icon,\n`;
      css += `#PlacesToolbar toolbarbutton[label="${label}"] .toolbarbutton-icon {\n`;
      css += `  -moz-context-properties: fill, fill-opacity;\n`;
      css += `  fill: ${icon} !important;\n`;
      css += `  fill-opacity: 1 !important;\n`;
      css += `}\n`;
    }
    css += "\n";
  }
  return css;
}

function showCSS(css) {
  const out = document.getElementById("css-output");
  out.value = css;
  const sec = document.getElementById("css-section");
  sec.style.display = "block";
  sec.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("generate-btn").addEventListener("click", async () => {
  const { folderColors = {} } = await browser.storage.local.get("folderColors");
  const css = buildCSS(folderColors);
  if (!css) {
    alert("Nenhuma cor salva. Selecione cores e clique em Salvar cores primeiro.");
    return;
  }
  showCSS(css);
});

// ── Copy CSS ───────────────────────────────────────────────────────────────

document.getElementById("copy-btn").addEventListener("click", async () => {
  const css = document.getElementById("css-output").value;
  if (!css.trim()) return;
  try {
    await navigator.clipboard.writeText(css);
    flash("copy-feedback", "CSS copiado! Cole em chrome/userChrome.css e reinicie o Firefox.", "#2ac3a2");
  } catch (e) {
    flash("copy-feedback", "Erro ao copiar: " + e.message, "#e05252");
  }
});

// ── Flash helper ───────────────────────────────────────────────────────────

function flash(id, msg, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = color;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.remove("show"); el.textContent = ""; }, 5000);
}
