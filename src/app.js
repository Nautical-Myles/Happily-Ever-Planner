/* 
 Copyright (C) 2026 Nautical-Myles
 Use of this software is govered by the Business Source License included in the LICENSE.md file and at www.mariadb.com/bsl11.
 Change Date: 1 January 2028
 On the date above, in accordance with the Business Source License, use of this software will be governed by the open source license specified in the LICENSE.md file.
*/

// Version 0.3.7
    
    // =========================================================================
    // PHASE 1: CORE ENGINE, SHARED GLOBAL STATE (window.APP) & TERRITORY MAP
    // =========================================================================
    window.APP = {
      GRID_SIZE: 95,
      TERR_SIZE: 19,
      TILE_PX: 28,
      camera: { x: 0, y: 0, zoom: 1.0 },
      territories: [],
      terrain: [],
      deposits: new Map(),
      buildings: new Map(),
      buildingGrid: [],
      roadGrid: [],
      settings: {
        freePlacement: false,
        overlays: {
          desirability: false,
          waterSewer: false,
          workArea: false
        }
      },
      activeTool: {
        mode: 'pan',
        itemId: null,
        rot: 0,
        activeHubId: null
      },

      // Runtime interaction state & extensible hooks for Phases 2-5
      mouse: {
        sx: 0, sy: 0,
        wx: 0, wy: 0,
        tx: -1, ty: -1,
        terrX: -1, terrY: -1,
        inBounds: false,
        isDown: false,
        isPanning: false,
        button: 0,
        shiftKey: false,
        dragStartTx: -1,
        dragStartTy: -1,
        panStartX: 0,
        panStartY: 0,
        camStartX: 0,
        camStartY: 0
      },
      spacePressed: false,
      nextId: 1,
      hooks: {
        onMouseDown: [],
        onMouseMove: [],
        onMouseUp: [],
        onKeyDown: [],
        onToolChange: [],
        onStateChanged: [],
        onWipeCanvas: []
      }
    };

    const mainCanvas = document.getElementById('main-canvas');
    const mainCtx = mainCanvas.getContext('2d');
    const miniCanvas = document.getElementById('minimap-canvas');
    const miniCtx = miniCanvas.getContext('2d');
    const tooltipEl = document.getElementById('hover-tooltip');

    APP.isStorybookMap = function () {
      return document.body.classList.contains('storybook-map');
    };

    APP.getCanvasTextFontFamily = function () {
      return APP.isStorybookMap()
        ? getComputedStyle(document.body).getPropertyValue('--font-story-body').trim()
        : '"Segoe UI", sans-serif';
    };

    // Terrain Color Palette Lookup (Shared across Phase 1 & Phase 2)
   APP.TERRAIN_COLORS = {
      grass:       '#496b38',
      grassAlt:    '#456634',
      hill_top:    '#5a7542',
      shoreline:   '#7d7456',
      river:       '#2f6d8f',
      lake:        '#1f4e6b',
      shoal:       '#3d8ca8',
      hill:        '#5c5248',
      tree:        '#2d4c22',
      small_stone: '#a0a0a0',
      large_stone: '#5c5c5c',
      iron:        '#8c533e',
      mystic:      '#7d4294',
      encounter:   '#2b5078',
      ruin:        '#9c8754'
    };

 APP.TERRAIN_NAMES = {
      grass:       'Grassland',
      hill_top:    'Hilltop / Plateau (Buildable)',
      shoreline:   'Shoreline (Too Close to Water)',
      river:       'River (Water)',
      lake:        'Lake / Deep Water',
      shoal:       'Fish Shoal',
      hill:        'Hill / Cliff (Unbuildable)',
      tree:        'Forest / Trees',
      small_stone: 'Small Stone Deposit (2×2)',
      large_stone: 'Large Stone Deposit (2×2)',
      iron:        'Iron Deposit (2×2)',
      mystic:      'Prismatic Liquid Deposit (2×2)',
      encounter: 'Encounter',
      ruin:        'Ruin (2×2)'
    };

    // Initialize or Reset the 95x95 Two-Layer State and 5x5 Territories
    APP.initGridState = function () {
      APP.territories = [];
      for (let ty = 0; ty < 5; ty++) {
        const row = [];
        for (let tx = 0; tx < 5; tx++) {
          // Only center territory [2][2] (Row 3, Col 3) starts Active
          row.push(ty === 2 && tx === 2);
        }
        APP.territories.push(row);
      }

      APP.terrain = [];
      APP.buildingGrid = [];
      APP.roadGrid = [];
      for (let y = 0; y < APP.GRID_SIZE; y++) {
        const tRow = [];
        const bRow = [];
        const rRow = [];
        for (let x = 0; x < APP.GRID_SIZE; x++) {
          tRow.push({ type: 'grass', depositId: null });
          bRow.push(null);
          rRow.push(null);
        }
        APP.terrain.push(tRow);
        APP.buildingGrid.push(bRow);
        APP.roadGrid.push(rRow);
      }

     APP.deposits.clear();
      APP.buildings.clear();
      APP.nextId = 1;
      APP.activeTool.activeHubId = null;
      APP.updateActiveHubBanner();
      APP.updateMinimapCounter();
    };

    // Coordinate & Bounds Helpers
    APP.inBounds = function (tx, ty) {
      return tx >= 0 && tx < APP.GRID_SIZE && ty >= 0 && ty < APP.GRID_SIZE;
    };

    APP.isTerritoryActive = function (tx, ty) {
      if (!APP.inBounds(tx, ty)) return false;
      const terrX = Math.floor(tx / APP.TERR_SIZE);
      const terrY = Math.floor(ty / APP.TERR_SIZE);
      return !!(APP.territories[terrY] && APP.territories[terrY][terrX]);
    };

    APP.screenToWorld = function (sx, sy) {
      const wx = (sx - APP.camera.x) / APP.camera.zoom;
      const wy = (sy - APP.camera.y) / APP.camera.zoom;
      const tx = Math.floor(wx / APP.TILE_PX);
      const ty = Math.floor(wy / APP.TILE_PX);
      const inBounds = APP.inBounds(tx, ty);
      const terrX = inBounds ? Math.floor(tx / APP.TERR_SIZE) : -1;
      const terrY = inBounds ? Math.floor(ty / APP.TERR_SIZE) : -1;
      return { wx, wy, tx, ty, terrX, terrY, inBounds };
    };

    APP.worldToScreen = function (wx, wy) {
      return {
        sx: wx * APP.camera.zoom + APP.camera.x,
        sy: wy * APP.camera.zoom + APP.camera.y
      };
    };

    APP.centerOnTerritory = function (terrX, terrY, targetZoom) {
      if (typeof targetZoom === 'number') {
        APP.camera.zoom = Math.max(0.25, Math.min(2.5, targetZoom));
      }
      const centerTileX = (terrX + 0.5) * APP.TERR_SIZE;
      const centerTileY = (terrY + 0.5) * APP.TERR_SIZE;
      const worldCenterX = centerTileX * APP.TILE_PX;
      const worldCenterY = centerTileY * APP.TILE_PX;
      APP.camera.x = mainCanvas.width / 2 - worldCenterX * APP.camera.zoom;
      APP.camera.y = mainCanvas.height / 2 - worldCenterY * APP.camera.zoom;
      APP.requestRender();
    };

    APP.notifyStateChanged = function () {
      for (const fn of APP.hooks.onStateChanged) {
        fn();
      }
      APP.requestRender();
    };

    APP.updateActiveHubBanner = function () {
      const banner = document.getElementById('active-hub-banner');
      const label = document.getElementById('active-hub-label');
      if (APP.activeTool.activeHubId && APP.buildings.has(APP.activeTool.activeHubId)) {
        const hub = APP.buildings.get(APP.activeTool.activeHubId);
        label.textContent = `Editing Hub #${hub.id} (${hub.defId})`;
        banner.classList.add('visible');
      } else {
        banner.classList.remove('visible');
      }
    };

    APP.updateMinimapCounter = function () {
      let count = 0;
      for (let ty = 0; ty < 5; ty++) {
        for (let tx = 0; tx < 5; tx++) {
          if (APP.territories[ty][tx]) count++;
        }
      }
      const el = document.getElementById('minimap-active-count');
      if (el) el.textContent = `${count}/25`;
    };

    // Tooltip Helper
    APP.showTooltip = function (htmlContent, clientX, clientY) {
      if (!htmlContent) {
        tooltipEl.style.display = 'none';
        return;
      }
      tooltipEl.innerHTML = htmlContent;
      tooltipEl.style.display = 'block';
      const pad = 16;
      let left = clientX + pad;
      let top = clientY + pad;
      const rect = tooltipEl.getBoundingClientRect();
      if (left + rect.width > window.innerWidth - 10) {
        left = clientX - rect.width - pad;
      }
      if (top + rect.height > window.innerHeight - 10) {
        top = clientY - rect.height - pad;
      }
      tooltipEl.style.left = `${Math.max(8, left)}px`;
      tooltipEl.style.top = `${Math.max(8, top)}px`;
    };

    APP.hideTooltip = function () {
      tooltipEl.style.display = 'none';
    };

    // =========================================================================
    // 5 SEQUENTIAL RENDER HOOKS CALLED INSIDE APP.render(ctx)
    // =========================================================================

    // 1. Base Grid & Layer 1 Terrain
    function drawBaseGridAndTerrain(ctx) {
      const S = APP.TILE_PX;
      const G = APP.GRID_SIZE;

      // Calculate visible tile bounds for fast culling
      const topLeft = APP.screenToWorld(0, 0);
      const botRight = APP.screenToWorld(mainCanvas.width, mainCanvas.height);
      const startX = Math.max(0, topLeft.tx - 1);
      const startY = Math.max(0, topLeft.ty - 1);
      const endX = Math.min(G - 1, botRight.tx + 1);
      const endY = Math.min(G - 1, botRight.ty + 1);

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          const cell = APP.terrain[y][x];
          const px = x * S;
          const py = y * S;

          if (cell.type === 'grass') {
            ctx.fillStyle = (x + y) % 2 === 0 ? APP.TERRAIN_COLORS.grass : APP.TERRAIN_COLORS.grassAlt;
            ctx.fillRect(px, py, S, S);
          } else {
            ctx.fillStyle = APP.TERRAIN_COLORS[cell.type] || APP.TERRAIN_COLORS.grass;
            ctx.fillRect(px, py, S, S);

            // Subtle visual markers for special terrain types
            if (cell.type === 'tree') {
              ctx.fillStyle = '#496b38';
              ctx.fillRect(px, py, S, S);
              ctx.fillStyle = '#26451b';
              ctx.beginPath();
              ctx.arc(px + S * 0.5, py + S * 0.5, S * 0.34, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#386329';
              ctx.beginPath();
              ctx.arc(px + S * 0.44, py + S * 0.44, S * 0.22, 0, Math.PI * 2);
              ctx.fill();
            } else if (cell.type === 'shoal') {
              ctx.fillStyle = '#2f6d8f';
              ctx.fillRect(px, py, S, S);
              ctx.strokeStyle = '#8ee3ff';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(px + S * 0.5, py + S * 0.5, S * 0.28, 0, Math.PI * 1.4);
              ctx.stroke();
            } else if (cell.type === 'hill') {
              ctx.strokeStyle = '#3d352e';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(px + 4, py + S - 5);
              ctx.lineTo(px + S * 0.5, py + 5);
              ctx.lineTo(px + S - 4, py + S - 5);
              ctx.stroke();
            }
          }
        }
      }

      if (APP.isStorybookMap()) {
        ctx.fillStyle = 'rgba(235, 218, 184, 0.055)';
        ctx.fillRect(startX * S, startY * S, (endX - startX + 1) * S, (endY - startY + 1) * S);
      }

      // Draw multi-tile deposit outlines if any exist
      if (APP.deposits.size > 0) {
        for (const dep of APP.deposits.values()) {
          const dx = dep.x * S;
          const dy = dep.y * S;
          const dw = dep.w * S;
          const dh = dep.h * S;
          ctx.strokeStyle = 'rgba(255, 235, 190, 0.55)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(dx + 1, dy + 1, dw - 2, dh - 2);
        }
      }

      // Draw subtle tile grid lines when zoomed in enough
      if (APP.camera.zoom >= 0.45) {
        ctx.strokeStyle = APP.isStorybookMap()
          ? 'rgba(74, 52, 31, 0.28)'
          : 'rgba(0, 0, 0, 0.18)';
        ctx.lineWidth = 1 / APP.camera.zoom;
        ctx.beginPath();
        for (let x = startX; x <= endX + 1; x++) {
          ctx.moveTo(x * S, startY * S);
          ctx.lineTo(x * S, (endY + 1) * S);
        }
        for (let y = startY; y <= endY + 1; y++) {
          ctx.moveTo(startX * S, y * S);
          ctx.lineTo((endX + 1) * S, y * S);
        }
        ctx.stroke();
      }

      if (typeof APP.onDrawBaseGridAndTerrain === 'function') {
        APP.onDrawBaseGridAndTerrain(ctx, { startX, startY, endX, endY });
      }
    }

    // 2. Layer 2 Buildings & Roads
    function drawBuildingsAndRoads(ctx) {
      if (typeof APP.onDrawBuildingsAndRoads === 'function') {
        APP.onDrawBuildingsAndRoads(ctx);
        return;
      }

      const S = APP.TILE_PX;
      // Default fallback renderer for roads & buildings prior to Phase 3
      for (let y = 0; y < APP.GRID_SIZE; y++) {
        for (let x = 0; x < APP.GRID_SIZE; x++) {
          const r = APP.roadGrid[y][x];
          if (r) {
            ctx.fillStyle = r === 'bridge' ? '#7a5835' : '#8c7a61';
            ctx.fillRect(x * S + 2, y * S + 2, S - 4, S - 4);
          }
        }
      }

      for (const b of APP.buildings.values()) {
        ctx.fillStyle = '#6e4e32';
        ctx.fillRect(b.x * S, b.y * S, b.w * S, b.h * S);
        ctx.strokeStyle = '#e0b86c';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x * S + 1, b.y * S + 1, b.w * S - 2, b.h * S - 2);
      }
    }

    // 3. Advisory Overlays & Rule Violation Warnings
    function drawOverlaysAndWarnings(ctx) {
      if (typeof APP.onDrawOverlaysAndWarnings === 'function') {
        APP.onDrawOverlaysAndWarnings(ctx);
      }
    }

    // 4. Translucent Parchment Fog on Unbought Territories & 19x19 Borders
    function drawParchmentFogAndBorders(ctx) {
      const S = APP.TILE_PX;
      const T = APP.TERR_SIZE;
      const terrPx = T * S;
      const totalPx = APP.GRID_SIZE * S;

      // Render subtle translucent parchment fog over Unbought territories (NO diagonal hatching)
      for (let ty = 0; ty < 5; ty++) {
        for (let tx = 0; tx < 5; tx++) {
          const px = tx * terrPx;
          const py = ty * terrPx;
          const isActive = APP.territories[ty][tx];

          if (!isActive) {
            // Smooth aged-parchment translucent veil
            ctx.fillStyle = 'rgba(214, 193, 152, 0.42)';
            ctx.fillRect(px, py, terrPx, terrPx);

            // Soft inner vignette border
            ctx.strokeStyle = 'rgba(92, 71, 42, 0.45)';
            ctx.lineWidth = 2 / APP.camera.zoom;
            ctx.strokeRect(px + 2, py + 2, terrPx - 4, terrPx - 4);

            // Territory coordinate badge in center of unbought territory
            if (APP.camera.zoom >= 0.32) {
              ctx.save();
              ctx.fillStyle = 'rgba(56, 41, 24, 0.72)';
              ctx.font = `bold ${Math.round(14 / Math.max(0.5, Math.min(1.2, APP.camera.zoom)))}px Georgia, serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`Territory (${ty + 1}, ${tx + 1})`, px + terrPx / 2, py + terrPx / 2 - 8);
              ctx.font = `${Math.round(11 / Math.max(0.5, Math.min(1.2, APP.camera.zoom)))}px ${APP.getCanvasTextFontFamily()}`;
              ctx.fillStyle = 'rgba(74, 55, 33, 0.65)';
              ctx.fillText('Unbought Land', px + terrPx / 2, py + terrPx / 2 + 10);
              ctx.restore();
            }
          }
        }
      }

      // Draw crisp territory boundary lines
      ctx.save();
      ctx.strokeStyle = APP.isStorybookMap()
        ? 'rgba(126, 91, 52, 0.52)'
        : 'rgba(222, 179, 98, 0.65)';
      ctx.lineWidth = 2 / APP.camera.zoom;
      ctx.setLineDash([8 / APP.camera.zoom, 5 / APP.camera.zoom]);
      ctx.beginPath();
      for (let i = 1; i < 5; i++) {
        const pos = i * terrPx;
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, totalPx);
        ctx.moveTo(0, pos);
        ctx.lineTo(totalPx, pos);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Outer Kingdom Map Border
      ctx.strokeStyle = APP.isStorybookMap() ? '#a9824c' : '#cfa358';
      ctx.lineWidth = 4 / APP.camera.zoom;
      ctx.strokeRect(0, 0, totalPx, totalPx);
      ctx.restore();

      // Define the clean territory fog and borders
      APP.onDrawParchmentFogAndBorders = function (ctx) {
        const S = APP.TILE_PX;
        const T = APP.TERR_SIZE;
        const terrPx = T * S;

        // Draw solid translucent fog over unbought territories (No hatching)
        ctx.fillStyle = APP.isStorybookMap()
          ? 'rgba(220, 202, 166, 0.66)'
          : 'rgba(20, 16, 12, 0.65)';
        for (let ty = 0; ty < 5; ty++) {
          for (let tx = 0; tx < 5; tx++) {
            if (!APP.territories[ty][tx]) {
              const px = tx * terrPx;
              const py = ty * terrPx;
              ctx.fillRect(px, py, terrPx, terrPx);
            }
          }
        }

        // Draw warm gold border ONLY along outermost perimeter of contiguous active territories
        ctx.save();
        ctx.strokeStyle = APP.isStorybookMap() ? '#b18a50' : '#f0c265';
        ctx.lineWidth = 2.5 / APP.camera.zoom;
        ctx.beginPath();
        for (let ty = 0; ty < 5; ty++) {
          for (let tx = 0; tx < 5; tx++) {
            if (!APP.territories[ty][tx]) continue;
            const px = tx * terrPx;
            const py = ty * terrPx;

            // North edge: draw only if on outer map boundary or North neighbor is unbought
            if (ty === 0 || !APP.territories[ty - 1][tx]) {
              ctx.moveTo(px, py);
              ctx.lineTo(px + terrPx, py);
            }
            // South edge: draw only if on outer map boundary or South neighbor is unbought
            if (ty === 4 || !APP.territories[ty + 1][tx]) {
              ctx.moveTo(px, py + terrPx);
              ctx.lineTo(px + terrPx, py + terrPx);
            }
            // West edge: draw only if on outer map boundary or West neighbor is unbought
            if (tx === 0 || !APP.territories[ty][tx - 1]) {
              ctx.moveTo(px, py);
              ctx.lineTo(px, py + terrPx);
            }
            // East edge: draw only if on outer map boundary or East neighbor is unbought
            if (tx === 4 || !APP.territories[ty][tx + 1]) {
              ctx.moveTo(px + terrPx, py);
              ctx.lineTo(px + terrPx, py + terrPx);
            }
          }
        }
        ctx.stroke();
        ctx.restore();
      };

      // Execute it
      if (typeof APP.onDrawParchmentFogAndBorders === 'function') {
        APP.onDrawParchmentFogAndBorders(ctx);
      }
    }
    // 5. Hovered Tile Cursor, Selection Box & Placement Ghost
    function drawSelectionAndGhost(ctx) {
      if (typeof APP.onDrawSelectionAndGhost === 'function') {
        APP.onDrawSelectionAndGhost(ctx);
        return;
      }

      // Default Phase 1 hovered tile outline
      if (APP.mouse.inBounds) {
        const S = APP.TILE_PX;
        const hx = APP.mouse.tx * S;
        const hy = APP.mouse.ty * S;
        ctx.save();
        ctx.strokeStyle = '#ffe394';
        ctx.lineWidth = 2 / APP.camera.zoom;
        ctx.strokeRect(hx + 1, hy + 1, S - 2, S - 2);
        ctx.fillStyle = 'rgba(255, 227, 148, 0.14)';
        ctx.fillRect(hx, hy, S, S);
        ctx.restore();
      }
    }

    // Master Render Loop
    let renderPending = false;
    APP.requestRender = function () {
      if (!renderPending) {
        renderPending = true;
        requestAnimationFrame(() => {
          renderPending = false;
          APP.render(mainCtx);
        });
      }
    };

    APP.render = function (ctx) {
      ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

      if (APP.isStorybookMap()) {
        const paper = ctx.createLinearGradient(0, 0, mainCanvas.width, mainCanvas.height);
        paper.addColorStop(0, '#c5b087');
        paper.addColorStop(0.48, '#b7a074');
        paper.addColorStop(1, '#ceb98e');
        ctx.fillStyle = paper;
        ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

        const wash = ctx.createRadialGradient(
          mainCanvas.width * 0.32, mainCanvas.height * 0.28, 0,
          mainCanvas.width * 0.32, mainCanvas.height * 0.28, Math.max(mainCanvas.width, mainCanvas.height) * 0.78
        );
        wash.addColorStop(0, 'rgba(235, 220, 184, 0.22)');
        wash.addColorStop(1, 'rgba(104, 75, 43, 0.08)');
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

        ctx.save();
        ctx.strokeStyle = 'rgba(91, 65, 38, 0.045)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 36; i++) {
          const x = (i * 97 + 31) % Math.max(1, mainCanvas.width);
          const y = (i * 59 + 17) % Math.max(1, mainCanvas.height);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(Math.min(mainCanvas.width, x + 12 + (i % 17)), y + ((i % 3) - 1));
          ctx.stroke();
        }
        ctx.restore();
      } else {
        // Deep background behind the 95x95 board
        ctx.fillStyle = '#110d0a';
        ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
      }

      ctx.save();
      ctx.translate(APP.camera.x, APP.camera.y);
      ctx.scale(APP.camera.zoom, APP.camera.zoom);

      // Required 5 render hooks in exact order
      drawBaseGridAndTerrain(ctx);
      drawBuildingsAndRoads(ctx);
      drawOverlaysAndWarnings(ctx);
      drawParchmentFogAndBorders(ctx);
      drawSelectionAndGhost(ctx);

      ctx.restore();

      APP.renderMinimap();
      APP.updateStatusBar();
    };

    // =========================================================================
    // 5x5 TERRITORY MINIMAP RENDERER & INTERACTION
    // =========================================================================
    APP.renderMinimap = function () {
      const W = miniCanvas.width;
      const H = miniCanvas.height;
      const cellPx = W / 5;
      const tileScale = W / APP.GRID_SIZE;

      miniCtx.clearRect(0, 0, W, H);

      // 1. Draw territory backgrounds (Active vs. Unbought parchment)
      for (let ty = 0; ty < 5; ty++) {
        for (let tx = 0; tx < 5; tx++) {
          const isActive = APP.territories[ty][tx];
          miniCtx.fillStyle = isActive ? '#3f5e30' : '#7d6e54';
          miniCtx.fillRect(tx * cellPx, ty * cellPx, cellPx, cellPx);
        }
      }

      // 2. Draw non-grass terrain & buildings overview on minimap
      for (let y = 0; y < APP.GRID_SIZE; y++) {
        for (let x = 0; x < APP.GRID_SIZE; x++) {
          const tType = APP.terrain[y][x].type;
          if (tType !== 'grass') {
            miniCtx.fillStyle = APP.TERRAIN_COLORS[tType] || '#496b38';
            miniCtx.fillRect(x * tileScale, y * tileScale, Math.ceil(tileScale), Math.ceil(tileScale));
          }
          if (APP.roadGrid[y][x]) {
            miniCtx.fillStyle = '#b8a486';
            miniCtx.fillRect(x * tileScale, y * tileScale, Math.ceil(tileScale), Math.ceil(tileScale));
          }
        }
      }

      for (const b of APP.buildings.values()) {
        miniCtx.fillStyle = '#f0a843';
        miniCtx.fillRect(b.x * tileScale, b.y * tileScale, Math.max(2, b.w * tileScale), Math.max(2, b.h * tileScale));
      }

      // 3. Re-apply subtle parchment fog on unbought territories on minimap
      for (let ty = 0; ty < 5; ty++) {
        for (let tx = 0; tx < 5; tx++) {
          if (!APP.territories[ty][tx]) {
            miniCtx.fillStyle = 'rgba(214, 193, 152, 0.38)';
            miniCtx.fillRect(tx * cellPx, ty * cellPx, cellPx, cellPx);
          }
        }
      }

      // 4. Draw 5x5 Territory Grid Lines & Active Borders
      for (let ty = 0; ty < 5; ty++) {
        for (let tx = 0; tx < 5; tx++) {
          const isActive = APP.territories[ty][tx];
          miniCtx.strokeStyle = isActive ? '#f0c265' : 'rgba(40, 30, 20, 0.65)';
          miniCtx.lineWidth = isActive ? 1.5 : 1;
          miniCtx.strokeRect(tx * cellPx + 0.5, ty * cellPx + 0.5, cellPx - 1, cellPx - 1);
        }
      }

      // 5. Draw Current Camera Viewport Box
      const totalWorldPx = APP.GRID_SIZE * APP.TILE_PX;
      const topLeft = APP.screenToWorld(0, 0);
      const botRight = APP.screenToWorld(mainCanvas.width, mainCanvas.height);

      const vx = (topLeft.wx / totalWorldPx) * W;
      const vy = (topLeft.wy / totalWorldPx) * H;
      const vw = ((botRight.wx - topLeft.wx) / totalWorldPx) * W;
      const vh = ((botRight.wy - topLeft.wy) / totalWorldPx) * H;

      miniCtx.strokeStyle = '#ffffff';
      miniCtx.lineWidth = 1.5;
      miniCtx.strokeRect(vx, vy, vw, vh);
    };

    miniCanvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = miniCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const tx = Math.max(0, Math.min(4, Math.floor((mx / rect.width) * 5)));
      const ty = Math.max(0, Math.min(4, Math.floor((my / rect.height) * 5)));

      if (e.shiftKey) {
        // Shift + Left-Click toggles Active vs. Unbought
        APP.territories[ty][tx] = !APP.territories[ty][tx];
        APP.updateMinimapCounter();
        APP.notifyStateChanged();
      } else if (e.button === 0) {
        // Left-Click jumps camera to that territory
        APP.centerOnTerritory(tx, ty);
      }
    });

    // =========================================================================
    // VIEWPORT RESIZE, CAMERA PAN, ZOOM & MOUSE/KEYBOARD EVENTS
    // =========================================================================
    function resizeCanvas() {
      const vp = document.getElementById('viewport');
      mainCanvas.width = vp.clientWidth;
      mainCanvas.height = vp.clientHeight;
      APP.requestRender();
    }

    window.addEventListener('resize', resizeCanvas);

    function updateCursorStyle() {
      if (APP.mouse.isPanning) {
        mainCanvas.className = 'cursor-grabbing';
      } else if (APP.activeTool.mode === 'pan' || APP.spacePressed) {
        mainCanvas.className = 'cursor-grab';
      } else {
        mainCanvas.className = '';
      }
    }

    mainCanvas.addEventListener('mousedown', (e) => {
      const rect = mainCanvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = APP.screenToWorld(sx, sy);

      Object.assign(APP.mouse, world, {
        sx, sy,
        isDown: true,
        button: e.button,
        shiftKey: e.shiftKey,
        dragStartTx: world.tx,
        dragStartTy: world.ty
      });

      // Middle-click (button 1), Space + Left-click, or Pan tool initiates camera pan
      if (e.button === 1 || (e.button === 0 && (APP.spacePressed || APP.activeTool.mode === 'pan'))) {
        e.preventDefault();
        APP.mouse.isPanning = true;
        APP.mouse.panStartX = e.clientX;
        APP.mouse.panStartY = e.clientY;
        APP.mouse.camStartX = APP.camera.x;
        APP.mouse.camStartY = APP.camera.y;
        updateCursorStyle();
        return;
      }

      for (const fn of APP.hooks.onMouseDown) {
        fn(e, APP.mouse);
      }
      APP.requestRender();
    });

    window.addEventListener('mousemove', (e) => {
      const rect = mainCanvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = APP.screenToWorld(sx, sy);

      // Force out-of-bounds if the mouse is over the sidebar, toolbars, or outside the canvas
      if (sx < 0 || sx > rect.width || sy < 0 || sy > rect.height) {
        world.inBounds = false;
      }

      Object.assign(APP.mouse, world, {
        sx, sy,
        shiftKey: e.shiftKey
      });

      if (APP.mouse.isPanning) {
        const dx = e.clientX - APP.mouse.panStartX;
        const dy = e.clientY - APP.mouse.panStartY;
        APP.camera.x = APP.mouse.camStartX + dx;
        APP.camera.y = APP.mouse.camStartY + dy;
        APP.requestRender();
        return;
      }

      for (const fn of APP.hooks.onMouseMove) {
        fn(e, APP.mouse);
      }
      APP.requestRender();
    });

    window.addEventListener('mouseup', (e) => {
      if (APP.mouse.isPanning) {
        APP.mouse.isPanning = false;
        APP.mouse.isDown = false;
        updateCursorStyle();
        APP.requestRender();
        return;
      }

      if (APP.mouse.isDown) {
        APP.mouse.isDown = false;
        for (const fn of APP.hooks.onMouseUp) {
          fn(e, APP.mouse);
        }
        APP.requestRender();
      }
    });

    mainCanvas.addEventListener('mouseleave', () => {
      APP.hideTooltip();
    });

    // Cursor-Centered Scroll Zoom (clamped 0.25x to 2.5x)
    mainCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = mainCanvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const worldBeforeX = (sx - APP.camera.x) / APP.camera.zoom;
      const worldBeforeY = (sy - APP.camera.y) / APP.camera.zoom;

      const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextZoom = Math.max(0.25, Math.min(2.5, APP.camera.zoom * zoomFactor));

      APP.camera.zoom = nextZoom;
      APP.camera.x = sx - worldBeforeX * nextZoom;
      APP.camera.y = sy - worldBeforeY * nextZoom;

      const updated = APP.screenToWorld(sx, sy);
      Object.assign(APP.mouse, updated, { sx, sy });
      APP.requestRender();
    }, { passive: false });

    // Prevent context menu on canvas
    mainCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // =========================================================================
    // UI CONTROLS: SIDEBAR TABS, TOOLBAR MODES, ROTATION, OVERLAYS & STATUS BAR
    // =========================================================================
    APP.setActiveTab = function (tabName) {
      document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === `panel-${tabName}`);
      });
    };

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => APP.setActiveTab(btn.dataset.tab));
    });

    APP.setToolMode = function (mode, itemId = APP.activeTool.itemId) {
      APP.activeTool.mode = mode;
      APP.activeTool.itemId = itemId;
      document.querySelectorAll('#toolbar-modes .tool-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
      });
      if (mode === 'terrain') APP.setActiveTab('terrain');
      if (mode === 'build') APP.setActiveTab('buildings');
      if (mode === 'select') APP.setActiveTab('presets');

      updateCursorStyle();
      for (const fn of APP.hooks.onToolChange) {
        fn(APP.activeTool);
      }
      APP.requestRender();
    };

    document.querySelectorAll('#toolbar-modes .tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => APP.setToolMode(btn.dataset.mode));
    });

    APP.rotateTool = function () {
      APP.activeTool.rot = (APP.activeTool.rot + 90) % 360;
      document.getElementById('rot-indicator').textContent = `${APP.activeTool.rot}°`;
      APP.requestRender();
    };

    document.getElementById('btn-rotate').addEventListener('click', APP.rotateTool);

    // Overlay Toggles
    document.querySelectorAll('#toolbar-overlays .tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.overlay;
        APP.settings.overlays[key] = !APP.settings.overlays[key];
        btn.classList.toggle('active', APP.settings.overlays[key]);
        APP.requestRender();
      });
    });

    // Free-Placement Toggle
    const freePlaceToggle = document.getElementById('toggle-free-place');
    freePlaceToggle.addEventListener('click', () => {
      APP.settings.freePlacement = !APP.settings.freePlacement;
      freePlaceToggle.classList.toggle('active', APP.settings.freePlacement);
      APP.notifyStateChanged();
    });

    // Center Camera Button
    document.getElementById('btn-center-map').addEventListener('click', () => {
      APP.centerOnTerritory(2, 2, 0.95);
    });

   // Finish Editing Active Hub Button
    document.getElementById('btn-finish-hub').addEventListener('click', () => {
      if (typeof APP.finishActiveHub === 'function') {
        APP.finishActiveHub();
      } else {
        APP.activeTool.activeHubId = null;
        APP.updateActiveHubBanner();
        APP.requestRender();
      }
    });

// =========================================================================
    // CUSTOM MEDIEVAL CONFIRMATION MODAL & REALM SIZE TOGGLE (18x18 / 19x19 / 20x20)
    // =========================================================================
    (function initModalAndRealmSizeUI() {
      // 1. Inject Styles for Custom Medieval Modal & Minimap Realm Toggle
      const styleEl = document.createElement('style');
      styleEl.id = 'medieval-modal-and-realm-styles';
      styleEl.textContent = `
        #medieval-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(10, 7, 5, 0.76);
          backdrop-filter: blur(3px);
          z-index: 500;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        #medieval-modal-backdrop.open {
          display: flex;
          animation: modalFadeIn 0.14s ease-out;
        }
        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.97); }
          to   { opacity: 1; transform: scale(1); }
        }
        .medieval-modal-card {
          width: 100%;
          max-width: 410px;
          background: linear-gradient(180deg, #2b2219 0%, #1a140f 100%);
          border: 2px solid var(--border-gold-bright);
          border-radius: 7px;
          box-shadow: 0 14px 38px rgba(0, 0, 0, 0.85), inset 0 0 0 1px rgba(255, 223, 145, 0.12);
          overflow: hidden;
          color: var(--text-main);
        }
        .medieval-modal-header {
          padding: 12px 16px;
          background: linear-gradient(90deg, #382a1d 0%, #241b12 100%);
          border-bottom: 1px solid var(--border-gold);
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 14px;
          font-weight: 700;
          color: var(--accent-gold);
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }
        .medieval-modal-body {
          padding: 16px;
          font-size: 12.5px;
          line-height: 1.55;
          color: var(--text-main);
        }
        .medieval-modal-footer {
          padding: 10px 16px 14px 16px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          border-top: 1px solid var(--border-muted);
          background: rgba(0, 0, 0, 0.22);
        }

        /* Realm Size Toggle inside Minimap Card */
        .minimap-realm-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          margin-bottom: 6px;
          padding: 3px 4px;
          background: rgba(0, 0, 0, 0.28);
          border: 1px solid var(--border-muted);
          border-radius: 4px;
        }
        .minimap-realm-label {
          font-size: 10px;
          color: var(--text-muted);
          font-weight: 600;
          padding-left: 2px;
        }
        .minimap-realm-btns {
          display: flex;
          gap: 3px;
        }
        .realm-size-btn {
          background: var(--bg-panel-alt);
          border: 1px solid var(--border-muted);
          color: var(--text-muted);
          border-radius: 3px;
          padding: 2px 5px;
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .realm-size-btn:hover {
          border-color: var(--border-gold);
          color: var(--text-main);
        }
        .realm-size-btn.active {
          background: linear-gradient(180deg, #523e24 0%, #3b2b17 100%);
          border-color: var(--border-gold-bright);
          color: #ffe2a8;
        }
      `;
      document.head.appendChild(styleEl);

      // 2. Inject Custom Medieval Modal DOM into body
      const modalBackdrop = document.createElement('div');
      modalBackdrop.id = 'medieval-modal-backdrop';
      modalBackdrop.innerHTML = `
        <div class="medieval-modal-card" role="dialog" aria-modal="true">
          <div class="medieval-modal-header">
            <span id="medieval-modal-icon">♛</span>
            <span id="medieval-modal-title">Confirm Action</span>
          </div>
          <div class="medieval-modal-body" id="medieval-modal-message"></div>
          <div class="medieval-modal-footer">
            <button class="tool-btn" id="medieval-modal-cancel">Cancel</button>
            <button class="tool-btn danger" id="medieval-modal-confirm">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(modalBackdrop);

      let activeConfirmCallback = null;

      APP.closeConfirmModal = function () {
        modalBackdrop.classList.remove('open');
        activeConfirmCallback = null;
      };

      APP.showConfirmModal = function ({
        title = 'Royal Decree Confirmation',
        icon = '♛',
        message = 'Are you sure you wish to proceed?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        danger = true,
        onConfirm = null
      }) {
        document.getElementById('medieval-modal-icon').textContent = icon;
        document.getElementById('medieval-modal-title').textContent = title;
        document.getElementById('medieval-modal-message').innerHTML = message;

        const confirmBtn = document.getElementById('medieval-modal-confirm');
        const cancelBtn = document.getElementById('medieval-modal-cancel');
        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;
        confirmBtn.className = `tool-btn ${danger ? 'danger' : 'active'}`;

        activeConfirmCallback = onConfirm;
        modalBackdrop.classList.add('open');
      };

      document.getElementById('medieval-modal-cancel').addEventListener('click', () => {
        APP.closeConfirmModal();
      });

      document.getElementById('medieval-modal-confirm').addEventListener('click', () => {
        const cb = activeConfirmCallback;
        APP.closeConfirmModal();
        if (typeof cb === 'function') cb();
      });

      modalBackdrop.addEventListener('mousedown', (e) => {
        if (e.target === modalBackdrop) APP.closeConfirmModal();
      });

      window.addEventListener('keydown', (e) => {
        if (!modalBackdrop.classList.contains('open')) return;
        if (e.key === 'Escape') {
          e.stopPropagation();
          APP.closeConfirmModal();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const cb = activeConfirmCallback;
          APP.closeConfirmModal();
          if (typeof cb === 'function') cb();
        }
      }, true);

      // 3. Inject Realm Size Toggle Bar into the Floating 5x5 Minimap Card
      const minimapCard = document.getElementById('minimap-card');
      const minimapCanvas = document.getElementById('minimap-canvas');
      if (minimapCard && minimapCanvas) {
        const realmBar = document.createElement('div');
        realmBar.className = 'minimap-realm-bar';
        realmBar.innerHTML = `
          <span class="minimap-realm-label">Realm:</span>
          <div class="minimap-realm-btns">
            <button class="realm-size-btn" data-terr-size="18" title="Small Realm: 18×18 tiles per territory (90×90 total)">S (18²)</button>
            <button class="realm-size-btn active" data-terr-size="19" title="Medium Realm: 19×19 tiles per territory (95×95 total)">M (19²)</button>
            <button class="realm-size-btn" data-terr-size="20" title="Large Realm: 20×20 tiles per territory (100×100 total)">L (20²)</button>
          </div>
        `;
        minimapCard.insertBefore(realmBar, minimapCanvas);

        realmBar.querySelectorAll('.realm-size-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const targetSize = parseInt(btn.dataset.terrSize, 10);
            APP.setRealmSize(targetSize, false);
          });
        });
      }
    })();

    // Helper: Check whether the current map has any user edits
    APP.isCanvasEmpty = function () {
      if (APP.buildings.size > 0 || APP.deposits.size > 0) return false;
      for (let ty = 0; ty < 5; ty++) {
        for (let tx = 0; tx < 5; tx++) {
          const expected = (ty === 2 && tx === 2);
          if (APP.territories[ty][tx] !== expected) return false;
        }
      }
      for (let y = 0; y < APP.GRID_SIZE; y++) {
        for (let x = 0; x < APP.GRID_SIZE; x++) {
          if (APP.terrain[y][x].type !== 'grass' || APP.roadGrid[y][x] !== null) {
            return false;
          }
        }
      }
      return true;
    };

  // Sync Minimap Realm Toggle Buttons with current APP.TERR_SIZE
    APP.syncRealmSizeUI = function () {
      document.querySelectorAll('.realm-size-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.terrSize, 10) === APP.TERR_SIZE);
      });
    };

    // Switch Realm Size (18 = Small, 19 = Medium, 20 = Large)
    APP.setRealmSize = function (newTerrSize, skipConfirm = false) {
      if (![18, 19, 20].includes(newTerrSize)) return;
      if (newTerrSize === APP.TERR_SIZE) return;

      const names = { 18: 'Small', 19: 'Medium', 20: 'Large' };
      const label = names[newTerrSize];
      const newGridSize = newTerrSize * 5;

      const applySwitch = () => {
        APP.TERR_SIZE = newTerrSize;
        APP.GRID_SIZE = newGridSize;
        APP.initGridState();
        APP.syncRealmSizeUI();
        for (const fn of APP.hooks.onWipeCanvas) {
          fn();
        }
        APP.centerOnTerritory(2, 2, 0.95);
        APP.notifyStateChanged();
      };

      if (skipConfirm || APP.isCanvasEmpty()) {
        applySwitch();
      } else {
        APP.showConfirmModal({
          title: `Switch to ${label} Realm?`,
          icon: '🗺️',
          message: `Switch to <strong>${label} Realm</strong> (${newTerrSize}×${newTerrSize} territories / ${newGridSize}×${newGridSize} grid)?<br/><br/>This will start a fresh realm and wipe the current canvas.`,
          confirmText: `Switch to ${label} (${newTerrSize}²)`,
          danger: true,
          onConfirm: applySwitch
        });
      }
    };

