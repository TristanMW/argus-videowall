// ─────────────────────────────────────────────────────────────────────────────
// Argus wall engine — a binary space-partition (BSP) video wall.
//
// The layout is a tree of splits (each with two children and one ratio) and
// leaves (each holding a camera). Tiles are absolutely positioned; resizing a
// divider mutates one ratio and re-lays that subtree on every animation frame,
// so neighbours reflow live. iframes are sized via their container only and are
// never re-created or re-sourced during a drag — the video never drops.
//
// Exposes window.Wall.create({ container, urlFor, nameFor, onChange }).
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  const GAP = 6;
  const MIN_W = 160;
  const MIN_H = 90;
  const HANDLE = 8;
  const SNAP_FRACTIONS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
  const SNAP_PX = 12;

  let _uid = 0;
  const uid = () => `n${++_uid}`;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const leaf = (cameraId = null) => ({ id: uid(), type: "leaf", cameraId });

  // Build a right-leaning chain of binary splits so all leaves end up equal.
  function equalSplit(dir, nodes) {
    if (nodes.length === 1) return nodes[0];
    let node = nodes[nodes.length - 1];
    for (let i = nodes.length - 2; i >= 0; i--) {
      const remaining = nodes.length - i;
      node = { id: uid(), type: "split", dir, ratio: 1 / remaining, children: [nodes[i], node] };
    }
    return node;
  }

  // A grid of rows×cols equal cells, filled from cameraIds in order.
  function gridTree(rows, cols, cameraIds) {
    let k = 0;
    const rowNodes = [];
    for (let r = 0; r < rows; r++) {
      const cells = [];
      for (let c = 0; c < cols; c++) cells.push(leaf(cameraIds[k++] ?? null));
      rowNodes.push(equalSplit("row", cells)); // row dir = columns side by side
    }
    return equalSplit("col", rowNodes); // col dir = rows stacked
  }

  const PRESETS = {
    "1": (ids) => gridTree(1, 1, ids),
    "4": (ids) => gridTree(2, 2, ids),
    "6": (ids) => gridTree(2, 3, ids),
    "9": (ids) => gridTree(3, 3, ids),
    "16": (ids) => gridTree(4, 4, ids),
  };

  // Choose a sensible grid for an arbitrary camera count.
  function autoTree(ids) {
    const n = Math.max(1, ids.length);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return gridTree(rows, cols, ids);
  }

  function create(opts) {
    const { container, urlFor, nameFor, onChange } = opts;
    const KEY = opts.storageKey || "argus.layout";

    let root = null;
    let mode = "view";
    const rects = new Map();      // nodeId -> {x,y,w,h}
    const tiles = new Map();      // leafId -> tile element
    const dividers = [];          // {el, nodeId}
    let drag = null;
    let ro = null;

    // ── tree helpers ─────────────────────────────────────────────────────────
    function forEachLeaf(node, fn) {
      if (!node) return;
      if (node.type === "leaf") return fn(node);
      node.children.forEach((c) => forEachLeaf(c, fn));
    }
    function findParent(node, targetId, parent = null) {
      if (!node || node.type === "leaf") return node && node.id === targetId ? parent : null;
      if (node.id === targetId) return parent;
      for (const c of node.children) {
        const r = findParent(c, targetId, node);
        if (r !== null) return r;
      }
      return null;
    }
    function replaceNode(oldId, newNode, node = root, parent = null, idx = -1) {
      if (node.id === oldId) {
        if (!parent) { root = newNode; return; }
        parent.children[idx] = newNode;
        return;
      }
      if (node.type === "split") node.children.forEach((c, i) => replaceNode(oldId, newNode, c, node, i));
    }
    function largestLeaf() {
      let best = null, area = -1;
      forEachLeaf(root, (l) => {
        const r = rects.get(l.id);
        const a = r ? r.w * r.h : 0;
        if (a > area) { area = a; best = l; }
      });
      return best;
    }
    function minAlong(node, dir) {
      if (node.type === "leaf") return dir === "row" ? MIN_W : MIN_H;
      if (node.dir === dir) return minAlong(node.children[0], dir) + GAP + minAlong(node.children[1], dir);
      return Math.max(minAlong(node.children[0], dir), minAlong(node.children[1], dir));
    }

    // ── layout ────────────────────────────────────────────────────────────────
    function layoutNode(node, rect) {
      rects.set(node.id, rect);
      if (node.type === "leaf") {
        const el = tiles.get(node.id);
        if (el) {
          el.style.transform = `translate(${rect.x}px,${rect.y}px)`;
          el.style.width = rect.w + "px";
          el.style.height = rect.h + "px";
        }
        return;
      }
      if (node.dir === "row") {
        const wA = Math.round((rect.w - GAP) * node.ratio);
        const wB = rect.w - GAP - wA;
        layoutNode(node.children[0], { x: rect.x, y: rect.y, w: wA, h: rect.h });
        layoutNode(node.children[1], { x: rect.x + wA + GAP, y: rect.y, w: wB, h: rect.h });
      } else {
        const hA = Math.round((rect.h - GAP) * node.ratio);
        const hB = rect.h - GAP - hA;
        layoutNode(node.children[0], { x: rect.x, y: rect.y, w: rect.w, h: hA });
        layoutNode(node.children[1], { x: rect.x, y: rect.y + hA + GAP, w: rect.w, h: hB });
      }
    }
    function wallRect() {
      return { x: 0, y: 0, w: container.clientWidth, h: container.clientHeight };
    }
    function fullLayout() {
      if (root) layoutNode(root, wallRect());
      positionDividers();
    }

    // ── DOM (tiles) ────────────────────────────────────────────────────────────
    function makeTile(node) {
      const el = document.createElement("div");
      el.className = "tile";
      el.dataset.leaf = node.id;

      const frame = document.createElement("iframe");
      frame.className = "player";
      frame.allow = "autoplay; fullscreen";
      frame.setAttribute("allowfullscreen", "");

      const chrome = document.createElement("div");
      chrome.className = "tile-chrome";

      el.append(frame, chrome);
      container.appendChild(el);
      tiles.set(node.id, el);
      paintTile(node);
      return el;
    }
    function paintTile(node) {
      const el = tiles.get(node.id);
      if (!el) return;
      const frame = el.querySelector("iframe");
      const chrome = el.querySelector(".tile-chrome");
      if (node.cameraId) {
        const want = urlFor(node.cameraId);
        if (frame.dataset.src !== want) { frame.dataset.src = want; frame.src = want; }
        el.classList.remove("tile--empty");
        chrome.innerHTML = `
          <span class="tile-live">LIVE</span>
          <span class="tile-label">${escapeHtml(nameFor(node.cameraId))}</span>
          <button class="tile-x" title="Remove" aria-label="Remove">✕</button>`;
      } else {
        frame.removeAttribute("src"); frame.dataset.src = "";
        el.classList.add("tile--empty");
        chrome.innerHTML = `<span class="tile-empty">Empty slot<br><small>pick a camera</small></span>
          <button class="tile-x" title="Remove" aria-label="Remove">✕</button>`;
      }
      chrome.querySelector(".tile-x").addEventListener("click", (e) => {
        e.stopPropagation();
        removeLeaf(node.id);
      });
      el.onclick = () => {
        if (mode === "edit") selectLeaf(node.id);
      };
    }
    function reconcileTiles() {
      const live = new Set();
      forEachLeaf(root, (l) => {
        live.add(l.id);
        if (!tiles.has(l.id)) makeTile(l);
        else paintTile(l);
      });
      for (const [id, el] of [...tiles]) {
        if (!live.has(id)) { el.remove(); tiles.delete(id); }
      }
    }

    // ── DOM (dividers, edit mode) ───────────────────────────────────────────────
    function clearDividers() {
      dividers.forEach((d) => d.el.remove());
      dividers.length = 0;
    }
    function buildDividers() {
      clearDividers();
      if (mode !== "edit") return;
      (function walk(node) {
        if (!node || node.type === "leaf") return;
        const el = document.createElement("div");
        el.className = "divider";
        el.dataset.node = node.id;
        el.dataset.dir = node.dir;
        el.addEventListener("pointerdown", (e) => onDown(e, node, el));
        container.appendChild(el);
        dividers.push({ el, nodeId: node.id });
        node.children.forEach(walk);
      })(root);
      positionDividers();
    }
    function positionDividers() {
      for (const d of dividers) {
        const node = nodeById(d.nodeId);
        const r = rects.get(d.nodeId);
        if (!node || !r) continue;
        if (node.dir === "row") {
          const wA = Math.round((r.w - GAP) * node.ratio);
          d.el.style.transform = `translate(${r.x + wA + (GAP - HANDLE) / 2}px,${r.y}px)`;
          d.el.style.width = HANDLE + "px";
          d.el.style.height = r.h + "px";
        } else {
          const hA = Math.round((r.h - GAP) * node.ratio);
          d.el.style.transform = `translate(${r.x}px,${r.y + hA + (GAP - HANDLE) / 2}px)`;
          d.el.style.width = r.w + "px";
          d.el.style.height = HANDLE + "px";
        }
      }
    }
    function nodeById(id, node = root) {
      if (!node) return null;
      if (node.id === id) return node;
      if (node.type === "leaf") return null;
      for (const c of node.children) { const r = nodeById(id, c); if (r) return r; }
      return null;
    }

    // ── resize interaction ──────────────────────────────────────────────────────
    function onDown(e, node, el) {
      if (mode !== "edit") return;
      e.preventDefault();
      const r = rects.get(node.id);
      const usable = (node.dir === "row" ? r.w : r.h) - GAP;
      const minA = minAlong(node.children[0], node.dir);
      const minB = minAlong(node.children[1], node.dir);
      drag = {
        node, el, usable,
        ratioMin: minA / usable,
        ratioMax: 1 - minB / usable,
        startPos: node.dir === "row" ? e.clientX : e.clientY,
        startRatio: node.ratio,
        pos: node.dir === "row" ? e.clientX : e.clientY,
        raf: false,
      };
      el.setPointerCapture(e.pointerId);
      el.classList.add("active");
      container.classList.add("dragging");
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    }
    function onMove(e) {
      if (!drag || drag.cancelled) return;
      drag.pos = drag.node.dir === "row" ? e.clientX : e.clientY;
      if (!drag.raf) { drag.raf = true; requestAnimationFrame(applyDrag); }
    }
    function applyDrag() {
      if (!drag || drag.cancelled) return;
      drag.raf = false;
      let ratio = drag.startRatio + (drag.pos - drag.startPos) / drag.usable;
      ratio = clamp(ratio, drag.ratioMin, drag.ratioMax);
      ratio = snap(ratio, drag.usable, drag.ratioMin, drag.ratioMax);
      drag.node.ratio = ratio;
      layoutNode(drag.node, rects.get(drag.node.id));
      positionDividers();
    }
    function snap(ratio, usable, lo, hi) {
      for (const f of SNAP_FRACTIONS) if (Math.abs(ratio - f) * usable < SNAP_PX) return clamp(f, lo, hi);
      const px = Math.round((ratio * usable) / 8) * 8;
      return clamp(px / usable, lo, hi);
    }
    function onUp(e) {
      if (!drag) return;
      const el = drag.el;
      const cancelled = drag.cancelled;
      try { el.releasePointerCapture(e.pointerId); } catch {}
      el.classList.remove("active");
      container.classList.remove("dragging");
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      drag = null;
      if (!cancelled) save();
    }

    // ── mutations ───────────────────────────────────────────────────────────────
    function assignToLeaf(leafId, cameraId) {
      const n = nodeById(leafId);
      if (!n || n.type !== "leaf") return;
      n.cameraId = cameraId;
      paintTile(n);
      save();
    }
    function addCamera(cameraId) {
      // fill an empty slot if there is one, else split the largest leaf
      let empty = null;
      forEachLeaf(root, (l) => { if (!empty && !l.cameraId) empty = l; });
      if (empty) { assignToLeaf(empty.id, cameraId); return; }
      const target = largestLeaf();
      if (!target) { root = leaf(cameraId); rebuild(); return; }
      const r = rects.get(target.id) || { w: 2, h: 1 };
      const dir = r.w >= r.h ? "row" : "col";
      const fresh = leaf(cameraId);
      // Reuse `target` as the first child so its live stream isn't reloaded.
      replaceNode(target.id, { id: uid(), type: "split", dir, ratio: 0.5, children: [target, fresh] });
      rebuild();
    }
    function removeLeaf(leafId) {
      const parent = findParent(root, leafId);
      if (!parent) { // last tile → empty it
        const n = nodeById(leafId); if (n) { n.cameraId = null; paintTile(n); save(); }
        return;
      }
      const sibling = parent.children[0].id === leafId ? parent.children[1] : parent.children[0];
      replaceNode(parent.id, sibling);
      rebuild();
    }
    function selectLeaf(leafId) {
      tiles.forEach((el, id) => el.classList.toggle("tile--selected", id === leafId));
      if (onChange) onChange({ selected: leafId });
    }

    // ── public rebuild/render ───────────────────────────────────────────────────
    function rebuild() {
      reconcileTiles();
      buildDividers();
      fullLayout();
      save();
    }

    // ── persistence ─────────────────────────────────────────────────────────────
    function serialize(node) {
      if (node.type === "leaf") return { id: node.id, type: "leaf", cameraId: node.cameraId };
      return { id: node.id, type: "split", dir: node.dir, ratio: node.ratio, children: node.children.map(serialize) };
    }
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify({ v: 1, root: serialize(root) })); } catch {}
      if (onChange) onChange({});
    }
    function loadSaved() {
      try {
        const d = JSON.parse(localStorage.getItem(KEY));
        if (d && d.root) return d.root;
      } catch {}
      return null;
    }

    // After restoring a saved tree, advance the uid counter past every id in it
    // so freshly created nodes can never collide with restored ones.
    function absorbIds(node, m = 0) {
      const n = parseInt(String(node.id).replace(/^n/, ""), 10);
      if (!isNaN(n)) m = Math.max(m, n);
      if (node.type === "split") node.children.forEach((c) => { m = absorbIds(c, m); });
      return m;
    }

    // Reconcile a loaded/served camera set against the current tree.
    function setCameras(cameras) {
      const ids = cameras.map((c) => c.id);
      const known = new Set(ids);
      if (!root) { root = loadSaved(); if (root) _uid = Math.max(_uid, absorbIds(root)); }
      if (!root) { root = autoTree(ids); rebuild(); return; }
      // drop leaves whose camera vanished
      forEachLeaf(root, (l) => { if (l.cameraId && !known.has(l.cameraId)) l.cameraId = null; });
      rebuild();
    }

    function applyPreset(name) {
      const assigned = [];
      forEachLeaf(root, (l) => { if (l.cameraId) assigned.push(l.cameraId); });
      const builder = PRESETS[name] || autoTree;
      root = builder(assigned);
      rebuild();
    }
    function setMode(m) {
      mode = m;
      container.dataset.mode = m;
      buildDividers();
      fullLayout();
    }
    function refreshStreams() {
      forEachLeaf(root, (l) => paintTile(l));
    }
    function currentCameraIds() {
      const out = [];
      forEachLeaf(root, (l) => { if (l.cameraId) out.push(l.cameraId); });
      return out;
    }

    // ── boot ────────────────────────────────────────────────────────────────────
    container.dataset.mode = mode;
    ro = new ResizeObserver(() => fullLayout());
    ro.observe(container);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drag && !drag.cancelled) {
        drag.cancelled = true;
        drag.node.ratio = drag.startRatio;
        layoutNode(drag.node, rects.get(drag.node.id));
        positionDividers();
      }
    });

    return {
      setCameras, applyPreset, setMode, addCamera, removeLeaf, assignToLeaf,
      refreshStreams, currentCameraIds, getMode: () => mode,
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.Wall = { create };
})();
