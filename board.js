// ============================================================
// Skillovo Board — доска для уроков и домашних заданий.
// Инструменты: перо, ластик, текст, изображения (файл/вставка),
// выбор и перемещение, удаление. Данные — плоский массив
// элементов (stroke/text/image), готовый к сохранению в Firebase
// по пути boards/{boardId}.
// ============================================================

export function createBoard({ canvas, wrap, toolbar, onChange, readOnlyLabel }) {
    const ctx = canvas.getContext('2d');

    let elements = [];
    let selectedId = null;
    let idCounter = 1;
    let tool = 'pen';
    let color = '#0A84FF';
    let strokeWidth = 4;

    let drawing = false;
    let currentStroke = null;
    let dragOffset = null;
    let saveTimer = null;

    function newId() {
        return 'el_' + (idCounter++) + '_' + Date.now();
    }

    function scheduleSave() {
        if (!onChange) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => onChange(serialize()), 600);
    }

    function resize() {
        const rect = wrap.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        redraw();
    }

    function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const el of elements) drawElement(el);
        if (selectedId) {
            const el = elements.find(e => e.id === selectedId);
            if (el) drawSelection(el);
        }
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
        return { x: el.x, y: el.y, w: el.w, h: el.h };
    }

    function drawSelection(el) {
        const b = boundsOf(el);
        ctx.save();
        ctx.strokeStyle = '#0A84FF';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.restore();
    }

    function hitTest(x, y) {
        for (let i = elements.length - 1; i >= 0; i--) {
            const b = boundsOf(elements[i]);
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return elements[i];
        }
        return null;
    }

    // ---------- панель инструментов ----------
    function setTool(t) {
        tool = t;
        closeTextEditor();
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
        const clearBtn = toolbar.querySelector('[data-board-clear]');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            if (confirm('Очистить всю доску?')) { elements = []; selectedId = null; redraw(); scheduleSave(); }
        });
    }

    function deleteSelected() {
        if (!selectedId) return;
        elements = elements.filter(e => e.id !== selectedId);
        selectedId = null;
        redraw();
        scheduleSave();
    }

    // ---------- рисование мышью/пальцем ----------
    function pos(e) {
        const rect = canvas.getBoundingClientRect();
        const point = e.touches ? e.touches[0] : e;
        return { x: point.clientX - rect.left, y: point.clientY - rect.top };
    }

    function onPointerDown(e) {
        const p = pos(e);
        if (tool === 'pen' || tool === 'eraser') {
            drawing = true;
            currentStroke = {
                id: newId(), type: 'stroke', points: [p], color,
                width: tool === 'eraser' ? strokeWidth * 3 : strokeWidth,
                erase: tool === 'eraser'
            };
            elements.push(currentStroke);
        } else if (tool === 'select') {
            const hit = hitTest(p.x, p.y);
            selectedId = hit ? hit.id : null;
            if (hit) {
                dragOffset = {
                    x: p.x, y: p.y,
                    origX: hit.x !== undefined ? hit.x : 0,
                    origY: hit.y !== undefined ? hit.y : 0,
                    el: hit,
                    points: hit.points ? hit.points.map(pt => ({ ...pt })) : null
                };
            }
            redraw();
        } else if (tool === 'text') {
            openTextEditor(p);
        }
    }

    function onPointerMove(e) {
        const p = pos(e);
        if (drawing && currentStroke) {
            currentStroke.points.push(p);
            redraw();
        } else if (dragOffset) {
            const dx = p.x - dragOffset.x, dy = p.y - dragOffset.y;
            const el = dragOffset.el;
            if (el.type === 'stroke') {
                el.points = dragOffset.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
            } else {
                el.x = dragOffset.origX + dx;
                el.y = dragOffset.origY + dy;
            }
            redraw();
        }
    }

    function onPointerUp() {
        if (drawing) scheduleSave();
        drawing = false;
        currentStroke = null;
        if (dragOffset) scheduleSave();
        dragOffset = null;
    }

    // ---------- текст ----------
    let activeEditor = null;

    function openTextEditor(p) {
        closeTextEditor();
        const div = document.createElement('div');
        div.contentEditable = 'true';
        div.className = 'board-text-editor';
        div.style.left = p.x + 'px';
        div.style.top = p.y + 'px';
        div.style.color = color;
        wrap.appendChild(div);
        // фокус после вставки в DOM, синхронно в обработчике клика — работает надёжно в браузере
        div.focus();
        activeEditor = { div, x: p.x, y: p.y };
        div.addEventListener('blur', commitTextEditor);
        div.addEventListener('keydown', e => {
            if (e.key === 'Escape') { div.blur(); }
        });
    }

    function commitTextEditor() {
        if (!activeEditor) return;
        const text = activeEditor.div.innerText.trim();
        if (text) {
            elements.push({ id: newId(), type: 'text', text, x: activeEditor.x, y: activeEditor.y, color, fontSize: 22 });
            scheduleSave();
        }
        closeTextEditor();
        redraw();
    }

    function closeTextEditor() {
        if (activeEditor) { activeEditor.div.remove(); activeEditor = null; }
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
            const maxW = 320;
            const scale = Math.min(1, maxW / img.width);
            const el = { id: newId(), type: 'image', src: dataUrl, x: 80, y: 80, w: img.width * scale, h: img.height * scale, _img: img };
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

    function onKeyDown(e) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId &&
            document.activeElement.tagName !== 'DIV') {
            deleteSelected();
        }
    }

    // ---------- сохранение / загрузка ----------
    function serialize() {
        return elements.map(({ _img, ...rest }) => rest);
    }

    function load(data) {
        elements = [];
        selectedId = null;
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
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKeyDown);

    bindToolbar();
    setTool('pen');
    resize();

    function destroy() {
        resizeObserver.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('paste', onPaste);
        document.removeEventListener('keydown', onKeyDown);
        closeTextEditor();
    }

    return { load, serialize, destroy, setTool };
}