// Wipe Canvas Action (Uses Custom Medieval Modal)
    APP.wipeCanvas = function (skipConfirm = false) {
      const executeWipe = () => {
        APP.initGridState();
        for (const fn of APP.hooks.onWipeCanvas) {
          fn();
        }
        APP.notifyStateChanged();
      };

      if (skipConfirm) {
        executeWipe();
      } else {
        APP.showConfirmModal({
          title: 'Wipe Kingdom Canvas?',
          icon: '🔥',
          message: 'Wipe entire canvas and start over with a blank map?',
          confirmText: '🔥 Wipe Canvas',
          danger: true,
          onConfirm: () => {
            executeWipe();
            const splash = document.getElementById('startup-splash');
            if (splash) splash.style.display = 'flex';
            const leftGroup = document.getElementById('status-info-left');
            const toolSpan = document.getElementById('status-info-tool');
            const zoomSpan = document.getElementById('status-info-zoom');
            if (leftGroup) leftGroup.style.visibility = 'hidden';
            if (toolSpan) toolSpan.style.visibility = 'hidden';
            if (zoomSpan) zoomSpan.style.visibility = 'hidden';
          }
        });
      }
    };

    const toggleMinimapBtn = document.getElementById('btn-toggle-minimap');
    if (toggleMinimapBtn) {
      toggleMinimapBtn.addEventListener('click', () => {
        const minimapCard = document.getElementById('minimap-card');
        if (minimapCard) {
          const isHidden = minimapCard.style.display === 'none';
          minimapCard.style.display = isHidden ? 'block' : 'none';
          toggleMinimapBtn.classList.toggle('active', isHidden);
        }
      });
    }
    
    APP.syncRealmSizeUI();

   // Keyboard Shortcuts & Smooth WASD Camera Panning
    const wasdState = { w: false, a: false, s: false, d: false };
    let wasdAnimId = null;

    function runWasdPanLoop() {
      const dx = (wasdState.a ? 1 : 0) - (wasdState.d ? 1 : 0);
      const dy = (wasdState.w ? 1 : 0) - (wasdState.s ? 1 : 0);

      if (dx === 0 && dy === 0) {
        wasdAnimId = null;
        return;
      }

      // Normalize diagonal speed so diagonal panning isn't faster than orthogonal panning
      const len = Math.hypot(dx, dy);
      const panSpeed = 12; // Pixels per frame at 60fps
      APP.camera.x += (dx / len) * panSpeed;
      APP.camera.y += (dy / len) * panSpeed;

      // Keep tile coordinates & building ghost under the mouse cursor updated while panning
      const updated = APP.screenToWorld(APP.mouse.sx, APP.mouse.sy);
      Object.assign(APP.mouse, updated);

      APP.requestRender();
      wasdAnimId = requestAnimationFrame(runWasdPanLoop);
    }

    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      const k = e.key.toLowerCase();
      if (!e.ctrlKey && !e.altKey && !e.metaKey && (k === 'w' || k === 'a' || k === 's' || k === 'd')) {
        wasdState[k] = true;
        if (!wasdAnimId) {
          wasdAnimId = requestAnimationFrame(runWasdPanLoop);
        }
        return;
      }

      if (e.code === 'Space') {
        APP.spacePressed = true;
        updateCursorStyle();
      } else if (k === 'r') {
        e.preventDefault();
        APP.rotateTool();
      } else if (k === 'c') {
        APP.centerOnTerritory(2, 2, 0.95);
      } else if (e.key === '1') {
        APP.setToolMode('terrain');
      } else if (e.key === '2') {
        APP.setToolMode('build');
      } else if (e.key === '3' || k === 'p') {
        APP.setToolMode('select');
      } else if (k === 'm') {
        APP.setToolMode('move');
      } else if (k === 'x' || e.key === 'Delete') {
        APP.setToolMode('delete');
      } else if (e.key === 'Escape') {
        APP.activeTool.activeHubId = null;
        APP.updateActiveHubBanner();
        APP.setToolMode('pan', null);
      }

      for (const fn of APP.hooks.onKeyDown) {
        fn(e);
      }
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
        wasdState[k] = false;
      }
      if (e.code === 'Space') {
        APP.spacePressed = false;
        updateCursorStyle();
      }
    });

    window.addEventListener('blur', () => {
      wasdState.w = wasdState.a = wasdState.s = wasdState.d = false;
      APP.spacePressed = false;
      updateCursorStyle();
    });

    // Status Bar Updater
    APP.updateStatusBar = function () {
      const m = APP.mouse;
      const stCoords = document.getElementById('st-coords');
      const stTerr = document.getElementById('st-terr');
      const stTerrBadge = document.getElementById('st-terr-badge');
      const stTerrain = document.getElementById('st-terrain');
      const stBuilding = document.getElementById('st-building');
      const stTool = document.getElementById('st-tool');
      const stZoom = document.getElementById('st-zoom');

      if (m.inBounds) {
        stCoords.textContent = `(${m.tx}, ${m.ty})`;
        stTerr.textContent = `Row ${m.terrY + 1}, Col ${m.terrX + 1}`;
        const active = APP.territories[m.terrY][m.terrX];
        stTerrBadge.textContent = active ? 'Active' : 'Unbought';
        stTerrBadge.className = `status-badge ${active ? 'active' : 'unbought'}`;

        const tCell = APP.terrain[m.ty][m.tx];
        stTerrain.textContent = APP.TERRAIN_NAMES[tCell.type] || tCell.type;

        const bId = APP.buildingGrid[m.ty][m.tx];
        const rType = APP.roadGrid[m.ty][m.tx];
        if (bId && APP.buildings.has(bId)) {
          const b = APP.buildings.get(bId);
          stBuilding.textContent = `${b.defId} (#${b.id})`;
        } else if (rType) {
          stBuilding.textContent = rType.toUpperCase();
        } else {
          stBuilding.textContent = 'None';
        }
      } else {
        stCoords.textContent = '(--, --)';
        stTerr.textContent = '(--, --)';
        stTerrain.textContent = '--';
        stBuilding.textContent = 'None';
      }

      const itemSuffix = APP.activeTool.itemId ? ` [${APP.activeTool.itemId}]` : '';
      stTool.textContent = `${APP.activeTool.mode.toUpperCase()}${itemSuffix} (${APP.activeTool.rot}°)`;
      stZoom.textContent = `${Math.round(APP.camera.zoom * 100)}%`;
    };

    // Initialize Phase 1 State & Center on Territory [2][2]
    APP.initGridState();
    resizeCanvas();
    APP.centerOnTerritory(2, 2, 0.95);

   // === [SLOT PHASE 2: STATE & TERRAIN PAINTER] ===
    (function initPhase2TerrainModule() {
    // 1. Layer 1 Terrain & Multi-Tile Deposit Definitions
      APP.TERRAIN_DEFS = {
        // 1x1 Brushes
        grass: {
          id: 'grass', name: 'Grass (Clear)', category: 'brush',
          w: 1, h: 1, isDeposit: false, rotatable: false,
          color: APP.TERRAIN_COLORS.grass, icon: '🌱',
          desc: 'Clears water, trees, hills, or deposits back to buildable grassland.'
        },
        hill_top: {
          id: 'hill_top', name: 'Hilltop / Plateau', category: 'brush',
          w: 1, h: 1, isDeposit: false, rotatable: false,
          color: APP.TERRAIN_COLORS.hill_top, icon: '🏞️',
          desc: 'Elevated flat hilltop terrain. 100% buildable for structures, roads, and farms.'
        },
        shoreline: {
          id: 'shoreline', name: 'Shoreline (Coast)', category: 'brush',
          w: 1, h: 1, isDeposit: false, rotatable: false,
          color: APP.TERRAIN_COLORS.shoreline, icon: '🏖️',
          desc: 'Land bordering water ("Too close to water"). Blocks standard land buildings.'
        },
        river: {
          id: 'river', name: 'River (Water)', category: 'brush',
          w: 1, h: 1, isDeposit: false, rotatable: false,
          color: APP.TERRAIN_COLORS.river, icon: '🌊',
          desc: 'Freshwater river tile. Bridges and Fisherman’s Huts can be placed here.'
        },
        lake: {
          id: 'lake', name: 'Lake / Deep Water', category: 'brush',
          w: 1, h: 1, isDeposit: false, rotatable: false,
          color: APP.TERRAIN_COLORS.lake, icon: '💧',
          desc: 'Deep water tile. Blocks standard land buildings.'
        },
        shoal: {
          id: 'shoal', name: 'Fish Shoal', category: 'brush',
          w: 1, h: 1, isDeposit: false, rotatable: false,
          color: APP.TERRAIN_COLORS.shoal, icon: '🐟',
          desc: 'Water resource node required within a Fisherman’s Hut work area.'
        },
        hill: {
          id: 'hill', name: 'Hill / Cliff', category: 'brush',
          w: 1, h: 1, isDeposit: false, rotatable: false,
          color: APP.TERRAIN_COLORS.hill, icon: '⛰️',
          desc: 'Unbuildable elevated cliff or slope.'
        },
        tree: {
          id: 'tree', name: 'Trees / Forest', category: 'brush',
          w: 1, h: 1, isDeposit: false, rotatable: false,
          color: APP.TERRAIN_COLORS.tree, icon: '🌲',
          desc: 'Used for Lumber Camp & Forester planning. Never blocks building placement.'
        },

        // Multi-Tile Resource Nodes (Deposits)
        small_stone: {
          id: 'small_stone', name: 'Small Stone (2×2)', category: 'deposit',
          w: 2, h: 2, isDeposit: true, rotatable: false,
          color: APP.TERRAIN_COLORS.small_stone, icon: '🪨',
          anchorNote: 'Anchor for: Stone Camp',
          desc: '2×2 surface stone node.'
        },
        large_stone: {
          id: 'large_stone', name: 'Large Stone (2×2)', category: 'deposit',
          w: 2, h: 2, isDeposit: true, rotatable: false,
          color: APP.TERRAIN_COLORS.large_stone, icon: '🪨',
          anchorNote: 'Anchor for: Stone Quarry',
          desc: '2×2 deep stone quarry deposit.'
        },
        iron: {
          id: 'iron', name: 'Iron Deposit (2×2)', category: 'deposit',
          w: 2, h: 2, isDeposit: true, rotatable: false,
          color: APP.TERRAIN_COLORS.iron, icon: '⚙️',
          anchorNote: 'Anchor for: Iron Mine',
          desc: '2×2 iron ore vein.'
        },
        mystic: {
          id: 'mystic', name: 'Prismatic Liquid (2×2)', category: 'deposit',
          w: 2, h: 2, isDeposit: true, rotatable: false,
          color: APP.TERRAIN_COLORS.mystic, icon: '🔮',
          anchorNote: 'Anchor for: Prismatic Extractor',
          desc: '2×2 glowing Prismatic Liquid deposit.'
        },
        encounter: {
          id: 'encounter', name: 'Encounter', category: 'deposit',
          w: 1, h: 1, isDeposit: true, rotatable: false,
          color: APP.TERRAIN_COLORS.encounter, icon: '❓',
          anchorNote: 'Landmark / Hero Encounter Site',
          desc: 'Heroic encounter site.'
        },
        ruin: {
          id: 'ruin', name: 'Ruin (2×2)', category: 'deposit',
          w: 2, h: 2, isDeposit: true, rotatable: false,
          color: APP.TERRAIN_COLORS.ruin, icon: '🏛️',
          anchorNote: 'Landmark / Hero Encounter Site',
          desc: '2×2 ancient ruin site.'
        }
     };

      APP.lastTerrainItemId = 'river';
      APP.movingLayer1 = null; // { isDeposit, type, w, h, rot, origX, origY }

      // 2. Build the Left Sidebar Terrain Panel UI
      function renderTerrainSidebar() {
        const panel = document.getElementById('panel-terrain');
        if (!panel) return;

        const brushItems = Object.values(APP.TERRAIN_DEFS).filter(d => !d.isDeposit);
        const depositItems = Object.values(APP.TERRAIN_DEFS).filter(d => d.isDeposit);

        panel.innerHTML = `
          <div class="panel-section-title">1×1 Terrain Brushes (Drag to Paint)</div>
          <div class="item-grid" id="terrain-brush-grid">
            ${brushItems.map(item => `
              <button class="palette-btn" data-terrain-id="${item.id}" title="${item.desc}">
                <span class="swatch" style="background:${item.color}; display:flex; align-items:center; justify-content:center; font-size:11px;">${item.icon}</span>
                <span>${item.name}</span>
              </button>
            `).join('')}
          </div>

          <div class="panel-section-title">Multi-Tile Resource Nodes (Stamp)</div>
          <div class="item-grid" id="terrain-deposit-grid" style="grid-template-columns: 1fr;">
            ${depositItems.map(item => `
              <button class="palette-btn" data-terrain-id="${item.id}" title="${item.desc}">
                <span class="swatch" style="background:${item.color}; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:12px;">${item.icon}</span>
                <div style="display:flex; flex-direction:column; line-height:1.25;">
                  <strong style="font-size:12px;">${item.name}</strong>
                  <span style="font-size:10.5px; color:var(--text-muted);">${item.anchorNote}</span>
                </div>
              </button>
            `).join('')}
          </div>

          <div class="panel-section-title">Layer 1 Painter Controls</div>
          <div class="panel-placeholder" style="text-align:left; font-size:11.5px; padding:10px 12px; color:var(--text-main);">
            <div style="margin-bottom:5px;">• <strong>Left-Click / Drag:</strong> Paint 1×1 terrain or stamp resource node.</div>
            <div style="margin-bottom:5px;">• <strong>Right-Click / Drag:</strong> Quick-erase terrain/node back to Grass.</div>
            <div style="margin-bottom:5px;">• <strong>Rotate [R]:</strong> Flips Large Stone between <strong>3×2</strong> and <strong>2×3</strong>.</div>
            <div style="margin-bottom:5px;">• <strong>Move [M] / Delete [X]:</strong> Works on any terrain tile or resource node (hold <strong>Alt</strong> if under a building).</div>
            <div style="color:var(--accent-gold); font-size:11px; margin-top:6px;">
              ✦ Layer 1 edits never overwrite or delete Layer 2 buildings.
            </div>
          </div>
        `;

        panel.querySelectorAll('[data-terrain-id]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.terrainId;
            APP.lastTerrainItemId = id;
            APP.setToolMode('terrain', id);
            syncTerrainPaletteUI();
          });
        });

        syncTerrainPaletteUI();
      }

      function syncTerrainPaletteUI() {
        const activeId = APP.activeTool.mode === 'terrain' ? APP.activeTool.itemId : null;
        document.querySelectorAll('#panel-terrain [data-terrain-id]').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.terrainId === activeId);
        });
      }

      // 3. Layer 1 State Manipulation Helpers (Safe from overwriting Layer 2)
      APP.getDepositFootprint = function (type, rot = 0) {
        const def = APP.TERRAIN_DEFS[type];
        if (!def) return { w: 1, h: 1 };
        const isRotated = def.rotatable && (rot === 90 || rot === 270);
        return {
          w: isRotated ? def.h : def.w,
          h: isRotated ? def.w : def.h
        };
      };

      APP.canPlaceDepositAt = function (tx, ty, type, rot = 0) {
        const { w, h } = APP.getDepositFootprint(type, rot);
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            if (!APP.inBounds(tx + dx, ty + dy)) return false;
          }
        }
        return true;
      };

      APP.removeDepositById = function (depositId) {
        if (depositId == null) return false;
        const dep = APP.deposits.get(depositId);
        if (dep) {
          for (let dy = 0; dy < dep.h; dy++) {
            for (let dx = 0; dx < dep.w; dx++) {
              const cx = dep.x + dx;
              const cy = dep.y + dy;
              if (APP.inBounds(cx, cy) && APP.terrain[cy][cx].depositId === depositId) {
                APP.terrain[cy][cx] = { type: 'grass', depositId: null };
              }
            }
          }
          APP.deposits.delete(depositId);
          return true;
        }
        // Fallback scan in case of orphaned tiles
        for (let y = 0; y < APP.GRID_SIZE; y++) {
          for (let x = 0; x < APP.GRID_SIZE; x++) {
            if (APP.terrain[y][x].depositId === depositId) {
              APP.terrain[y][x] = { type: 'grass', depositId: null };
            }
          }
        }
        return false;
      };

      APP.paintTerrainTile = function (tx, ty, type) {
        if (!APP.inBounds(tx, ty)) return false;
        const current = APP.terrain[ty][tx];
        if (current.depositId !== null) {
          APP.removeDepositById(current.depositId);
        }
        if (current.type === type && current.depositId === null) return false;
        APP.terrain[ty][tx] = { type: type, depositId: null };
        return true;
      };

      APP.placeDeposit = function (tx, ty, type, rot = APP.activeTool.rot) {
        const def = APP.TERRAIN_DEFS[type];
        if (!def || !def.isDeposit) return null;
        if (!APP.canPlaceDepositAt(tx, ty, type, rot)) return null;

        const { w, h } = APP.getDepositFootprint(type, rot);

        // Remove any existing deposits overlapping the new footprint
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const existingDepId = APP.terrain[ty + dy][tx + dx].depositId;
            if (existingDepId !== null) {
              APP.removeDepositById(existingDepId);
            }
          }
        }

        const id = APP.nextId++;
        const depositObj = { id, type, x: tx, y: ty, w, h, rot: def.rotatable ? rot : 0 };
        APP.deposits.set(id, depositObj);

        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            APP.terrain[ty + dy][tx + dx] = { type, depositId: id };
          }
        }
        return depositObj;
      };

      APP.eraseTerrainAt = function (tx, ty) {
        if (!APP.inBounds(tx, ty)) return false;
        const cell = APP.terrain[ty][tx];
        if (cell.depositId !== null) {
          APP.removeDepositById(cell.depositId);
          return true;
        }
        if (cell.type !== 'grass') {
          APP.terrain[ty][tx] = { type: 'grass', depositId: null };
          return true;
        }
        return false;
      };

      // Apply active terrain tool at (tx, ty)
      function applyTerrainToolAt(tx, ty, isDrag = false) {
        if (!APP.inBounds(tx, ty)) return;
        const itemId = APP.activeTool.itemId || APP.lastTerrainItemId || 'grass';
        const def = APP.TERRAIN_DEFS[itemId];
        if (!def) return;

        if (!def.isDeposit) {
          if (APP.paintTerrainTile(tx, ty, def.id)) {
            APP.notifyStateChanged();
          }
        } else if (!isDrag) {
          // Multi-tile deposits stamp on click (not continuous smear)
          if (APP.placeDeposit(tx, ty, def.id, APP.activeTool.rot)) {
            APP.notifyStateChanged();
          }
        }
      }

      // 4. Hook into Canvas Mouse & Keyboard Events for Layer 1 Painting, Moving & Deleting
      let isRightErasing = false;

      APP.hooks.onToolChange.push((tool) => {
        if (tool.mode === 'terrain' && (!tool.itemId || !APP.TERRAIN_DEFS[tool.itemId])) {
          tool.itemId = APP.lastTerrainItemId || 'river';
        }
        if (tool.mode !== 'move' && APP.movingLayer1) {
          cancelLayer1Move();
        }
        syncTerrainPaletteUI();
      });

      function cancelLayer1Move() {
        if (!APP.movingLayer1) return;
        const m = APP.movingLayer1;
        if (m.isDeposit) {
          APP.placeDeposit(m.origX, m.origY, m.type, m.rot);
        } else {
          APP.paintTerrainTile(m.origX, m.origY, m.type);
        }
        APP.movingLayer1 = null;
        APP.notifyStateChanged();
      }

      APP.hooks.onMouseDown.push((e, mouse) => {
        if (!mouse.inBounds) return;
        const { tx, ty } = mouse;

// TERRAIN MODE: Left-click paints/stamps; Shift+Right-click erases to grass; Right-click exits to Pan
        if (APP.activeTool.mode === 'terrain') {
          if (e.button === 0) {
            applyTerrainToolAt(tx, ty, false);
          } else if (e.button === 2) {
            if (e.shiftKey) {
              isRightErasing = true;
              if (APP.eraseTerrainAt(tx, ty)) {
                APP.notifyStateChanged();
              }
            } else {
              APP.setToolMode('pan', null);
            }
          }
          return;
        }

        // DELETE MODE: Delete deposit/terrain if no Layer 2 building/road is on top (or if Alt is held)
        if (APP.activeTool.mode === 'delete' && e.button === 0) {
          const hasLayer2 = APP.buildingGrid[ty][tx] !== null || APP.roadGrid[ty][tx] !== null;
          if (!hasLayer2 || e.altKey) {
            if (APP.eraseTerrainAt(tx, ty)) {
              APP.notifyStateChanged();
            }
          }
          return;
        }

        // MOVE MODE: Pick up or place a Layer 1 Deposit or Terrain tile
        if (APP.activeTool.mode === 'move') {
          if (e.button === 2 && APP.movingLayer1) {
            cancelLayer1Move();
            return;
          }

          if (e.button === 0) {
            // If currently carrying a Layer 1 deposit/tile, place it down
            if (APP.movingLayer1) {
              const m = APP.movingLayer1;
              if (m.isDeposit) {
                if (APP.canPlaceDepositAt(tx, ty, m.type, APP.activeTool.rot)) {
                  APP.placeDeposit(tx, ty, m.type, APP.activeTool.rot);
                  APP.movingLayer1 = null;
                  APP.notifyStateChanged();
                }
              } else {
                APP.paintTerrainTile(tx, ty, m.type);
                APP.movingLayer1 = null;
                APP.notifyStateChanged();
              }
              return;
            }

            // Otherwise, pick up a Layer 1 deposit/tile if no Layer 2 building is being grabbed
            const hasLayer2Building = APP.buildingGrid[ty][tx] !== null;
            if (!hasLayer2Building || e.altKey) {
              const cell = APP.terrain[ty][tx];
              if (cell.depositId !== null && APP.deposits.has(cell.depositId)) {
                const dep = APP.deposits.get(cell.depositId);
                APP.activeTool.rot = dep.rot || 0;
                document.getElementById('rot-indicator').textContent = `${APP.activeTool.rot}°`;
                APP.movingLayer1 = {
                  isDeposit: true,
                  type: dep.type,
                  origX: dep.x,
                  origY: dep.y,
                  rot: dep.rot || 0
                };
                APP.removeDepositById(dep.id);
                APP.notifyStateChanged();
              } else if (cell.type !== 'grass') {
                APP.movingLayer1 = {
                  isDeposit: false,
                  type: cell.type,
                  origX: tx,
                  origY: ty,
                  rot: 0
                };
                APP.paintTerrainTile(tx, ty, 'grass');
                APP.notifyStateChanged();
              }
            }
          }
        }
      });

      APP.hooks.onMouseMove.push((e, mouse) => {
        if (!mouse.inBounds) {
          APP.hideTooltip();
          return;
        }
        const { tx, ty } = mouse;

        // Drag-painting in Terrain mode
        if (APP.activeTool.mode === 'terrain') {
          if (mouse.isDown && mouse.button === 0) {
            applyTerrainToolAt(tx, ty, true);
          } else if (isRightErasing) {
            if (APP.eraseTerrainAt(tx, ty)) {
              APP.notifyStateChanged();
            }
          }
        }

        // Drag-erasing Layer 1 in Delete mode (when no Layer 2 building/road is present or Alt held)
        if (APP.activeTool.mode === 'delete' && mouse.isDown && mouse.button === 0) {
          const hasLayer2 = APP.buildingGrid[ty][tx] !== null || APP.roadGrid[ty][tx] !== null;
          if (!hasLayer2 || e.altKey) {
            if (APP.eraseTerrainAt(tx, ty)) {
              APP.notifyStateChanged();
            }
          }
        }

        // Hover Tooltip for Multi-Tile Resource Deposits (when no Layer 2 building is on tile)
        const bId = APP.buildingGrid[ty][tx];
        const cell = APP.terrain[ty][tx];
        if (!bId && cell.depositId !== null && APP.deposits.has(cell.depositId)) {
          const dep = APP.deposits.get(cell.depositId);
          const def = APP.TERRAIN_DEFS[dep.type];
          if (def) {
            APP.showTooltip(`
              <div class="tt-title">${def.icon} ${def.name}</div>
              <div class="tt-sub">Footprint: ${dep.w}×${dep.h} at (${dep.x}, ${dep.y})</div>
              <div>${def.anchorNote || def.desc}</div>
            `, e.clientX, e.clientY);
          }
        } else if (!bId) {
          APP.hideTooltip();
        }
      });

      APP.hooks.onMouseUp.push(() => {
        isRightErasing = false;
      });

      APP.hooks.onKeyDown.push((e) => {
        if (e.key === 'Escape' && APP.movingLayer1) {
          cancelLayer1Move();
        }
      });

      APP.hooks.onWipeCanvas.push(() => {
        APP.movingLayer1 = null;
      });

      // 5. Render Rich Multi-Tile Deposit Details on Layer 1
      const prevDrawBase = APP.onDrawBaseGridAndTerrain;
      APP.onDrawBaseGridAndTerrain = function (ctx, bounds) {
        if (typeof prevDrawBase === 'function') prevDrawBase(ctx, bounds);

        const S = APP.TILE_PX;
        for (const dep of APP.deposits.values()) {
          const px = dep.x * S;
          const py = dep.y * S;
          const pw = dep.w * S;
          const ph = dep.h * S;
          const def = APP.TERRAIN_DEFS[dep.type];
          if (!def) continue;

          ctx.save();
          // Outer bevel & distinct resource border
          ctx.fillStyle = def.color;
          ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);

          ctx.strokeStyle = '#e8d5b5';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);

          // Inner resource cluster detail
          ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
          ctx.fillRect(px + 6, py + 6, pw - 12, ph - 12);

          // Center Icon & Footprint Label
          if (APP.camera.zoom >= 0.45) {
            ctx.fillStyle = '#fff5e0';
            ctx.font = `bold ${Math.round(S * 0.55)}px "Segoe UI Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(def.icon, px + pw / 2, py + ph / 2 - 4);

            const label = def.short || def.name.replace(/\s*\(\d+[×x]\d+\)/g, '').trim();
            ctx.font = `bold 9px ${APP.getCanvasTextFontFamily()}`;
            ctx.fillStyle = '#ffdfa0';
            ctx.fillText(label, px + pw / 2, py + ph - 8, pw - 8);
          }
          ctx.restore();
        }
      };

      // 6. Render Layer 1 Brush / Deposit Placement Ghost & Move/Delete Highlights
      const prevDrawGhost = APP.onDrawSelectionAndGhost;
      APP.onDrawSelectionAndGhost = function (ctx) {
        if (!APP.mouse.inBounds) return;
        const S = APP.TILE_PX;
        const { tx, ty } = APP.mouse;

        // Case A: Moving a Layer 1 Deposit or Terrain Tile
        if (APP.activeTool.mode === 'move' && APP.movingLayer1) {
          const m = APP.movingLayer1;
          const def = APP.TERRAIN_DEFS[m.type];
          const { w, h } = m.isDeposit ? APP.getDepositFootprint(m.type, APP.activeTool.rot) : { w: 1, h: 1 };
          const valid = m.isDeposit ? APP.canPlaceDepositAt(tx, ty, m.type, APP.activeTool.rot) : APP.inBounds(tx, ty);

          ctx.save();
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = def ? def.color : '#888';
          ctx.fillRect(tx * S, ty * S, w * S, h * S);
          ctx.globalAlpha = 1.0;
          ctx.strokeStyle = valid ? '#6ee061' : '#ff5e52';
          ctx.lineWidth = 2.5 / APP.camera.zoom;
          ctx.strokeRect(tx * S + 1, ty * S + 1, w * S - 2, h * S - 2);
          ctx.restore();
          return;
        }

        // Case B: Painting / Stamping in Terrain Mode
        if (APP.activeTool.mode === 'terrain') {
          const itemId = APP.activeTool.itemId || APP.lastTerrainItemId || 'grass';
          const def = APP.TERRAIN_DEFS[itemId];
          if (def) {
            const { w, h } = def.isDeposit ? APP.getDepositFootprint(def.id, APP.activeTool.rot) : { w: 1, h: 1 };
            const valid = def.isDeposit ? APP.canPlaceDepositAt(tx, ty, def.id, APP.activeTool.rot) : true;

            ctx.save();
            ctx.globalAlpha = 0.65;
            ctx.fillStyle = def.color;
            ctx.fillRect(tx * S, ty * S, w * S, h * S);
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = valid ? '#ffe394' : '#ff5e52';
            ctx.lineWidth = 2.5 / APP.camera.zoom;
            ctx.strokeRect(tx * S + 1, ty * S + 1, w * S - 2, h * S - 2);

            if (def.isDeposit && APP.camera.zoom >= 0.45) {
              ctx.fillStyle = '#ffffff';
              ctx.font = `bold 12px ${APP.getCanvasTextFontFamily()}`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${def.icon} ${w}×${h}`, tx * S + (w * S) / 2, ty * S + (h * S) / 2);
            }
            ctx.restore();
            return;
          }
        }

        // Case C: Highlighting a Layer 1 Deposit in Delete Mode (when no Layer 2 building is on top)
        if (APP.activeTool.mode === 'delete' && APP.buildingGrid[ty][tx] === null) {
          const depId = APP.terrain[ty][tx].depositId;
          if (depId !== null && APP.deposits.has(depId)) {
            const dep = APP.deposits.get(depId);
            ctx.save();
            ctx.fillStyle = 'rgba(235, 64, 52, 0.32)';
            ctx.fillRect(dep.x * S, dep.y * S, dep.w * S, dep.h * S);
            ctx.strokeStyle = '#ff5e52';
            ctx.lineWidth = 2.5 / APP.camera.zoom;
            ctx.strokeRect(dep.x * S + 1, dep.y * S + 1, dep.w * S - 2, dep.h * S - 2);
            ctx.restore();
            return;
          }
        }

        if (typeof prevDrawGhost === 'function') {
          prevDrawGhost(ctx);
        }
      };

      // Initialize Sidebar UI
      renderTerrainSidebar();
    })();

