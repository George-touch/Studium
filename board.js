// ============================================================
// Skillovo Board — доска для уроков и домашних заданий.
// Инструменты: перо, ластик, текст, фигуры (прямоугольник,
// эллипс, стрелка), стикеры, изображения, выбор/перемещение/
// масштабирование, зум и панорамирование холста, отмена (Ctrl+Z),
// дублирование (Ctrl+D). Данные — плоский массив элементов,
// готовый к сохранению в Firebase по пути boards/{boardId}.
// ============================================================

export function createBoard({ canvas, wrap, toolbar, onChange }) {
    const ctx = canvas.getContext('2d');

    let elements = [];
    let selectedId = null;
    let idCounter = 1;
    let tool = 'pen';
    let color = '#0A84FF';
    let fillColor = '#FFE58A';
    let strokeWidth = 4;

    // вид: смещение и масштаб холста (зум/панорамирование)
    let viewX = 0, viewY = 0, scale = 1;
    const MIN_SCALE = 0.2, MAX_SCALE = 4;

    let drawing = false;
    let currentEl = null;
    let dragOffset = null;
    let resizing = null;
    let isPanning = false;
    let panStart = null;
    let spacePressed = false;
    const activePointers = new Map();
    let pinchStartDist = null;
    let saveTimer = null;

    const history = [];
    const HISTORY_LIMIT = 50;

    function newId() { return 'el_' + (idCounter++) + '_' + Date.now(); }

    function snapshot() {
        history.push(JSON.stringify(serialize()));
        if (history.length > HISTORY_LIMIT) history.shift();
    }

    function undo() {
        if (history.length === 0) return;
        const prev = JSON.parse(history.pop());
        load(prev, { keepHistory: true });
        scheduleSave();
    }

    function scheduleSave() {
        if (!onChange) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => onChange(serialize()), 600);
    }

    function resizeCanvas() {
        const rect = wrap.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        redraw();
    }

    // ---------- координаты: экран <-> мир ----------
    function screenPos(e) {
        const rect = canvas.getBoundingClientRect();
        const point = e.touches ? e.touches[0] : e;
        return { x: point.clientX - rect.left, y: point.clientY - rect.top };
    }
    function toWorld(sx, sy) { return { x: (sx - viewX) / scale, y: (sy - viewY) / scale }; }
    function toScreen(wx, wy) { return { x: wx * scale + viewX, y: wy * scale + viewY }; }
    function worldPos(e) { const s = screenPos(e); return toWorld(s.x, s.y); }

    function setZoomLabel() {
        const label = toolbar && toolbar.querySelector('[data-board-zoom-level]');
        if (label) label.textContent = Math.round(scale * 100) + '%';
    }

    function zoomAt(sx, sy, factor) {
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
        const before = toWorld(sx, sy);
        scale = newScale;
        viewX = sx - before.x * scale;
        viewY = sy - before.y * scale;
        redraw();
        setZoomLabel();
    }

    function resetView() {
        scale = 1; viewX = 0; viewY = 0;
        redraw();
        setZoomLabel();
    }

    // ---------- рендер ----------
    function redraw() {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        drawGrid();

        ctx.save();
        ctx.translate(viewX, viewY);
        ctx.scale(scale, scale);
        for (const el of elements) drawElement(el);
        if (selectedId) {
            const el = elements.find(e => e.id === selectedId);
            if (el) drawSelection(el);
        }
        ctx.restore();
    }

    function drawGrid() {
        const step = 32 * scale;
        if (step < 8) return;
        ctx.save();
        ctx.fillStyle = 'rgba(120,120,128,0.18)';
        const offX = viewX % step, offY = viewY % step;
        for (let x = offX; x < canvas.width; x += step) {
            for (let y = offY; y < canvas.height; y += step) {
                ctx.beginPath();
                ctx.arc(x, y, 1.1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    function wrapLines(text, maxWidth) {
        const words = text.split(/\s+/);
        const lines = [];
        let line = '';
        words.forEach(word => {
            const test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    function drawElement(el) {
        if (el.type === 'stroke') {
            if (el.points.length < 2) return;
            ctx.save();
            ctx.globalCompositeOperation = el.erase ? 'destination-out' : 'source-over';
            ctx.strokeStyle = el.color;
            ctx.lineWidth = el.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(el.points[0].x, el.points[0].y);
            for (const p of el.points.slice(1)) ctx.lineTo(p.x, p.y);
            ctx.stroke();
            ctx.restore();
        } else if (el.type === 'text') {
            ctx.save();
            ctx.fillStyle = el.color;
            ctx.font = `${el.fontSize}px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
            ctx.textBaseline = 'top';
            el.text.split('\n').forEach((line, i) => ctx.fillText(line, el.x, el.y + i * (el.fontSize * 1.25)));
            ctx.restore();
        } else if (el.type === 'image' && el._img) {
            ctx.drawImage(el._img, el.x, el.y, el.w, el.h);
        } else if (el.type === 'shape') {
            ctx.save();
            ctx.strokeStyle = el.color;
            ctx.lineWidth = el.strokeWidth;
            if (el.fill) ctx.fillStyle = el.fill;
            if (el.kind === 'rect') {
                if (el.fill) ctx.fillRect(el.x, el.y, el.w, el.h);
                ctx.strokeRect(el.x, el.y, el.w, el.h);
            } else if (el.kind === 'ellipse') {
                ctx.beginPath();
                ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
                if (el.fill) ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        } else if (el.type === 'line') {
            ctx.save();
            ctx.strokeStyle = el.color;
            ctx.fillStyle = el.color;
            ctx.lineWidth = el.strokeWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(el.x1, el.y1);
            ctx.lineTo(el.x2, el.y2);
            ctx.stroke();
            const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
            const headLen = 8 + el.strokeWidth * 1.5;
            ctx.beginPath();
            ctx.moveTo(el.x2, el.y2);
            ctx.lineTo(el.x2 - headLen * Math.cos(angle - Math.PI / 7), el.y2 - headLen * Math.sin(angle - Math.PI / 7));
            ctx.lineTo(el.x2 - headLen * Math.cos(angle + Math.PI / 7), el.y2 - headLen * Math.sin(angle + Math.PI / 7));
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        } else if (el.type === 'sticky') {
            ctx.save();
            ctx.fillStyle = el.fill;
            ctx.fillRect(el.x, el.y, el.w, el.h);
            ctx.strokeStyle = 'rgba(0,0,0,0.08)';
            ctx.strokeRect(el.x, el.y, el.w, el.h);
            ctx.fillStyle = el.color;
            ctx.font = `${el.fontSize}px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
            ctx.textBaseline = 'top';
            const pad = 10;
            const lines = wrapLines(el.text || '', el.w - pad * 2);
            lines.forEach((line, i) => ctx.fillText(line, el.x + pad, el.y + pad + i * (el.fontSize * 1.25)));
            ctx.restore();
        }
    }

    function boundsOf(el) {
        if (el.type === 'stroke') {
            const xs = el.points.map(p => p.x), ys = el.points.map(p => p.y);
            return {
                x: Math.min(...xs) - el.width, y: Math.min(...ys) - el.width,
                w: Math.max(...xs) - Math.min(...xs) + el.width * 2,
                h: Math.max(...ys) - Math.min(...ys) + el.width * 2
            };
        }
        if (el.type === 'text') {
            ctx.font = `${el.fontSize}px -apple-system, sans-serif`;
            const lines = el.text.split('\n');
            const w = Math.max(...lines.map(l => ctx.measureText(l).width), 20);
            return { x: el.x - 4, y: el.y - 4, w: w + 8, h: lines.length * el.fontSize * 1.25 + 8 };
        }
        if (el.type === 'line') {
            const pad = el.strokeWidth + 6;
            return {
                x: Math.min(el.x1, el.x2) - pad, y: Math.min(el.y1, el.y2) - pad,
                w: Math.abs(el.x2 - el.x1) + pad * 2, h: Math.abs(el.y2 - el.y1) + pad * 2
            };
        }
        return { x: el.x, y: el.y, w: el.w, h: el.h };
    }

    function isResizable(el) {
        return el.type === 'image' || el.type === 'text' || el.type === 'shape' || el.type === 'sticky';
    }

    function handleRectOf(el) {
        const b = boundsOf(el);
        const size = 14 / scale;
        return { x: b.x + b.w - size / 2, y: b.y + b.h - size / 2, w: size, h: size };
    }

    function drawSelection(el) {
        const b = boundsOf(el);
        ctx.save();
        ctx.strokeStyle = '#0A84FF';
        ctx.setLineDash([6 / scale, 4 / scale]);
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.restore();

        if (isResizable(el)) {
            const h = handleRectOf(el);
            ctx.save();
            ctx.setLineDash([]);
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = '#0A84FF';
            ctx.lineWidth = 1.5 / scale;
            ctx.fillRect(h.x, h.y, h.w, h.h);
            ctx.strokeRect(h.x, h.y, h.w, h.h);
            ctx.restore();
        }
    }

    function hitTest(x, y) {
        for (let i = elements.length - 1; i >= 0; i--) {
            const b = boundsOf(elements[i]);
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return elements[i];
        }
        return null;
    }

    function hitHandle(x, y) {
        if (!selectedId) return null;
        const el = elements.find(e => e.id === selectedId);
        if (!el || !isResizable(el)) return null;
        const h = handleRectOf(el);
        const pad = 6 / scale;
        if (x >= h.x - pad && x <= h.x + h.w + pad && y >= h.y - pad && y <= h.y + h.h + pad) return el;
        return null;
    }

    // ---------- панель инструментов ----------
    const SHAPE_TOOLS = ['pen', 'eraser', 'select', 'text', 'rect', 'ellipse', 'arrow', 'sticky', 'pan'];

    function setTool(t) {
        tool = t;
        closeTextEditor();
        canvas.style.cursor = t === 'pan' ? 'grab' : (t === 'pen' || t === 'eraser') ? 'crosshair' : 'default';
        if (!toolbar) return;
        toolbar.querySelectorAll('[data-board-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.boardTool === t);
        });
    }

    function bindToolbar() {
        if (!toolbar) return;
        toolbar.querySelectorAll('[data-board-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = btn.dataset.boardTool;
                if (t === 'image') {
                    toolbar.querySelector('[data-board-file]').click();
                    setTool('select');
                } else {
                    setTool(t);
                }
            });
        });
        const colorInput = toolbar.querySelector('[data-board-color]');
        if (colorInput) {
            colorInput.addEventListener('input', e => color = e.target.value);
            color = colorInput.value || color;
        }
        const fillInput = toolbar.querySelector('[data-board-fill]');
        if (fillInput) {
            fillInput.addEventListener('input', e => fillColor = e.target.value);
            fillColor = fillInput.value || fillColor;
        }
        const widthInput = toolbar.querySelector('[data-board-width]');
        if (widthInput) {
            widthInput.addEventListener('input', e => strokeWidth = +e.target.value);
            strokeWidth = +widthInput.value || strokeWidth;
        }
        const fileInput = toolbar.querySelector('[data-board-file]');
        if (fileInput) {
            fileInput.addEventListener('change', e => {
                if (e.target.files[0]) addImageFromFile(e.target.files[0]);
                e.target.value = '';
            });
        }
        const deleteBtn = toolbar.querySelector('[data-board-delete]');
        if (deleteBtn) deleteBtn.addEventListener('click', deleteSelected);
        const undoBtn = toolbar.querySelector('[data-board-undo]');
        if (undoBtn) undoBtn.addEventListener('click', undo);
        const dupBtn = toolbar.querySelector('[data-board-duplicate]');
        if (dupBtn) dupBtn.addEventListener('click', duplicateSelected);
        const clearBtn = toolbar.querySelector('[data-board-clear]');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            if (confirm('Очистить всю доску?')) {
                snapshot();
                elements = [];
                selectedId = null;
                redraw();
                scheduleSave();
            }
        });
        const zoomInBtn = toolbar.querySelector('[data-board-zoom-in]');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => zoomAt(canvas.width / 2, canvas.height / 2, 1.2));
        const zoomOutBtn = toolbar.querySelector('[data-board-zoom-out]');
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomAt(canvas.width / 2, canvas.height / 2, 1 / 1.2));
        const zoomResetBtn = toolbar.querySelector('[data-board-zoom-reset]');
        if (zoomResetBtn) zoomResetBtn.addEventListener('click', resetView);
        setZoomLabel();
    }

    function deleteSelected() {
        if (!selectedId) return;
        snapshot();
        elements = elements.filter(e => e.id !== selectedId);
        selectedId = null;
        redraw();
        scheduleSave();
    }

    function duplicateSelected() {
        if (!selectedId) return;
        const el = elements.find(e => e.id === selectedId);
        if (!el) return;
        snapshot();
        const copy = JSON.parse(JSON.stringify(el, (k, v) => k === '_img' ? undefined : v));
        copy.id = newId();
        if (copy.x !== undefined) copy.x += 20;
        if (copy.y !== undefined) copy.y += 20;
        if (copy.x1 !== undefined) { copy.x1 += 20; copy.x2 += 20; copy.y1 += 20; copy.y2 += 20; }
        if (copy.points) copy.points = copy.points.map(p => ({ x: p.x + 20, y: p.y + 20 }));
        if (el._img) copy._img = el._img;
        elements.push(copy);
        selectedId = copy.id;
        redraw();
        scheduleSave();
    }

    // ---------- указатель: рисование / панорамирование / зум жестами ----------
    function onPointerDown(e) {
        e.preventDefault();
        activePointers.set(e.pointerId, screenPos(e));

        if (activePointers.size === 2) {
            const pts = [...activePointers.values()];
            pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            isPanning = false; drawing = false; dragOffset = null; resizing = null; currentEl = null;
            return;
        }

        if (e.button === 1 || tool === 'pan' || spacePressed) {
            isPanning = true;
            const s = screenPos(e);
            panStart = { sx: s.x, sy: s.y, ox: viewX, oy: viewY };
            canvas.style.cursor = 'grabbing';
            return;
        }

        const p = worldPos(e);

        if (tool === 'pen' || tool === 'eraser') {
            snapshot();
            drawing = true;
            currentEl = {
                id: newId(), type: 'stroke', points: [p], color,
                width: tool === 'eraser' ? strokeWidth * 3 : strokeWidth,
                erase: tool === 'eraser'
            };
            elements.push(currentEl);
        } else if (tool === 'rect' || tool === 'ellipse') {
            snapshot();
            drawing = true;
            currentEl = { id: newId(), type: 'shape', kind: tool, x: p.x, y: p.y, w: 0, h: 0, color, fill: fillColor, strokeWidth };
            elements.push(currentEl);
        } else if (tool === 'arrow') {
            snapshot();
            drawing = true;
            currentEl = { id: newId(), type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, strokeWidth };
            elements.push(currentEl);
        } else if (tool === 'sticky') {
            snapshot();
            const el = { id: newId(), type: 'sticky', x: p.x, y: p.y, w: 200, h: 140, text: '', fill: fillColor, color: '#1c1c1e', fontSize: 18 };
            elements.push(el);
            setTool('select');
            selectedId = el.id;
            redraw();
            openStickyEditor(el);
        } else if (tool === 'select') {
            const handleEl = hitHandle(p.x, p.y);
            if (handleEl) {
                snapshot();
                resizing = {
                    el: handleEl, x: p.x, y: p.y,
                    origW: handleEl.w, origH: handleEl.h, origFontSize: handleEl.fontSize
                };
                return;
            }
            const hit = hitTest(p.x, p.y);
            selectedId = hit ? hit.id : null;
            if (hit) {
                snapshot();
                dragOffset = {
                    x: p.x, y: p.y,
                    origX: hit.x !== undefined ? hit.x : 0,
                    origY: hit.y !== undefined ? hit.y : 0,
                    el: hit,
                    points: hit.points ? hit.points.map(pt => ({ ...pt })) : null,
                    line: hit.type === 'line' ? { x1: hit.x1, y1: hit.y1, x2: hit.x2, y2: hit.y2 } : null
                };
            }
            redraw();
        } else if (tool === 'text') {
            snapshot();
            openTextEditor(p);
        }
    }

    function onPointerMove(e) {
        if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, screenPos(e));

        if (activePointers.size === 2 && pinchStartDist) {
            const pts = [...activePointers.values()];
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
            zoomAt(mid.x, mid.y, dist / pinchStartDist);
            pinchStartDist = dist;
            return;
        }

        if (isPanning) {
            const s = screenPos(e);
            viewX = panStart.ox + (s.x - panStart.sx);
            viewY = panStart.oy + (s.y - panStart.sy);
            redraw();
            return;
        }

        const p = worldPos(e);

        if (drawing && currentEl) {
            if (currentEl.type === 'stroke') {
                currentEl.points.push(p);
            } else if (currentEl.type === 'shape') {
                currentEl.w = p.x - currentEl.x;
                currentEl.h = p.y - currentEl.y;
            } else if (currentEl.type === 'line') {
                currentEl.x2 = p.x;
                currentEl.y2 = p.y;
            }
            redraw();
        } else if (resizing) {
            const dx = p.x - resizing.x;
            const el = resizing.el;
            if (el.type === 'image') {
                const ratio = resizing.origH / resizing.origW;
                el.w = Math.max(24, resizing.origW + dx);
                el.h = el.w * ratio;
            } else if (el.type === 'shape' || el.type === 'sticky') {
                el.w = Math.max(24, resizing.origW + dx);
                el.h = Math.max(24, resizing.origH + dx * (resizing.origH / resizing.origW));
            } else if (el.type === 'text') {
                el.fontSize = Math.max(10, Math.round(resizing.origFontSize + dx / 4));
            }
            redraw();
        } else if (dragOffset) {
            const dx = p.x - dragOffset.x, dy = p.y - dragOffset.y;
            const el = dragOffset.el;
            if (el.type === 'stroke') {
                el.points = dragOffset.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
            } else if (el.type === 'line') {
                el.x1 = dragOffset.line.x1 + dx; el.y1 = dragOffset.line.y1 + dy;
                el.x2 = dragOffset.line.x2 + dx; el.y2 = dragOffset.line.y2 + dy;
            } else {
                el.x = dragOffset.origX + dx;
                el.y = dragOffset.origY + dy;
            }
            redraw();
        } else {
            onHoverCursor(e, p);
        }
    }

    function onHoverCursor(e, p) {
        if (tool !== 'select') return;
        canvas.style.cursor = hitHandle(p.x, p.y) ? 'nwse-resize' : (hitTest(p.x, p.y) ? 'move' : 'default');
    }

    function onPointerUp(e) {
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) pinchStartDist = null;

        if (isPanning) {
            isPanning = false;
            canvas.style.cursor = tool === 'pan' ? 'grab' : 'default';
        }
        if (drawing) scheduleSave();
        drawing = false;
        currentEl = null;
        if (dragOffset) scheduleSave();
        dragOffset = null;
        if (resizing) scheduleSave();
        resizing = null;
    }

    function onWheel(e) {
        e.preventDefault();
        const s = screenPos(e);
        if (e.ctrlKey || e.metaKey) {
            const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
            zoomAt(s.x, s.y, factor);
        } else {
            viewX -= e.deltaX;
            viewY -= e.deltaY;
            redraw();
        }
    }

    // ---------- текст / стикеры ----------
    let activeEditor = null;

    function openTextEditor(p, opts) {
        closeTextEditor();
        opts = opts || {};
        const screen = toScreen(p.x, p.y);
        const div = document.createElement('div');
        div.contentEditable = 'true';
        div.className = 'board-text-editor';
        div.style.left = screen.x + 'px';
        div.style.top = screen.y + 'px';
        div.style.color = opts.color || color;
        div.style.fontSize = (opts.fontSize || 22) * scale + 'px';
        if (opts.initialText) div.innerText = opts.initialText;
        wrap.appendChild(div);
        activeEditor = { div, worldX: p.x, worldY: p.y, editingId: opts.editingId || null, fontSize: opts.fontSize || 22, color: opts.color || color };
        setTimeout(() => { div.focus(); placeCaretAtEnd(div); }, 0);
        div.addEventListener('blur', commitTextEditor);
        div.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Escape') div.blur();
        });
    }

    function placeCaretAtEnd(el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function commitTextEditor() {
        if (!activeEditor) return;
        const text = activeEditor.div.innerText.trim();
        if (activeEditor.editingId) {
            const el = elements.find(e => e.id === activeEditor.editingId);
            if (el) {
                if (text) el.text = text;
                else elements = elements.filter(e => e.id !== activeEditor.editingId);
            }
            scheduleSave();
        } else if (text) {
            elements.push({ id: newId(), type: 'text', text, x: activeEditor.worldX, y: activeEditor.worldY, color: activeEditor.color, fontSize: activeEditor.fontSize });
            scheduleSave();
        } else {
            history.pop();
        }
        closeTextEditor();
        redraw();
    }

    function closeTextEditor() {
        if (activeEditor) { activeEditor.div.remove(); activeEditor = null; }
    }

    function openStickyEditor(el) {
        closeTextEditor();
        const screen = toScreen(el.x, el.y);
        const div = document.createElement('div');
        div.contentEditable = 'true';
        div.className = 'board-sticky-editor';
        div.style.left = screen.x + 'px';
        div.style.top = screen.y + 'px';
        div.style.width = (el.w * scale) + 'px';
        div.style.height = (el.h * scale) + 'px';
        div.style.background = el.fill;
        div.style.color = el.color;
        div.style.fontSize = (el.fontSize * scale) + 'px';
        div.innerText = el.text || '';
        wrap.appendChild(div);
        activeEditor = { div, editingId: el.id, sticky: true };
        setTimeout(() => { div.focus(); placeCaretAtEnd(div); }, 0);
        div.addEventListener('blur', commitTextEditor);
        div.addEventListener('keydown', e => e.stopPropagation());
    }

    function onDoubleClick(e) {
        if (tool !== 'select') return;
        const p = worldPos(e);
        const el = hitTest(p.x, p.y);
        if (!el) return;
        snapshot();
        if (el.type === 'text') {
            openTextEditor({ x: el.x, y: el.y }, { editingId: el.id, initialText: el.text, color: el.color, fontSize: el.fontSize });
        } else if (el.type === 'sticky') {
            selectedId = el.id;
            openStickyEditor(el);
        } else {
            history.pop();
        }
    }

    function onKeyDown(e) {
        if (document.activeElement.tagName === 'DIV') return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedId) deleteSelected();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            duplicateSelected();
        } else if (e.code === 'Space') {
            spacePressed = true;
            if (!isPanning) canvas.style.cursor = 'grab';
        }
    }
    function onKeyUp(e) {
        if (e.code === 'Space') {
            spacePressed = false;
            if (!isPanning) setTool(tool);
        }
    }

    // ---------- изображения ----------
    function addImageFromFile(file) {
        const reader = new FileReader();
        reader.onload = ev => addImageFromDataUrl(ev.target.result);
        reader.readAsDataURL(file);
    }

    function addImageFromDataUrl(dataUrl) {
        const img = new Image();
        img.onload = () => {
            snapshot();
            const maxW = 320;
            const scaleFactor = Math.min(1, maxW / img.width);
            const el = { id: newId(), type: 'image', src: dataUrl, x: 80, y: 80, w: img.width * scaleFactor, h: img.height * scaleFactor, _img: img };
            elements.push(el);
            setTool('select');
            selectedId = el.id;
            redraw();
            scheduleSave();
        };
        img.src = dataUrl;
    }

    function onPaste(e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) addImageFromFile(item.getAsFile());
        }
    }

    // ---------- сохранение / загрузка ----------
    function serialize() {
        return elements.map(({ _img, ...rest }) => rest);
    }

    function load(data, opts) {
        elements = [];
        selectedId = null;
        if (!opts || !opts.keepHistory) history.length = 0;
        (data || []).forEach(el => {
            if (el.type === 'image' && el.src) {
                const img = new Image();
                img.onload = () => { el._img = img; redraw(); };
                img.src = el.src;
            }
            elements.push(el);
        });
        redraw();
    }

    // ---------- инициализация / уничтожение ----------
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(wrap);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    bindToolbar();
    setTool('pen');
    resizeCanvas();

    function destroy() {
        resizeObserver.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('dblclick', onDoubleClick);
        canvas.removeEventListener('wheel', onWheel);
        window.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('paste', onPaste);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        closeTextEditor();
    }

    return { load, serialize, destroy, setTool, undo };
}