// === [SLOT PHASE 3: BUILDING ROSTER & PARENT-CHILD BUILDER] ===
    (function initPhase3Buildings() {
      // 1. Road Style Lookup ('dirt' | 'cobble' | 'terracotta')
      APP.roadStyle = new Map();

   // 2. Authentic In-Game Construction Categories (Now with Icons)
      const BUILDING_CATEGORIES = [
        { id: 'all',                 label: 'All',                 icon: '🔍' },
        { id: 'basic',               label: 'Basic',               icon: '🏠' },
        { id: 'essentials',          label: 'Essentials',          icon: '🔨' },
        { id: 'amenities',           label: 'Amenities',           icon: '🎭' },
        { id: 'food_production',     label: 'Food Production',     icon: '🥕' },
        { id: 'fortifications',      label: 'Fortifications',      icon: '🏰' },
        { id: 'military',            label: 'Military',            icon: '⚔️' },
        { id: 'decorations',         label: 'Decorations',         icon: '🌺' },
        { id: 'courting',            label: 'Courting',            icon: '🌹' },
        { id: 'resource_production', label: 'Resource Production', icon: '📦' },
        { id: 'roads_bridges',       label: 'Roads & Bridges',     icon: '🛤️' }
      ];

      // ... (APP.BUILDING_DEFS is located here, keep it as is) ...

      // 3. Complete Authentic Fabledom Building Roster
      APP.BUILDING_DEFS = {
        // =====================================================================
        // BASIC (Housing, Wells, Sewer & Palace)
        // =====================================================================
        homestead_hub: {
          id: 'homestead_hub', name: 'Homestead (Hub)', short: 'Homestead', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: true,
          isHub: true, hubType: 'homestead',
          allowedChildren: [
            'homestead_yard',
            'homestead_addon_bee', 'homestead_addon_tree', 'homestead_addon_greenhouse', 'homestead_addon_coop',
            'homestead_addon_dog', 'homestead_addon_clothesline', 'homestead_addon_outhouse'
          ],
          color: '#b87344', roofColor: '#d48855', icon: '🏠',
          desc: '1×1 Peasant Home Hub (up to 3 Peasants). Requires 3–5 Yard tiles + up to 2 Attachments. Emits -10 Desirability to Town Houses within 7 tiles of foundation.'
        },
        homestead_yard: {
          id: 'homestead_yard', name: 'Homestead Yard (Foundation)', short: 'Yard', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false, isChild: true, parentHubType: 'homestead',
          isFoundation: true, countsAsFoundation: true, dragPaintChild: true,
          color: '#735838', icon: '🟫',
          desc: '1×1 Yard foundation for active Homestead (3–5 tiles; cannot be placed in front of door).'
        },
        homestead_addon_bee: {
          id: 'homestead_addon_bee', name: 'Beehive (Homegrown)', short: 'Beehive', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: false, isChild: true, parentHubType: 'homestead',
          isAttachment: true, countsAsFoundation: true,
          color: '#c99b38', icon: '🐝',
          desc: '1×1 Homestead Attachment (+1 Homegrown/day, except winter; max 2 attachments per Homestead).'
        },
        homestead_addon_tree: {
          id: 'homestead_addon_tree', name: 'Apple Tree (Homegrown)', short: 'AppleTree', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false, isChild: true, parentHubType: 'homestead',
          isAttachment: true, countsAsFoundation: true,
          color: '#4e8742', icon: '🍎',
          desc: '1×1 Homestead Attachment (+1 Homegrown/day, except winter; max 2 attachments per Homestead).'
        },
        homestead_addon_greenhouse: {
          id: 'homestead_addon_greenhouse', name: 'Small Greenhouse (Homegrown)', short: 'Greenhse', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: false, isChild: true, parentHubType: 'homestead',
          isAttachment: true, countsAsFoundation: true,
          color: '#5fa387', icon: '🌱',
          desc: '1×1 Homestead Attachment (+1 Homegrown/day, except winter; max 2 attachments per Homestead).'
        },
        homestead_addon_coop: {
          id: 'homestead_addon_coop', name: 'Small Chicken Coop (Homegrown)', short: 'SmCoop', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: false, isChild: true, parentHubType: 'homestead',
          isAttachment: true, countsAsFoundation: true,
          color: '#b5834c', icon: '🐣',
          desc: '1×1 Homestead Attachment (+1 Homegrown/day, except winter; max 2 attachments per Homestead).'
        },
        homestead_addon_dog: {
          id: 'homestead_addon_dog', name: 'Dog House (+3 Desirability)', short: 'Doghouse', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: false, isChild: true, parentHubType: 'homestead',
          isAttachment: true, countsAsFoundation: true,
          color: '#9c5a3c', icon: '🐶',
          desc: '1×1 Homestead Attachment (+3 Desirability to this Homestead; max 2 attachments).'
        },
        homestead_addon_clothesline: {
          id: 'homestead_addon_clothesline', name: 'Clothing Line (+3 Desirability)', short: 'Clothes', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: false, isChild: true, parentHubType: 'homestead',
          isAttachment: true, countsAsFoundation: true,
          color: '#7a9ec2', icon: '👕',
          desc: '1×1 Homestead Attachment (+3 Desirability to this Homestead; max 2 attachments).'
        },
        homestead_addon_outhouse: {
          id: 'homestead_addon_outhouse', name: 'Home Outhouse (+3 Desirability)', short: 'HomeWC', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: false, isChild: true, parentHubType: 'homestead',
          isAttachment: true, countsAsFoundation: true,
          color: '#7d6347', icon: '🚽',
          desc: '1×1 Homestead Attachment (+3 Desirability to this Homestead; max 2 attachments).'
        },
        condo_hub: {
          id: 'condo_hub', name: 'Condominium (Hub)', short: 'CondoHub', category: 'basic', milestone: 'Small Town',
          w: 1, h: 1, rotatable: true, hasDoor: true,
          isHub: true, hubType: 'condo',
          allowedChildren: ['condo_foundation', 'town_house', 'condo_shop', 'condo_arch'],
          color: '#4f759b', roofColor: '#638eb8', icon: '🏘️',
          desc: '1×1 Condominium Hub. Connectors on left/right sides only. Complex requires 9–30 total squares (up to 12 Town Houses, 4 Shops, 5 Arches).'
        },
        condo_foundation: {
          id: 'condo_foundation', name: 'Condo Foundation Tile', short: 'CondoTile', category: 'basic', milestone: 'Small Town',
          w: 1, h: 1, rotatable: false, hasDoor: false, isChild: true, parentHubType: 'condo',
          isFoundation: true, countsAsFoundation: true, dragPaintChild: true,
          color: '#767a80', icon: '⬜',
          desc: '1×1 Stone Courtyard Foundation for Condominium (9–30 total complex tiles).'
        },
        town_house: {
          id: 'town_house', name: 'Town House (Condo Unit)', short: 'TownHouse', category: 'basic', milestone: 'Small Town',
          w: 1, h: 1, rotatable: true, hasDoor: true, isChild: true, parentHubType: 'condo',
          countsAsFoundation: true, dragPaintChild: true,
          color: '#3d648f', roofColor: '#527fb0', icon: '🏡',
          desc: '1×1 Commoner Town House (max 12 per Condo; houses 2 Commoners). Requires Town Well & Sewer Drain.'
        },
        condo_shop: {
          id: 'condo_shop', name: 'Town Shop (Condo Unit)', short: 'TownShop', category: 'basic', milestone: 'Small Town',
          w: 1, h: 1, rotatable: true, hasDoor: true, isChild: true, parentHubType: 'condo',
          countsAsFoundation: true, desirabilityEmit: 5, desirabilityRadius: 4,
          color: '#82548c', roofColor: '#9c68a8', icon: '🛍️',
          desc: '1×1 Condominium Shop (max 4 per Condo). Sells goods and boosts local desirability.'
        },
        condo_arch: {
          id: 'condo_arch', name: 'Condo Archway', short: 'Archway', category: 'basic', milestone: 'Small Town',
          w: 1, h: 1, rotatable: true, hasDoor: false, isChild: true, parentHubType: 'condo',
          countsAsFoundation: true,
          color: '#8f8b82', icon: '⛩️',
          desc: '1×1 Walkthrough Archway for inner Condominium courtyards (max 5 per Condo).'
        },
        basic_well: {
          id: 'basic_well', name: 'Basic Well', short: 'Well', category: 'basic', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          waterRadius: 6,
          color: '#3b7ea1', icon: '🪣',
          desc: '1×1 Basic Well. Supplies water to Homesteads within 6 tiles.'
        },
        town_well: {
          id: 'town_well', name: 'Town Well', short: 'TownWell', category: 'basic', milestone: 'Small Town',
          w: 2, h: 2, rotatable: false, hasDoor: false,
          waterRadius: 7, desirabilityEmit: 10, desirabilityRadius: 5,
          color: '#2d8ab8', roofColor: '#4da8d6', icon: '⛲',
          desc: '2×2 Town Well. Supplies water within 7 tiles and +10 Desirability within 5 tiles.'
        },
        sewer_drain: {
          id: 'sewer_drain', name: 'Sewer Drain', short: 'Sewer', category: 'basic', milestone: 'Small Town',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          requiresRoad: true, sewerRadius: 3,
          color: '#4e6b58', icon: '🕳️',
          desc: '1×1 Sewer Drain. Must be placed on a Road tile. Provides Sewer coverage within 3 tiles.'
        },
        palace_hub: {
          id: 'palace_hub', name: 'Palace Main Hall (Hub)', short: 'Palace', category: 'basic', milestone: 'City',
          w: 4, h: 3, rotatable: true, hasDoor: true,
          isHub: true, hubType: 'palace',
          allowedChildren: ['palace_foundation', 'palace_wing', 'palace_feast', 'palace_treasury', 'palace_tower'],
          desirabilityEmit: 20, desirabilityRadius: 8,
          color: '#9c7834', roofColor: '#d4a84e', icon: '👑',
          desc: '4×3 Palace Main Hall Hub. Takes foundation on any side. Emits +20 Desirability (8 tiles).'
        },
        palace_foundation: {
          id: 'palace_foundation', name: 'Palace Foundation / Terrace', short: 'PalaceTile', category: 'basic', milestone: 'City',
          w: 1, h: 1, rotatable: false, hasDoor: false, isChild: true, parentHubType: 'palace',
          isFoundation: true, countsAsFoundation: true, dragPaintChild: true,
          color: '#948b7a', icon: '🟨',
          desc: '1×1 Marble Foundation for the Palace complex (up to 40 tiles).'
        },
        palace_wing: {
          id: 'palace_wing', name: 'Living Quarters (Palace)', short: 'Quarters', category: 'basic', milestone: 'City',
          w: 2, h: 2, rotatable: true, hasDoor: true, isChild: true, parentHubType: 'palace',
          isAttachment: true, countsAsFoundation: true,
          color: '#b0883e', roofColor: '#e0b458', icon: '🏛️',
          desc: '2×2 Palace Living Quarters attachment (grants +2 Nobles when first finished).'
        },
        palace_feast: {
          id: 'palace_feast', name: 'Feast Hall (Palace)', short: 'FeastHall', category: 'basic', milestone: 'City',
          w: 3, h: 2, rotatable: true, hasDoor: true, isChild: true, parentHubType: 'palace',
          isAttachment: true, countsAsFoundation: true,
          color: '#b87a3d', roofColor: '#e69d53', icon: '🍗',
          desc: '3×2 Palace Feast Hall attachment (converts Grape Juice into Feast supplies).'
        },
        palace_treasury: {
          id: 'palace_treasury', name: 'Royal Treasury (Palace)', short: 'Treasury', category: 'basic', milestone: 'City',
          w: 2, h: 2, rotatable: true, hasDoor: true, isChild: true, parentHubType: 'palace',
          isAttachment: true, countsAsFoundation: true,
          color: '#c49b3b', roofColor: '#f0c356', icon: '💰',
          desc: '2×2 Palace Treasury attachment.'
        },
        palace_tower: {
          id: 'palace_tower', name: 'Palace Spire (Palace)', short: 'Spire', category: 'basic', milestone: 'City',
          w: 1, h: 1, rotatable: false, hasDoor: false, isChild: true, parentHubType: 'palace',
          isAttachment: true, countsAsFoundation: true,
          color: '#8c6f38', icon: '🗼',
          desc: '1×1 Ornamental Palace Spire attachment.'
        },

        // =====================================================================
        // ESSENTIALS
        // =====================================================================
        laborers_hut: {
          id: 'laborers_hut', name: 'Laborers’ Hut', short: 'Laborers', category: 'essentials', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: true,
          color: '#856547', icon: '🔨',
          desc: '1×1 Laborers’ Hut. First building placed in a new kingdom; employs Peasant or Commoner builders.'
        },
        out_house: {
          id: 'out_house', name: 'Public Outhouse', short: 'Outhouse', category: 'essentials', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: true,
          desirabilityEmit: -5, desirabilityRadius: 3,
          color: '#73563d', icon: '🚾',
          desc: '1×1 Public Outhouse. Projects -5 Desirability within 3 tiles.'
        },
        messenger_guild: {
          id: 'messenger_guild', name: 'Messengers’ Guild', short: 'Messenger', category: 'essentials', milestone: 'Small Village',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          color: '#526b82', roofColor: '#3a4e61', icon: '📯',
          desc: '2×2 Messengers’ Guild. Unlocks World Map diplomacy, quests, and courtship.'
        },
        hospital: {
          id: 'hospital', name: 'Hospital', short: 'Hospital', category: 'essentials', milestone: 'Town',
          w: 3, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 5, desirabilityRadius: 5,
          color: '#578778', roofColor: '#6fa695', icon: '🏥',
          desc: '3×2 Hospital. Cures sick Fablings; emits +5 Desirability within 5 tiles.'
        },
        embassy: {
          id: 'embassy', name: 'Embassy', short: 'Embassy', category: 'essentials', milestone: 'Big Town',
          w: 3, h: 2, rotatable: true, hasDoor: true,
          color: '#4e6785', roofColor: '#6482a6', icon: '📜',
          desc: '3×2 Diplomatic Embassy for foreign realm relations and treaties.'
        },
        bank: {
          id: 'bank', name: 'Bank', short: 'Bank', category: 'essentials', milestone: 'Big Town',
          w: 3, h: 3, rotatable: true, hasDoor: true,
          desirabilityEmit: 5, desirabilityRadius: 5,
          color: '#8f7943', roofColor: '#b59b57', icon: '🏦',
          desc: '3×3 Kingdom Bank. Unlocks tax controls and employs up to 3 Nobles/Commoners.'
        },
        laborers_guild: {
          id: 'laborers_guild', name: 'Laborers’ Guild', short: 'LabGuild', category: 'essentials', milestone: 'Big Town',
          w: 1, h: 2, rotatable: true, hasDoor: true,
          color: '#785a3c', roofColor: '#594129', icon: '⚒️',
          desc: '1×2 Laborers’ Guild. Employs up to 3 Commoners who carry double construction loads (10 resources).'
        },
        fairy_tower: {
          id: 'fairy_tower', name: 'Fairy Tower', short: 'FairyTwr', category: 'essentials', milestone: 'Big City',
          w: 3, h: 3, rotatable: true, hasDoor: true,
          workAreaRadius: 23, desirabilityEmit: 10, desirabilityRadius: 5,
          color: '#7e52a3', roofColor: '#9b6bc4', icon: '🧚',
          desc: '3×3 Fairy Tower. Houses up to 5 Fairies that haul goods within a 23-tile Work Area.'
        },
        fairy_pillar: {
          id: 'fairy_pillar', name: 'Fairy Pillar', short: 'FairyPlr', category: 'essentials', milestone: 'Big City',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          color: '#9568bd', icon: '🔮',
          desc: '1×1 Fairy Pillar. Raises Fairy Tower housing capacity by +2 Fairies.'
        },

        // =====================================================================
        // AMENITIES (Exact 9 Authentic Fabledom Amenities)
        // =====================================================================
        inn: {
          id: 'inn', name: 'Inn', short: 'Inn', category: 'amenities', milestone: 'Hamlet',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 10, desirabilityRadius: 7,
          color: '#9c5e38', roofColor: '#bd7448', icon: '🍺',
          desc: '2×2 Country Inn. Consumes food to emit +10 Desirability to dwellings within 7 tiles.'
        },
        street_theater: {
          id: 'street_theater', name: 'Street Theatre', short: 'StTheatre', category: 'amenities', milestone: 'Big Village',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 20, desirabilityRadius: 5,
          color: '#914968', roofColor: '#b35b81', icon: '🎭',
          desc: '2×2 Street Theatre. Employs 1 worker and emits +20 Desirability within 5 tiles.'
        },
        puppet_show: {
          id: 'puppet_show', name: 'Puppet Show', short: 'Puppets', category: 'amenities', milestone: 'Town',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 15, desirabilityRadius: 6,
          color: '#a14f42', roofColor: '#c46354', icon: '🎪',
          desc: '2×2 Puppet Show stage. Emits +15 Desirability within 6 tiles.'
        },
        cafe: {
          id: 'cafe', name: 'Cafe', short: 'Cafe', category: 'amenities', milestone: 'Town',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 15, desirabilityRadius: 7,
          color: '#8c584c', roofColor: '#ad6f60', icon: '☕',
          desc: '2×2 Town Cafe. Serves food/drink and emits +15 Desirability within 7 tiles.'
        },
        grand_theatre: {
          id: 'grand_theatre', name: 'Grand Theatre', short: 'GdTheatre', category: 'amenities', milestone: 'Small City',
          w: 3, h: 3, rotatable: true, hasDoor: true,
          desirabilityEmit: 25, desirabilityRadius: 9,
          color: '#873e5c', roofColor: '#a84f74', icon: '🎟️',
          desc: '3×3 Grand Theatre. Emits +25 Desirability within 9 tiles.'
        },
        concert_hall: {
          id: 'concert_hall', name: 'Concert Hall', short: 'Concert', category: 'amenities', milestone: 'Big City',
          w: 4, h: 4, rotatable: true, hasDoor: true,
          desirabilityEmit: 30, desirabilityRadius: 11,
          color: '#733e82', roofColor: '#9150a3', icon: '🎻',
          desc: '4×4 Concert Hall. Employs 3 workers and emits +30 Desirability within 11 tiles.'
        },
        circus_tent: {
          id: 'circus_tent', name: 'Circus Tent', short: 'Circus', category: 'amenities', milestone: 'Small Kingdom',
          w: 4, h: 4, rotatable: true, hasDoor: true,
          desirabilityEmit: 30, desirabilityRadius: 11,
          color: '#b03b3b', roofColor: '#d94c4c', icon: '🎪',
          desc: '4×4 Circus Tent (Unique; unlocks Ferris Wheel). Emits +30 Desirability within 11 tiles.'
        },
        ferris_wheel: {
          id: 'ferris_wheel', name: 'Ferris Wheel', short: 'Ferris', category: 'amenities', milestone: 'Small Kingdom',
          w: 3, h: 3, rotatable: true, hasDoor: true,
          desirabilityEmit: 25, desirabilityRadius: 10,
          color: '#9e6b36', roofColor: '#c48747', icon: '🎡',
          desc: '3×3 Ferris Wheel (requires Circus Tent). Emits +25 Desirability within 10 tiles.'
        },
        mall: {
          id: 'mall', name: 'Mall', short: 'Mall', category: 'amenities', milestone: 'Kingdom',
          w: 4, h: 3, rotatable: true, hasDoor: true,
          desirabilityEmit: 35, desirabilityRadius: 12,
          color: '#8c6930', roofColor: '#b88b42', icon: '🏬',
          desc: '4×3 Royal Mall (300 Population Kingdom Milestone). Emits +35 Desirability within 12 tiles.'
        },

        // =====================================================================
        // FOOD PRODUCTION
        // =====================================================================
      veg_farm_hub: {
          id: 'veg_farm_hub', name: 'Vegetable Farm (Hub)', short: 'VegFarm', category: 'food_production', milestone: 'Start',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          isHub: true, hubType: 'veg_farm', allowedChildren: ['veg_field'],
          color: '#6e8c3a', roofColor: '#9c7144', icon: '🥕',
          desc: '2×2 Vegetable Farm Hub. Supports 1–40 Vegetable Fields.'
        },
        veg_field: {
          id: 'veg_field', name: 'Vegetable Field', short: 'VegField', category: 'food_production', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false, isChild: true, parentHubType: 'veg_farm',
          isFoundation: true, countsAsFoundation: true, dragPaintChild: true,
          color: '#5a7830', icon: '▤',
          desc: '1×1 Vegetable Field tile for active Vegetable Farm (up to 40 tiles).'
        },
        grain_farm_hub: {
          id: 'grain_farm_hub', name: 'Wheat Farm (Hub)', short: 'WheatFarm', category: 'food_production', milestone: 'Small Village',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          isHub: true, hubType: 'grain_farm', allowedChildren: ['grain_field'],
          color: '#8c803a', roofColor: '#b8a649', icon: '🌾',
          desc: '2×2 Wheat Farm Hub. Supports 1–60 Wheat Fields.'
        },
        grain_field: {
          id: 'grain_field', name: 'Wheat Field', short: 'WheatFld', category: 'food_production', milestone: 'Small Village',
          w: 1, h: 1, rotatable: false, hasDoor: false, isChild: true, parentHubType: 'grain_farm',
          isFoundation: true, countsAsFoundation: true, dragPaintChild: true,
          color: '#786d29', icon: '▤',
          desc: '1×1 Wheat Field tile for active Wheat Farm (up to 60 tiles).'
        },
        granary: {
          id: 'granary', name: 'Granary', short: 'Granary', category: 'food_production', milestone: 'Hamlet',
          w: 2, h: 1, rotatable: true, hasDoor: true,
          color: '#ad8549', roofColor: '#826130', icon: '🌽',
          desc: '2×1 Food Granary. Stores harvested crops, grain, flour, and processed foods.'
        },
        fisherman_hut: {
          id: 'fisherman_hut', name: 'Fisherman’s Hut', short: 'Fisher', category: 'food_production', milestone: 'Village',
          w: 3, h: 3, rotatable: true, hasDoor: true,
          requiresWaterOrShoal: true, workAreaRadius: 8,
          color: '#467387', roofColor: '#365869', icon: '🎣',
          desc: '3×3 Shoreline Fishery. Must be placed on water/coast with entrances on land/coast. Work Area: 8 tiles.'
        },
        windmill: {
          id: 'windmill', name: 'Windmill', short: 'Windmill', category: 'food_production', milestone: 'Village',
          w: 3, h: 3, rotatable: true, hasDoor: true,
          color: '#b89f68', roofColor: '#d9c089', icon: '🌾',
          desc: '3×3 Grain Windmill (9 squares). Grinds Grain into Flour for Bakeries.'
        },
        bakery: {
          id: 'bakery', name: 'Bakery', short: 'Bakery', category: 'food_production', milestone: 'Big Village',
          w: 3, h: 2, rotatable: true, hasDoor: true, doorSide: 'W',
          desirabilityEmit: 5, desirabilityRadius: 7,
          color: '#b36d3e', roofColor: '#cc8250', icon: '🥖',
          desc: '3×2 Bread Bakery (6 squares). Bakes Flour into Bread and emits +5 Desirability within 7 tiles.'
        },
        chicken_coop: {
          id: 'chicken_coop', name: 'Large Chicken Coop', short: 'LgCoop', category: 'food_production', milestone: 'Town',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: -10, desirabilityRadius: 7,
          color: '#997a49', roofColor: '#b5925b', icon: '🐔',
          desc: '2×2 Large Chicken Coop. Converts Grain into Eggs. Emits -10 Desirability within 7 tiles.'
        },
        pigsty: {
          id: 'pigsty', name: 'Pigsty', short: 'Pigsty', category: 'food_production', milestone: 'Town',
          w: 3, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: -10, desirabilityRadius: 7,
          color: '#7a5942', roofColor: '#5c412e', icon: '🐖',
          desc: '3×2 Pigsty. Converts Vegetables into Pork. Emits -10 Desirability within 7 tiles.'
        },
        vineyard_hub: {
          id: 'vineyard_hub', name: 'Grape Farm (Hub)', short: 'GrapeFarm', category: 'food_production', milestone: 'Small City',
          w: 3, h: 2, rotatable: true, hasDoor: true,
          isHub: true, hubType: 'vineyard', allowedChildren: ['vine_field'],
          color: '#70497a', roofColor: '#8c5c99', icon: '🍇',
          desc: '3×2 Grape Farm Hub (6 squares). Supports 1–40 Grape Fields.'
        },
        vine_field: {
          id: 'vine_field', name: 'Grape Field', short: 'GrapeFld', category: 'food_production', milestone: 'Small City',
          w: 1, h: 1, rotatable: false, hasDoor: false, isChild: true, parentHubType: 'vineyard',
          isFoundation: true, countsAsFoundation: true, dragPaintChild: true,
          color: '#5c3b66', icon: '▤',
          desc: '1×1 Grapevine Field tile for active Grape Farm (up to 40 tiles).'
        },
        juicery: {
          id: 'juicery', name: 'Juicery', short: 'Juicery', category: 'food_production', milestone: 'Small City',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          color: '#853c62', roofColor: '#a34d7a', icon: '🧃',
          desc: '2×2 Grape Juicery. Employs 3 Commoners to press Grapes into Grape Juice for Nobles.'
        },

        // =====================================================================
        // FORTIFICATIONS
        // =====================================================================
        wood_wall: {
          id: 'wood_wall', name: 'Wooden Wall', short: 'WdWall', category: 'fortifications', milestone: 'Big Town',
          w: 1, h: 1, rotatable: false, hasDoor: false, dragPaintBuilding: true,
          color: '#6e5236', icon: '🪵',
          desc: '1×1 Palisade Wooden Wall segment (drag-paintable).'
        },
        wood_gate: {
          id: 'wood_gate', name: 'Wooden Gatehouse', short: 'WdGate', category: 'fortifications', milestone: 'Big Town',
          w: 2, h: 1, rotatable: true, hasDoor: true,
          color: '#7a5938', icon: '🚪',
          desc: '2×1 Wooden Palisade Gate.'
        },
        stone_wall: {
          id: 'stone_wall', name: 'Stone Wall', short: 'StWall', category: 'fortifications', milestone: 'City',
          w: 1, h: 1, rotatable: false, hasDoor: false, dragPaintBuilding: true,
          color: '#7c8085', icon: '🧱',
          desc: '1×1 Fortified Stone Wall segment (drag-paintable).'
        },
        stone_gate: {
          id: 'stone_gate', name: 'Stone Gatehouse', short: 'StGate', category: 'fortifications', milestone: 'City',
          w: 2, h: 1, rotatable: true, hasDoor: true,
          color: '#686c70', roofColor: '#868a8f', icon: '🏰',
          desc: '2×1 Fortified Stone Gatehouse.'
        },
        watchtower: {
          id: 'watchtower', name: 'Fortification Bastion / Tower', short: 'Tower', category: 'fortifications', milestone: 'City',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          color: '#5a5f66', roofColor: '#3f4347', icon: '🗼',
          desc: '2×2 Defensive Stone Watchtower.'
        },
        wall_ballista: {
          id: 'wall_ballista', name: 'Wall Ballista', short: 'Ballista', category: 'fortifications', milestone: 'City',
          w: 1, h: 1, rotatable: true, hasDoor: false,
          color: '#826342', icon: '🏹',
          desc: '1×1 Wall-mounted Ballista emplacement.'
        },
        wall_cannon: {
          id: 'wall_cannon', name: 'Wall Cannon', short: 'Cannon', category: 'fortifications', milestone: 'City',
          w: 1, h: 1, rotatable: true, hasDoor: false,
          color: '#4e545c', icon: '💣',
          desc: '1×1 Wall-mounted Cannon emplacement.'
        },
        wall_mortar: {
          id: 'wall_mortar', name: 'Wall Mortar', short: 'Mortar', category: 'fortifications', milestone: 'City',
          w: 1, h: 1, rotatable: true, hasDoor: false,
          color: '#3f444a', icon: '💥',
          desc: '1×1 Wall-mounted heavy Mortar emplacement.'
        },

        // =====================================================================
        // MILITARY
        // =====================================================================
        hero_tent: {
          id: 'hero_tent', name: 'Hero Quarters', short: 'HeroQtrs', category: 'military', milestone: 'Village',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          color: '#8c3b3b', roofColor: '#b54c4c', icon: '⛺',
          desc: '2×2 Hero Quarters. Houses and heals the Kingdom’s Hero.'
        },
        arena_of_trials: {
          id: 'arena_of_trials', name: 'Arena of Trials', short: 'Arena', category: 'military', milestone: 'Big Village',
          w: 3, h: 4, rotatable: true, hasDoor: true,
          color: '#824638', roofColor: '#a35847', icon: '⚔️',
          desc: '3×3 Arena of Trials for hero and combat challenges.'
        },
        barracks: {
          id: 'barracks', name: 'Barracks', short: 'Barracks', category: 'military', milestone: 'Town',
          w: 3, h: 3, rotatable: true, hasDoor: true,
          color: '#6b3838', roofColor: '#8c4949', icon: '🛡️',
          desc: '3×3 Military Barracks. Garrisons trained Kingdom soldiers.'
        },
        swordfighter_grounds: {
          id: 'swordfighter_grounds', name: 'Swordfighter Grounds', short: 'Swords', category: 'military', milestone: 'Town',
          w: 3, h: 2, rotatable: true, hasDoor: true,
          color: '#7a3e32', roofColor: '#994f40', icon: '🗡️',
          desc: '3×2 Swordfighter Grounds. Trains Fablings into melee Swordfighters.'
        },
        archery_range: {
          id: 'archery_range', name: 'Archery Grounds', short: 'Archery', category: 'military', milestone: 'Town',
          w: 3, h: 2, rotatable: true, hasDoor: true,
          color: '#755338', roofColor: '#916746', icon: '🎯',
          desc: '3×2 Archery Grounds. Trains Fablings into ranged Archers.'
        },

     // =====================================================================
        // DECORATIONS
        // =====================================================================
    flower_plot: {
          id: 'flower_plot', name: 'Flower Plot', short: 'Flower', category: 'decorations', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          isDecoration: true, desirabilityEmit: 10, desirabilityRadius: 3,
          color: '#a3425a', icon: '🌺',
          desc: '1×1 Flower Plot. Emits +10 Desirability within 3 tiles.'
        },
        log_bench: {
          id: 'log_bench', name: 'Log Bench', short: 'Bench', category: 'decorations', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: false,
          isDecoration: true, desirabilityEmit: 10, desirabilityRadius: 3,
          color: '#825c38', icon: '🪑',
          desc: '1×1 Log Bench. Emits +10 Desirability within 3 tiles.'
        },
        circular_table: {
          id: 'circular_table', name: 'Circular Table', short: 'Table', category: 'decorations', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          isDecoration: true, desirabilityEmit: 10, desirabilityRadius: 3,
          color: '#735738', icon: '🪵',
          desc: '1×1 Circular Table. Emits +10 Desirability within 3 tiles.'
        },
        street_lamp: {
          id: 'street_lamp', name: 'Street Lamp', short: 'Lamp', category: 'decorations', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          isDecoration: true, desirabilityEmit: 10, desirabilityRadius: 3,
          color: '#c9a649', icon: '🏮',
          desc: '1×1 Street Lamp. Emits +10 Desirability within 3 tiles.'
        },
        cypress_tree: {
          id: 'cypress_tree', name: 'Cypress Tree (Planted)', short: 'Cypress', category: 'decorations', milestone: 'Hamlet',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          isDecoration: true, desirabilityEmit: 10, desirabilityRadius: 3,
          color: '#366141', icon: '🌲',
          desc: '1×1 Planted Cypress Tree. Emits +10 Desirability within 3 tiles.'
        },
        evergreen_tree: {
          id: 'evergreen_tree', name: 'Evergreen Tree (Planted)', short: 'Evergreen', category: 'decorations', milestone: 'Hamlet',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          isDecoration: true, desirabilityEmit: 10, desirabilityRadius: 3,
          color: '#285734', icon: '🎄',
          desc: '1×1 Planted Evergreen Tree. Emits +10 Desirability within 3 tiles.'
        },
        ancient_guardian: {
          id: 'ancient_guardian', name: 'Ancient Stone Guardian', short: 'Guardian', category: 'decorations', milestone: 'Village',
          w: 1, h: 1, rotatable: true, hasDoor: false,
          isDecoration: true, desirabilityEmit: 15, desirabilityRadius: 4,
          color: '#868d94', icon: '🗿',
          desc: '1×1 Ancient Guardian Statue. Emits +15 Desirability within 4 tiles.'
        },
        maidens_fountain: {
          id: 'maidens_fountain', name: 'Maiden’s Fountain', short: 'Fountain', category: 'decorations', milestone: 'Village',
          w: 2, h: 2, rotatable: true, hasDoor: false,
          isDecoration: true, desirabilityEmit: 15, desirabilityRadius: 5,
          color: '#4986a1', roofColor: '#60a3c2', icon: '⛲',
          desc: '2×2 Maiden’s Fountain. Emits +15 Desirability within 5 tiles.'
        },
        gazebo: {
          id: 'gazebo', name: 'Gazebo', short: 'Gazebo', category: 'decorations', milestone: 'Town',
          w: 2, h: 2, rotatable: true, hasDoor: false,
          isDecoration: true, desirabilityEmit: 15, desirabilityRadius: 5,
          color: '#438552', roofColor: '#5cb06f', icon: '🛖',
          desc: '2×2 Park Gazebo. Emits +15 Desirability within 5 tiles.'
        },
        cupids_garden: {
          id: 'cupids_garden', name: 'Cupid’s Garden', short: 'Cupid', category: 'decorations', milestone: 'Small City',
          w: 2, h: 2, rotatable: true, hasDoor: false,
          isDecoration: true, desirabilityEmit: 20, desirabilityRadius: 6,
          color: '#a84d6b', roofColor: '#c75e81', icon: '💖',
          desc: '2×2 Cupid’s Garden. Emits +20 Desirability within 6 tiles.'
        },
        gamblers_garden: {
          id: 'gamblers_garden', name: 'Gambler’s Garden', short: 'Gambler', category: 'decorations', milestone: 'Small City',
          w: 2, h: 2, rotatable: true, hasDoor: false,
          isDecoration: true, desirabilityEmit: 20, desirabilityRadius: 6,
          color: '#9e843c', roofColor: '#bd9e46', icon: '🃏',
          desc: '2×2 Gambler’s Garden. Emits +20 Desirability within 6 tiles.'
        },
        lighthouse: {
          id: 'lighthouse', name: 'Lighthouse', short: 'Lighthouse', category: 'decorations', milestone: 'City',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          isDecoration: true, desirabilityEmit: 25, desirabilityRadius: 8,
          color: '#a84444', roofColor: '#cc5454', icon: '🗼',
          desc: '2×2 Lighthouse. Emits +25 Desirability within 8 tiles.'
        },

        // =====================================================================
        // COURTING
        // =====================================================================
        court_rose_garden: {
          id: 'court_rose_garden', name: 'Flower Farm (Agnes)', short: 'Flowers', category: 'courting', milestone: 'Courting',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 10, desirabilityRadius: 5,
          color: '#b04369', roofColor: '#d45582', icon: '🌹',
          desc: '2×2 Courting Building (Princess Agnes). Grows flowers and emits +10 Desirability (5 tiles).'
        },
        harvest_guild: {
          id: 'harvest_guild', name: 'Harvest Guild (Agnes)', short: 'Harvest', category: 'courting', milestone: 'Courting',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          workAreaRadius: 10,
          color: '#7c993d', roofColor: '#98bd4b', icon: '🌻',
          desc: '2×2 Courting Building (Princess Agnes). Boosts nearby farm crop yields.'
        },
        dice_table: {
          id: 'dice_table', name: 'Dice Table (Giovanni)', short: 'Dice', category: 'courting', milestone: 'Courting',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          desirabilityEmit: 5, desirabilityRadius: 4,
          color: '#9e7b32', icon: '🎲',
          desc: '1×1 Courting Building (Prince Giovanni). Lets you gamble coin on dice rolls (no entrance).'
        },
        court_bank: {
          id: 'court_bank', name: 'Pawnbroker (Giovanni)', short: 'Pawnshop', category: 'courting', milestone: 'Courting',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 5, desirabilityRadius: 5,
          color: '#b58d3d', roofColor: '#d9ac4c', icon: '⚖️',
          desc: '2×2 Courting Building (Prince Giovanni). Exchanges Nobility and Coin.'
        },
        golden_goose_coop: {
          id: 'golden_goose_coop', name: 'Golden Goose Coop', short: 'GoldGoose', category: 'courting', milestone: 'Courting',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          color: '#c49a35', roofColor: '#e6b845', icon: '🪿',
          desc: '2×2 Courting Building. Converts Grain into Golden Eggs.'
        },
        court_jousting: {
          id: 'court_jousting', name: 'Jousting Arena (Sir Payne)', short: 'Jousting', category: 'courting', milestone: 'Courting',
          w: 4, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 15, desirabilityRadius: 6,
          color: '#9e4738', roofColor: '#c45a47', icon: '🏇',
          desc: '4×2 Courting Building (Sir Payne). Emits +15 Desirability within 6 tiles.'
        },
        court_feast_hall: {
          id: 'court_feast_hall', name: 'Banquet Hall (Ramone)', short: 'Banquet', category: 'courting', milestone: 'Courting',
          w: 3, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 15, desirabilityRadius: 6,
          color: '#9e5d36', roofColor: '#c27446', icon: '🍷',
          desc: '3×2 Courting Building (Prince Ramone). Emits +15 Desirability within 6 tiles.'
        },
        court_magic_spire: {
          id: 'court_magic_spire', name: 'Arcane Spire (Mystic)', short: 'Arcane', category: 'courting', milestone: 'Courting',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: 10, desirabilityRadius: 5,
          color: '#6e4594', roofColor: '#8b58ba', icon: '🩸',
          desc: '2×2 Courting Building. Emits +10 Desirability within 5 tiles.'
        },
        court_tree_shrine: {
          id: 'court_tree_shrine', name: 'Sylvan Great Tree', short: 'GreatTree', category: 'courting', milestone: 'Courting',
          w: 3, h: 3, rotatable: false, hasDoor: false,
          desirabilityEmit: 15, desirabilityRadius: 7,
          color: '#3b824e', roofColor: '#4ca664', icon: '🌳',
          desc: '3×3 Courting Building. Emits +15 Desirability within 7 tiles.'
        },

        // =====================================================================
        // RESOURCE PRODUCTION
        // =====================================================================
        stockpile_hub: {
          id: 'stockpile_hub', name: 'Stockpile (Hub)', short: 'Stockpile', category: 'resource_production', milestone: 'Start',
          w: 1, h: 1, rotatable: true, hasDoor: true,
          isHub: true, hubType: 'stockpile', allowedChildren: ['stockpile_lot'],
          color: '#8c694a', roofColor: '#ab825e', icon: '📦',
          desc: '1×1 Stockpile Warehouse Hub. Paint up to 3 Stockpile Lots (1×1) to store raw & processed materials.'
        },
        stockpile_lot: {
          id: 'stockpile_lot', name: 'Stockpile Lot (Storage)', short: 'Lot', category: 'resource_production', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false, isChild: true, parentHubType: 'stockpile',
          isFoundation: true, countsAsFoundation: true, dragPaintChild: true,
          color: '#6e5239', icon: '🪵',
          desc: '1×1 Storage Pallet Lot for active Stockpile (up to 3 tiles).'
        },
        lumber_camp: {
          id: 'lumber_camp', name: 'Lumber Camp (Hub)', short: 'Lumber', category: 'resource_production', milestone: 'Start',
          w: 2, h: 1, rotatable: true, hasDoor: true,
          isHub: true, hubType: 'lumber_camp', allowedChildren: ['forester_hut'],
          workAreaRadius: 9, desirabilityEmit: -5, desirabilityRadius: 4,
          color: '#6b4c32', roofColor: '#4d3522', icon: '🪓',
          desc: '2×1 Lumber Camp Hub. Work Area: 9 tiles; Desirability: -5 (4 tiles). Accepts 1 Forester attachment.'
        },
        forester_hut: {
          id: 'forester_hut', name: 'Forester (Lumber Addon)', short: 'Forester', category: 'resource_production', milestone: 'Hamlet',
          w: 1, h: 1, rotatable: true, hasDoor: false, isChild: true, parentHubType: 'lumber_camp',
          isAttachment: true, countsAsFoundation: true,
          workAreaRadius: 9,
          color: '#3f6e38', roofColor: '#2c4f27', icon: '🌲',
          desc: '1×1 Forester attachment for Lumber Camp (max 1 per camp). Replants trees inside parent camp’s area.'
        },
        stone_camp: {
          id: 'stone_camp', name: 'Stone Camp', short: 'StoneCamp', category: 'resource_production', milestone: 'Hamlet',
          w: 3, h: 2, rotatable: true, hasDoor: true,
          requiresDeposit: 'small_stone', minDepositOverlap: 4, desirabilityEmit: -5, desirabilityRadius: 4,
          color: '#7a7d80', roofColor: '#57595c', icon: '⛏️',
          desc: '3×2 Stone Camp. Covers a 2×2 Small Stone deposit (4 tiles) + 2×1 strip. Desirability: -5 (4 tiles).'
        },
        coal_maker: {
          id: 'coal_maker', name: 'Coal Maker', short: 'CoalMaker', category: 'resource_production', milestone: 'Hamlet',
          w: 2, h: 1, rotatable: true, hasDoor: true,
          desirabilityEmit: -10, desirabilityRadius: 4,
          color: '#4a4744', roofColor: '#2e2c2a', icon: '🔥',
          desc: '2×1 Charcoal Kiln. Burns wood into coal. Emits -10 Desirability within 4 tiles.'
        },
        sawmill: {
          id: 'sawmill', name: 'Sawmill', short: 'Sawmill', category: 'resource_production', milestone: 'Small Village',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: -10, desirabilityRadius: 5,
          color: '#7d5636', roofColor: '#593b22', icon: '🪚',
          desc: '2×2 Plank Sawmill. Emits -10 Desirability within 5 tiles.'
        },
        stone_quarry: {
          id: 'stone_quarry', name: 'Stone Quarry', short: 'Quarry', category: 'resource_production', milestone: 'Village',
          w: 4, h: 2, rotatable: true, hasDoor: true,
          requiresDeposit: 'large_stone', minDepositOverlap: 4, desirabilityEmit: -10, desirabilityRadius: 5,
          color: '#63676b', roofColor: '#45484b', icon: '⚒️',
          desc: '4×2 Deep Stone Quarry. Covers a 2×2 Large Stone deposit (4 tiles) + 2×2 strip. Desirability: -10 (5 tiles).'
        },
        brickworks: {
          id: 'brickworks', name: 'Stone Masonry', short: 'Masonry', category: 'resource_production', milestone: 'Big Village',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: -5, desirabilityRadius: 5,
          color: '#945242', roofColor: '#703b2e', icon: '🧱',
          desc: '2×2 Stone Masonry. Crafts stone into bricks. Emits -5 Desirability within 5 tiles.'
        },
        iron_mine: {
          id: 'iron_mine', name: 'Iron Quarry', short: 'IronQry', category: 'resource_production', milestone: 'Small Town',
          w: 3, h: 2, rotatable: true, hasDoor: true,
          requiresDeposit: 'iron', minDepositOverlap: 4, desirabilityEmit: -10, desirabilityRadius: 6,
          color: '#785240', roofColor: '#52372b', icon: '⛏️',
          desc: '3×2 Iron Quarry. Covers a 2×2 Iron Deposit (4 tiles) + 2×1 strip. Emits -10 Desirability (6 tiles).'
        },
        blacksmith: {
          id: 'blacksmith', name: 'Blacksmith', short: 'Smithy', category: 'resource_production', milestone: 'Town',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          desirabilityEmit: -10, desirabilityRadius: 7,
          color: '#4e545c', roofColor: '#34383d', icon: '⚔️',
          desc: '2×2 Blacksmith. Forges Iron and Coal into Armament. Emits -10 Desirability within 7 tiles.'
        },
        mystic_mine: {
          id: 'mystic_mine', name: 'Mystic Mine', short: 'MysticMn', category: 'resource_production', milestone: 'Big Town',
          w: 2, h: 2, rotatable: true, hasDoor: true,
          color: '#6b498c', roofColor: '#4c3266', icon: '💎',
          desc: '2×2 Mystic Mine. Extracts coins, but attracts trolls.'
        },
        marketplace: {
          id: 'marketplace', name: 'Marketplace', short: 'Market', category: 'resource_production', milestone: 'Small City',
          w: 3, h: 3, rotatable: true, hasDoor: true,
          desirabilityEmit: 5, desirabilityRadius: 6,
          color: '#9c7838', roofColor: '#bd9348', icon: '⚖️',
          desc: '3×3 Central Marketplace. Commoner workers haul double loads (20 food / 10 resources).'
        },
        prismatic_extractor: {
          id: 'prismatic_extractor', name: 'Prismatic Liquid Extractor', short: 'Extractor', category: 'resource_production', milestone: 'Small City',
          w: 2, h: 3, rotatable: true, hasDoor: true,
          requiresDeposit: 'mystic', minDepositOverlap: 4, desirabilityEmit: -10, desirabilityRadius: 5,
          color: '#73489c', roofColor: '#915cc4', icon: '🧪',
          desc: '2×3 Prismatic Liquid Extractor. Covers a 2×2 Mystic Deposit (4 tiles) + 2×1 strip.'
        },

        // =====================================================================
        // ROADS & BRIDGES
        // =====================================================================
        dirt_road: {
          id: 'dirt_road', name: 'Gravel / Dirt Road', short: 'DirtRoad', category: 'roads_bridges', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          isRoad: true, roadType: 'road', roadStyle: 'dirt',
          color: '#8c785c', icon: '🛤️',
          desc: '1×1 Gravel/Dirt Path. Drag-paintable; auto-connects to adjacent road tiles.'
        },
        cobble_road: {
          id: 'cobble_road', name: 'Cobblestone Road', short: 'Cobble', category: 'roads_bridges', milestone: 'Small Town',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          isRoad: true, roadType: 'road', roadStyle: 'cobble',
          color: '#787b82', icon: '🧱',
          desc: '1×1 Cobblestone Street. Unlocked at Small Town (65 pop); faster Fabling movement.'
        },
        terracotta_road: {
          id: 'terracotta_road', name: 'Terracotta Road', short: 'Terracotta', category: 'roads_bridges', milestone: 'City',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          isRoad: true, roadType: 'road', roadStyle: 'terracotta',
          color: '#a86048', icon: '🟧',
          desc: '1×1 Royal Terracotta Road. Unlocked at City (180 pop); fastest road surface.'
        },
        bridge: {
          id: 'bridge', name: 'Wooden Bridge', short: 'Bridge', category: 'roads_bridges', milestone: 'Start',
          w: 1, h: 1, rotatable: false, hasDoor: false,
          isRoad: true, roadType: 'bridge', roadStyle: 'bridge',
          color: '#734f2c', icon: '🌉',
          desc: '1×1 Wooden Bridge. Connects roads across River, Lake, or Fish Shoal tiles.'
        }
      };

   // Hub Child & Foundation Maximum Limits Configuration
      APP.HUB_LIMITS = {
        homestead:   { maxFoundation: 5,  maxAttachments: 2 },
        condo:       { minFoundation: 9,  maxFoundation: 30, maxHouses: 12, maxShops: 4, maxArches: 5 },
        veg_farm:    { maxFoundation: 40 },
        grain_farm:  { maxFoundation: 60 },
        vineyard:    { maxFoundation: 40 },
        stockpile:   { maxFoundation: 3 },
        palace:      { maxFoundation: 40, maxAttachments: 8 },
        lumber_camp: { maxAttachments: 1 }
      };

      // 4. Phase 3 State & Helper Functions
      APP.activeBuildCategory = 'all';
      APP.lastBuildItemId = 'homestead_hub';
      APP.movingLayer2 = null;
      let layer2DeleteStrokeActive = false;

      APP.getRotatedDims = function (defId, rot = 0) {
        const def = APP.BUILDING_DEFS[defId];
        if (!def) return { w: 1, h: 1 };
        if (!def.rotatable) return { w: def.w, h: def.h };
        const r = ((rot % 360) + 360) % 360;
        return (r === 90 || r === 270) ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
      };

  APP.getDoorSide = function (rot = 0, baseSide = 'S') {
        const dirs = ['N', 'E', 'S', 'W'];
        const baseIdx = dirs.indexOf(baseSide) !== -1 ? dirs.indexOf(baseSide) : 2;
        const r = ((rot % 360) + 360) % 360;
        const steps = Math.floor(r / 90);
        return dirs[(baseIdx + steps) % 4];
      };

      APP.getDoorTile = function (b) {
        const def = APP.BUILDING_DEFS[b.defId];
        const baseSide = def ? (def.door || def.doorSide || 'S') : 'S';
        const side = APP.getDoorSide(b.rot || 0, baseSide);
        let dx = 0, dy = 0;
        let chkX = b.x, chkY = b.y;
        if (side === 'N') { dy = -1; chkX += Math.floor(b.w / 2); }
        else if (side === 'S') { dy = 1; chkX += Math.floor(b.w / 2); chkY += b.h - 1; }
        else if (side === 'W') { dx = -1; chkY += Math.floor(b.h / 2); }
        else if (side === 'E') { dx = 1; chkX += b.w - 1; chkY += Math.floor(b.h / 2); }
        return { x: chkX + dx, y: chkY + dy, side };
      };

      function getRootHub(b) {
        if (!b) return null;
        if (b.parentId && APP.buildings.has(b.parentId)) {
          return APP.buildings.get(b.parentId);
        }
        return b;
      }

      function rectsTouchOrthogonally(ax, ay, aw, ah, bx, by, bw, bh) {
        const horizOverlap = ax < bx + bw && ax + aw > bx;
        const vertTouch = (ay + ah === by) || (by + bh === ay);
        const vertOverlap = ay < by + bh && ay + ah > by;
        const horizTouch = (ax + aw === bx) || (bx + bw === ax);
        return (horizOverlap && vertTouch) || (vertOverlap && horizTouch);
      }

      APP.resolveParentHubForChild = function (childDefId, tx, ty) {
        const childDef = APP.BUILDING_DEFS[childDefId];
        if (!childDef || !childDef.isChild) return null;

        if (APP.activeTool.activeHubId && APP.buildings.has(APP.activeTool.activeHubId)) {
          const activeHub = APP.buildings.get(APP.activeTool.activeHubId);
          const hubDef = APP.BUILDING_DEFS[activeHub.defId];
          if (hubDef && hubDef.hubType === childDef.parentHubType) {
            return activeHub;
          }
        }

        const { w, h } = APP.getRotatedDims(childDefId, APP.activeTool.rot);
        for (const b of APP.buildings.values()) {
          const def = APP.BUILDING_DEFS[b.defId];
          if (def && def.isHub && def.hubType === childDef.parentHubType) {
            const overlapsHub = (tx < b.x + b.w && tx + w > b.x && ty < b.y + b.h && ty + h > b.y);
            if (overlapsHub || rectsTouchOrthogonally(tx, ty, w, h, b.x, b.y, b.w, b.h)) {
              return b;
            }
            for (const cid of (b.childrenIds || [])) {
              const child = APP.buildings.get(cid);
              if (child) {
                const overlapsChild = (tx < child.x + child.w && tx + w > child.x && ty < child.y + child.h && ty + h > child.y);
                if (overlapsChild || rectsTouchOrthogonally(tx, ty, w, h, child.x, child.y, child.w, child.h)) {
                  return b;
                }
              }
            }
          }
        }

        let bestHub = null;
        let bestDist = Infinity;
        for (const b of APP.buildings.values()) {
          const def = APP.BUILDING_DEFS[b.defId];
          if (def && def.isHub && def.hubType === childDef.parentHubType) {
            const d = Math.hypot((b.x + b.w / 2) - (tx + w / 2), (b.y + b.h / 2) - (ty + h / 2));
            if (d < bestDist) {
              bestDist = d;
              bestHub = b;
            }
          }
        }
        return bestHub;
      };

      APP.getHubStats = function (hubId) {
        const hub = APP.buildings.get(hubId);
        if (!hub) return null;
        const hubDef = APP.BUILDING_DEFS[hub.defId];
        const children = (hub.childrenIds || []).map(id => APP.buildings.get(id)).filter(Boolean);

        let foundationCount = (hubDef && hubDef.hubType === 'condo') ? 1 : 0;
        let attachmentCount = 0;
        let houseCount = 0;
        let shopCount = 0;
        let archCount = 0;

        for (const c of children) {
          const cDef = APP.BUILDING_DEFS[c.defId];
          if (!cDef) continue;
          if (cDef.isFoundation) foundationCount += (c.w * c.h);
          else if (hubDef?.hubType === 'condo' && cDef.countsAsFoundation && !c.stackedOnId) foundationCount += (c.w * c.h);
          if (cDef.isAttachment) attachmentCount++;
          if (c.defId === 'town_house') houseCount++;
          if (c.defId === 'condo_shop') shopCount++;
          if (c.defId === 'condo_arch') archCount++;
        }

  return {
          hub,
          hubDef,
          children,
          foundationCount,
          attachmentCount,
          houseCount,
          shopCount,
          archCount,
          // Aliases required by Phase 4 APP.evaluateAllWarnings & Overlays:
          foundationTiles: foundationCount,
          attachments: attachmentCount,
          townHouses: houseCount,
          shops: shopCount,
          arches: archCount,
          limits: APP.HUB_LIMITS[hubDef?.hubType] || {}
        };
      };
      APP.getComplexStats = APP.getHubStats;

 // Placement Validation (Bounds, Overlap, Contiguous Children & Deposit Anchors)
      APP.canPlaceBuilding = function (defId, tx, ty, rot = 0, ignoreBuildingIds = null) {
        const def = APP.BUILDING_DEFS[defId];
        if (!def) return { ok: false, reason: 'Unknown building.' };

        if (def.isRoad) {
          if (!APP.inBounds(tx, ty)) return { ok: false, reason: 'Out of bounds.' };
          return { ok: true, reason: '' };
        }

        const { w, h } = APP.getRotatedDims(defId, rot);
        const ignoreSet = ignoreBuildingIds instanceof Set ? ignoreBuildingIds : new Set();

        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const cx = tx + dx;
            const cy = ty + dy;
            if (!APP.inBounds(cx, cy)) {
              return { ok: false, reason: 'Out of bounds.' };
            }
          }
        }

        const isCondoSubUnit = def.parentHubType === 'condo' && !def.isFoundation;
        const isHomesteadAddon = def.parentHubType === 'homestead' && def.isAttachment;

        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const cx = tx + dx;
            const cy = ty + dy;
            const existingId = APP.buildingGrid[cy][cx];
            if (existingId !== null && !ignoreSet.has(existingId)) {
              const existingB = APP.buildings.get(existingId);
              if (isCondoSubUnit && existingB && existingB.defId === 'condo_foundation') continue;
              if (isHomesteadAddon && existingB && existingB.defId === 'homestead_yard') continue;
              return { ok: false, reason: 'Tile occupied by another structure.' };
            }
          }
        }

     if (def.isChild) {
          const parentHub = APP.resolveParentHubForChild(defId, tx, ty);
          if (!parentHub) {
            return { ok: false, reason: `Place a parent ${def.parentHubType.toUpperCase()} Hub first.` };
          }

          // Strict Contiguous & Maximum Limit Checks when Free-Place is OFF
          if (!APP.settings.freePlacement) {
            // 1. Contiguous Check
            let touches = false;
            if (rectsTouchOrthogonally(tx, ty, w, h, parentHub.x, parentHub.y, parentHub.w, parentHub.h)) {
              touches = true;
            } else {
              for (const cid of (parentHub.childrenIds || [])) {
                const child = APP.buildings.get(cid);
                if (!child) continue;
                const overlapsExisting = (tx < child.x + child.w && tx + w > child.x && ty < child.y + child.h && ty + h > child.y);
                if (overlapsExisting || rectsTouchOrthogonally(tx, ty, w, h, child.x, child.y, child.w, child.h)) {
                  touches = true;
                  break;
                }
              }
            }
            if (!touches) {
              return { ok: false, reason: 'Must be placed contiguous to its parent complex (or enable Free-Place).' };
            }

            // 2. Maximum Child / Foundation Limit Checks
            const stats = APP.getHubStats(parentHub.id);
            if (stats && stats.limits) {
              const { limits, foundationCount, attachmentCount, houseCount, shopCount, archCount } = stats;

              // Account for Condo sub-units or Homestead addons replacing an existing foundation tile
              let replacedFoundationTiles = 0;
              for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                  const exId = APP.buildingGrid[ty + dy][tx + dx];
                  const exB = exId ? APP.buildings.get(exId) : null;
                  if (exB && exB.parentId === parentHub.id) {
                    if (isCondoSubUnit && exB.defId === 'condo_foundation') replacedFoundationTiles++;
                    if (isHomesteadAddon && exB.defId === 'homestead_yard') replacedFoundationTiles++;
                  }
                }
              }

              let addedFoundation = 0;
              if (def.isFoundation) {
                addedFoundation = (w * h);
              } else if (def.parentHubType === 'condo' && def.countsAsFoundation) {
                addedFoundation = (w * h) - replacedFoundationTiles;
              }

              if (limits.maxFoundation !== undefined && addedFoundation > 0 && (foundationCount + addedFoundation) > limits.maxFoundation) {
                return { ok: false, reason: `Maximum foundation/field limit reached (${limits.maxFoundation}).` };
              }
              if (def.isAttachment && limits.maxAttachments !== undefined && (attachmentCount + 1) > limits.maxAttachments) {
                return { ok: false, reason: `Maximum attachments limit reached (${limits.maxAttachments}).` };
              }
              if (def.id === 'town_house' && limits.maxHouses !== undefined && (houseCount + 1) > limits.maxHouses) {
                return { ok: false, reason: `Maximum Town Houses limit reached (${limits.maxHouses}).` };
              }
              if (def.id === 'condo_shop' && limits.maxShops !== undefined && (shopCount + 1) > limits.maxShops) {
                return { ok: false, reason: `Maximum Town Shops limit reached (${limits.maxShops}).` };
              }
              if (def.id === 'condo_arch' && limits.maxArches !== undefined && (archCount + 1) > limits.maxArches) {
                return { ok: false, reason: `Maximum Condo Arches limit reached (${limits.maxArches}).` };
              }
            }
          }
        }

        if (!APP.settings.freePlacement) {
          if (def.requiresDeposit) {
            let overlapCount = 0;
            for (let dy = 0; dy < h; dy++) {
              for (let dx = 0; dx < w; dx++) {
                const row = APP.terrain[ty + dy];
                const tCell = row ? row[tx + dx] : null; // Crash-proof terrain array access
                if (tCell && tCell.type === def.requiresDeposit) {
                  overlapCount++;
                }
              }
            }

            const requiredOverlap = def.minDepositOverlap || 1;
            if (overlapCount < requiredOverlap) {
              const reqName = APP.TERRAIN_NAMES[def.requiresDeposit] || def.requiresDeposit;
              return {
                ok: false,
                reason: requiredOverlap > 1
                  ? `Must cover at least ${requiredOverlap} tiles of ${reqName} (or enable Free-Place).`
                  : `Requires ${reqName} underneath (or enable Free-Place).`
              };
            }
          }

          if (def.requiresWaterOrShoal) {
            let hasWater = false;
            for (let dy = 0; dy < h; dy++) {
              for (let dx = 0; dx < w; dx++) {
                const row = APP.terrain[ty + dy];
                const tCell = row ? row[tx + dx] : null; // Crash-proof terrain array access
                if (tCell && (tCell.type === 'river' || tCell.type === 'lake' || tCell.type === 'shoal')) {
                  hasWater = true;
                }
              }
            }
            if (!hasWater) {
              return {
                ok: false,
                reason: 'Fisherman’s Hut must overlap River, Lake, or Fish Shoal (or enable Free-Place).'
              };
            }
          }
        }

        return { ok: true, reason: '' };
      };

      // Place a Road or Bridge Tile at (tx, ty)
      APP.placeRoadAt = function (tx, ty, defId) {
        if (!APP.inBounds(tx, ty)) return false;
        const def = APP.BUILDING_DEFS[defId];
        if (!def || !def.isRoad) return false;

        const key = `${tx},${ty}`;
        const prevRoad = APP.roadGrid[ty][tx];
        const prevStyle = APP.roadStyle.get(key);

        const nextRoadType = prevRoad === 'sewer' && def.roadType === 'road' ? 'sewer' : def.roadType;
        const nextStyle = def.roadStyle || 'dirt';

        if (prevRoad === nextRoadType && prevStyle === nextStyle) {
          return false;
        }

        APP.roadGrid[ty][tx] = nextRoadType;
        APP.roadStyle.set(key, nextStyle);
        return true;
      };

      // Place a Building, Hub, or Child Sub-Element
      APP.placeBuilding = function (defId, tx, ty, rot = 0) {
        const def = APP.BUILDING_DEFS[defId];
        if (!def) return null;

        if (def.isRoad) {
          const changed = APP.placeRoadAt(tx, ty, defId);
          if (changed) {
            if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
            APP.requestRender();
          }
          return changed;
        }

        const check = APP.canPlaceBuilding(defId, tx, ty, rot);
        if (!check.ok) return null;

        const { w, h } = APP.getRotatedDims(defId, rot);
        let parentHub = null;

        let stackedOnId = null;

        if (def.isChild) {
          parentHub = APP.resolveParentHubForChild(defId, tx, ty);
          if (!parentHub) return null;

          const existingId = APP.buildingGrid[ty][tx];
          if (existingId !== null && APP.buildings.has(existingId)) {
            const existingB = APP.buildings.get(existingId);
            const isCondoSubUnit = def.parentHubType === 'condo' && !def.isFoundation;
            const isHomesteadAddon = def.parentHubType === 'homestead' && def.isAttachment;
            if (
              (isCondoSubUnit && existingB.defId === 'condo_foundation') ||
              (isHomesteadAddon && existingB.defId === 'homestead_yard')
            ) {
              if (existingB.parentId && APP.buildings.has(existingB.parentId)) {
                parentHub = APP.buildings.get(existingB.parentId);
              }
              stackedOnId = existingId;
            }
          }
        }

        const id = APP.nextId++;
        const building = {
          id,
          defId,
          x: tx,
          y: ty,
          w,
          h,
          rot: def.rotatable ? ((rot % 360) + 360) % 360 : 0,
          parentId: parentHub ? parentHub.id : null,
          childrenIds: [],
          warnings: [],
          stackedOnId
        };

        APP.buildings.set(id, building);
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            APP.buildingGrid[ty + dy][tx + dx] = id;
          }
        }

        if (def.id === 'sewer_drain' && APP.roadGrid[ty][tx] === 'road') {
          APP.roadGrid[ty][tx] = 'sewer';
        }

  if (parentHub) {
          if (!Array.isArray(parentHub.childrenIds)) parentHub.childrenIds = [];
          parentHub.childrenIds.push(id);
          APP.activeTool.activeHubId = parentHub.id;
        } else if (def.isHub) {
          APP.activeTool.activeHubId = id;
          if (Array.isArray(def.allowedChildren) && def.allowedChildren.length > 0) {
            const defaultChild = def.allowedChildren[0];
            APP.lastBuildItemId = defaultChild;
            
            // Securely set the tool mode so hooks fire and the sidebar UI updates instantly
            if (typeof APP.setToolMode === 'function') {
              APP.setToolMode('build', defaultChild);
            } else {
              APP.activeTool.itemId = defaultChild;
            }
          }
        }

        APP.updateActiveHubBanner();
        syncBuildPaletteUI();
        if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
        APP.requestRender();
        return building;
      };

      // Delete Building by ID
      APP.deleteBuildingById = function (bId, cascadeIfHub = false) {
        const b = APP.buildings.get(bId);
        if (!b) return false;
        const def = APP.BUILDING_DEFS[b.defId];

        if (def && def.isHub && (cascadeIfHub || (b.childrenIds && b.childrenIds.length > 0))) {
          const childCopy = [...(b.childrenIds || [])];
          for (const cid of childCopy) {
            APP.deleteBuildingById(cid, false);
          }
        }

        if (b.parentId && APP.buildings.has(b.parentId)) {
          const parent = APP.buildings.get(b.parentId);
          if (Array.isArray(parent.childrenIds)) {
            parent.childrenIds = parent.childrenIds.filter(cid => cid !== bId);
          }
        }

        for (let dy = 0; dy < b.h; dy++) {
          for (let dx = 0; dx < b.w; dx++) {
            const cx = b.x + dx;
            const cy = b.y + dy;
            if (APP.inBounds(cx, cy) && APP.buildingGrid[cy][cx] === bId) {
              APP.buildingGrid[cy][cx] = (b.stackedOnId && APP.buildings.has(b.stackedOnId)) ? b.stackedOnId : null;
            }
          }
        }

        if (b.defId === 'sewer_drain' && APP.inBounds(b.x, b.y) && APP.roadGrid[b.y][b.x] === 'sewer') {
          APP.roadGrid[b.y][b.x] = 'road';
        }

        APP.buildings.delete(bId);

        if (APP.activeTool.activeHubId === bId) {
          APP.activeTool.activeHubId = null;
        }

        APP.updateActiveHubBanner();
        syncBuildPaletteUI();
        if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
        return true;
      };

      function deleteLayer2At(tx, ty, shiftWholeComplex = false) {
        if (!APP.inBounds(tx, ty)) return false;

        const bId = APP.buildingGrid[ty][tx];
        if (bId !== null && APP.buildings.has(bId)) {
          const b = APP.buildings.get(bId);
          const def = APP.BUILDING_DEFS[b.defId];
          if (shiftWholeComplex && b.parentId && APP.buildings.has(b.parentId)) {
            APP.deleteBuildingById(b.parentId, true);
          } else if (def && def.isHub) {
            APP.deleteBuildingById(bId, true);
          } else {
            APP.deleteBuildingById(bId, false);
          }
          return true;
        }

        if (APP.roadGrid[ty][tx] !== null) {
          APP.roadGrid[ty][tx] = null;
          APP.roadStyle.delete(`${tx},${ty}`);
          if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
          return true;
        }

        return false;
      }

      function getMovedLayer2Layout(tx, ty) {
        if (!APP.movingLayer2) return null;
        const m = APP.movingLayer2;
        const currentRot = APP.activeTool.rot;

        return m.items.map(item => {
          const b = item.b;
          const def = APP.BUILDING_DEFS[b.defId];
          const canRotate = def ? def.rotatable : false;

          const nrot = canRotate ? currentRot : item.origRot;
          const dims = canRotate ? APP.getRotatedDims(b.defId, nrot) : { w: item.origW, h: item.origH };

          return {
            b,
            def,
            x: tx + item.dx,
            y: ty + item.dy,
            w: dims.w,
            h: dims.h,
            rot: nrot
          };
        });
      }

      function pickupLayer2At(tx, ty, moveSingleElement = false) {
        if (!APP.inBounds(tx, ty)) return false;
        const bId = APP.buildingGrid[ty][tx];
        if (bId === null || !APP.buildings.has(bId)) return false;

        const clicked = APP.buildings.get(bId);
        const root = getRootHub(clicked);
        const moveComplex = !moveSingleElement && root && (APP.BUILDING_DEFS[root.defId]?.isHub);

        const allParts = moveComplex
          ? [root, ...(root.childrenIds || []).map(id => APP.buildings.get(id)).filter(Boolean)]
          : [clicked];

        const items = [];
        const ignoreIds = new Set();

        for (const part of allParts) {
          ignoreIds.add(part.id);
          items.push({
            b: part,
            origX: part.x,
            origY: part.y,
            origW: part.w,
            origH: part.h,
            origRot: part.rot || 0,
            dx: part.x - tx,
            dy: part.y - ty
          });
        }

        for (const item of items) {
          const p = item.b;
          for (let dy = 0; dy < p.h; dy++) {
            for (let dx = 0; dx < p.w; dx++) {
              if (APP.buildingGrid[p.y + dy][p.x + dx] === p.id) {
                APP.buildingGrid[p.y + dy][p.x + dx] = (p.stackedOnId && APP.buildings.has(p.stackedOnId)) ? p.stackedOnId : null;
              }
            }
          }
        }

        const initialRot = clicked.rot || 0;
        APP.activeTool.rot = initialRot;
        const rotInd = document.getElementById('rot-indicator');
        if (rotInd) rotInd.textContent = `${initialRot}°`;

        APP.movingLayer2 = {
          anchorX: tx,
          anchorY: ty,
          initialRot,
          items,
          ignoreIds
        };
        APP.requestRender();
        return true;
      }

      function canCommitMovedLayer2At(tx, ty) {
        if (!APP.movingLayer2) return false;
        const parts = getMovedLayer2Layout(tx, ty);
        if (!parts) return false;

        for (const p of parts) {
          for (let dy = 0; dy < p.h; dy++) {
            for (let dx = 0; dx < p.w; dx++) {
              const cx = p.x + dx;
              const cy = p.y + dy;
              if (!APP.inBounds(cx, cy)) return false;
              const occ = APP.buildingGrid[cy][cx];
              if (occ !== null && !APP.movingLayer2.ignoreIds.has(occ)) {
                const existingB = APP.buildings.get(occ);
                const isCondoSubUnit = p.def && p.def.parentHubType === 'condo' && !p.def.isFoundation;
                const isHomesteadAddon = p.def && p.def.parentHubType === 'homestead' && p.def.isAttachment;
                
                if (existingB && (
                  (isCondoSubUnit && existingB.defId === 'condo_foundation') ||
                  (isHomesteadAddon && existingB.defId === 'homestead_yard')
                )) {
                  // Valid stacking overlap, ignore collision
                } else {
                  return false;
                }
              }
            }
          }

          if (!APP.settings.freePlacement && p.def) {
            if (p.def.requiresDeposit) {
              let overlapCount = 0;
              for (let dy = 0; dy < p.h; dy++) {
                for (let dx = 0; dx < p.w; dx++) {
                  const row = APP.terrain[p.y + dy];
                  const tCell = row ? row[p.x + dx] : null;
                  if (tCell && tCell.type === p.def.requiresDeposit) overlapCount++;
                }
              }
              const reqOverlap = p.def.minDepositOverlap || 1;
              if (overlapCount < reqOverlap) return false;
            }
            if (p.def.requiresWaterOrShoal) {
              let hasWater = false;
              for (let dy = 0; dy < p.h; dy++) {
                for (let dx = 0; dx < p.w; dx++) {
                  const row = APP.terrain[p.y + dy];
                  const tCell = row ? row[p.x + dx] : null;
                  if (tCell && (tCell.type === 'river' || tCell.type === 'lake' || tCell.type === 'shoal')) hasWater = true;
                }
              }
              if (!hasWater) return false;
            }
          }
        }
        return true;
      }

      function commitMovedLayer2At(tx, ty) {
        if (!APP.movingLayer2) return false;
        if (!canCommitMovedLayer2At(tx, ty)) return false;

        const parts = getMovedLayer2Layout(tx, ty);
        if (!parts) return false;

        parts.sort((a, b) => {
          const aF = a.def?.isFoundation ? 0 : 1;
          const bF = b.def?.isFoundation ? 0 : 1;
          return aF - bF;
        });

        for (const p of parts) {
          const b = p.b;
          b.x = p.x;
          b.y = p.y;
          b.w = p.w;
          b.h = p.h;
          b.rot = p.rot;
          
          b.stackedOnId = null;
          const def = p.def;
          if (def && def.isChild) {
             const isCondoSub = def.parentHubType === 'condo' && !def.isFoundation;
             const isHomesteadAd = def.parentHubType === 'homestead' && def.isAttachment;
             if (isCondoSub || isHomesteadAd) {
                const exId = APP.buildingGrid[b.y][b.x];
                if (exId !== null && APP.buildings.has(exId)) {
                   const exB = APP.buildings.get(exId);
                   if ((isCondoSub && exB.defId === 'condo_foundation') || (isHomesteadAd && exB.defId === 'homestead_yard')) {
                      b.stackedOnId = exId;
                   }
                }
             }
          }

          for (let dy = 0; dy < b.h; dy++) {
            for (let dx = 0; dx < b.w; dx++) {
              APP.buildingGrid[b.y + dy][b.x + dx] = b.id;
            }
          }
        }

        APP.movingLayer2 = null;
        if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
        APP.notifyStateChanged();
        return true;
      }

      function cancelLayer2Move() {
        if (!APP.movingLayer2) return;
        for (const item of APP.movingLayer2.items) {
          const b = item.b;
          b.x = item.origX;
          b.y = item.origY;
          b.w = item.origW;
          b.h = item.origH;
          b.rot = item.origRot;
          for (let dy = 0; dy < b.h; dy++) {
            for (let dx = 0; dx < b.w; dx++) {
              APP.buildingGrid[b.y + dy][b.x + dx] = b.id;
            }
          }
        }
        APP.movingLayer2 = null;
        APP.requestRender();
      }

 // 5. Build Sidebar UI (#panel-buildings)
      function renderBuildingsSidebar() {
        const panel = document.getElementById('panel-buildings');
        if (!panel) return;

        panel.innerHTML = `
          <!-- Active Parent-Child Complex Inspector Drawer -->
          <div id="complex-inspector-drawer" style="display:none; margin-bottom:12px; padding:10px; border-radius:6px; background:linear-gradient(180deg, #332616 0%, #241b10 100%); border:1px solid var(--border-gold-bright);"></div>

          <!-- Category Filter Chips (With Icons) -->
          <div class="panel-section-title" style="margin-top:0;">Construction Categories</div>
          <div id="build-cat-bar" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:10px;">
            ${BUILDING_CATEGORIES.map(c => `
              <button class="tool-btn ${c.id === APP.activeBuildCategory ? 'active' : ''}"
                      data-cat="${c.id}"
                      style="padding:4px 7px; font-size:11px;">
                ${c.icon} ${c.label}
              </button>
            `).join('')}
          </div>

          <!-- Building Roster Grid (Forced to 1 Column to prevent side-scroll) -->
          <div class="panel-section-title" id="build-list-header">All Buildings</div>
          <div class="item-grid" id="build-item-grid" style="grid-template-columns: 1fr;"></div>

          <!-- Selected Building Details Card -->
          <div id="build-info-card" style="margin-top:12px; padding:10px; border-radius:5px; background:rgba(0,0,0,0.28); border:1px solid var(--border-muted); font-size:11.5px; line-height:1.45;"></div>
        `;

        panel.querySelectorAll('#build-cat-bar .tool-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            APP.activeBuildCategory = btn.dataset.cat;
            syncBuildPaletteUI();
          });
        });

        syncBuildPaletteUI();
      }

      function syncBuildPaletteUI() {
        const panel = document.getElementById('panel-buildings');
        if (!panel) return;

        panel.querySelectorAll('#build-cat-bar .tool-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.cat === APP.activeBuildCategory);
        });

        const drawer = document.getElementById('complex-inspector-drawer');
        if (drawer) {
          if (APP.activeTool.activeHubId && APP.buildings.has(APP.activeTool.activeHubId)) {
            const stats = APP.getHubStats(APP.activeTool.activeHubId);
            if (stats) {
              const { hub, hubDef, foundationCount, attachmentCount, houseCount, shopCount, archCount, limits } = stats;
              let metricsHtml = '';
              if (hubDef.hubType === 'condo') {
                metricsHtml = `
                  <div>Foundations: <strong>${foundationCount}/${limits.maxFoundation}</strong> (Min ${limits.minFoundation})</div>
                  <div>Town Houses: <strong>${houseCount}/${limits.maxHouses}</strong> • Shops: <strong>${shopCount}/${limits.maxShops}</strong> • Arches: <strong>${archCount}/${limits.maxArches}</strong></div>
                `;
              } else if (hubDef.hubType === 'homestead') {
                metricsHtml = `
                  <div>Yard Tiles: <strong>${foundationCount}/${limits.maxFoundation}</strong> (Min 3) • Attachments: <strong>${attachmentCount}/${limits.maxAttachments}</strong></div>
                `;
              } else if (hubDef.hubType === 'lumber_camp') {
                metricsHtml = `
                  <div>Forester Attachment: <strong>${attachmentCount}/${limits.maxAttachments || 1}</strong></div>
                `;
              } else {
                metricsHtml = `
                  <div>Foundation / Field Tiles: <strong>${foundationCount}${limits.maxFoundation ? '/' + limits.maxFoundation : ''}</strong></div>
                `;
              }

              const childButtonsHtml = (hubDef.allowedChildren || []).map(cid => {
                const cDef = APP.BUILDING_DEFS[cid];
                if (!cDef) return '';
                const isSelected = APP.activeTool.mode === 'build' && APP.activeTool.itemId === cid;
                return `
                  <button class="palette-btn ${isSelected ? 'active' : ''}" data-child-id="${cid}" style="padding:5px 7px; font-size:11px;">
                    <span class="swatch" style="background:${cDef.color}; display:flex; align-items:center; justify-content:center; font-size:10px;">${cDef.icon}</span>
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">+ ${cDef.short}</span>
                  </button>
                `;
              }).join('');

              drawer.style.display = 'block';
              drawer.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <strong style="color:var(--accent-gold); font-size:12px;">${hubDef.icon} Active: ${hubDef.name} #${hub.id}</strong>
                  <span style="font-size:10.5px; color:var(--text-muted);">(${hub.x + 1}, ${hub.y + 1})</span>
                </div>
                <div style="font-size:11px; color:var(--text-main); margin-bottom:8px; line-height:1.4;">
                  ${metricsHtml}
                </div>
                <div style="font-size:10.5px; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.4px;">Paint Child Sub-Elements:</div>
                <div class="item-grid" style="grid-template-columns:repeat(2, 1fr); gap:5px;">
                  ${childButtonsHtml}
                </div>
              `;

              drawer.querySelectorAll('[data-child-id]').forEach(b => {
                b.addEventListener('click', () => {
                  const cid = b.dataset.childId;
                  APP.lastBuildItemId = cid;
                  APP.setToolMode('build', cid);
                  syncBuildPaletteUI();
                });
              });
            }
          } else {
            drawer.style.display = 'none';
          }
        }

        const grid = document.getElementById('build-item-grid');
        const header = document.getElementById('build-list-header');
        if (grid && header) {
          const catObj = BUILDING_CATEGORIES.find(c => c.id === APP.activeBuildCategory);
          header.textContent = catObj ? `${catObj.label} Structures` : 'Buildings';

          const items = Object.values(APP.BUILDING_DEFS).filter(d => {
            if (APP.activeBuildCategory === 'all') return true;
            return d.category === APP.activeBuildCategory;
          });

          grid.innerHTML = items.map(d => {
            const isSelected = APP.activeTool.mode === 'build' && APP.activeTool.itemId === d.id;
            const sizeBadge = `${d.w}×${d.h}`;
            return `
              <button class="palette-btn ${isSelected ? 'active' : ''}" data-build-id="${d.id}" title="${d.name} (${sizeBadge}) — ${d.milestone}">
                <span class="swatch" style="background:${d.color}; display:flex; align-items:center; justify-content:center; font-size:11px;">${d.icon}</span>
                <div style="min-width:0; flex:1;">
                  <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d.name}</div>
                  <div style="font-size:10px; color:var(--text-muted);">${sizeBadge} • ${d.milestone}</div>
                </div>
              </button>
            `;
          }).join('');

          grid.querySelectorAll('[data-build-id]').forEach(btn => {
            btn.addEventListener('click', () => {
              const id = btn.dataset.buildId;
              APP.lastBuildItemId = id;
              APP.setToolMode('build', id);
              syncBuildPaletteUI();
            });
          });
        }

 const infoCard = document.getElementById('build-info-card');
        if (infoCard) {
          const curId = (APP.activeTool.mode === 'build' && APP.activeTool.itemId) ? APP.activeTool.itemId : APP.lastBuildItemId;
          const def = APP.BUILDING_DEFS[curId] || APP.BUILDING_DEFS.homestead_hub;
          const { w, h } = APP.getRotatedDims(def.id, APP.activeTool.rot);
          infoCard.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
              <strong style="color:var(--accent-gold); font-family:Georgia,serif;">${def.icon} ${def.name}</strong>
              <span id="ui-build-dims" class="status-badge active">${w}×${h}</span>
            </div>
            <div style="color:var(--text-muted); font-size:11px; margin-bottom:5px;">
              Milestone: <strong style="color:var(--text-main);">${def.milestone}</strong>
              ${def.hasDoor ? ` • Door: <strong id="ui-door-dir" style="color:#ffdf73;">${APP.getDoorSide(APP.activeTool.rot, def.door || def.doorSide || 'S')}</strong>` : ''}
            </div>
            <div style="color:var(--text-main);">${def.desc}</div>
          `;
        }
      }

// Real-time Sidebar Door & Dimension Updater for 'R' Key Rotation
      APP.hooks.onKeyDown.push((e) => {
        if (e.key === 'r' || e.key === 'R') {
          // Use a tiny timeout to ensure the main engine has already updated the rotation math
          setTimeout(() => {
            const curId = (APP.activeTool.mode === 'build' && APP.activeTool.itemId) ? APP.activeTool.itemId : APP.lastBuildItemId;
            const def = curId ? APP.BUILDING_DEFS[curId] : null;
            
            const doorSpan = document.getElementById('ui-door-dir');
            if (doorSpan && def) {
              doorSpan.textContent = APP.getDoorSide(APP.activeTool.rot, def.door || def.doorSide || 'S');
            }
            
            const dimSpan = document.getElementById('ui-build-dims');
            if (dimSpan && def) {
              const { w, h } = APP.getRotatedDims(curId, APP.activeTool.rot);
              dimSpan.textContent = `${w}×${h}`;
            }
          }, 10);
        }
      });

      // 6. Hook into Canvas Mouse & Keyboard Events
      let isBuildShiftRightErasing = false;

      APP.finishActiveHub = function () {
        let parentHubDefId = null;
        if (APP.activeTool.activeHubId && APP.buildings.has(APP.activeTool.activeHubId)) {
          const hub = APP.buildings.get(APP.activeTool.activeHubId);
          parentHubDefId = hub.defId;
        } else {
          const curDef = APP.BUILDING_DEFS[APP.activeTool.itemId];
          if (curDef && curDef.isChild) {
            const matchingHub = Object.values(APP.BUILDING_DEFS).find(
              d => d.isHub && d.hubType === curDef.parentHubType
            );
            if (matchingHub) parentHubDefId = matchingHub.id;
          }
        }

        APP.activeTool.activeHubId = null;
        if (parentHubDefId) {
          APP.lastBuildItemId = parentHubDefId;
          APP.activeTool.itemId = parentHubDefId;
        }
        APP.updateActiveHubBanner();
        syncBuildPaletteUI();
        APP.requestRender();
      };

      APP.hooks.onToolChange.push((tool) => {
        if (tool.mode === 'build' && (!tool.itemId || !APP.BUILDING_DEFS[tool.itemId])) {
          tool.itemId = APP.lastBuildItemId || 'homestead_hub';
        }
        if (tool.mode !== 'move' && APP.movingLayer2) {
          cancelLayer2Move();
        }
        syncBuildPaletteUI();
      });

      APP.hooks.onMouseDown.push((e, mouse) => {
        if (!mouse.inBounds) return;
        const { tx, ty } = mouse;

        if (e.ctrlKey && e.button === 0) {
          const bId = APP.buildingGrid[ty][tx];
          if (bId && APP.buildings.has(bId)) {
            const root = getRootHub(APP.buildings.get(bId));
            const rootDef = root ? APP.BUILDING_DEFS[root.defId] : null;
            if (rootDef && rootDef.isHub) {
              APP.activeTool.activeHubId = root.id;
              APP.updateActiveHubBanner();
              APP.setActiveTab('buildings');
              APP.requestRender();
              return;
            }
          }
        }

        if (APP.activeTool.mode === 'build') {
          if (e.button === 0) {
            const itemId = APP.activeTool.itemId || APP.lastBuildItemId;
            const def = APP.BUILDING_DEFS[itemId];
            if (!def) return;

            if (def.isRoad) {
              if (APP.placeRoadAt(tx, ty, itemId)) {
                if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
                APP.notifyStateChanged();
              }
            } else {
              const placed = APP.placeBuilding(itemId, tx, ty, APP.activeTool.rot);
              if (placed) {
                APP.notifyStateChanged();
              }
            }
          } else if (e.button === 2) {
            if (e.shiftKey) {
              isBuildShiftRightErasing = true;
              if (deleteLayer2At(tx, ty, false)) {
                APP.notifyStateChanged();
              }
            } else if (APP.activeTool.activeHubId !== null || APP.BUILDING_DEFS[APP.activeTool.itemId]?.isChild) {
              APP.finishActiveHub();
            } else {
              APP.setToolMode('pan', null);
            }
          }
          return;
        }

        if (APP.activeTool.mode === 'delete') {
          if (e.button === 0 && !e.altKey) {
            if (deleteLayer2At(tx, ty, e.shiftKey)) {
              layer2DeleteStrokeActive = true;
              APP.notifyStateChanged();
            }
          } else if (e.button === 2 && !e.shiftKey) {
            APP.setToolMode('pan', null);
          }
          return;
        }

        if (APP.activeTool.mode === 'move') {
          if (e.button === 2) {
            if (APP.movingLayer2) {
              cancelLayer2Move();
            } else if (!e.shiftKey) {
              APP.setToolMode('pan', null);
            }
            return;
          }
          if (e.button === 0 && !e.altKey) {
            if (APP.movingLayer2) {
              commitMovedLayer2At(tx, ty);
            } else {
              pickupLayer2At(tx, ty, e.shiftKey);
            }
          }
        }
      });

      APP.hooks.onMouseMove.push((e, mouse) => {
        if (!mouse.inBounds) return;
        const { tx, ty } = mouse;

        if (APP.activeTool.mode === 'build') {
          if (mouse.isDown && mouse.button === 0) {
            const itemId = APP.activeTool.itemId || APP.lastBuildItemId;
            const def = APP.BUILDING_DEFS[itemId];
            if (def) {
              if (def.isRoad) {
                if (APP.placeRoadAt(tx, ty, itemId)) {
                  if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
                  APP.notifyStateChanged();
                }
              } else if (def.dragPaintChild || def.dragPaintBuilding) {
                const placed = APP.placeBuilding(itemId, tx, ty, APP.activeTool.rot);
                if (placed) {
                  APP.notifyStateChanged();
                }
              }
            }
          } else if (isBuildShiftRightErasing && e.shiftKey) {
            if (deleteLayer2At(tx, ty, false)) {
              APP.notifyStateChanged();
            }
          }
        }

        if (APP.activeTool.mode === 'delete' && mouse.isDown && mouse.button === 0 && !e.altKey) {
          if (deleteLayer2At(tx, ty, e.shiftKey)) {
            layer2DeleteStrokeActive = true;
            APP.notifyStateChanged();
          }
        }

        const bId = APP.buildingGrid[ty][tx];
        const rVal = APP.roadGrid[ty][tx];
        if (bId !== null && APP.buildings.has(bId)) {
          const b = APP.buildings.get(bId);
          const def = APP.BUILDING_DEFS[b.defId];
          const root = getRootHub(b);
          document.getElementById('st-building').textContent = def ? def.name : 'Building';

          if (!mouse.isDown) {
            let subText = `Footprint: ${b.w}×${b.h} • Tile (${tx + 1}, ${ty + 1})`;
            if (def?.hasDoor) subText += ` • Door: ${APP.getDoorSide(b.rot, def.door || def.doorSide || 'S')}`;
            if (root && APP.BUILDING_DEFS[root.defId]?.isHub) {
              const st = APP.getHubStats(root.id);
              if (st) {
                if (st.hubDef.hubType === 'condo') {
                  subText += `<br/>Condo #${root.id}: ${st.foundationCount} tiles, ${st.houseCount}/12 Houses, ${st.shopCount}/4 Shops`;
                } else if (st.hubDef.hubType === 'homestead') {
                  subText += `<br/>Homestead #${root.id}: ${st.foundationCount}/5 Yard tiles, ${st.attachmentCount}/2 Addons`;
                } else if (st.hubDef.hubType === 'lumber_camp') {
                  subText += `<br/>Lumber Camp #${root.id}: ${st.attachmentCount}/1 Forester`;
                } else {
                  subText += `<br/>Complex #${root.id}: ${st.foundationCount} foundation/field tiles`;
                }
              }
            }
            const warnHtml = (b.warnings && b.warnings.length > 0)
              ? `<div class="tt-warn">${b.warnings.map(w => `• ${w}`).join('<br/>')}</div>`
              : '';

            APP.showTooltip(`
              <div class="tt-title">${def ? def.icon : ''} ${def ? def.name : 'Structure'}</div>
              <div class="tt-sub">${subText}</div>
              ${warnHtml}
            `, e.clientX, e.clientY);
          }
        } else if (rVal !== null) {
          const style = APP.roadStyle.get(`${tx},${ty}`) || 'dirt';
          const label = rVal === 'bridge'
            ? 'Wooden Bridge'
            : (rVal === 'sewer' ? 'Road + Sewer Drain' : (style === 'terracotta' ? 'Terracotta Road' : (style === 'cobble' ? 'Cobblestone Road' : 'Gravel / Dirt Road')));
          document.getElementById('st-building').textContent = label;
          if (!mouse.isDown) {
            APP.showTooltip(`
              <div class="tt-title">🛤️ ${label}</div>
              <div class="tt-sub">Tile (${tx + 1}, ${ty + 1})</div>
            `, e.clientX, e.clientY);
          }
        }
      });

      APP.hooks.onMouseUp.push(() => {
        layer2DeleteStrokeActive = false;
        isBuildShiftRightErasing = false;
      });

      APP.hooks.onWipeCanvas.push(() => {
        APP.roadStyle.clear();
        APP.movingLayer2 = null;
        syncBuildPaletteUI();
      });

      // 7. Canvas Rendering: Roads, Foundations, Buildings, Complex Borders & Warning Badges
      function drawDoorArrow(ctx, b, S) {
        const def = APP.BUILDING_DEFS[b.defId];
        if (!def || !def.hasDoor) return;

        const px = b.x * S;
        const py = b.y * S;
        const pw = b.w * S;
        const ph = b.h * S;
        const side = APP.getDoorSide(b.rot, def.door || def.doorSide || 'S');

        ctx.save();
        ctx.fillStyle = '#ffdf73';
        ctx.strokeStyle = '#1f160f';
        ctx.lineWidth = 1.2;

        let cx = px + pw / 2;
        let cy = py + ph / 2;
        const sz = 5;

        ctx.beginPath();
        if (side === 'S') {
          cx = px + pw / 2;
          cy = py + ph - 2;
          ctx.moveTo(cx, cy + 2);
          ctx.lineTo(cx - sz, cy - sz);
          ctx.lineTo(cx + sz, cy - sz);
        } else if (side === 'N') {
          cx = px + pw / 2;
          cy = py + 2;
          ctx.moveTo(cx, cy - 2);
          ctx.lineTo(cx - sz, cy + sz);
          ctx.lineTo(cx + sz, cy + sz);
        } else if (side === 'W') {
          cx = px + 2;
          cy = py + ph / 2;
          ctx.moveTo(cx - 2, cy);
          ctx.lineTo(cx + sz, cy - sz);
          ctx.lineTo(cx + sz, cy + sz);
        } else if (side === 'E') {
          cx = px + pw - 2;
          cy = py + ph / 2;
          ctx.moveTo(cx + 2, cy);
          ctx.lineTo(cx - sz, cy - sz);
          ctx.lineTo(cx - sz, cy + sz);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

  const COMPLEX_BORDER_RGB = {
        homestead:   [235, 208, 141], // Soft Pale Gold
        condo:       [212, 208, 200], // Crisp Pale Stone
        veg_farm:    [222, 184, 104], // Warm Harvest Amber
        grain_farm:  [222, 184, 104], // Warm Harvest Amber
        vineyard:    [222, 184, 104], // Warm Harvest Amber
        stockpile:   [214, 172, 122], // Warm Cedar / Bronze
        lumber_camp: [188, 214, 165], // Forest Sage
        palace:      [255, 215, 0]    // Royal Gold
      };

      APP.onDrawBuildingsAndRoads = function (ctx) {
        const S = APP.TILE_PX;
        const G = APP.GRID_SIZE;

        // Pass 1: Draw Seamless Roads & Bridges with True Outer Curbs/Shoulders & Surface Detail
        const hasRoadAt = (x, y) => APP.inBounds(x, y) && APP.roadGrid[y][x] !== null;

        for (let y = 0; y < G; y++) {
          for (let x = 0; x < G; x++) {
            const r = APP.roadGrid[y][x];
            if (!r) continue;
            const px = x * S;
            const py = y * S;
            const style = APP.roadStyle.get(`${x},${y}`) || 'dirt';

            if (r === 'bridge') {
              ctx.fillStyle = '#734f2c';
              ctx.fillRect(px + 1, py + 1, S - 2, S - 2);
              ctx.strokeStyle = '#c49a6c';
              ctx.lineWidth = 2;
              ctx.strokeRect(px + 2, py + 2, S - 4, S - 4);
              ctx.strokeStyle = 'rgba(0,0,0,0.35)';
              ctx.lineWidth = 1;
              for (let i = 6; i < S - 4; i += 6) {
                ctx.beginPath();
                ctx.moveTo(px + i, py + 2);
                ctx.lineTo(px + i, py + S - 2);
                ctx.stroke();
              }
            } else {
              const isCobble = style === 'cobble';
              const isTerracotta = style === 'terracotta';
              const fill = isTerracotta ? '#a86048' : (isCobble ? '#7d828a' : '#967e5e');
              const innerTrack = isTerracotta ? '#b86c52' : (isCobble ? '#8a9099' : '#a38a68');
              const trim = isTerracotta ? '#5e3122' : (isCobble ? '#45484f' : '#594730');
              const pad = 4;

              const nN = hasRoadAt(x, y - 1);
              const nS = hasRoadAt(x, y + 1);
              const nW = hasRoadAt(x - 1, y);
              const nE = hasRoadAt(x + 1, y);

              // 1. Continuous Base Road Fill
              ctx.fillStyle = fill;
              ctx.fillRect(px + pad, py + pad, S - pad * 2, S - pad * 2);
              if (nN) ctx.fillRect(px + pad, py, S - pad * 2, pad);
              if (nS) ctx.fillRect(px + pad, py + S - pad, S - pad * 2, pad);
              if (nW) ctx.fillRect(px, py + pad, pad, S - pad * 2);
              if (nE) ctx.fillRect(px + S - pad, py + pad, pad, S - pad * 2);

              // 2. Subtle Path Crown & Surface Texture
              ctx.fillStyle = innerTrack;
              ctx.fillRect(px + pad + 3, py + pad + 3, S - (pad + 3) * 2, S - (pad + 3) * 2);
              if (nN) ctx.fillRect(px + pad + 3, py, S - (pad + 3) * 2, pad + 3);
              if (nS) ctx.fillRect(px + pad + 3, py + S - pad - 3, S - (pad + 3) * 2, pad + 3);
              if (nW) ctx.fillRect(px, py + pad + 3, pad + 3, S - (pad + 3) * 2);
              if (nE) ctx.fillRect(px + S - pad - 3, py + pad + 3, pad + 3, S - (pad + 3) * 2);

              if (APP.camera.zoom >= 0.55) {
                if (isCobble || isTerracotta) {
                  ctx.strokeStyle = isTerracotta ? 'rgba(75, 32, 20, 0.35)' : 'rgba(40, 44, 52, 0.32)';
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.moveTo(px + pad + 2, py + S * 0.36);
                  ctx.lineTo(px + S - pad - 2, py + S * 0.36);
                  ctx.moveTo(px + pad + 2, py + S * 0.66);
                  ctx.lineTo(px + S - pad - 2, py + S * 0.66);
                  ctx.moveTo(px + S * 0.5, py + pad + 2);
                  ctx.lineTo(px + S * 0.5, py + S * 0.36);
                  ctx.moveTo(px + S * 0.35, py + S * 0.36);
                  ctx.lineTo(px + S * 0.35, py + S * 0.66);
                  ctx.moveTo(px + S * 0.68, py + S * 0.66);
                  ctx.lineTo(px + S * 0.68, py + S - pad - 2);
                  ctx.stroke();
                } else {
                  ctx.fillStyle = 'rgba(72, 55, 36, 0.35)';
                  ctx.fillRect(px + 9, py + 9, 2, 2);
                  ctx.fillRect(px + S - 12, py + 14, 2, 2);
                  ctx.fillRect(px + 12, py + S - 11, 2, 2);
                }
              }

              // 3. True Outer Curbs / Shoulders Only on Unconnected Edges
              ctx.strokeStyle = trim;
              ctx.lineWidth = 1.5;
              ctx.beginPath();

              if (!nN) {
                ctx.moveTo(px + (nW ? 0 : pad), py + pad);
                ctx.lineTo(px + S - (nE ? 0 : pad), py + pad);
              }
              if (!nS) {
                ctx.moveTo(px + (nW ? 0 : pad), py + S - pad);
                ctx.lineTo(px + S - (nE ? 0 : pad), py + S - pad);
              }
              if (!nW) {
                ctx.moveTo(px + pad, py + (nN ? 0 : pad));
                ctx.lineTo(px + pad, py + S - (nS ? 0 : pad));
              }
              if (!nE) {
                ctx.moveTo(px + S - pad, py + (nN ? 0 : pad));
                ctx.lineTo(px + S - pad, py + S - (nS ? 0 : pad));
              }

              if (nN && nW && !hasRoadAt(x - 1, y - 1)) {
                ctx.moveTo(px, py + pad);
                ctx.lineTo(px + pad, py + pad);
                ctx.lineTo(px + pad, py);
              }
              if (nN && nE && !hasRoadAt(x + 1, y - 1)) {
                ctx.moveTo(px + S, py + pad);
                ctx.lineTo(px + S - pad, py + pad);
                ctx.lineTo(px + S - pad, py);
              }
              if (nS && nW && !hasRoadAt(x - 1, y + 1)) {
                ctx.moveTo(px, py + S - pad);
                ctx.lineTo(px + pad, py + S - pad);
                ctx.lineTo(px + pad, py + S);
              }
              if (nS && nE && !hasRoadAt(x + 1, y + 1)) {
                ctx.moveTo(px + S, py + S - pad);
                ctx.lineTo(px + S - pad, py + S - pad);
                ctx.lineTo(px + S - pad, py + S);
              }

              ctx.stroke();
            }
          }
        }

        // Pass 2: Draw Foundation / Yard / Crop / Storage Child Tiles First
        for (const b of APP.buildings.values()) {
          const def = APP.BUILDING_DEFS[b.defId];
          if (!def || !def.isFoundation) continue;

          const px = b.x * S;
          const py = b.y * S;
          const pw = b.w * S;
          const ph = b.h * S;

          ctx.save();
          ctx.fillStyle = def.color;
          ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);

          if (b.defId === 'condo_foundation') {
            ctx.strokeStyle = APP.isStorybookMap() ? '#756044' : '#bab2a6';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);
          } else if (b.defId === 'homestead_yard') {
            ctx.strokeStyle = APP.isStorybookMap() ? '#80613d' : '#9c7a4c';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);
            ctx.setLineDash([]);
       } else if (b.defId === 'veg_field' || b.defId === 'grain_field' || b.defId === 'vine_field') {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
            ctx.lineWidth = 2;
            for (let ry = py + 5; ry < py + ph - 3; ry += 6) {
              ctx.beginPath();
              ctx.moveTo(px + 4, ry);
              ctx.lineTo(px + pw - 4, ry);
              ctx.stroke();
            }
          } else {
            ctx.strokeStyle = APP.isStorybookMap()
              ? 'rgba(74, 52, 31, 0.42)'
              : 'rgba(255, 235, 195, 0.35)';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);
          }
          ctx.restore();
        }

        // Pass 3: Draw Primary Structures, Hubs, Condo Units & Attachments
        for (const b of APP.buildings.values()) {
          const def = APP.BUILDING_DEFS[b.defId];
          if (!def || def.isFoundation) continue;

          const px = b.x * S;
          const py = b.y * S;
          const pw = b.w * S;
          const ph = b.h * S;

          ctx.save();

          if (def.parentHubType === 'condo') {
            ctx.fillStyle = '#8b857c';
            ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
          }

          ctx.fillStyle = def.color;
          ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);

          if (def.roofColor) {
            ctx.fillStyle = def.roofColor;
            ctx.fillRect(px + 5, py + 5, pw - 10, ph - 10);
          }

          const isActiveHub = APP.activeTool.activeHubId && (b.id === APP.activeTool.activeHubId || b.parentId === APP.activeTool.activeHubId);
          ctx.strokeStyle = isActiveHub
            ? '#ffdf73'
            : def.isHub
              ? (APP.isStorybookMap() ? '#c29a58' : '#e6b85c')
              : (APP.isStorybookMap() ? '#493522' : '#261b12');
          ctx.lineWidth = isActiveHub || def.isHub ? 2.2 : (APP.isStorybookMap() ? 1.8 : 1.5);
          ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);

          if (APP.camera.zoom >= 0.42) {
            ctx.fillStyle = '#fff6e5';
            ctx.font = `${Math.round(Math.min(pw, ph) * 0.42)}px "Segoe UI Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const iconY = (b.h > 1 || b.w > 1) && APP.camera.zoom >= 0.65 ? py + ph / 2 - 5 : py + ph / 2;
            ctx.fillText(def.icon, px + pw / 2, iconY);

            if ((b.w > 1 || b.h > 1) && APP.camera.zoom >= 0.65) {
              ctx.font = `bold 9.5px ${APP.getCanvasTextFontFamily()}`;
              ctx.fillStyle = '#ffdfa0';
              ctx.fillText(def.short, px + pw / 2, py + ph - 7);
            }
          }

          drawDoorArrow(ctx, b, S);
          ctx.restore();
        }

        // Pass 4: Unified Category-Tinted Outer Perimeter Border Around All Hub-and-Child Complexes
        for (const hub of APP.buildings.values()) {
          const hubDef = APP.BUILDING_DEFS[hub.defId];
          if (!hubDef || !hubDef.isHub) continue;

          const childIds = hub.childrenIds || [];
          const isEditing = APP.activeTool.activeHubId === hub.id;
          if (childIds.length === 0 && !isEditing) continue;

          const memberIds = new Set([hub.id, ...childIds]);
          const parts = [hub, ...childIds.map(cid => APP.buildings.get(cid)).filter(Boolean)];
          const isSameComplex = (tx, ty) => APP.inBounds(tx, ty) && memberIds.has(APP.buildingGrid[ty][tx]);

          const rgb = COMPLEX_BORDER_RGB[hubDef.hubType] || [245, 230, 196];
          const alpha = isEditing ? 0.95 : 0.62;
          const ins = 1;

          ctx.save();
          ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
          ctx.lineWidth = (isEditing ? 2.25 : 1.75) / APP.camera.zoom;
          ctx.beginPath();

          for (const part of parts) {
            for (let dy = 0; dy < part.h; dy++) {
              for (let dx = 0; dx < part.w; dx++) {
                const cx = part.x + dx;
                const cy = part.y + dy;
                const px = cx * S;
                const py = cy * S;

                if (!isSameComplex(cx, cy - 1)) {
                  ctx.moveTo(px + ins, py + ins);
                  ctx.lineTo(px + S - ins, py + ins);
                }
                if (!isSameComplex(cx, cy + 1)) {
                  ctx.moveTo(px + ins, py + S - ins);
                  ctx.lineTo(px + S - ins, py + S - ins);
                }
                if (!isSameComplex(cx - 1, cy)) {
                  ctx.moveTo(px + ins, py + ins);
                  ctx.lineTo(px + ins, py + S - ins);
                }
                if (!isSameComplex(cx + 1, cy)) {
                  ctx.moveTo(px + S - ins, py + ins);
                  ctx.lineTo(px + S - ins, py + S - ins);
                }
              }
            }
          }
          ctx.stroke();
          ctx.restore();
        }

        // Pass 5: Draw Red Advisory Warning Borders & Badges on Buildings with Rule/Limit Violations
        for (const b of APP.buildings.values()) {
          if (!Array.isArray(b.warnings) || b.warnings.length === 0) continue;
          const px = b.x * S;
          const py = b.y * S;
          const pw = b.w * S;
          const ph = b.h * S;

          ctx.save();
          ctx.fillStyle = 'rgba(214, 56, 45, 0.22)';
          ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
          ctx.strokeStyle = '#ff4d42';
          ctx.lineWidth = 2.2 / APP.camera.zoom;
          ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);

          if (APP.camera.zoom >= 0.45) {
            ctx.fillStyle = '#b8251d';
            ctx.fillRect(px + pw - 13, py + 2, 11, 11);
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold 9px ${APP.getCanvasTextFontFamily()}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('!', px + pw - 7.5, py + 7.5);
          }
          ctx.restore();
        }
      };

      // 8. Layer 2 Ghost Preview, Move Preview & Delete Highlight
      const prevDrawGhost = APP.onDrawSelectionAndGhost;
      APP.onDrawSelectionAndGhost = function (ctx) {
        if (typeof prevDrawGhost === 'function') {
          prevDrawGhost(ctx);
        }
        if (!APP.mouse.inBounds) return;

        const S = APP.TILE_PX;
        const { tx, ty } = APP.mouse;

        if (APP.activeTool.mode === 'build') {
          const itemId = APP.activeTool.itemId || APP.lastBuildItemId;
          const def = APP.BUILDING_DEFS[itemId];
          if (!def) return;

          const { w, h } = APP.getRotatedDims(itemId, APP.activeTool.rot);
          
          // Identify if we're hovering a valid foundation to ignore it for the ghost collision check
          const ignoreSet = new Set();
          if (def.isChild && !def.isFoundation) {
            const hoveredBldId = APP.buildingGrid[ty][tx];
            if (hoveredBldId !== null && APP.buildings.has(hoveredBldId)) {
              const hoveredBld = APP.buildings.get(hoveredBldId);
              if (
                (def.parentHubType === 'condo' && hoveredBld.defId === 'condo_foundation') ||
                (def.parentHubType === 'homestead' && hoveredBld.defId === 'homestead_yard')
              ) {
                ignoreSet.add(hoveredBldId);
              }
            }
          }

          const check = APP.canPlaceBuilding(itemId, tx, ty, APP.activeTool.rot, ignoreSet);
          const px = tx * S;
          const py = ty * S;
          const pw = w * S;
          const ph = h * S;

          ctx.save();
          ctx.globalAlpha = 0.68;
          ctx.fillStyle = check.ok ? def.color : '#a82820';
          
          if (def.isFoundation) {
            ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = check.ok ? '#6ee061' : '#ff5e52';
            ctx.lineWidth = 2.2 / APP.camera.zoom;
            ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
          } else {
            ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = check.ok ? '#6ee061' : '#ff5e52';
            ctx.lineWidth = 2.2 / APP.camera.zoom;
            ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);
          }

          if (def.hasDoor) {
            drawDoorArrow(ctx, { defId: itemId, x: tx, y: ty, w, h, rot: APP.activeTool.rot }, S);
          }

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 12px "Segoe UI Emoji", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.icon, px + pw / 2, py + ph / 2);
          ctx.restore();
          return;
        }

        if (APP.activeTool.mode === 'move' && APP.movingLayer2) {
          const valid = canCommitMovedLayer2At(tx, ty);
          const parts = getMovedLayer2Layout(tx, ty);
          if (parts) {
            ctx.save();
            for (const p of parts) {
              const def = p.def;
              const nx = p.x * S;
              const ny = p.y * S;
              const nw = p.w * S;
              const nh = p.h * S;

              ctx.globalAlpha = 0.68;
              ctx.fillStyle = valid ? (def?.color || '#5588aa') : '#a82820';
              
              if (def && def.isFoundation) {
                ctx.fillRect(nx + 1, ny + 1, nw - 2, nh - 2);
                ctx.globalAlpha = 1.0;
                ctx.strokeStyle = valid ? '#6ee061' : '#ff5e52';
                ctx.lineWidth = 2.2 / APP.camera.zoom;
                ctx.strokeRect(nx + 1, ny + 1, nw - 2, nh - 2);
              } else {
                ctx.fillRect(nx + 2, ny + 2, nw - 4, nh - 4);
                ctx.globalAlpha = 1.0;
                ctx.strokeStyle = valid ? '#6ee061' : '#ff5e52';
                ctx.lineWidth = 2.2 / APP.camera.zoom;
                ctx.strokeRect(nx + 2, ny + 2, nw - 4, nh - 4);
              }

              if (def && def.hasDoor) {
                drawDoorArrow(ctx, { defId: p.b.defId, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot }, S);
              }

              if (def && APP.camera.zoom >= 0.42) {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 12px "Segoe UI Emoji", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(def.icon, nx + nw / 2, ny + nh / 2);
              }
            }
            ctx.restore();
          }
          return;
        }

        if (APP.activeTool.mode === 'delete') {
          const bId = APP.buildingGrid[ty][tx];
          if (bId !== null && APP.buildings.has(bId)) {
            const b = APP.buildings.get(bId);
            ctx.save();
            ctx.fillStyle = 'rgba(224, 67, 56, 0.35)';
            ctx.fillRect(b.x * S, b.y * S, b.w * S, b.h * S);
            ctx.strokeStyle = '#ff5e52';
            ctx.lineWidth = 2.5 / APP.camera.zoom;
            ctx.strokeRect(b.x * S, b.y * S, b.w * S, b.h * S);
            ctx.restore();
          }
        }
      };

      // Initialize Phase 3 Sidebar
      renderBuildingsSidebar();
    })();

    // === [SLOT PHASE 4: ADVISORY RULES & OVERLAYS] ===
    (function initPhase4RulesAndOverlays() {
      // 1. Outer-Edge Circular (0.7x Diagonal) Distance Metric
      APP.getEdgeDistance = function (tx, ty, rx, ry, rw, rh) {
        const dx = Math.max(0, rx - tx, tx - (rx + rw - 1));
        const dy = Math.max(0, ry - ty, ty - (ry + rh - 1));
        if (dx === 0 && dy === 0) return 0;
        return Math.hypot(dx, dy);
      };

      APP.isTileWithinRadius = function (tx, ty, rx, ry, rw, rh, radius) {
        if (radius <= 0) return false;
        const dist = APP.getEdgeDistance(tx, ty, rx, ry, rw, rh);
        return dist <= radius + 0.15;
      };

      APP.getFootprintDistance = function (b1, b2) {
        const dx = Math.max(0, b1.x - (b2.x + b2.w - 1), b2.x - (b1.x + b1.w - 1));
        const dy = Math.max(0, b1.y - (b2.y + b2.h - 1), b2.y - (b1.y + b1.h - 1));
        if (dx === 0 && dy === 0) return 0;
        return Math.hypot(dx, dy);
      };

      // 2. Cached Overlay Grids for Fast 60fps Viewport Rendering
      APP.overlayCache = {
        dirty: true,
        waterGrid: [],
        sewerGrid: [],
        baseDesirGrid: [],
        townHouseDesirGrid: [],
        decorGrid: [],
        workAreaGrid: []
      };

      function allocateOverlayGrids() {
        const G = APP.GRID_SIZE;
        APP.overlayCache.waterGrid = Array.from({ length: G }, () => new Array(G).fill(false));
        APP.overlayCache.sewerGrid = Array.from({ length: G }, () => new Array(G).fill(false));
        APP.overlayCache.baseDesirGrid = Array.from({ length: G }, () => new Array(G).fill(0));
        APP.overlayCache.townHouseDesirGrid = Array.from({ length: G }, () => new Array(G).fill(0));
        APP.overlayCache.decorGrid = Array.from({ length: G }, () => new Array(G).fill(false));
        APP.overlayCache.workAreaGrid = Array.from({ length: G }, () => new Array(G).fill(0));
      }
      allocateOverlayGrids();

      APP.recomputeOverlayCache = function () {
        const G = APP.GRID_SIZE;
        if (APP.overlayCache.waterGrid.length !== G) allocateOverlayGrids();
	const {
          waterGrid,
          sewerGrid,
          baseDesirGrid,
          townHouseDesirGrid,
          decorGrid,
          workAreaGrid
        } = APP.overlayCache;

        for (let y = 0; y < G; y++) {
          waterGrid[y].fill(false);
          sewerGrid[y].fill(false);
          baseDesirGrid[y].fill(0);
          townHouseDesirGrid[y].fill(0);
          decorGrid[y].fill(false);
          workAreaGrid[y].fill(0);
        }

        for (const b of APP.buildings.values()) {
          const def = APP.BUILDING_DEFS ? APP.BUILDING_DEFS[b.defId] : null;
          if (!def) continue;

          // A. Water Coverage (Basic Well = 6, Town Well = 7)
          if (def.waterRadius) {
            const R = def.waterRadius;
            const minX = Math.max(0, b.x - R - 1);
            const maxX = Math.min(G - 1, b.x + b.w + R);
            const minY = Math.max(0, b.y - R - 1);
            const maxY = Math.min(G - 1, b.y + b.h + R);
            for (let ty = minY; ty <= maxY; ty++) {
              for (let tx = minX; tx <= maxX; tx++) {
                if (APP.isTileWithinRadius(tx, ty, b.x, b.y, b.w, b.h, R)) {
                  waterGrid[ty][tx] = true;
                }
              }
            }
          }

          // B. Sewer Coverage (Sewer Drain = 3)
          if (def.sewerRadius) {
            const R = def.sewerRadius;
            const minX = Math.max(0, b.x - R - 1);
            const maxX = Math.min(G - 1, b.x + b.w + R);
            const minY = Math.max(0, b.y - R - 1);
            const maxY = Math.min(G - 1, b.y + b.h + R);
            for (let ty = minY; ty <= maxY; ty++) {
              for (let tx = minX; tx <= maxX; tx++) {
                if (APP.isTileWithinRadius(tx, ty, b.x, b.y, b.w, b.h, R)) {
                  sewerGrid[ty][tx] = true;
                }
              }
            }
          }

          // C. Work Area Coverage (Lumber Camp = 9, Forester = 9, Fisherman = 8, Fairy Tower = 10)
          if (def.workAreaRadius) {
            const R = def.workAreaRadius;
            const minX = Math.max(0, b.x - R - 1);
            const maxX = Math.min(G - 1, b.x + b.w + R);
            const minY = Math.max(0, b.y - R - 1);
            const maxY = Math.min(G - 1, b.y + b.h + R);
            for (let ty = minY; ty <= maxY; ty++) {
              for (let tx = minX; tx <= maxX; tx++) {
                if (APP.isTileWithinRadius(tx, ty, b.x, b.y, b.w, b.h, R)) {
                  workAreaGrid[ty][tx] += 1;
                }
              }
            }
          }

          // D. Desirability & Pollution Emitters
          if (def.desirabilityEmit && def.desirabilityRadius) {
            const R = def.desirabilityRadius;
            const val = def.desirabilityEmit;

            // Special Rule 1: Homestead (-10, 7 tiles) projects from FULL FOUNDATION EDGE to Town Houses
            if (def.hubType === 'homestead' && def.affectsOnlyTownHouses) {
              const complexTiles = [b];
              for (const cid of (b.childrenIds || [])) {
                const child = APP.buildings.get(cid);
                if (child) complexTiles.push(child);
              }

              let cMinX = G, cMaxX = 0, cMinY = G, cMaxY = 0;
              for (const part of complexTiles) {
                if (part.x < cMinX) cMinX = part.x;
                if (part.x + part.w - 1 > cMaxX) cMaxX = part.x + part.w - 1;
                if (part.y < cMinY) cMinY = part.y;
                if (part.y + part.h - 1 > cMaxY) cMaxY = part.y + part.h - 1;
              }
              const minX = Math.max(0, cMinX - R - 1);
              const maxX = Math.min(G - 1, cMaxX + R + 1);
              const minY = Math.max(0, cMinY - R - 1);
              const maxY = Math.min(G - 1, cMaxY + R + 1);

              for (let ty = minY; ty <= maxY; ty++) {
                for (let tx = minX; tx <= maxX; tx++) {
                  let inRange = false;
                  for (let i = 0; i < complexTiles.length; i++) {
                    const part = complexTiles[i];
                    if (APP.isTileWithinRadius(tx, ty, part.x, part.y, part.w, part.h, R)) {
                      inRange = true;
                      break;
                    }
                  }
                  if (inRange) {
                    townHouseDesirGrid[ty][tx] += val;
                  }
                }
              }
            }
            // Special Rule 2: Decorations (+10) are BINARY and do NOT stack with other Decorations
            else if (def.isDecoration) {
              const minX = Math.max(0, b.x - R - 1);
              const maxX = Math.min(G - 1, b.x + b.w + R);
              const minY = Math.max(0, b.y - R - 1);
              const maxY = Math.min(G - 1, b.y + b.h + R);
              for (let ty = minY; ty <= maxY; ty++) {
                for (let tx = minX; tx <= maxX; tx++) {
                  if (!decorGrid[ty][tx] && APP.isTileWithinRadius(tx, ty, b.x, b.y, b.w, b.h, R)) {
                    decorGrid[ty][tx] = true;
                    baseDesirGrid[ty][tx] += 10;
                    townHouseDesirGrid[ty][tx] += 10;
                  }
                }
              }
            }
            // Standard Positive Amenities & Infinitely-Stacking Negative Pollution Emitters
            else {
              const minX = Math.max(0, b.x - R - 1);
              const maxX = Math.min(G - 1, b.x + b.w + R);
              const minY = Math.max(0, b.y - R - 1);
              const maxY = Math.min(G - 1, b.y + b.h + R);
              for (let ty = minY; ty <= maxY; ty++) {
                for (let tx = minX; tx <= maxX; tx++) {
                  if (APP.isTileWithinRadius(tx, ty, b.x, b.y, b.w, b.h, R)) {
                    baseDesirGrid[ty][tx] += val;
                    townHouseDesirGrid[ty][tx] += val;
                  }
                }
              }
            }
          }
        }

        APP.overlayCache.dirty = false;
      };

      APP.getNetDesirabilityAt = function (b) {
        if (!b) return 0;
        if (APP.overlayCache.dirty) APP.recomputeOverlayCache();
        const def = APP.BUILDING_DEFS ? APP.BUILDING_DEFS[b.defId] : null;
        const isTownHouseType = def && (def.housingType === 'town_house' || def.housingType === 'condo');
        const grid = isTownHouseType ? APP.overlayCache.townHouseDesirGrid : APP.overlayCache.baseDesirGrid;

        let sum = 0;
        let count = 0;
        for (let dy = 0; dy < b.h; dy++) {
          for (let dx = 0; dx < b.w; dx++) {
            const cx = b.x + dx;
            const cy = b.y + dy;
            if (APP.inBounds(cx, cy)) {
              sum += grid[cy][cx];
              count++;
            }
          }
        }
        return count > 0 ? Math.round(sum / count) : 0;
      };

      // 3. Comprehensive Advisory Rule Engine (Populates b.warnings[] on all Layer 2 buildings)
APP.evaluateAllWarnings = function () {
        if (!APP.BUILDING_DEFS) return;

        for (const b of APP.buildings.values()) {
          b.warnings = [];
        }

        for (let y = 0; y < APP.GRID_SIZE; y++) {
          for (let x = 0; x < APP.GRID_SIZE; x++) {
            if (APP.roadGrid[y][x] === 'sewer') {
              const bId = APP.buildingGrid[y][x];
              const b = bId ? APP.buildings.get(bId) : null;
              if (!b || b.defId !== 'sewer_drain') {
                APP.roadGrid[y][x] = 'road';
              }
            }
          }
        }

        for (const b of APP.buildings.values()) {
          const def = APP.BUILDING_DEFS[b.defId];
          if (!def) continue;

          // --- RULE 1: Unbought Territory Check ---
          let onUnbought = false;
          for (let dy = 0; dy < b.h; dy++) {
            for (let dx = 0; dx < b.w; dx++) {
              if (!APP.isTerritoryActive(b.x + dx, b.y + dy)) {
                onUnbought = true;
              }
            }
          }
          if (onUnbought) {
            b.warnings.push('Placed inside an Unbought Territory (Shift+Click minimap to unlock).');
          }

        // --- RULE 2: Terrain Compatibility (Water / Hill / Shoreline / Deposit Anchors) ---
          let onHill = false;
          let onShoreline = false;
          let onWater = false;
          let hasWaterOrShoal = false;
          let overlapCount = 0;

          for (let dy = 0; dy < b.h; dy++) {
            for (let dx = 0; dx < b.w; dx++) {
              const row = APP.terrain[b.y + dy];
              const tCell = row ? row[b.x + dx] : null;
              
              if (tCell) {
                // Note: 'hill_top' is buildable plateau and intentionally does not trigger onHill
                if (tCell.type === 'hill') onHill = true;
                if (tCell.type === 'shoreline') onShoreline = true;
                if (tCell.type === 'river' || tCell.type === 'lake' || tCell.type === 'shoal') {
                  onWater = true;
                  hasWaterOrShoal = true;
                }
                if (def.requiresDeposit && tCell.type === def.requiresDeposit) {
                  overlapCount++;
                }
              }
            }
          }

          if (onHill) {
            b.warnings.push('Cannot build on unbuildable Hill / Cliff terrain.');
          }
          if (onShoreline && !def.requiresWaterOrShoal) {
            b.warnings.push('Too close to water: Cannot build standard structures on Shoreline tiles.');
          }
          if (onWater && !def.requiresWaterOrShoal) {
            b.warnings.push('Land building is placed on Water / Shoal tiles.');
          }
          if (def.requiresWaterOrShoal && !hasWaterOrShoal) {
            b.warnings.push('Fisherman’s Hut must overlap River, Lake, or Fish Shoal water tiles.');
          }
          if (def.requiresDeposit) {
            const requiredOverlap = def.minDepositOverlap || 1;
            if (overlapCount < requiredOverlap) {
              const reqName = APP.TERRAIN_NAMES[def.requiresDeposit] || def.requiresDeposit;
              b.warnings.push(`Missing Deposit: Must cover at least ${requiredOverlap} tiles of ${reqName}.`);
            }
          }

          // --- RULE 3: Sewer Drain Road Requirement ---
          if (def.requiresRoad) {
            const rVal = APP.roadGrid[b.y][b.x];
            if (rVal === 'road' || rVal === 'sewer') {
              APP.roadGrid[b.y][b.x] = 'sewer';
            } else {
              b.warnings.push('Sewer Drain Grate must be placed directly on a Road tile.');
            }
          }

          // --- RULE 4: Entrance Door Blocked Check ---
          if (def.hasDoor) {
            const door = APP.getDoorTile(b);
            if (!APP.inBounds(door.x, door.y)) {
              b.warnings.push('Entrance door faces outside the kingdom map boundary.');
            } else {
              // BUGFIX: Crash-proof terrain access for door tile
              const doorRow = APP.terrain[door.y];
              const doorTerrain = doorRow && doorRow[door.x] ? doorRow[door.x].type : null;
              
              const doorRoad = APP.roadGrid[door.y][door.x];
              const doorBldId = APP.buildingGrid[door.y][door.x];
              const doorBld = doorBldId ? APP.buildings.get(doorBldId) : null;
              const doorBldDef = doorBld ? APP.BUILDING_DEFS[doorBld.defId] : null;

              if (doorTerrain === 'hill') {
                b.warnings.push(`Entrance door at (${door.x}, ${door.y}) is blocked by a Hill/Cliff.`);
              } else if ((doorTerrain === 'river' || doorTerrain === 'lake' || doorTerrain === 'shoal') && doorRoad !== 'bridge' && !def.requiresWaterOrShoal) {
                b.warnings.push(`Entrance door at (${door.x}, ${door.y}) opens into Water without a Bridge.`);
              } else if (doorBld && doorBld.id !== b.id) {
                const isPassableChild = doorBldDef && (doorBldDef.isFoundation || doorBldDef.condoRole === 'arch');
                if (!isPassableChild) {
                  b.warnings.push(`Entrance door at (${door.x}, ${door.y}) is blocked by ${doorBldDef ? doorBldDef.name : 'another building'}.`);
                }
              }
            }
          }

          // --- RULE 5: Parent-Child Hub & Foundation Rules ---
          if (def.isHub) {
            const stats = APP.getComplexStats(b.id);
            const limits = APP.HUB_LIMITS[def.hubType];

            if (stats && limits) {
              if (limits.maxFoundation !== undefined && stats.foundationTiles > limits.maxFoundation) {
                b.warnings.push(`[Complex Limit] Foundation/Yard exceeds maximum (${stats.foundationTiles}/${limits.maxFoundation} tiles).`);
              }
              if (limits.maxAttachments !== undefined && stats.attachments > limits.maxAttachments) {
                b.warnings.push(`[Complex Limit] Attachments exceed maximum (${stats.attachments}/${limits.maxAttachments}).`);
              }
              if (limits.maxHouses !== undefined && stats.townHouses > limits.maxHouses) {
                b.warnings.push(`[Complex Limit] Town Houses exceed maximum (${stats.townHouses}/${limits.maxHouses}).`);
              }
              if (limits.maxShops !== undefined && stats.shops > limits.maxShops) {
                b.warnings.push(`[Complex Limit] Condo Shops exceed maximum (${stats.shops}/${limits.maxShops}).`);
              }
              if (limits.maxArches !== undefined && stats.arches > limits.maxArches) {
                b.warnings.push(`[Complex Limit] Condo Arches exceed maximum (${stats.arches}/${limits.maxArches}).`);
              }

              if (def.hubType === 'condo') {
                if (stats.foundationTiles < 9) {
                  b.warnings.push(`Condominium requires at least 9 foundation tiles (currently ${stats.foundationTiles}/9–30).`);
                }
                if (stats.children.length > 0) {
                  let touchesSide = false;
                  const ortho = [
                    { x: b.x + 1, y: b.y },
                    { x: b.x - 1, y: b.y },
                    { x: b.x, y: b.y + 1 },
                    { x: b.x, y: b.y - 1 }
                  ];
                  for (const pt of ortho) {
                    if (!APP.inBounds(pt.x, pt.y)) continue;
                    const adjId = APP.buildingGrid[pt.y][pt.x];
                    const adjBld = adjId ? APP.buildings.get(adjId) : null;
                    if (adjBld && adjBld.parentId === b.id) {
                      touchesSide = true;
                      break;
                    }
                  }
                  if (!touchesSide) {
                    b.warnings.push('Condo Connector Hub must be placed directly against the side of its Condo Foundation.');
                  }
                }
              }

              if (def.hubType === 'homestead' && stats.foundationTiles === 0) {
                b.warnings.push('Homestead has no Yard tiles attached (paint up to 5 Homestead Yard tiles).');
              }

              if (stats.children.length > 0) {
                const complexTileSet = new Set();
                const allParts = [b, ...stats.children];
                for (const part of allParts) {
                  for (let py = 0; py < part.h; py++) {
                    for (let px = 0; px < part.w; px++) {
                      complexTileSet.add(`${part.x + px},${part.y + py}`);
                    }
                  }
                }

                const startKey = `${b.x},${b.y}`;
                const visited = new Set([startKey]);
                const queue = [startKey];
                while (queue.length > 0) {
                  const curr = queue.shift();
                  const [cx, cy] = curr.split(',').map(Number);
                  const neighbors = [
                    `${cx + 1},${cy}`,
                    `${cx - 1},${cy}`,
                    `${cx},${cy + 1}`,
                    `${cx},${cy - 1}`
                  ];
                  for (const nKey of neighbors) {
                    if (complexTileSet.has(nKey) && !visited.has(nKey)) {
                      visited.add(nKey);
                      queue.push(nKey);
                    }
                  }
                }

                if (visited.size < complexTileSet.size) {
                  b.warnings.push('One or more child foundation/addon tiles are disconnected from the Hub complex.');
                  for (const child of stats.children) {
                    if (!visited.has(`${child.x},${child.y}`)) {
                      child.warnings.push(`Disconnected from parent ${def.short} #${b.id} (must form a contiguous complex).`);
                    }
                  }
                }

                const complexLimitWarns = b.warnings.filter(w => w.startsWith('[Complex Limit]'));
                if (complexLimitWarns.length > 0) {
                  for (const child of stats.children) {
                    for (const cw of complexLimitWarns) {
                      if (!child.warnings.includes(cw)) child.warnings.push(cw);
                    }
                  }
                }
              }
            }
          }
          
          // --- RULE 6: Orphaned Child Check (NEW BUGFIX) ---
          if (def.isChild && !b.parentId) {
            b.warnings.push(`Missing parent Hub (Place a ${def.parentHubType.toUpperCase()} Hub first).`);
          }
        }

        APP.overlayCache.dirty = true;
        APP.recomputeOverlayCache();
      };

      APP.hooks.onStateChanged.push(() => {
        APP.evaluateAllWarnings();
      });

      // 4. Helper to Draw Crisp Outer Perimeter Lines Around a Boolean Coverage Mask
      function strokeTileMaskPerimeter(ctx, maskFn, minX, maxX, minY, maxY, strokeStyle, fillStyle, S) {
        ctx.save();
        if (fillStyle) {
          ctx.fillStyle = fillStyle;
          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              if (maskFn(x, y)) {
                ctx.fillRect(x * S, y * S, S, S);
              }
            }
          }
        }

        if (strokeStyle) {
          ctx.strokeStyle = strokeStyle;
          ctx.lineWidth = 2 / APP.camera.zoom;
          ctx.beginPath();
          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              if (!maskFn(x, y)) continue;
              const px = x * S;
              const py = y * S;
              if (!maskFn(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + S, py); }
              if (!maskFn(x, y + 1)) { ctx.moveTo(px, py + S); ctx.lineTo(px + S, py + S); }
              if (!maskFn(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + S); }
              if (!maskFn(x + 1, y)) { ctx.moveTo(px + S, py); ctx.lineTo(px + S, py + S); }
            }
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // 5. Render Hook #3: Draw Active Overlays (Desirability, Water/Sewer, Work Areas) & Net Scores
      APP.onDrawOverlaysAndWarnings = function (ctx) {
        if (APP.overlayCache.dirty) {
          APP.recomputeOverlayCache();
        }

        const S = APP.TILE_PX;
        const G = APP.GRID_SIZE;
        const ov = APP.settings.overlays;

        const topLeft = APP.screenToWorld(0, 0);
        const botRight = APP.screenToWorld(mainCanvas.width, mainCanvas.height);
        const startX = Math.max(0, topLeft.tx - 1);
        const startY = Math.max(0, topLeft.ty - 1);
        const endX = Math.min(G - 1, botRight.tx + 1);
        const endY = Math.min(G - 1, botRight.ty + 1);

        // --- OVERLAY 1: DESIRABILITY (+) & POLLUTION (-) ---
        if (ov.desirability) {
          const { townHouseDesirGrid } = APP.overlayCache;

          ctx.save();
          for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
              const val = townHouseDesirGrid[y][x];
              if (val === 0) continue;
              const px = x * S;
              const py = y * S;

              if (val > 0) {
                const alpha = Math.min(0.45, 0.14 + (val / 35) * 0.28);
                ctx.fillStyle = `rgba(92, 214, 92, ${alpha.toFixed(2)})`;
              } else {
                const alpha = Math.min(0.50, 0.16 + (Math.abs(val) / 35) * 0.30);
                ctx.fillStyle = `rgba(235, 68, 56, ${alpha.toFixed(2)})`;
              }
              ctx.fillRect(px, py, S, S);
            }
          }

          for (const b of APP.buildings.values()) {
            const def = APP.BUILDING_DEFS[b.defId];
            if (!def || !def.isHousing) continue;

            const net = APP.getNetDesirabilityAt(b);
            const signStr = net > 0 ? `+${net}` : `${net}`;
            const cx = (b.x + b.w / 2) * S;
            const cy = (b.y + b.h / 2) * S;

            ctx.fillStyle = 'rgba(18, 13, 9, 0.88)';
            ctx.strokeStyle = net > 0 ? '#6ee061' : (net < 0 ? '#ff5e52' : '#d9a74a');
            ctx.lineWidth = 1.5 / APP.camera.zoom;
            const bw = 24;
            const bh = 14;
            ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
            ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);

            ctx.fillStyle = net > 0 ? '#9be890' : (net < 0 ? '#ff948a' : '#ffe394');
            ctx.font = `bold 9.5px ${APP.getCanvasTextFontFamily()}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(signStr, cx, cy);
          }
          ctx.restore();
        }

        // --- OVERLAY 2: WATER & SEWER COVERAGE ---
        if (ov.waterSewer) {
          const { waterGrid, sewerGrid } = APP.overlayCache;

          strokeTileMaskPerimeter(
            ctx,
            (x, y) => APP.inBounds(x, y) && waterGrid[y][x],
            startX, endX, startY, endY,
            '#38b6ff',
            'rgba(45, 160, 235, 0.24)',
            S
          );

          strokeTileMaskPerimeter(
            ctx,
            (x, y) => APP.inBounds(x, y) && sewerGrid[y][x],
            startX, endX, startY, endY,
            '#5ce68a',
            'rgba(72, 209, 122, 0.24)',
            S
          );

          if (APP.camera.zoom >= 0.45) {
            ctx.save();
            for (const b of APP.buildings.values()) {
              const def = APP.BUILDING_DEFS[b.defId];
              if (!def || !def.isHousing) continue;
              const hasW = waterGrid[b.y][b.x];
              const hasS = sewerGrid[b.y][b.x];
              const cx = (b.x + b.w / 2) * S;
              const cy = (b.y + b.h / 2) * S;

              ctx.fillStyle = 'rgba(18, 13, 9, 0.85)';
              ctx.fillRect(cx - 13, cy - 7, 26, 14);
              ctx.font = '10px "Segoe UI Emoji", sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${hasW ? '💧' : '❌'}${hasS ? '🕳️' : ''}`, cx, cy);
            }
            ctx.restore();
          }
        }

        // --- OVERLAY 3: WORK AREAS (Lumber, Forester, Fisherman, Fairy Tower) ---
        if (ov.workArea) {
          const { workAreaGrid } = APP.overlayCache;

          strokeTileMaskPerimeter(
            ctx,
            (x, y) => APP.inBounds(x, y) && workAreaGrid[y][x] > 0,
            startX, endX, startY, endY,
            '#f5b942',
            'rgba(245, 185, 66, 0.18)',
            S
          );

          ctx.save();
          ctx.strokeStyle = '#9be890';
          ctx.lineWidth = 2 / APP.camera.zoom;
          for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
              if (workAreaGrid[y][x] > 0) {
                const tType = APP.terrain[y][x].type;
                if (tType === 'tree' || tType === 'shoal') {
                  ctx.strokeRect(x * S + 2, y * S + 2, S - 4, S - 4);
                }
              }
            }
          }
          ctx.restore();
        }

        // --- HOVERED BUILDING SPECIFIC RADIUS RING ---
        if (APP.mouse.inBounds) {
          const bId = APP.buildingGrid[APP.mouse.ty][APP.mouse.tx];
          const b = bId ? APP.buildings.get(bId) : null;
          const def = b && APP.BUILDING_DEFS ? APP.BUILDING_DEFS[b.defId] : null;
          if (b && def) {
            drawSingleBuildingRadiusPreview(ctx, def, b.x, b.y, b.w, b.h, b.id);
          }
        }
      };

      function drawSingleBuildingRadiusPreview(ctx, def, bx, by, bw, bh, existingHubId = null) {
        const S = APP.TILE_PX;
        const G = APP.GRID_SIZE;

        if (def.hubType === 'homestead' && def.desirabilityRadius) {
          const R = def.desirabilityRadius;
          const parts = [{ x: bx, y: by, w: bw, h: bh }];
          if (existingHubId && APP.buildings.has(existingHubId)) {
            const hub = APP.buildings.get(existingHubId);
            for (const cid of (hub.childrenIds || [])) {
              const c = APP.buildings.get(cid);
              if (c) parts.push(c);
            }
          }
          let minX = G, maxX = 0, minY = G, maxY = 0;
          for (const p of parts) {
            if (p.x < minX) minX = p.x;
            if (p.x + p.w - 1 > maxX) maxX = p.x + p.w - 1;
            if (p.y < minY) minY = p.y;
            if (p.y + p.h - 1 > maxY) maxY = p.y + p.h - 1;
          }
          minX = Math.max(0, minX - R - 1);
          maxX = Math.min(G - 1, maxX + R + 1);
          minY = Math.max(0, minY - R - 1);
          maxY = Math.min(G - 1, maxY + R + 1);

          strokeTileMaskPerimeter(
            ctx,
            (x, y) => {
              if (!APP.inBounds(x, y)) return false;
              for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                if (APP.isTileWithinRadius(x, y, p.x, p.y, p.w, p.h, R)) return true;
              }
              return false;
            },
            minX, maxX, minY, maxY,
            '#ff6b5e',
            'rgba(235, 68, 56, 0.14)',
            S
          );
          return;
        }

        const R = def.waterRadius || def.sewerRadius || def.workAreaRadius || def.desirabilityRadius || 0;
        if (R <= 0) return;

        let strokeCol = '#ffe394';
        let fillCol = 'rgba(255, 227, 148, 0.12)';
        if (def.waterRadius) {
          strokeCol = '#38b6ff';
          fillCol = 'rgba(45, 160, 235, 0.16)';
        } else if (def.sewerRadius) {
          strokeCol = '#5ce68a';
          fillCol = 'rgba(72, 209, 122, 0.16)';
        } else if (def.workAreaRadius) {
          strokeCol = '#f5b942';
          fillCol = 'rgba(245, 185, 66, 0.14)';
        } else if (def.desirabilityEmit > 0) {
          strokeCol = '#6ee061';
          fillCol = 'rgba(92, 214, 92, 0.15)';
        } else if (def.desirabilityEmit < 0) {
          strokeCol = '#ff6b5e';
          fillCol = 'rgba(235, 68, 56, 0.15)';
        }

        const minX = Math.max(0, bx - R - 1);
        const maxX = Math.min(G - 1, bx + bw + R);
        const minY = Math.max(0, by - R - 1);
        const maxY = Math.min(G - 1, by + bh + R);

        strokeTileMaskPerimeter(
          ctx,
          (x, y) => APP.inBounds(x, y) && APP.isTileWithinRadius(x, y, bx, by, bw, bh, R),
          minX, maxX, minY, maxY,
          strokeCol,
          fillCol,
          S
        );
      }

      APP.onDrawBuildGhostOverlay = function (ctx, def, tx, ty, w, h) {
        drawSingleBuildingRadiusPreview(ctx, def, tx, ty, w, h, null);
      };

      APP.evaluateAllWarnings();
    })();

 // === [SLOT PHASE 5: PRESETS & PERSISTENCE] ===
    (function initPhase5PresetsAndPersistence() {
      const STORAGE_KEY_MAP = 'fabledom_planner_map_v1';
      const STORAGE_KEY_PRESETS = 'fabledom_planner_perm_presets_v1';
      const STORAGE_KEY_SEEDS = 'fabledom_planner_terrain_seeds_v1';
      const STORAGE_KEY_HIDDEN_BUILTINS = 'fabledom_planner_hidden_builtins_v1';
      const STORAGE_KEY_LAST_EXPORT = 'fabledom_planner_last_export_time_v1';

      // Helper to build a 2x2 Homestead sub-block (1 Hub + 1 Yard + 2 Addons)
      function make2x2Homestead(baseId, hubPos, hubRot, yardPos, addon1Pos, addon1Id, addon2Pos, addon2Id) {
        return [
          { origId: baseId,     defId: 'homestead_hub', dx: hubPos[0],    dy: hubPos[1],    w: 1, h: 1, rot: hubRot, origParentId: null },
          { origId: baseId + 1, defId: 'homestead_yard', dx: yardPos[0],  dy: yardPos[1],   w: 1, h: 1, rot: 0,      origParentId: baseId },
          { origId: baseId + 2, defId: addon1Id,         dx: addon1Pos[0], dy: addon1Pos[1], w: 1, h: 1, rot: 0,      origParentId: baseId },
          { origId: baseId + 3, defId: addon2Id,         dx: addon2Pos[0], dy: addon2Pos[1], w: 1, h: 1, rot: 0,      origParentId: baseId }
        ];
      }

      // Hardcoded 6x6 Community Housing Presets (Cannot be wiped or permanently deleted; can be hidden/restored)
      APP.builtinPresets = [
        // 1. Homestead 6x6 (Balanced): 6 Homesteads (2x2 each) + Bakery (2x2) + Center Garden (2x2) + Well/Outhouse/Decor
        {
          id: 'builtin_homestead_6x6_balanced',
          name: 'Homestead 6×6 (Balanced)',
          subtitle: '6×6 • 6 Homesteads, Inn, Well & Garden',
          isBuiltin: true,
          w: 6,
          h: 6,
          roads: [],
          buildings: [
            ...make2x2Homestead(10, [0, 0], 180, [1, 0], [0, 1], 'homestead_addon_bee', [1, 1], 'homestead_addon_tree'),
            ...make2x2Homestead(20, [2, 0], 180, [3, 0], [2, 1], 'homestead_addon_dog', [3, 1], 'homestead_addon_tree'),
            ...make2x2Homestead(30, [0, 2], 90,  [0, 3], [1, 2], 'homestead_addon_bee', [1, 3], 'homestead_addon_tree'),
            ...make2x2Homestead(40, [5, 2], 270, [5, 3], [4, 2], 'homestead_addon_dog', [4, 3], 'homestead_addon_tree'),
            ...make2x2Homestead(50, [0, 5], 0,   [1, 5], [0, 4], 'homestead_addon_bee', [1, 4], 'homestead_addon_tree'),
            ...make2x2Homestead(60, [2, 5], 0,   [3, 5], [2, 4], 'homestead_addon_dog', [3, 4], 'homestead_addon_tree'),
            // Center 2x2 Gazebo Garden (+10 Desirability)
            { origId: 70, defId: 'decor_garden', dx: 2, dy: 2, w: 2, h: 2, rot: 0, origParentId: null },
            // Bottom-Right 2x2 Inn (+10 Desirability, door facing South)
            { origId: 71, defId: 'inn',          dx: 4, dy: 4, w: 2, h: 2, rot: 0, origParentId: null },
            // Top-Right 2x2 Utility & Decor Corner (Outhouse facing North, Basic Well covering full 6x6, Lamp & Statue)
            { origId: 72, defId: 'out_house',    dx: 4, dy: 0, w: 1, h: 1, rot: 180, origParentId: null },
            { origId: 73, defId: 'street_lamp',  dx: 5, dy: 0, w: 1, h: 1, rot: 0,   origParentId: null },
            { origId: 74, defId: 'basic_well',   dx: 4, dy: 1, w: 1, h: 1, rot: 0,   origParentId: null },
            { origId: 75, defId: 'decor_statue', dx: 5, dy: 1, w: 1, h: 1, rot: 0,   origParentId: null }
          ]
        },

        // 2. Homestead 6x6 (Max Efficiency): 8 Homesteads (2x2 each) around a 2x2 Center Town Well
        {
          id: 'builtin_homestead_6x6_max',
          name: 'Homestead 6×6 (Max Efficiency)',
          subtitle: '6×6 • 8 Homesteads + Center Town Well',
          isBuiltin: true,
          w: 6,
          h: 6,
          roads: [],
          buildings: [
            ...make2x2Homestead(110, [0, 0], 180, [1, 0], [0, 1], 'homestead_addon_bee', [1, 1], 'homestead_addon_tree'),
            ...make2x2Homestead(120, [2, 0], 180, [3, 0], [2, 1], 'homestead_addon_dog', [3, 1], 'homestead_addon_tree'),
            ...make2x2Homestead(130, [5, 0], 180, [4, 0], [4, 1], 'homestead_addon_bee', [5, 1], 'homestead_addon_tree'),
            ...make2x2Homestead(140, [0, 2], 90,  [0, 3], [1, 2], 'homestead_addon_dog', [1, 3], 'homestead_addon_tree'),
            ...make2x2Homestead(150, [5, 2], 270, [5, 3], [4, 2], 'homestead_addon_bee', [4, 3], 'homestead_addon_tree'),
            ...make2x2Homestead(160, [0, 5], 0,   [1, 5], [0, 4], 'homestead_addon_dog', [1, 4], 'homestead_addon_tree'),
            ...make2x2Homestead(170, [2, 5], 0,   [3, 5], [2, 4], 'homestead_addon_bee', [3, 4], 'homestead_addon_tree'),
            ...make2x2Homestead(180, [5, 5], 0,   [4, 5], [4, 4], 'homestead_addon_dog', [5, 4], 'homestead_addon_tree'),
            // Center 2x2 Town Well / Fountain (Water + +10 Desirability to all 8 Homesteads)
            { origId: 190, defId: 'town_well', dx: 2, dy: 2, w: 2, h: 2, rot: 0, origParentId: null }
          ]
        },

        // 3. Condo/Townhouse 6x6 (Courtyard Ring): 20-Tile Perimeter Ring (1 Hub, 12 Houses, 4 Corner Shops, 3 Arches) + Empty 4x4 Center
        {
          id: 'builtin_condo_6x6_ring',
          name: 'Condo 6×6',
          subtitle: '6×6 Ring • 12 Houses, 4 Shops, 3 Arches (4×4 Courtyard)',
          isBuiltin: true,
          w: 6,
          h: 6,
          roads: [],
          buildings: [
            // Parent Condo Connector Hub on South Edge (2, 5) facing South
            { origId: 200, defId: 'condo_hub',  dx: 2, dy: 5, w: 1, h: 1, rot: 0,   origParentId: null },
            // 4 Corner Boutique Shops
            { origId: 201, defId: 'condo_shop', dx: 0, dy: 0, w: 1, h: 1, rot: 180, origParentId: 200 },
            { origId: 202, defId: 'condo_shop', dx: 5, dy: 0, w: 1, h: 1, rot: 180, origParentId: 200 },
            { origId: 203, defId: 'condo_shop', dx: 0, dy: 5, w: 1, h: 1, rot: 0,   origParentId: 200 },
            { origId: 204, defId: 'condo_shop', dx: 5, dy: 5, w: 1, h: 1, rot: 0,   origParentId: 200 },
            // 3 Courtyard Archways (North, West, East)
            { origId: 205, defId: 'condo_arch', dx: 2, dy: 0, w: 1, h: 1, rot: 180, origParentId: 200 },
            { origId: 206, defId: 'condo_arch', dx: 0, dy: 2, w: 1, h: 1, rot: 90,  origParentId: 200 },
            { origId: 207, defId: 'condo_arch', dx: 5, dy: 2, w: 1, h: 1, rot: 270, origParentId: 200 },
            // 12 Town House Units (3 North, 3 South, 3 West, 3 East)
            { origId: 208, defId: 'town_house', dx: 1, dy: 0, w: 1, h: 1, rot: 180, origParentId: 200 },
            { origId: 209, defId: 'town_house', dx: 3, dy: 0, w: 1, h: 1, rot: 180, origParentId: 200 },
            { origId: 210, defId: 'town_house', dx: 4, dy: 0, w: 1, h: 1, rot: 180, origParentId: 200 },
            { origId: 211, defId: 'town_house', dx: 1, dy: 5, w: 1, h: 1, rot: 0,   origParentId: 200 },
            { origId: 212, defId: 'town_house', dx: 3, dy: 5, w: 1, h: 1, rot: 0,   origParentId: 200 },
            { origId: 213, defId: 'town_house', dx: 4, dy: 5, w: 1, h: 1, rot: 0,   origParentId: 200 },
            { origId: 214, defId: 'town_house', dx: 0, dy: 1, w: 1, h: 1, rot: 90,  origParentId: 200 },
            { origId: 215, defId: 'town_house', dx: 0, dy: 3, w: 1, h: 1, rot: 90,  origParentId: 200 },
            { origId: 216, defId: 'town_house', dx: 0, dy: 4, w: 1, h: 1, rot: 90,  origParentId: 200 },
            { origId: 217, defId: 'town_house', dx: 5, dy: 1, w: 1, h: 1, rot: 270, origParentId: 200 },
            { origId: 218, defId: 'town_house', dx: 5, dy: 3, w: 1, h: 1, rot: 270, origParentId: 200 },
            { origId: 219, defId: 'town_house', dx: 5, dy: 4, w: 1, h: 1, rot: 270, origParentId: 200 }
          ]
        }
      ];

      // 1. Phase 5 State: Selection Box, Captured Stamp, Preset Lists & Terrain Seeds
      APP.sessionPresets = [];          // Current Run Presets (Session memory only)
      APP.permanentPresets = [];        // User-Saved Permanent Building Presets (localStorage)
      APP.hiddenBuiltinIds = new Set(); // IDs of Built-In Presets hidden by the user (localStorage)
      APP.terrainSeeds = [];            // Permanent 95x95 Layer 1 Terrain Map Seeds (localStorage)
      APP.selectionState = {
        isDragging: false,
        startX: -1,
        startY: -1,
        endX: -1,
        endY: -1,
        hasBox: false
      };
      APP.capturedStamp = null;
      APP.activeStamp = null;

      function loadPermanentPresets() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) APP.permanentPresets = parsed;
          }
        } catch (err) {
          console.warn('Could not load Permanent Presets:', err);
        }
      }

      function savePermanentPresets() {
        try {
          localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(APP.permanentPresets));
        } catch (err) {
          console.warn('Could not save Permanent Presets:', err);
        }
      }

      function loadHiddenBuiltins() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY_HIDDEN_BUILTINS);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) APP.hiddenBuiltinIds = new Set(parsed);
          }
        } catch (err) {
          console.warn('Could not load hidden built-in presets:', err);
        }
      }

      function saveHiddenBuiltins() {
        try {
          localStorage.setItem(STORAGE_KEY_HIDDEN_BUILTINS, JSON.stringify(Array.from(APP.hiddenBuiltinIds)));
        } catch (err) {
          console.warn('Could not save hidden built-in presets:', err);
        }
      }

      APP.generateExportJSON = function(fileName, mapSeed, kingdomName, isTerrainOnly) {
        let exportData = {
          formatVersion: 3,
          savedAt: new Date().toISOString(),
          isTerrainOnly: isTerrainOnly,
          mapSeed: mapSeed,
          kingdomName: kingdomName,
          terrSize: APP.TERR_SIZE,
          gridSize: APP.GRID_SIZE,
          territories: APP.territories,
          terrain: APP.terrain,
          deposits: Array.from(APP.deposits.values())
        };

        if (!isTerrainOnly) {
          exportData.nextId = APP.nextId;
          exportData.camera = { ...APP.camera };
          exportData.settings = JSON.parse(JSON.stringify(APP.settings));
          exportData.buildings = Array.from(APP.buildings.values());
          exportData.roadGrid = APP.roadGrid;
          exportData.roadStyle = APP.roadStyle ? Array.from(APP.roadStyle.entries()) : [];
          exportData.sessionPresets = APP.sessionPresets;
        }

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        try {
          localStorage.setItem(STORAGE_KEY_LAST_EXPORT, exportData.savedAt);
          if (typeof APP.updateExportIndicator === 'function') {
            APP.updateExportIndicator();
          }
        } catch (err) {
          console.warn('Could not save export timestamp:', err);
        }
      };

      APP.openSaveExportModal = function (defaultName) {
        const existing = document.getElementById('save-export-custom-modal');
        if (existing) existing.remove();

        const resolvedName = (defaultName || '').trim() || `Kingdom_Save_${new Date().getTime()}`;

        const overlay = document.createElement('div');
        overlay.id = 'save-export-custom-modal';
        overlay.style.cssText = `
          position: fixed; inset: 0; background: rgba(10, 7, 5, 0.78);
          backdrop-filter: blur(2px); z-index: 9999;
          display: flex; align-items: center; justify-content: center; padding: 16px;
        `;

        overlay.innerHTML = `
          <div style="background: linear-gradient(180deg, #2b2218 0%, #1c1610 100%);
                      border: 2px solid var(--border-gold-bright, #e6b85c);
                      border-radius: 8px; box-shadow: 0 14px 36px rgba(0,0,0,0.8);
                      width: 450px; max-width: 94vw; padding: 18px 20px;
                      color: var(--text-main, #f5e6c4); font-family: 'Segoe UI', sans-serif;">
            <div style="font-family: Georgia, serif; font-size: 16px; font-weight: 700;
                        color: var(--accent-gold, #ffdf73); margin-bottom: 10px;
                        padding-bottom: 8px; border-bottom: 1px solid rgba(217, 167, 74, 0.3);
                        display: flex; align-items: center; gap: 8px;">
              <span>💾</span>
              <span>Export Kingdom Save File</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;">
              <div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: var(--accent-gold, #ffdf73); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.4px;">
                  File Name
                </label>
                <input type="text" id="modal-inp-file-name" value="${resolvedName}"
                       style="width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 4px;
                              border: 1px solid var(--border-gold, #b88b42); background: #14100d;
                              color: var(--text-main, #f5e6c4); font-size: 12.5px;" />
              </div>
              <div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: var(--accent-gold, #ffdf73); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.4px;">
                  Map Seed (Optional)
                </label>
                <input type="text" id="modal-inp-map-seed" placeholder="Enter in-game Map Seed..."
                       style="width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 4px;
                              border: 1px solid var(--border-gold, #b88b42); background: #14100d;
                              color: var(--text-main, #f5e6c4); font-size: 12.5px;" />
              </div>
              <div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: var(--accent-gold, #ffdf73); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.4px;">
                  Default Kingdom Name (Optional)
                </label>
                <input type="text" id="modal-inp-kingdom-name" placeholder="Enter Default Kingdom Name..."
                       style="width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 4px;
                              border: 1px solid var(--border-gold, #b88b42); background: #14100d;
                              color: var(--text-main, #f5e6c4); font-size: 12.5px;" />
              </div>
            </div>

            <label style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; cursor: pointer; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-muted); border-radius: 4px;">
              <input type="checkbox" id="modal-chk-terrain-only" style="margin-top: 2px;" />
              <div style="font-size: 12px; color: var(--text-main);">
                Save only the terrain, not the buildings.
                <div id="modal-warn-terrain" style="display: none; color: #ff5e52; font-size: 11px; margin-top: 4px; font-weight: 600;">
                  Your buildings and current-run presets will not be stored!
                </div>
              </div>
            </label>

            <div style="display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08);">
              <button class="tool-btn" id="modal-btn-cancel" style="padding: 6px 11px; font-size: 12px;">Cancel</button>
              <button class="tool-btn active" id="modal-btn-export" style="padding: 6px 12px; font-size: 12px;">💾 Export JSON</button>
            </div>
          </div>
        `;

        document.body.appendChild(overlay);

        const chkTerrain = overlay.querySelector('#modal-chk-terrain-only');
        const warnTerrain = overlay.querySelector('#modal-warn-terrain');
        chkTerrain.addEventListener('change', () => {
          warnTerrain.style.display = chkTerrain.checked ? 'block' : 'none';
        });

        const btnExport = overlay.querySelector('#modal-btn-export');
        const btnCancel = overlay.querySelector('#modal-btn-cancel');

        const closeModal = () => {
          document.removeEventListener('keydown', onKeyDown);
          overlay.remove();
        };

        const onKeyDown = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', onKeyDown);

        btnExport.addEventListener('click', () => {
          const fName = overlay.querySelector('#modal-inp-file-name').value.trim() || 'Fabledom_Kingdom';
          const seedStr = overlay.querySelector('#modal-inp-map-seed').value.trim();
          const kingStr = overlay.querySelector('#modal-inp-kingdom-name').value.trim();
          const isTerrainOnly = chkTerrain.checked;

          APP.generateExportJSON(fName, seedStr, kingStr, isTerrainOnly);
          closeModal();
        });

        btnCancel.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
      };

      APP.openLoadedSeedInfoModal = function (seed) {
        const existing = document.getElementById('seed-load-info-modal');
        if (existing) existing.remove();

        const hasInfo = Boolean((seed.mapSeed && seed.mapSeed.trim()) || (seed.kingdomName && seed.kingdomName.trim()));

        const overlay = document.createElement('div');
        overlay.id = 'seed-load-info-modal';
        overlay.style.cssText = `
          position: fixed; inset: 0; background: rgba(10, 7, 5, 0.78);
          backdrop-filter: blur(2px); z-index: 9999;
          display: flex; align-items: center; justify-content: center; padding: 16px;
        `;

const bodyHtml = hasInfo
          ? `
            <div style="font-size: 12.5px; line-height: 1.5; color: var(--text-main, #f5e6c4); margin-bottom: 12px;">
              Use the following identifying information when generating this map in <strong>Fabledom</strong>:
            </div>
            <div style="background: rgba(0, 0, 0, 0.35); border: 1px solid var(--border-gold, #b88b42); border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                <span style="font-size: 11.5px; color: var(--text-muted, #b8a68e); text-transform: uppercase; letter-spacing: 0.4px;">Map Seed:</span>
                <strong style="font-size: 13.5px; color: #ffdf73; user-select: all; font-family: Consolas, monospace;">${seed.mapSeed || '—'}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid rgba(255,255,255,0.07); padding-top: 8px;">
                <span style="font-size: 11.5px; color: var(--text-muted, #b8a68e); text-transform: uppercase; letter-spacing: 0.4px;">Default Kingdom Name:</span>
                <strong style="font-size: 13.5px; color: #9be890; user-select: all;">${seed.kingdomName || '—'}</strong>
              </div>
            </div>
          `
          : `
            <div style="background: rgba(0, 0, 0, 0.28); border: 1px solid var(--border-muted, #4a3c2c); border-radius: 6px; padding: 14px; margin-bottom: 16px; font-size: 12.5px; color: var(--text-muted, #b8a68e); text-align: center; font-style: italic;">
              This terrain map was saved without identifying information.
            </div>
          `;

        overlay.innerHTML = `
          <div style="background: linear-gradient(180deg, #2b2218 0%, #1c1610 100%);
                      border: 2px solid var(--border-gold-bright, #e6b85c);
                      border-radius: 8px; box-shadow: 0 14px 36px rgba(0,0,0,0.8);
                      width: 420px; max-width: 94vw; padding: 18px 20px;
                      color: var(--text-main, #f5e6c4); font-family: 'Segoe UI', sans-serif;">
            <div style="font-family: Georgia, serif; font-size: 16px; font-weight: 700;
                        color: var(--accent-gold, #ffdf73); margin-bottom: 12px;
                        padding-bottom: 8px; border-bottom: 1px solid rgba(217, 167, 74, 0.3);
                        display: flex; align-items: center; gap: 8px;">
              <span>🗺️</span>
              <span>Terrain Map Loaded</span>
            </div>

            ${bodyHtml}

            <div style="display: flex; justify-content: flex-end; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);">
              <button class="tool-btn active" id="modal-btn-seed-info-continue" style="padding: 6px 18px; font-size: 12.5px;">
                Continue
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(overlay);

        const btnContinue = overlay.querySelector('#modal-btn-seed-info-continue');
        const closeModal = () => {
          document.removeEventListener('keydown', onKeyDown);
          overlay.remove();
        };
        const onKeyDown = (e) => { if (e.key === 'Escape' || e.key === 'Enter') closeModal(); };
        document.addEventListener('keydown', onKeyDown);

        btnContinue.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

        setTimeout(() => btnContinue.focus(), 20);
      };

      APP.wipeBuildings = function(skipConfirm = false) {
        const doWipe = () => {
          APP.buildings.clear();
          APP.nextId = 1;
          const G = APP.GRID_SIZE;
          APP.buildingGrid = Array.from({ length: G }, () => Array(G).fill(null));
          APP.roadGrid = Array.from({ length: G }, () => Array(G).fill(null));
          APP.roadStyle.clear();
          APP.activeTool.activeHubId = null;
          APP.updateActiveHubBanner();
          if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
          APP.notifyStateChanged();
        };

        if (skipConfirm) {
          doWipe();
        } else {
          APP.showConfirmModal({
            title: 'Wipe All Buildings?',
            icon: '🧹',
            message: 'Are you sure you want to delete all buildings and roads?<br/><br/>Your terrain layer and deposits will remain intact.',
            confirmText: '🧹 Wipe Buildings',
            danger: true,
            onConfirm: doWipe
          });
        }
      };


// 3. Map Serialization, Auto-Save & Restoration
      APP.serializeMapState = function () {
        return {
          version: 3,
          savedAt: new Date().toISOString(),
          terrSize: APP.TERR_SIZE,
          gridSize: APP.GRID_SIZE,
          nextId: APP.nextId,
          camera: { ...APP.camera },
          settings: JSON.parse(JSON.stringify(APP.settings)),
          territories: APP.territories,
          terrain: APP.terrain,
          deposits: Array.from(APP.deposits.values()),
          buildings: Array.from(APP.buildings.values()),
          roadGrid: APP.roadGrid,
          roadStyle: APP.roadStyle ? Array.from(APP.roadStyle.entries()) : [],
          sessionPresets: APP.sessionPresets || []
        };
      };

      APP.deserializeMapState = function (data, mode = 'full') {
        if (!data) return false;

        const restoredTerrSize = data.terrSize || 19;
        if ([18, 19, 20].includes(restoredTerrSize)) {
          APP.TERR_SIZE = restoredTerrSize;
          APP.GRID_SIZE = restoredTerrSize * 5;
          if (typeof APP.syncRealmSizeUI === 'function') APP.syncRealmSizeUI();
        }

        const G = APP.GRID_SIZE;
        
        // 1. Territory Restore
        APP.territories = Array.from({ length: 5 }, () => Array(5).fill(false));
        if (Array.isArray(data.territories)) {
          for (let ty = 0; ty < 5; ty++) {
            for (let tx = 0; tx < 5; tx++) {
              if (data.territories[ty]) APP.territories[ty][tx] = Boolean(data.territories[ty][tx]);
            }
          }
        }

        // 2. Terrain Restore
        APP.terrain = Array.from({ length: G }, () => 
          Array.from({ length: G }, () => ({ type: 'grass', depositId: null }))
        );
        if (Array.isArray(data.terrain)) {
          for (let y = 0; y < G; y++) {
            for (let x = 0; x < G; x++) {
              if (data.terrain[y] && data.terrain[y][x]) {
                APP.terrain[y][x] = data.terrain[y][x];
              }
            }
          }
        }

        // 3. Deposits
        APP.deposits.clear();
        if (Array.isArray(data.deposits)) {
          for (const dep of data.deposits) APP.deposits.set(dep.id, dep);
        }

        if (mode === 'map') {
          // Map Only mode: Wipe all buildings and roads, reset session presets
          APP.buildings.clear();
          APP.nextId = 1;
          APP.buildingGrid = Array.from({ length: G }, () => Array(G).fill(null));
          APP.roadGrid = Array.from({ length: G }, () => Array(G).fill(null));
          APP.roadStyle.clear();
          APP.sessionPresets = [];
          
          if (typeof renderPresetsSidebar === 'function') renderPresetsSidebar();
          return true;
        }

        // 4. Building Grid (Full Mode Only)
        APP.nextId = data.nextId || 1;
        if (data.camera) APP.camera = { ...APP.camera, ...data.camera };
        if (data.settings) APP.settings = JSON.parse(JSON.stringify(data.settings));

        APP.buildingGrid = Array.from({ length: G }, () => Array(G).fill(null));
        APP.buildings.clear();
        
        if (Array.isArray(data.buildings)) {
          for (const b of data.buildings) {
            APP.buildings.set(b.id, b);
            for (let dy = 0; dy < b.h; dy++) {
              for (let dx = 0; dx < b.w; dx++) {
                const cy = b.y + dy;
                const cx = b.x + dx;
                if (cy >= 0 && cy < G && cx >= 0 && cx < G) {
                  APP.buildingGrid[cy][cx] = b.id;
                }
              }
            }
          }
        }

        // 5. Road Grid (Full Mode Only)
        APP.roadGrid = Array.from({ length: G }, () => Array(G).fill(null));
        if (Array.isArray(data.roadGrid)) {
          for (let y = 0; y < G; y++) {
            for (let x = 0; x < G; x++) {
              if (data.roadGrid[y]) APP.roadGrid[y][x] = data.roadGrid[y][x] || null;
            }
          }
        }
        
        APP.roadStyle.clear();
        if (Array.isArray(data.roadStyle)) {
          for (const [k, v] of data.roadStyle) APP.roadStyle.set(k, v);
        }

        if (Array.isArray(data.sessionPresets)) {
          APP.sessionPresets = data.sessionPresets;
        } else {
          APP.sessionPresets = [];
        }

        if (typeof renderPresetsSidebar === 'function') renderPresetsSidebar();

        return true;
      };

      APP.saveMapToLocalStorage = function () {
        try {
          const state = APP.serializeMapState();
          localStorage.setItem(STORAGE_KEY_MAP, JSON.stringify(state));
          const badge = document.getElementById('autosave-indicator');
          if (badge) {
            const now = new Date();
            badge.textContent = `Auto-saved to browser ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
          }
        } catch (err) {
          console.warn('Auto-save to localStorage failed:', err);
        }
      };

      APP.loadMapFromLocalStorage = function () {
        try {
          const raw = localStorage.getItem(STORAGE_KEY_MAP);
          if (!raw) return false;
          const parsed = JSON.parse(raw);
          return APP.deserializeMapState(parsed, 'full');
        } catch (err) {
          console.warn('Could not load saved map from localStorage:', err);
          return false;
        }
      };

      APP.hooks.onStateChanged.push(() => {
        APP.saveMapToLocalStorage();
      });

      // Clear session presets & selection/stamp state on canvas wipe 
      APP.hooks.onWipeCanvas.push(() => {
        APP.sessionPresets = [];
        APP.capturedStamp = null;
        APP.activeStamp = null;
        APP.selectionState.hasBox = false;
        APP.selectionState.isDragging = false;
        APP.saveMapToLocalStorage();
        renderPresetsSidebar();
      });

      // 4. Rectangular Area Capture & Stamp Rotation Math
      APP.captureRegionAsStamp = function (x1, y1, x2, y2) {
        const minX = Math.max(0, Math.min(x1, x2));
        const maxX = Math.min(APP.GRID_SIZE - 1, Math.max(x1, x2));
        const minY = Math.max(0, Math.min(y1, y2));
        const maxY = Math.min(APP.GRID_SIZE - 1, Math.max(y1, y2));

        const capturedBuildingIds = new Set();
        const rawRoads = [];

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const bId = APP.buildingGrid[y][x];
            if (bId !== null && APP.buildings.has(bId)) {
              capturedBuildingIds.add(bId);
              const b = APP.buildings.get(bId);
              if (b.stackedOnId) capturedBuildingIds.add(b.stackedOnId);
            }
            const rVal = APP.roadGrid[y][x];
            if (rVal !== null) {
              const style = APP.roadStyle ? (APP.roadStyle.get(`${x},${y}`) || 'dirt') : 'dirt';
              const baseRoadType = rVal === 'sewer' ? 'road' : rVal;
              const defId = baseRoadType === 'bridge' ? 'bridge' : (style === 'cobble' ? 'cobble_road' : 'dirt_road');
              rawRoads.push({ x, y, defId, roadType: baseRoadType, style });
            }
          }
        }

        if (capturedBuildingIds.size === 0 && rawRoads.length === 0) {
          APP.capturedStamp = null;
          renderPresetsSidebar();
          return null;
        }

        let tMinX = Infinity, tMinY = Infinity, tMaxX = -Infinity, tMaxY = -Infinity;
        const rawBuildings = [];

        for (const bId of capturedBuildingIds) {
          const b = APP.buildings.get(bId);
          if (!b) continue;
          rawBuildings.push(b);
          if (b.x < tMinX) tMinX = b.x;
          if (b.y < tMinY) tMinY = b.y;
          if (b.x + b.w - 1 > tMaxX) tMaxX = b.x + b.w - 1;
          if (b.y + b.h - 1 > tMaxY) tMaxY = b.y + b.h - 1;
        }

        for (const r of rawRoads) {
          if (r.x < tMinX) tMinX = r.x;
          if (r.y < tMinY) tMinY = r.y;
          if (r.x > tMaxX) tMaxX = r.x;
          if (r.y > tMaxY) tMaxY = r.y;
        }

        const w = tMaxX - tMinX + 1;
        const h = tMaxY - tMinY + 1;

        const normBuildings = rawBuildings.map(b => ({
          origId: b.id,
          defId: b.defId,
          dx: b.x - tMinX,
          dy: b.y - tMinY,
          w: b.w,
          h: b.h,
          rot: b.rot || 0,
          origParentId: b.parentId || null,
          origStackedOnId: b.stackedOnId || null
        }));

        const normRoads = rawRoads.map(r => ({
          dx: r.x - tMinX,
          dy: r.y - tMinY,
          defId: r.defId,
          roadType: r.roadType,
          style: r.style
        }));

        APP.capturedStamp = {
          w,
          h,
          buildings: normBuildings,
          roads: normRoads
        };

        renderPresetsSidebar();
        return APP.capturedStamp;
      };

      APP.getRotatedStampData = function (stamp, rot = 0) {
        if (!stamp) return null;
        const r = ((rot % 360) + 360) % 360;
        const W = stamp.w;
        const H = stamp.h;
        const SW = (r === 90 || r === 270) ? H : W;
        const SH = (r === 90 || r === 270) ? W : H;

        const transformRect = (dx, dy, iw, ih) => {
          if (r === 90) {
            return { ndx: H - dy - ih, ndy: dx, nw: ih, nh: iw };
          } else if (r === 180) {
            return { ndx: W - dx - iw, ndy: H - dy - ih, nw: iw, nh: ih };
          } else if (r === 270) {
            return { ndx: dy, ndy: W - dx - iw, nw: ih, nh: iw };
          }
          return { ndx: dx, ndy: dy, nw: iw, nh: ih };
        };

        const roads = (stamp.roads || []).map(rd => {
          const { ndx, ndy } = transformRect(rd.dx, rd.dy, 1, 1);
          return { ...rd, ndx, ndy };
        });

        const buildings = (stamp.buildings || []).map(b => {
          const def = APP.BUILDING_DEFS ? APP.BUILDING_DEFS[b.defId] : null;
          const { ndx, ndy, nw, nh } = transformRect(b.dx, b.dy, b.w, b.h);
          const nrot = (def && def.rotatable) ? ((b.rot + r) % 360) : (b.rot || 0);
          return {
            ...b,
            ndx,
            ndy,
            nw,
            nh,
            nrot
          };
        });

        return { w: SW, h: SH, roads, buildings };
      };

      APP.canPlaceStampAt = function (stamp, tx, ty, rot = 0) {
        const rotated = APP.getRotatedStampData(stamp, rot);
        if (!rotated) return { ok: false, reason: 'No active stamp.' };

        for (const rd of rotated.roads) {
          if (!APP.inBounds(tx + rd.ndx, ty + rd.ndy)) {
            return { ok: false, reason: 'Stamp extends outside the 95×95 grid.' };
          }
        }

        for (const b of rotated.buildings) {
          const def = APP.BUILDING_DEFS ? APP.BUILDING_DEFS[b.defId] : null;
          const bx = tx + b.ndx;
          const by = ty + b.ndy;
          for (let dy = 0; dy < b.nh; dy++) {
            for (let dx = 0; dx < b.nw; dx++) {
              const cx = bx + dx;
              const cy = by + dy;
              if (!APP.inBounds(cx, cy)) {
                return { ok: false, reason: 'Stamp extends outside the 95×95 grid.' };
              }
              const occ = APP.buildingGrid[cy][cx];
              if (occ !== null) {
                const existingB = APP.buildings.get(occ);
                const isCondoSubUnit = def && def.parentHubType === 'condo' && !def.isFoundation;
                const isHomesteadAddon = def && def.parentHubType === 'homestead' && def.isAttachment;
                
                if (existingB && (
                  (isCondoSubUnit && existingB.defId === 'condo_foundation') ||
                  (isHomesteadAddon && existingB.defId === 'homestead_yard')
                )) {
                  // Allow valid stacking overlap
                } else {
                  return { ok: false, reason: 'Stamp overlaps an existing building.' };
                }
              }
            }
          }

          if (!APP.settings.freePlacement && APP.BUILDING_DEFS) {
            const def = APP.BUILDING_DEFS[b.defId];
            if (def?.requiresDeposit) {
              for (let dy = 0; dy < b.nh; dy++) {
                for (let dx = 0; dx < b.nw; dx++) {
                  if (APP.terrain[by + dy][bx + dx].type !== def.requiresDeposit) {
                    return { ok: false, reason: `${def.name} requires ${def.requiresDeposit} underneath.` };
                  }
                }
              }
            }
            if (def?.requiresWaterOrShoal) {
              let hasWater = false;
              for (let dy = 0; dy < b.nh; dy++) {
                for (let dx = 0; dx < b.nw; dx++) {
                  const tType = APP.terrain[by + dy][bx + dx].type;
                  if (tType === 'river' || tType === 'lake' || tType === 'shoal') hasWater = true;
                }
              }
              if (!hasWater) {
                return { ok: false, reason: 'Fisherman’s Hut requires water/shoal tiles underneath.' };
              }
            }
          }
        }

        return { ok: true, reason: '', rotated };
      };

      APP.placeStampAt = function (stamp, tx, ty, rot = 0) {
        const check = APP.canPlaceStampAt(stamp, tx, ty, rot);
        if (!check.ok) return false;

        const { rotated } = check;

        for (const rd of rotated.roads) {
          APP.placeRoadAt(tx + rd.ndx, ty + rd.ndy, rd.defId);
        }

        const hubsAndStandalones = [];
        const children = [];
        for (const b of rotated.buildings) {
          const def = APP.BUILDING_DEFS[b.defId];
          if (def && def.isChild) {
            children.push(b);
          } else {
            hubsAndStandalones.push(b);
          }
        }

        const oldToNewId = new Map();

        const insertStampedBuilding = (bItem, resolvedParentId) => {
          const id = APP.nextId++;
          const bx = tx + bItem.ndx;
          const by = ty + bItem.ndy;
          const bObj = {
            id,
            defId: bItem.defId,
            x: bx,
            y: by,
            w: bItem.nw,
            h: bItem.nh,
            rot: bItem.nrot,
            parentId: resolvedParentId,
            childrenIds: [],
            warnings: [],
            stackedOnId: null
          };
          APP.buildings.set(id, bObj);
          for (let dy = 0; dy < bObj.h; dy++) {
            for (let dx = 0; dx < bObj.w; dx++) {
              APP.buildingGrid[by + dy][bx + dx] = id;
            }
          }
          if (resolvedParentId && APP.buildings.has(resolvedParentId)) {
            const parent = APP.buildings.get(resolvedParentId);
            if (!parent.childrenIds.includes(id)) {
              parent.childrenIds.push(id);
            }
          }
          return bObj;
        };

        for (const b of hubsAndStandalones) {
          const placed = insertStampedBuilding(b, null);
          oldToNewId.set(b.origId, placed.id);
        }

        const sortedChildren = children.sort((a, b) => {
          const aF = APP.BUILDING_DEFS[a.defId]?.isFoundation ? 0 : 1;
          const bF = APP.BUILDING_DEFS[b.defId]?.isFoundation ? 0 : 1;
          return aF - bF;
        });

        for (const c of sortedChildren) {
          let parentId = c.origParentId && oldToNewId.has(c.origParentId)
            ? oldToNewId.get(c.origParentId)
            : null;
          if (!parentId && typeof APP.resolveParentHubForChild === 'function') {
            const fallbackHub = APP.resolveParentHubForChild(c.defId, tx + c.ndx, ty + c.ndy);
            if (fallbackHub) parentId = fallbackHub.id;
          }
          
          const newObj = insertStampedBuilding(c, parentId);
          oldToNewId.set(c.origId, newObj.id);
          
          if (c.origStackedOnId && oldToNewId.has(c.origStackedOnId)) {
            newObj.stackedOnId = oldToNewId.get(c.origStackedOnId);
          }
        }

        if (typeof APP.evaluateAllWarnings === 'function') {
          APP.evaluateAllWarnings();
        }
        APP.notifyStateChanged();
        return true;
      };

// 5. Preset Sidebar UI (`#panel-presets`) & Data Management UI (`#panel-data`)
      function renderPresetsSidebar() {
        const panel = document.getElementById('panel-presets');
        if (!panel) return;

        // Initialize expand/collapse state for Sections 2 and 3
        if (!APP.presetSectionsOpen) {
          APP.presetSectionsOpen = { sec2: true, sec3: true };
        }

        // Inject layout styles once so Section 1 stays pinned and Sections 2 & 3 scroll together
        if (!document.getElementById('phase5-presets-layout-style')) {
          const st = document.createElement('style');
          st.id = 'phase5-presets-layout-style';
          st.textContent = `
            #panel-presets.active {
              display: flex;
              flex-direction: column;
              height: calc(100% + 24px);
              margin: -12px;
              overflow: hidden;
            }
            #presets-pinned-top {
              flex-shrink: 0;
              padding: 12px 12px 10px 12px;
              background: linear-gradient(180deg, #241d17 0%, #1d1712 100%);
              border-bottom: 1px solid var(--border-gold);
              box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
              z-index: 5;
            }
            #presets-scroll-area {
              flex: 1;
              overflow-y: auto;
              padding: 12px;
            }
            #presets-scroll-area::-webkit-scrollbar {
              width: 6px;
            }
            #presets-scroll-area::-webkit-scrollbar-track {
              background: #16110d;
            }
            #presets-scroll-area::-webkit-scrollbar-thumb {
              background: var(--border-muted);
              border-radius: 3px;
            }
            #presets-scroll-area::-webkit-scrollbar-thumb:hover {
              background: var(--border-gold);
            }
            .psec-header-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 6px;
              cursor: pointer;
            }
            .psec-toggle-btn {
              background: rgba(255, 255, 255, 0.05);
              border: 1px solid var(--border-muted);
              color: var(--text-muted);
              border-radius: 3px;
              padding: 1px 6px;
              font-size: 10px;
              font-family: 'Segoe UI', sans-serif;
              font-weight: 600;
              text-transform: none;
              letter-spacing: 0;
              cursor: pointer;
              transition: all 0.12s ease;
            }
            .psec-toggle-btn:hover {
              border-color: var(--border-gold);
              color: var(--text-main);
              background: rgba(217, 167, 74, 0.12);
            }
          `;
          document.head.appendChild(st);
        }

        // Preserve scroll position when toggling sections or updating lists
        const prevScrollEl = panel.querySelector('#presets-scroll-area');
        const savedScrollTop = prevScrollEl ? prevScrollEl.scrollTop : 0;

        const cap = APP.capturedStamp;
        const activeStampName = APP.activeStamp ? APP.activeStamp.name : null;
        const { sec2, sec3 } = APP.presetSectionsOpen;

        const visibleBuiltins = APP.builtinPresets.filter(p => !APP.hiddenBuiltinIds.has(p.id));
        const hiddenCount = APP.builtinPresets.length - visibleBuiltins.length;
        const totalPermCount = visibleBuiltins.length + APP.permanentPresets.length;

        panel.innerHTML = `
          <!-- PINNED TOP: Active Stamp Banner + Section 1 (Capture Area) -->
          <div id="presets-pinned-top">
            ${APP.activeStamp ? `
              <div style="margin-bottom:10px; padding:9px 10px; border-radius:6px; background:linear-gradient(180deg, #304729 0%, #20301b 100%); border:1px solid #6ee061; display:flex; align-items:center; justify-content:space-between; gap:8px;">
                <div>
                  <div style="font-size:11.5px; font-weight:700; color:#c8f5c1;">📐 Stamping: ${APP.activeStamp.name}</div>
                  <div style="font-size:10.5px; color:var(--text-muted);">Click map to stamp • [R] Rotate • Right-Click to exit</div>
                </div>
                <button class="tool-btn" id="btn-cancel-stamp" style="padding:4px 8px; font-size:11px;">Exit</button>
              </div>
            ` : ''}

            <div class="panel-section-title" style="margin-top:0;">Capture Area as Building Stamp</div>
            <div style="background:rgba(0,0,0,0.22); border:1px solid var(--border-muted); border-radius:6px; padding:10px;">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                <button class="tool-btn ${APP.activeTool.mode === 'select' && !APP.activeStamp ? 'active' : ''}" id="btn-activate-select" style="width:100%; justify-content:center;">
                  📐 Drag-Select Area on Map <span class="kbd-hint">3</span>
                </button>
              </div>

              ${cap ? `
                <div style="font-size:11.5px; color:#ffe394; margin-bottom:7px; padding:6px 8px; background:rgba(217,167,74,0.12); border:1px solid var(--border-gold); border-radius:4px;">
                  ✦ <strong>Captured Region (${cap.w}×${cap.h}):</strong> ${cap.buildings.length} buildings, ${cap.roads.length} road tiles
                </div>
                <input type="text" id="preset-name-input" placeholder="Enter preset name (e.g. 4x Homestead Block)..."
                       style="width:100%; padding:6px 8px; margin-bottom:7px; border-radius:4px; border:1px solid var(--border-gold); background:#14100d; color:var(--text-main); font-size:12px;" />
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
                  <button class="tool-btn" id="btn-save-session-preset" style="justify-content:center; font-size:11px;" title="Save in session memory for this run only">
                    ⏱️ Save Current Run
                  </button>
                  <button class="tool-btn active" id="btn-save-perm-preset" style="justify-content:center; font-size:11px;" title="Persist in localStorage across sessions and canvas wipes">
                    💾 Save Permanent
                  </button>
                </div>
                <button class="tool-btn" id="btn-stamp-captured-now" style="width:100%; justify-content:center; font-size:11px;">
                  🔨 Stamp Captured Selection Now
                </button>
              ` : `
                <div style="font-size:11px; color:var(--text-muted); text-align:center; padding:4px;">
                  Select <strong>📐 Select [3]</strong> and drag a box over buildings or roads on the canvas to capture them.
                </div>
              `}
            </div>
          </div>

          <!-- UNIFIED SCROLLABLE BODY: Sections 2 & 3 -->
          <div id="presets-scroll-area">
            <!-- Section 2: Permanent Building Presets -->
            <div class="panel-section-title psec-header-row" data-toggle-psec="sec2" style="margin-top:0;">
              <span>${sec2 ? '▾' : '▸'} Permanent Presets (${totalPermCount})</span>
              <div style="display:flex; align-items:center; gap:5px;">
                ${hiddenCount > 0 ? `
                  <button id="btn-restore-builtins"
                          style="background:rgba(217,167,74,0.14); border:1px solid var(--border-gold); color:var(--accent-gold); border-radius:3px; padding:1px 6px; font-size:10px; font-family:'Segoe UI',sans-serif; font-weight:600; text-transform:none; letter-spacing:0; cursor:pointer;"
                          title="Restore hidden built-in 6×6 housing presets">
                    ↺ Restore (${hiddenCount})
                  </button>
                ` : ''}
                <button class="psec-toggle-btn" data-toggle-psec="sec2">${sec2 ? 'Collapse ▴' : 'Expand ▾'}</button>
              </div>
            </div>

            <div id="perm-preset-list" style="display:${sec2 ? 'flex' : 'none'}; flex-direction:column; gap:6px; margin-bottom:14px;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:4px;">
                <button class="tool-btn" id="btn-backup-presets" style="justify-content:center; font-size:11px;">💾 Backup Presets</button>
                <button class="tool-btn" id="btn-import-presets" style="justify-content:center; font-size:11px;">📂 Import Presets</button>
              </div>
              
              ${totalPermCount === 0 ? `
                <div class="panel-placeholder" style="padding:10px; font-size:11px;">
                  No Permanent Presets visible. Click <strong>↺ Restore</strong> above or save a custom preset.
                </div>
              ` : ''}
              ${visibleBuiltins.map(p => `
                <div style="display:flex; align-items:center; gap:5px; background:linear-gradient(90deg, #2b2218 0%, #221b14 100%); border:1px solid ${activeStampName === p.name ? 'var(--border-gold-bright)' : 'var(--border-gold)'}; border-radius:4px; padding:6px 8px;">
                  <div style="flex:1; min-width:0; cursor:pointer;" data-stamp-perm="${p.id}">
                    <div style="font-weight:700; font-size:11.5px; color:#ffe094; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ★ ${p.name}
                    </div>
                    <div style="font-size:10px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ${p.subtitle || `${p.w}×${p.h} • ${p.buildings.length} blds`}
                    </div>
                  </div>
                  <button class="tool-btn" data-stamp-perm="${p.id}" style="padding:4px 7px; font-size:11px;" title="Load Built-In 6×6 Stamp onto Cursor">Stamp</button>
                  <button class="tool-btn" data-hide-builtin="${p.id}" style="padding:4px 7px; font-size:10.5px; color:var(--text-muted);" title="Hide this built-in preset (can be restored anytime)">Hide</button>
                </div>
              `).join('')}
              ${APP.permanentPresets.map(p => `
                <div style="display:flex; align-items:center; gap:5px; background:var(--bg-panel-alt); border:1px solid ${activeStampName === p.name ? 'var(--border-gold-bright)' : 'var(--border-muted)'}; border-radius:4px; padding:6px 8px;">
                  <div style="flex:1; min-width:0; cursor:pointer;" data-stamp-perm="${p.id}">
                    <div style="font-weight:700; font-size:11.5px; color:var(--accent-gold); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      📌 ${p.name}
                    </div>
                    <div style="font-size:10px; color:var(--text-muted);">
                      ${p.w}×${p.h} • ${p.buildings.length} blds, ${p.roads.length} roads
                    </div>
                  </div>
                  <button class="tool-btn" data-stamp-perm="${p.id}" style="padding:4px 7px; font-size:11px;" title="Load Stamp onto Cursor">Stamp</button>
                  <button class="tool-btn danger" data-del-perm="${p.id}" style="padding:4px 7px; font-size:11px;" title="Delete Permanent Preset">✕</button>
                </div>
              `).join('')}
            </div>

            <!-- Section 3: Current Run Presets -->
            <div class="panel-section-title psec-header-row" data-toggle-psec="sec3">
              <span>${sec3 ? '▾' : '▸'} Current Run Presets (${APP.sessionPresets.length})</span>
              <button class="psec-toggle-btn" data-toggle-psec="sec3">${sec3 ? 'Collapse ▴' : 'Expand ▾'}</button>
            </div>

            <div id="session-preset-list" style="display:${sec3 ? 'flex' : 'none'}; flex-direction:column; gap:6px; margin-bottom:14px;">
              ${APP.sessionPresets.length === 0 ? `
                <div class="panel-placeholder" style="padding:8px; font-size:11px;">
                  No Current Run Presets in session memory.
                </div>
              ` : APP.sessionPresets.map(p => `
                <div style="display:flex; align-items:center; gap:5px; background:var(--bg-panel-alt); border:1px solid ${activeStampName === p.name ? 'var(--border-gold-bright)' : 'var(--border-muted)'}; border-radius:4px; padding:6px 8px;">
                  <div style="flex:1; min-width:0; cursor:pointer;" data-stamp-sess="${p.id}">
                    <div style="font-weight:600; font-size:11.5px; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ⏱️ ${p.name}
                    </div>
                    <div style="font-size:10px; color:var(--text-muted);">
                      ${p.w}×${p.h} • ${p.buildings.length} blds, ${p.roads.length} roads
                    </div>
                  </div>
                  <button class="tool-btn" data-stamp-sess="${p.id}" style="padding:4px 7px; font-size:11px;">Stamp</button>
                  <button class="tool-btn danger" data-del-sess="${p.id}" style="padding:4px 7px; font-size:11px;">✕</button>
                </div>
              `).join('')}
            </div>
          </div>
        `;

        // Restore scroll position on the unified scroll area
        const nextScrollEl = panel.querySelector('#presets-scroll-area');
        if (nextScrollEl) nextScrollEl.scrollTop = savedScrollTop;

        // Bind Expand/Collapse toggles for Sections 2 and 3
        panel.querySelectorAll('.psec-header-row').forEach(row => {
          row.addEventListener('click', (e) => {
            if (e.target.closest('#btn-restore-builtins')) return;
            const key = row.dataset.togglePsec;
            if (key) {
              APP.presetSectionsOpen[key] = !APP.presetSectionsOpen[key];
              renderPresetsSidebar();
            }
          });
        });

        // Bind Section 1 & Stamp UI events
        const btnSelect = panel.querySelector('#btn-activate-select');
        if (btnSelect) {
          btnSelect.addEventListener('click', () => {
            APP.activeStamp = null;
            APP.setToolMode('select');
            renderPresetsSidebar();
          });
        }

        const btnCancelStamp = panel.querySelector('#btn-cancel-stamp');
        if (btnCancelStamp) {
          btnCancelStamp.addEventListener('click', () => {
            APP.activeStamp = null;
            renderPresetsSidebar();
            APP.requestRender();
          });
        }

        const getPresetName = (fallbackPrefix) => {
          const inp = panel.querySelector('#preset-name-input');
          const raw = inp ? inp.value.trim() : '';
          return raw || `${fallbackPrefix} (${cap.w}×${cap.h})`;
        };

        const btnSaveSession = panel.querySelector('#btn-save-session-preset');
        if (btnSaveSession && cap) {
          btnSaveSession.addEventListener('click', () => {
            const preset = {
              id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: getPresetName(`Run Preset #${APP.sessionPresets.length + 1}`),
              w: cap.w,
              h: cap.h,
              buildings: JSON.parse(JSON.stringify(cap.buildings)),
              roads: JSON.parse(JSON.stringify(cap.roads))
            };
            APP.sessionPresets.unshift(preset);
            APP.presetSectionsOpen.sec3 = true;
            APP.activeStamp = preset;
            renderPresetsSidebar();
            APP.requestRender();
          });
        }

        const btnSavePerm = panel.querySelector('#btn-save-perm-preset');
        if (btnSavePerm && cap) {
          btnSavePerm.addEventListener('click', () => {
            const preset = {
              id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: getPresetName(`Kingdom Preset #${APP.permanentPresets.length + 1}`),
              w: cap.w,
              h: cap.h,
              buildings: JSON.parse(JSON.stringify(cap.buildings)),
              roads: JSON.parse(JSON.stringify(cap.roads))
            };
            APP.permanentPresets.unshift(preset);
            savePermanentPresets();
            APP.presetSectionsOpen.sec2 = true;
            APP.activeStamp = preset;
            renderPresetsSidebar();
            APP.requestRender();
          });
        }

        const btnStampNow = panel.querySelector('#btn-stamp-captured-now');
        if (btnStampNow && cap) {
          btnStampNow.addEventListener('click', () => {
            APP.activeStamp = {
              id: 'temp_captured',
              name: getPresetName('Captured Selection'),
              w: cap.w,
              h: cap.h,
              buildings: JSON.parse(JSON.stringify(cap.buildings)),
              roads: JSON.parse(JSON.stringify(cap.roads))
            };
            APP.setToolMode('select');
            renderPresetsSidebar();
            APP.requestRender();
          });
        }

        // Bind Permanent & Built-In Preset Stamp, Hide, Restore & Delete buttons
        panel.querySelectorAll('[data-stamp-perm]').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.dataset.stampPerm;
            const found = APP.builtinPresets.find(p => p.id === id) || APP.permanentPresets.find(p => p.id === id);
            if (found) {
              APP.activeStamp = found;
              APP.setToolMode('select');
              renderPresetsSidebar();
              APP.requestRender();
            }
          });
        });

        panel.querySelectorAll('[data-hide-builtin]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.hideBuiltin;
            APP.hiddenBuiltinIds.add(id);
            if (APP.activeStamp && APP.activeStamp.id === id) {
              APP.activeStamp = null;
            }
            saveHiddenBuiltins();
            renderPresetsSidebar();
            APP.requestRender();
          });
        });

        const btnRestoreBuiltins = panel.querySelector('#btn-restore-builtins');
        if (btnRestoreBuiltins) {
          btnRestoreBuiltins.addEventListener('click', (e) => {
            e.stopPropagation();
            APP.hiddenBuiltinIds.clear();
            APP.presetSectionsOpen.sec2 = true;
            saveHiddenBuiltins();
            renderPresetsSidebar();
          });
        }

        panel.querySelectorAll('[data-del-perm]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.delPerm;
            APP.permanentPresets = APP.permanentPresets.filter(p => p.id !== id);
            if (APP.activeStamp && APP.activeStamp.id === id) {
              APP.activeStamp = null;
            }
            savePermanentPresets();
            renderPresetsSidebar();
            APP.requestRender();
          });
        });

        // Bind Session Preset Stamp & Delete buttons
        panel.querySelectorAll('[data-stamp-sess]').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.dataset.stampSess;
            const found = APP.sessionPresets.find(p => p.id === id);
            if (found) {
              APP.activeStamp = found;
              APP.setToolMode('select');
              renderPresetsSidebar();
              APP.requestRender();
            }
          });
        });

        panel.querySelectorAll('[data-del-sess]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.delSess;
            APP.sessionPresets = APP.sessionPresets.filter(p => p.id !== id);
            if (APP.activeStamp && APP.activeStamp.id === id) {
              APP.activeStamp = null;
            }
            renderPresetsSidebar();
            APP.requestRender();
          });
        });

        // Bind Permanent Presets Backup/Import Buttons
        const btnBackupPresets = panel.querySelector('#btn-backup-presets');
        if (btnBackupPresets) {
          btnBackupPresets.addEventListener('click', () => {
            const jsonString = JSON.stringify(APP.permanentPresets, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fabledom_presets_backup_${new Date().getTime()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          });
        }

        const btnImportPresets = panel.querySelector('#btn-import-presets');
        if (btnImportPresets) {
          btnImportPresets.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
              const file = e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                try {
                  const data = JSON.parse(ev.target.result);
                  if (Array.isArray(data)) {
                    let imported = 0;
                    for (const newP of data) {
                      if (!APP.permanentPresets.find(p => p.id === newP.id)) {
                        APP.permanentPresets.unshift(newP);
                        imported++;
                      }
                    }
                    if (imported > 0) {
                      savePermanentPresets();
                      APP.presetSectionsOpen.sec2 = true;
                      renderPresetsSidebar();
                    }
                    alert(`Successfully imported ${imported} new permanent presets.`);
                  } else {
                    alert('Invalid preset backup format. Expected an array of presets.');
                  }
                } catch (err) {
                  alert('Failed to parse preset file.');
                }
              };
              reader.readAsText(file);
            };
            input.click();
          });
        }
      }

      APP.updateExportIndicator = function () {
        const el = document.getElementById('export-indicator');
        if (!el) return;
        const raw = localStorage.getItem(STORAGE_KEY_LAST_EXPORT);
        if (!raw) {
          el.textContent = 'Last exported: Never';
          return;
        }
        const d = new Date(raw);
        if (isNaN(d.getTime())) {
          el.textContent = 'Last exported: Never';
          return;
        }
        el.textContent = `Last exported: ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      };

      function renderDataSidebar() {
        const panel = document.getElementById('panel-data');
        if (!panel) return;

        panel.innerHTML = `
          <!-- Kingdom & Map Files -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <div class="panel-section-title" style="margin:0;">Kingdom &amp; Map Files</div>
            <span id="autosave-indicator" style="font-size:10px; color:var(--text-muted);"></span>
          </div>

          <div style="background:rgba(0,0,0,0.22); border:1px solid var(--border-muted); border-radius:6px; padding:10px; margin-bottom:14px;">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px; line-height:1.4;">
              Save or load your kingdom or terrain layout via JSON save files.
            </div>
            <button class="tool-btn active" id="btn-export-kingdom-modal" style="width:100%; justify-content:center; font-size:12px; padding:7px; margin-bottom:5px;">
              💾 Save Kingdom or Terrain
            </button>
            <div id="export-indicator" style="font-size:10.5px; color:var(--text-muted); text-align:center; margin-bottom:8px;"></div>
            <div style="display:flex; gap:6px;">
              <button class="tool-btn" id="btn-load-full-kingdom" style="flex:1; justify-content:center; font-size:11.5px;" title="Load a complete kingdom save (buildings + terrain)">📂 Load Saved Kingdom</button>
              <button class="tool-btn" id="btn-load-map-only" style="flex:1; justify-content:center; font-size:11.5px;" title="Extract only the terrain layer from a save file">🗺️ Load Saved Map</button>
            </div>
          </div>

          <!-- Fabledom Terrain Importer -->
          <div class="panel-section-title" style="margin-top:14px;">Fabledom Terrain Importer</div>
          <div style="font-size:10.5px; color:var(--text-muted); line-height:1.4; margin-bottom:8px; padding:0 4px;">
            Load a native Fabledom <strong>.savegame</strong> file to auto-populate terrain and deposits.
          </div>
          <button class="tool-btn active" id="btn-import-fabledom-save" style="width:100%; justify-content:center; margin-bottom:14px; padding:7px;">
            ⛰️ Import Fabledom Save File
          </button>

          <!-- Reset Options -->
          <div class="panel-section-title" style="margin-top:10px;">Reset Options</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button class="tool-btn danger" id="btn-sidebar-wipe-buildings" style="width:100%; justify-content:center; font-size:11.5px;">
              🧹 Wipe Buildings (Keep Terrain)
            </button>
            <button class="tool-btn danger" id="btn-sidebar-wipe-canvas" style="width:100%; justify-content:center; font-size:11.5px;">
              🔥 Wipe Canvas (Keep Perm Presets)
            </button>
          </div>
        `;

        // Bind Export Kingdom Modal Button
        const btnExportModal = panel.querySelector('#btn-export-kingdom-modal');
        if (btnExportModal) {
          btnExportModal.addEventListener('click', () => {
            APP.openSaveExportModal();
          });
        }

        // Fabledom Save Parser Button
        const btnImportFabledom = panel.querySelector('#btn-import-fabledom-save');
        if (btnImportFabledom) {
          btnImportFabledom.addEventListener('click', () => {
            if (typeof APP.triggerImportFabledomSave === 'function') APP.triggerImportFabledomSave();
          });
        }

        // Data Management JSON Loaders
        const handleJSONLoad = (mode) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json';
          input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
              try {
                const data = JSON.parse(ev.target.result);
                
                if (mode === 'full' && data.isTerrainOnly) {
                  alert("Note: This file was saved as a 'Terrain-Only' map. No buildings will be loaded.");
                }

                const success = APP.deserializeMapState(data, mode);
                
                if (success !== false) {
                  APP.centerOnTerritory(2, 2, 0.95);
                  if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
                  APP.notifyStateChanged();
                  
                  if (mode === 'map' || data.isTerrainOnly) {
                    setTimeout(() => APP.openLoadedSeedInfoModal(data), 60);
                  }
                } else {
                  alert('Error: Invalid Fabledom Planner JSON format.');
                }
              } catch (err) {
                alert('Error: Failed to parse JSON file.');
              }
            };
            reader.readAsText(file);
          };
          input.click();
        };

        const btnLoadFull = panel.querySelector('#btn-load-full-kingdom');
        if (btnLoadFull) {
          btnLoadFull.addEventListener('click', () => {
            APP.showConfirmModal({
              title: 'Load Kingdom Save?',
              icon: '📂',
              message: 'Loading this save will completely overwrite your current canvas.',
              confirmText: 'Load Kingdom',
              danger: true,
              onConfirm: () => handleJSONLoad('full')
            });
          });
        }

        const btnLoadMap = panel.querySelector('#btn-load-map-only');
        if (btnLoadMap) {
          btnLoadMap.addEventListener('click', () => {
            APP.showConfirmModal({
              title: 'Extract Terrain Map?',
              icon: '🗺️',
              message: 'Extracting the terrain layer from this save will completely wipe your current canvas and delete any existing buildings.',
              confirmText: 'Load Map',
              danger: true,
              onConfirm: () => handleJSONLoad('map')
            });
          });
        }

        // Sidebar Wipe Buttons
        const btnWipeBuildings = panel.querySelector('#btn-sidebar-wipe-buildings');
        if (btnWipeBuildings) {
          btnWipeBuildings.addEventListener('click', () => APP.wipeBuildings(false));
        }

        const btnWipeCanvas = panel.querySelector('#btn-sidebar-wipe-canvas');
        if (btnWipeCanvas) {
          btnWipeCanvas.addEventListener('click', () => APP.wipeCanvas(false));
        }
      }

      // 6. Hook into Canvas Mouse & Keyboard Events for Select & Stamp Mode
      APP.hooks.onToolChange.push((tool) => {
        if (tool.mode !== 'select') {
          APP.selectionState.isDragging = false;
          APP.activeStamp = null;
        }
        renderPresetsSidebar();
      });

      APP.hooks.onMouseDown.push((e, mouse) => {
        if (APP.activeTool.mode !== 'select' || !mouse.inBounds) return;
        const { tx, ty } = mouse;

        if (e.button === 2) {
          if (APP.activeStamp) {
            APP.activeStamp = null;
            renderPresetsSidebar();
          } else if (APP.selectionState.hasBox) {
            APP.selectionState.hasBox = false;
            APP.capturedStamp = null;
            renderPresetsSidebar();
          } else {
            APP.setToolMode('pan', null);
          }
          APP.requestRender();
          return;
        }

        if (e.button === 0) {
          if (APP.activeStamp) {
            APP.placeStampAt(APP.activeStamp, tx, ty, APP.activeTool.rot);
            return;
          }

          APP.selectionState.isDragging = true;
          APP.selectionState.hasBox = true;
          APP.selectionState.startX = tx;
          APP.selectionState.startY = ty;
          APP.selectionState.endX = tx;
          APP.selectionState.endY = ty;
        }
      });

      APP.hooks.onMouseMove.push((e, mouse) => {
        if (APP.activeTool.mode !== 'select' || !mouse.inBounds) return;
        if (APP.selectionState.isDragging) {
          APP.selectionState.endX = mouse.tx;
          APP.selectionState.endY = mouse.ty;
        }
      });

      APP.hooks.onMouseUp.push(() => {
        if (APP.activeTool.mode !== 'select') return;
        if (APP.selectionState.isDragging) {
          APP.selectionState.isDragging = false;
          const { startX, startY, endX, endY } = APP.selectionState;
          APP.captureRegionAsStamp(startX, startY, endX, endY);
        }
      });

      APP.hooks.onKeyDown.push((e) => {
        if (e.key === 'Escape' && APP.activeStamp) {
          APP.activeStamp = null;
          renderPresetsSidebar();
          APP.requestRender();
        }
      });

      // 7. Render Rectangular Selection Marquee & Rotatable Stamp Ghost Preview
      const prevDrawGhost = APP.onDrawSelectionAndGhost;
      APP.onDrawSelectionAndGhost = function (ctx) {
        if (APP.activeTool.mode === 'select') {
          const S = APP.TILE_PX;

          if (APP.activeStamp && APP.mouse.inBounds) {
            const { tx, ty } = APP.mouse;
            const check = APP.canPlaceStampAt(APP.activeStamp, tx, ty, APP.activeTool.rot);
            const rotated = APP.getRotatedStampData(APP.activeStamp, APP.activeTool.rot);

            if (rotated) {
              ctx.save();
              ctx.strokeStyle = check.ok ? '#6ee061' : '#ff5e52';
              ctx.lineWidth = 2 / APP.camera.zoom;
              ctx.setLineDash([6 / APP.camera.zoom, 4 / APP.camera.zoom]);
              ctx.strokeRect(tx * S, ty * S, rotated.w * S, rotated.h * S);
              ctx.setLineDash([]);

              for (const rd of rotated.roads) {
                const rx = (tx + rd.ndx) * S;
                const ry = (ty + rd.ndy) * S;
                ctx.globalAlpha = 0.65;
                ctx.fillStyle = rd.roadType === 'bridge' ? '#7a5432' : (rd.style === 'cobble' ? '#787b82' : '#8c785c');
                ctx.fillRect(rx + 3, ry + 3, S - 6, S - 6);
              }

              for (const b of rotated.buildings) {
                const def = APP.BUILDING_DEFS ? APP.BUILDING_DEFS[b.defId] : null;
                const bx = (tx + b.ndx) * S;
                const by = (ty + b.ndy) * S;
                const bw = b.nw * S;
                const bh = b.nh * S;

                ctx.globalAlpha = 0.70;
                ctx.fillStyle = def ? def.color : '#888';
                
                if (def && def.isFoundation) {
                  ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
                  ctx.globalAlpha = 1.0;
                  ctx.strokeStyle = check.ok ? '#6ee061' : '#ff5e52';
                  ctx.lineWidth = 2 / APP.camera.zoom;
                  ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
                } else {
                  ctx.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
                  ctx.globalAlpha = 1.0;
                  ctx.strokeStyle = check.ok ? '#6ee061' : '#ff5e52';
                  ctx.lineWidth = 2 / APP.camera.zoom;
                  ctx.strokeRect(bx + 2, by + 2, bw - 4, bh - 4);
                }

                if (def && APP.camera.zoom >= 0.45) {
                  ctx.fillStyle = '#ffffff';
                  ctx.font = 'bold 11px "Segoe UI Emoji", sans-serif';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(def.icon, bx + bw / 2, by + bh / 2);
                }
              }
              ctx.restore();
            }
            return;
          }

          if (APP.selectionState.hasBox) {
            const { startX, startY, endX, endY } = APP.selectionState;
            const minX = Math.min(startX, endX);
            const maxX = Math.max(startX, endX);
            const minY = Math.min(startY, endY);
            const maxY = Math.max(startY, endY);
            const px = minX * S;
            const py = minY * S;
            const pw = (maxX - minX + 1) * S;
            const ph = (maxY - minY + 1) * S;

            ctx.save();
            ctx.fillStyle = 'rgba(217, 167, 74, 0.18)';
            ctx.fillRect(px, py, pw, ph);
            ctx.strokeStyle = '#ffdf73';
            ctx.lineWidth = 2.5 / APP.camera.zoom;
            ctx.setLineDash([7 / APP.camera.zoom, 4 / APP.camera.zoom]);
            ctx.strokeRect(px, py, pw, ph);
            ctx.setLineDash([]);
            ctx.restore();
          }
          return;
        }

        if (typeof prevDrawGhost === 'function') {
          prevDrawGhost(ctx);
        }
      };

 // 8. Initialize Phase 5: Load Permanent Presets, Hidden Built-Ins & Auto-Saved Map
      loadPermanentPresets();
      loadHiddenBuiltins();
      APP.loadMapFromLocalStorage();
      renderPresetsSidebar();
      renderDataSidebar();

      // 9. Startup Splash Screen Logic
      const splash = document.getElementById('startup-splash');
      
      const revealStatusBar = () => {
        const leftGroup = document.getElementById('status-info-left');
        const toolSpan = document.getElementById('status-info-tool');
        const zoomSpan = document.getElementById('status-info-zoom');
        if (leftGroup) leftGroup.style.visibility = 'visible';
        if (toolSpan) toolSpan.style.visibility = 'visible';
        if (zoomSpan) zoomSpan.style.visibility = 'visible';
      };

      if (splash) {
        // Hide immediately if they already have an active map loaded in local storage
        if (!APP.isCanvasEmpty()) {
          splash.style.display = 'none';
          revealStatusBar();
        }
        
        document.getElementById('btn-splash-import').addEventListener('click', () => {
          if (typeof APP.triggerImportFabledomSave === 'function') {
            APP.triggerImportFabledomSave();
            splash.style.display = 'none';
            revealStatusBar();
          }
        });
        
        document.getElementById('btn-splash-blank').addEventListener('click', () => {
          splash.style.display = 'none';
          revealStatusBar();
          if (typeof APP.centerCamera === 'function') {
            APP.centerCamera();
          }
        });

        // Failsafe: hide splash if they bypass it by using the sidebar data tab directly
        APP.hooks.onStateChanged.push(() => {
          if (splash.style.display !== 'none' && !APP.isCanvasEmpty()) {
            splash.style.display = 'none';
            revealStatusBar();
          }
        });
      }
      // =========================================================================
      // FABLEDOM SAVE PARSER & JSON IMPORT/EXPORT LOGIC
      // =========================================================================

      // =========================================================================
      // FABLEDOM SAVES DIRECTORY SCANNER & INDEXED-DB PERSISTENCE (OPTION 1)
      // =========================================================================

      function openFabledomDB() {
        return new Promise((resolve) => {
          if (!window.indexedDB) return resolve(null);
          const req = indexedDB.open('FabledomPlannerDirDB', 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('settings')) {
              db.createObjectStore('settings');
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });
      }

      async function getSavedDirectoryHandle() {
        const db = await openFabledomDB();
        if (!db) return null;
        return new Promise((resolve) => {
          try {
            const tx = db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const req = store.get('fabledomSavesDir');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
          } catch (e) {
            resolve(null);
          }
        });
      }

      async function storeDirectoryHandle(handle) {
        const db = await openFabledomDB();
        if (!db) return;
        return new Promise((resolve) => {
          try {
            const tx = db.transaction('settings', 'readwrite');
            const store = tx.objectStore('settings');
            store.put(handle, 'fabledomSavesDir');
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          } catch (e) {
            resolve();
          }
        });
      }

      async function clearSavedDirectoryHandle() {
        const db = await openFabledomDB();
        if (!db) return;
        return new Promise((resolve) => {
          try {
            const tx = db.transaction('settings', 'readwrite');
            const store = tx.objectStore('settings');
            store.delete('fabledomSavesDir');
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          } catch (e) {
            resolve();
          }
        });
      }

      async function getValidDirectoryHandle() {
        const handle = await getSavedDirectoryHandle();
        if (!handle) return null;
        try {
          let perm = await handle.queryPermission({ mode: 'read' });
          if (perm === 'granted') return handle;
          perm = await handle.requestPermission({ mode: 'read' });
          if (perm === 'granted') return handle;
        } catch (err) {
          // Directory moved, permission revoked, or handle invalidated
        }
        await clearSavedDirectoryHandle();
        return null;
      }

    function parseSaveMetaInfo(metaText, fallbackTitle) {
        let title = fallbackTitle;
        let details = '';
        if (metaText && typeof metaText === 'string') {
          // 1. Check for standard JSON metadata
          try {
            const data = JSON.parse(metaText);
            title = data.saveTitle || data.kingdomName || data.KingdomName || data.name || data.Name || data.townName || data.title || fallbackTitle;
            if (data.population !== undefined || data.Population !== undefined) {
              details += `Pop: ${data.population ?? data.Population} • `;
            }
            if (data.day !== undefined || data.Day !== undefined) {
              details += `Day ${data.day ?? data.Day} • `;
            }
            return { title, details };
          } catch (e) {}

          // 2. Fabledom metadata: extract the string following 'saveTitle'
          const saveTitleMatch = metaText.match(/saveTitle[\s\x00-\x1f]+([^\x00-\x1f\r\n]+)/i);
          if (saveTitleMatch && saveTitleMatch[1]) {
            let extracted = saveTitleMatch[1].trim();
            const boundaryIdx = extracted.search(/\s*(?:realm|population|gameMode)\b/i);
            if (boundaryIdx > 0) {
              extracted = extracted.substring(0, boundaryIdx).trim();
            }
            if (extracted.length > 0) {
              title = extracted;
            }
          } else {
            const fallbackMatch = metaText.match(/["']?(?:kingdomName|name|title|townName)["']?\s*[:=]\s*["']?([^\x00-\x1f"'#\r\n]+)/i);
            if (fallbackMatch && fallbackMatch[1]) {
              title = fallbackMatch[1].trim();
            }
          }

          // Extract population count if present
          const popMatch = metaText.match(/population[\s\x00-\x1f]+(\d+)/i);
          if (popMatch && popMatch[1]) {
            details += `Pop: ${popMatch[1]} • `;
          }
        }
        return { title, details };
      }

      async function extractSavegameFromHandle(entry, metaMap, relativePath) {
        const file = await entry.getFile();
        const base = relativePath.replace(/\.savegame$/i, '');
        const fileBase = entry.name.replace(/\.savegame$/i, '');
        const slotMatch = fileBase.match(/slot(\d+)/i);
        const slotLabel = slotMatch ? `Slot ${slotMatch[1]}` : fileBase;

        let metaText = '';
        const metaEntry = metaMap.get(base.toLowerCase());
        if (metaEntry) {
          try {
            const mFile = await metaEntry.getFile();
            metaText = await mFile.text();
          } catch (e) {}
        }

        let { title, details } = parseSaveMetaInfo(metaText, slotLabel);

        // Fallback: check the header block of the .savegame file if metadata file was missing or untitled
        if (title === slotLabel) {
          try {
            const slice = await file.slice(0, 65536).text();
            const headerMatch = slice.match(/saveTitle[\s\x00-\x1f]+([^\x00-\x1f\r\n]+)/i);
            if (headerMatch && headerMatch[1]) {
              let extracted = headerMatch[1].trim();
              const boundaryIdx = extracted.search(/\s*(?:realm|population|gameMode)\b/i);
              if (boundaryIdx > 0) extracted = extracted.substring(0, boundaryIdx).trim();
              if (extracted.length > 0) title = extracted;
            } else {
              const jsonMatch = slice.match(/["'](?:kingdomName|townName|cityName)["']\s*:\s*["']([^"']+)["']/i);
              if (jsonMatch && jsonMatch[1]) title = jsonMatch[1].trim();
            }
          } catch (e) {}
        }

        const sizeKb = Math.round(file.size / 1024);
        const sizeStr = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
        const dateStr = new Date(file.lastModified).toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        return {
          slotLabel,
          title,
          details,
          dateStr,
          sizeStr,
          lastModified: file.lastModified,
          getFileContent: () => file.text()
        };
      }

      async function scanDirectoryForSaves(dirHandle) {
        const savegameEntries = [];
        const metaMap = new Map();

        const collectEntries = async (directoryHandle, relativePath = '') => {
          for await (const entry of directoryHandle.values()) {
            const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            if (entry.kind === 'directory') {
              await collectEntries(entry, entryPath);
            } else if (entry.kind === 'file') {
              const lowerPath = entryPath.toLowerCase();
              if (lowerPath.endsWith('.savegame')) {
                savegameEntries.push({ entry, relativePath: entryPath });
              } else {
                const base = lowerPath.replace(/\.(metadata|meta|json|txt|dat|bin)$/i, '').replace(/(_metadata|_meta)$/i, '');
                metaMap.set(base, entry);
              }
            }
          }
        };
        await collectEntries(dirHandle);

        const items = [];
        for (const { entry, relativePath } of savegameEntries) {
          const item = await extractSavegameFromHandle(entry, metaMap, relativePath);
          items.push(item);
        }

        items.sort((a, b) => b.lastModified - a.lastModified);
        return items;
      }

      function openFabledomSaveBrowserModal(folderName, savesList, onChangeFolder) {
        const existing = document.getElementById('fabledom-saves-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'fabledom-saves-modal';
        overlay.style.cssText = `
          position: fixed; inset: 0; background: rgba(10, 7, 5, 0.82);
          backdrop-filter: blur(3px); z-index: 9999;
          display: flex; align-items: center; justify-content: center; padding: 16px;
        `;

        const renderListHtml = (saves) => {
          if (!saves || saves.length === 0) {
            return `
              <div style="border: 1px dashed var(--border-gold, #8c6d3f); border-radius: 6px; padding: 22px 16px; text-align: center; background: rgba(0,0,0,0.28); color: var(--text-main, #eee0c5);">
                <div style="font-size: 13.5px; font-weight: 700; color: #ff948a; margin-bottom: 6px;">
                  No .savegame files found in "${folderName}"
                </div>
                <div style="font-size: 11.5px; color: var(--text-muted, #b09d7c); line-height: 1.5; margin-bottom: 12px;">
                  If you need help finding your Fabledom saved games, please click <strong>📁 Change Folder</strong> above, copy and paste the file path below, select the "SaveData" folder, and click the "Select Folder" button:
                </div>
                <div style="font-family: Consolas, monospace; font-size: 10.5px; padding: 7px 10px; background: rgba(0,0,0,0.45); border: 1px solid var(--border-muted, #47392b); border-radius: 4px; color: #ffdfa0; user-select: all; word-break: break-all;">
                  %USERPROFILE%\\AppData\\LocalLow\\Grenaa Games\\Fabledom
                </div>
              </div>
            `;
          }

          return saves.map((s, idx) => `
            <div class="fabledom-save-card" data-idx="${idx}"
                 style="display: flex; align-items: center; justify-content: space-between; gap: 12px;
                        padding: 10px 12px; background: var(--bg-panel-alt, #29211a);
                        border: 1px solid var(--border-muted, #47392b); border-radius: 5px;
                        cursor: pointer; transition: all 0.12s ease;">
              <div style="min-width: 0; flex: 1;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px;">
                  <span style="font-weight: 700; font-size: 13px; color: var(--accent-gold, #d9a74a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${s.title}
                  </span>
                  <span class="status-badge active" style="font-size: 10px; padding: 1px 6px;">
                    ${s.slotLabel}
                  </span>
                </div>
                <div style="font-size: 10.5px; color: var(--text-muted, #b09d7c);">
                  ${s.details}${s.dateStr} • ${s.sizeStr}
                </div>
              </div>
              <button class="tool-btn active" style="padding: 5px 12px; font-size: 11.5px; flex-shrink: 0; pointer-events: none;">
                Load Terrain Map
              </button>
            </div>
          `).join('');
        };

        overlay.innerHTML = `
          <div style="width: 560px; max-width: 95vw; max-height: 85vh; display: flex; flex-direction: column;
                      background: linear-gradient(180deg, #2b2219 0%, #1a140f 100%);
                      border: 2px solid var(--border-gold-bright, #cfa358);
                      border-radius: 7px; box-shadow: 0 14px 38px rgba(0, 0, 0, 0.85);
                      overflow: hidden; color: var(--text-main, #eee0c5); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            
            <div style="padding: 12px 16px; background: linear-gradient(90deg, #382a1d 0%, #241b12 100%);
                        border-bottom: 1px solid var(--border-gold, #8c6d3f); display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 8px; font-family: Georgia, serif; font-size: 14px; font-weight: 700; color: var(--accent-gold, #d9a74a); text-transform: uppercase; letter-spacing: 0.6px;">
                <span>⛰️</span>
                <span>Select Fabledom Savegame</span>
              </div>
              <button id="fabledom-modal-close" style="background: transparent; border: none; color: var(--text-muted, #b09d7c); font-size: 16px; cursor: pointer; padding: 2px 6px;">✕</button>
            </div>

            <div style="padding: 9px 16px; background: rgba(0, 0, 0, 0.32); border-bottom: 1px solid var(--border-muted, #47392b); display: flex; align-items: center; justify-content: space-between; gap: 10px;">
              <div style="font-size: 11.5px; color: var(--text-muted, #b09d7c); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                📁 Current Folder: <strong id="fabledom-modal-folder-name" style="color: var(--text-main, #eee0c5);">${folderName}</strong>
              </div>
              <button class="tool-btn" id="fabledom-modal-change-folder" style="padding: 4px 9px; font-size: 11px; flex-shrink: 0;" title="Select a different Fabledom Saves directory">
                📁 Change Folder
              </button>
            </div>

            <div id="fabledom-saves-scroll-list" style="flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px;">
              ${renderListHtml(savesList)}
            </div>

            <div style="padding: 10px 16px; border-top: 1px solid var(--border-muted, #47392b); background: rgba(0, 0, 0, 0.22); display: flex; align-items: center; justify-content: space-between;">
              <div style="font-size: 10.5px; color: var(--text-dim, #7d6d54);">
                Select a kingdom to extract its terrain and resource nodes.
              </div>
              <button class="tool-btn" id="fabledom-modal-cancel" style="padding: 5px 14px; font-size: 11.5px;">
                Cancel
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(overlay);

        const closeModal = () => {
          document.removeEventListener('keydown', onKeyDown);
          overlay.remove();
        };

        const onKeyDown = (e) => {
          if (e.key === 'Escape') closeModal();
        };
        document.addEventListener('keydown', onKeyDown);

        overlay.querySelector('#fabledom-modal-close').addEventListener('click', closeModal);
        overlay.querySelector('#fabledom-modal-cancel').addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) closeModal();
        });

        overlay.querySelector('#fabledom-modal-change-folder').addEventListener('click', async () => {
          if (typeof onChangeFolder === 'function') {
            await onChangeFolder();
          }
        });

        const listContainer = overlay.querySelector('#fabledom-saves-scroll-list');
        listContainer.querySelectorAll('.fabledom-save-card').forEach((card) => {
          card.addEventListener('mouseenter', () => {
            card.style.borderColor = 'var(--border-gold-bright, #cfa358)';
            card.style.background = '#362b21';
          });
          card.addEventListener('mouseleave', () => {
            card.style.borderColor = 'var(--border-muted, #47392b)';
            card.style.background = 'var(--bg-panel-alt, #29211a)';
          });
          card.addEventListener('click', () => {
            const idx = parseInt(card.dataset.idx, 10);
            const saveItem = savesList[idx];
            if (!saveItem) return;

            closeModal();

            APP.showConfirmModal({
              title: `Import "${saveItem.title}"?`,
              icon: '⛰️',
              message: `Extracting map data from <strong>${saveItem.title}</strong> (${saveItem.slotLabel}) will wipe your current widget canvas.<br/><br/>Your permanent presets will NOT be affected.`,
              confirmText: 'Extract Map',
              danger: true,
              onConfirm: async () => {
                // 1. Add loading overlay
                const loadingEl = document.createElement('div');
                loadingEl.id = 'fabledom-loading-overlay';
                loadingEl.style.cssText = `position: fixed; inset: 0; background: rgba(10, 7, 5, 0.85); z-index: 10000; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--accent-gold); font-family: Georgia, serif; font-size: 18px; font-weight: bold; backdrop-filter: blur(4px);`;
                loadingEl.innerHTML = `<div style="font-size:32px; margin-bottom: 12px; display: inline-block; animation: spin 2s linear infinite;">⏳</div><div>Reading & Parsing Save File...</div><style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>`;
                document.body.appendChild(loadingEl);
                
                // 2. Yield thread to ensure browser paints the overlay before the file fetch blocks it
                await new Promise(r => setTimeout(r, 50));

                try {
                  const fileData = await saveItem.getFileContent();
                  // 3. Await the new Web Worker Promise
                  const success = await APP.parseFabledomSave(fileData);
                  if (success) {
                    APP.centerOnTerritory(2, 2, 0.95);
                    if (typeof APP.evaluateAllWarnings === 'function') APP.evaluateAllWarnings();
                    APP.notifyStateChanged();
                  }
                } catch (e) {
                  console.error(e);
                  alert("Failed to read save file.");
                } finally {
                  // 4. Remove overlay when worker finishes
                  const overlay = document.getElementById('fabledom-loading-overlay');
                  if (overlay) overlay.remove();
                }
              }
            });
          });
        });
      }

   function openFabledomFallbackFileInput() {
        const input = document.createElement('input');
        input.type = 'file';
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
        input.setAttribute('multiple', '');

        input.onchange = async (e) => {
          const files = Array.from(e.target.files || []);
          if (files.length === 0) return;

          const saveFiles = files.filter(f => f.name.toLowerCase().endsWith('.savegame'));
          const metaMap = new Map();
          for (const f of files) {
            const lower = f.name.toLowerCase();
            if (!lower.endsWith('.savegame')) {
              const base = lower.replace(/\.(metadata|meta|json|txt|dat|bin)$/i, '').replace(/(_metadata|_meta)$/i, '');
              metaMap.set(base, f);
            }
          }

          const items = [];
          for (const sFile of saveFiles) {
            const base = sFile.name.replace(/\.savegame$/i, '');
            const slotMatch = base.match(/slot(\d+)/i);
            const slotLabel = slotMatch ? `Slot ${slotMatch[1]}` : base;

            let metaText = '';
            const mFile = metaMap.get(base.toLowerCase());
            if (mFile) {
              try { metaText = await mFile.text(); } catch (err) {}
            }

            let { title, details } = parseSaveMetaInfo(metaText, slotLabel);
            if (title === slotLabel) {
              try {
                const slice = await sFile.slice(0, 65536).text();
                const headerMatch = slice.match(/saveTitle[\s\x00-\x1f]+([^\x00-\x1f\r\n]+)/i);
                if (headerMatch && headerMatch[1]) {
                  let extracted = headerMatch[1].trim();
                  const boundaryIdx = extracted.search(/\s*(?:realm|population|gameMode)\b/i);
                  if (boundaryIdx > 0) extracted = extracted.substring(0, boundaryIdx).trim();
                  if (extracted.length > 0) title = extracted;
                } else {
                  const match = slice.match(/["'](?:kingdomName|townName|cityName)["']\s*:\s*["']([^"']+)["']/i);
                  if (match && match[1]) title = match[1].trim();
                }
              } catch (err) {}
            }

            const sizeKb = Math.round(sFile.size / 1024);
            const sizeStr = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
            const dateStr = new Date(sFile.lastModified).toLocaleDateString([], {
              month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            items.push({
              slotLabel,
              title,
              details,
              dateStr,
              sizeStr,
              lastModified: sFile.lastModified,
              getFileContent: () => sFile.text()
            });
          }

          items.sort((a, b) => b.lastModified - a.lastModified);
          const folderName = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : 'Selected Saves Folder';

          openFabledomSaveBrowserModal(folderName, items, () => {
            openFabledomFallbackFileInput();
          });
        };

        input.click();
      }

      function reportDirectoryImportError(context, error) {
        if (error && error.name === 'AbortError') return;
        console.error(context, error);
        const detail = error && error.message ? `\n\nDetails: ${error.message}` : '';
        alert(`${context}${detail}`);
      }

      APP.triggerImportFabledomSave = async function () {
        if (!window.showDirectoryPicker) {
          openFabledomFallbackFileInput();
          return;
        }

        let dirHandle = await getValidDirectoryHandle();

        if (!dirHandle) {
          try {
            dirHandle = await window.showDirectoryPicker({
              id: 'fabledomSavesFolder',
              mode: 'read'
            });
            await storeDirectoryHandle(dirHandle);
          } catch (err) {
            reportDirectoryImportError(
              'Could not open the Fabledom save-folder picker. Try a supported browser or use the deployed app.',
              err
            );
            return;
          }
        }

        const runBrowser = async (handle) => {
          try {
            const saves = await scanDirectoryForSaves(handle);
            openFabledomSaveBrowserModal(handle.name, saves, async () => {
              try {
                const newHandle = await window.showDirectoryPicker({
                  id: 'fabledomSavesFolder',
                  mode: 'read'
                });
                await storeDirectoryHandle(newHandle);
                await runBrowser(newHandle);
              } catch (err) {
                reportDirectoryImportError('Could not select the Fabledom save folder.', err);
              }
            });
          } catch (scanErr) {
            await clearSavedDirectoryHandle();
            reportDirectoryImportError(
              'Could not read the selected folder. Select the Fabledom SaveData folder and allow read access.',
              scanErr
            );
          }
        };

        await runBrowser(dirHandle);
      };

// Native Parser: Offloads 15MB JSON parsing to an inline Web Worker
      APP.parseFabledomSave = function(fileData) {
        return new Promise((resolve) => {
          // Worker code is wrapped in a template literal. No backticks used inside to prevent breaking.
          const workerCode = `
            self.onmessage = function(e) {
              try {
                const rawData = e.data;
                const saveFile = JSON.parse(rawData);
                if (!saveFile.saveData) {
                  self.postMessage({ error: "Invalid format: This does not appear to be a Fabledom save file." });
                  return;
                }

                const gridEntry = saveFile.saveData.find(el => el.guid && el.guid.includes("GridManager") && el.guid.includes("Grid Manager"));
                if (!gridEntry) {
                  self.postMessage({ error: "Could not locate GridManager terrain data in this save file." });
                  return;
                }

                const gridData = JSON.parse(gridEntry.data);
                const savedSize = gridData.savedSize || 115;
                
                let newTerrSize = 19; 
                if (savedSize >= 115) newTerrSize = 20; 
                else if (savedSize <= 105) newTerrSize = 18; 

                const gridSize = newTerrSize * 5;
                const padding = Math.floor((savedSize - gridSize) / 2);
                
                const terrainUpdates = [];
                const territoryUpdates = [];

                if (gridData.savedInfoGridList) {
                  gridData.savedInfoGridList.forEach(row => {
                    if (row && row.list) {
                      row.list.forEach(t => {
                        const cx = t.coord.x - padding;
                        const cy = (savedSize - 1 - t.coord.z) - padding;
                        
                        if (cx >= 0 && cx < gridSize && cy >= 0 && cy < gridSize) {
                          let type = 'grass';
                          if (t.isHillBorder || t.isHillSlope) type = 'hill';
                          else if (t.isRiver || t.isRiverOrigin) type = 'river';
                          else if (t.isWater) type = 'lake';
                          else if (t.isLandNeighboringWater) type = 'shoreline';
                          else if (t.isForest) type = 'tree';
                          else if (t.isHill) type = 'hill_top';
                          
                          terrainUpdates.push({ cx, cy, type });

                          if (t.isFowRevealed) {
                            territoryUpdates.push({ cx, cy });
                          }
                        }
                      });
                    }
                  });
                }

                const depositUpdates = [];
                const standaloneUpdates = [];

                saveFile.saveData.forEach(el => {
                  if (el.guid && el.guid.includes("SaveTransform")) {
                    const guid = el.guid.toLowerCase();
                    const cloneIdx = guid.indexOf("(clone)");
                    if (cloneIdx === -1) return;

                    const pfx = guid.lastIndexOf("-", cloneIdx);
                    const prefabName = guid.substring(pfx + 1, cloneIdx).trim();

                    const tData = JSON.parse(el.data);
                    if (!tData || !tData.position) return;

                    let depType = null;
                    if (prefabName === 'stone deposit small') depType = 'small_stone';
                    else if (prefabName === 'stone deposit large') depType = 'large_stone';
                    else if (prefabName === 'iron deposit') depType = 'iron';
                    else if (prefabName === 'prismatic liquid' || prefabName.includes('mystic')) depType = 'mystic';
                    else if (prefabName === 'ruins') depType = 'ruin';
                    else if (
                      prefabName === 'abandoned graveyard' || prefabName === 'bob barkskin' ||
                      prefabName === 'stone giant lair' || prefabName === 'the missing shoe' ||
                      prefabName === 'wishing well' || prefabName === 'witches hut'
                    ) {
                      depType = 'encounter';
                    }

                    if (depType) {
                      const minGridX = Math.round(tData.position.x / 10) - 1;
                      const maxGridZ = Math.round(tData.position.z / 10);
                      const cx = minGridX - padding;
                      const cy = (savedSize - 1 - maxGridZ) - padding;

                      if (cx >= 0 && cx < gridSize && cy >= 0 && cy < gridSize) {
                        let rot = 0;
                        if (tData.rotation.y > 45 && tData.rotation.y <= 135) rot = 90;
                        else if (tData.rotation.y > 135 && tData.rotation.y <= 225) rot = 180;
                        else if (tData.rotation.y > 225 && tData.rotation.y <= 315) rot = 270;
                        depositUpdates.push({ cx, cy, depType, rot });
                      }
                    } else {
                      const gridX = Math.floor(tData.position.x / 10);
                      const gridZ = Math.floor(tData.position.z / 10);
                      const cx = gridX - padding;
                      const cy = (savedSize - 1 - gridZ) - padding;

                      if (cx >= 0 && cx < gridSize && cy >= 0 && cy < gridSize) {
                         let sType = null;
                         if (prefabName === 'tree') sType = 'tree';
                         else if (prefabName === 'fish') sType = 'shoal';
                         
                         if (sType) {
                           standaloneUpdates.push({ cx, cy, type: sType });
                         }
                      }
                    }
                  }
                });

                self.postMessage({
                  success: true,
                  newTerrSize,
                  terrainUpdates,
                  territoryUpdates,
                  depositUpdates,
                  standaloneUpdates
                });

              } catch (err) {
                self.postMessage({ error: "Error parsing Fabledom save data. See console for details." });
              }
            };
          `;

          const blob = new Blob([workerCode], { type: 'application/javascript' });
          const workerUrl = URL.createObjectURL(blob);
          const worker = new Worker(workerUrl);

          worker.onmessage = (e) => {
            URL.revokeObjectURL(workerUrl);
            const result = e.data;
            
            if (result.error) {
              alert(result.error);
              resolve(false);
              return;
            }

            // Sync structural limits before applying worker updates
            if (APP.TERR_SIZE !== result.newTerrSize) {
              APP.setRealmSize(result.newTerrSize, true); 
            } else {
              APP.wipeCanvas(true);
            }

            // 1. Apply Bulk Terrain
            for (let i = 0; i < result.terrainUpdates.length; i++) {
               const t = result.terrainUpdates[i];
               APP.terrain[t.cy][t.cx].type = t.type;
            }

            // 2. Apply Fog of War Reveal
            for (let i = 0; i < result.territoryUpdates.length; i++) {
               const t = result.territoryUpdates[i];
               const terrX = Math.floor(t.cx / result.newTerrSize);
               const terrY = Math.floor(t.cy / result.newTerrSize);
               if (APP.territories[terrY] && APP.territories[terrY][terrX] === false) {
                 APP.territories[terrY][terrX] = true;
               }
            }
            APP.updateMinimapCounter();

            // 3. Apply Multi-Tile Deposit Footprints
            for (let i = 0; i < result.depositUpdates.length; i++) {
               const d = result.depositUpdates[i];
               APP.placeDeposit(d.cx, d.cy, d.depType, d.rot);
            }

            // 4. Layer Single-Tile Overrides (Trees & Shoals)
            for (let i = 0; i < result.standaloneUpdates.length; i++) {
               const s = result.standaloneUpdates[i];
               const curType = APP.terrain[s.cy][s.cx].type;
               
               if (s.type === 'tree' && curType !== 'hill' && curType !== 'river' && curType !== 'lake') {
                 APP.terrain[s.cy][s.cx].type = 'tree';
               } else if (s.type === 'shoal' && (curType === 'lake' || curType === 'river')) {
                 APP.terrain[s.cy][s.cx].type = 'shoal';
               }
            }
            
            resolve(true);
          };

          worker.onerror = (err) => {
            URL.revokeObjectURL(workerUrl);
            console.error("Worker Error:", err);
            alert("A critical error occurred while parsing the save file.");
            resolve(false);
          };

          // Trigger worker execution
          worker.postMessage(fileData);
        });
      };
 })();