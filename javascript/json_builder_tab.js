// Embeddable JSON Builder instance for the prompt tabs. Based on the MOSS JSON Builder
// extension, bundled here so no other extension is needed. Differences: no "send" buttons
// (the host compiles on Generate) and an extra negative prompt box in the Summary section.
// Compiler / decompiler come from json_codec.js (window.PromptTabsJson).

(function () {
    "use strict";

    const LABELS = ["object", "character", "text"];
    const CANVAS_TYPES = ["single", "multi_panel", "collage"];
    const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
    const MP_PIXELS = 1024 * 1024;
    const MIN_ZOOM = 0.25;
    const MAX_ZOOM = 8;
    const REF_DIR_KEY = "ptb-ref-dir-remembered";
    const IMAGE_TYPES = [{ description: "Images", accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"] } }];

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const round16 = (v) => Math.max(16, Math.round(v / 16) * 16);
    const str = (v) => (typeof v === "string" ? v : "");

    let uidCounter = 0;

    function h(tag, attrs = {}, children = []) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === "class") el.className = v;
            else if (k === "style") Object.assign(el.style, v);
            else if (k === "dataset") Object.assign(el.dataset, v);
            else if (k === "value" || k === "checked") el[k] = v;
            else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
            else el.setAttribute(k, v);
        }
        for (const c of [].concat(children)) {
            if (c === null || c === undefined) continue;
            el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
        }
        return el;
    }

    function available() {
        return !!(window.PromptTabsJson && typeof window.PromptTabsJson.compilePrompt === "function");
    }

    function create({ tabname, state: saved, onChange }) {
        const uid = ++uidCounter;
        const P = (s) => `ptb${uid}-${s}`;
        let idCounter = 0;

        // ----- state -----

        // Canvas size falls back to the size set in the txt2img / img2img tab
        function readDefaultSize() {
            const read = (id) => parseInt(gradioApp().querySelector(`#${tabname}_${id} input`)?.value, 10);
            const w = read("width");
            const hgt = read("height");
            return { width: w > 0 ? round16(w) : 1024, height: hgt > 0 ? round16(hgt) : 1024 };
        }

        const state = {
            width: 0,
            height: 0,
            summary: { caption: "", meta: "", extra: "", negative: "", canvas: "single" },
            items: [],
        };

        function defaultBbox() {
            const m = Math.round(Math.min(state.width, state.height) * 0.1);
            const s = Math.round(Math.min(state.width, state.height) * 0.3);
            return [m, m, m + s, m + s];
        }

        function newItem() {
            return { id: ++idCounter, label: "object", caption: "", text: "", bbox: defaultBbox() };
        }

        (function init() {
            const s = saved && typeof saved === "object" ? saved : {};
            if (Number.isFinite(s.width) && s.width > 0 && Number.isFinite(s.height) && s.height > 0) {
                state.width = s.width;
                state.height = s.height;
            } else {
                Object.assign(state, readDefaultSize());
            }
            const sm = s.summary && typeof s.summary === "object" ? s.summary : {};
            state.summary.caption = str(sm.caption);
            state.summary.meta = str(sm.meta);
            state.summary.extra = str(sm.extra);
            state.summary.negative = str(sm.negative);
            state.summary.canvas = CANVAS_TYPES.includes(sm.canvas) ? sm.canvas : "single";
            if (Array.isArray(s.items)) {
                for (const it of s.items) {
                    if (!it || typeof it !== "object") continue;
                    const okBox = Array.isArray(it.bbox) && it.bbox.length === 4 && it.bbox.every((n) => Number.isFinite(n));
                    state.items.push({
                        id: ++idCounter,
                        label: LABELS.includes(it.label) ? it.label : "object",
                        caption: str(it.caption),
                        text: str(it.text),
                        bbox: okBox ? it.bbox.slice() : defaultBbox(),
                    });
                }
            }
            if (state.items.length === 0) state.items.push(newItem());
        })();

        const listRefs = new Map();
        const canvasRefs = new Map();
        const view = { scale: 1, panX: 0, panY: 0 };

        let notifyTimer = null;
        function notify() {
            if (!onChange) return;
            clearTimeout(notifyTimer);
            notifyTimer = setTimeout(onChange, 300);
        }

        // ----- auto-growing textareas -----

        const growables = new Set();

        function autoGrow(el) {
            if (el?.tagName !== "TEXTAREA") return;
            el.style.height = "auto";
            const cs = getComputedStyle(el);
            const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
            el.style.height = `${el.scrollHeight + borders}px`;
        }

        const growObserver = new ResizeObserver(() => growables.forEach(autoGrow));

        function addGrowable(el) {
            if (growables.has(el)) return;
            growables.add(el);
            growObserver.observe(el);
            requestAnimationFrame(() => autoGrow(el));
        }

        function pruneGrowables() {
            for (const el of growables) {
                if (el.isConnected) continue;
                growObserver.unobserve(el);
                growables.delete(el);
            }
        }

        // ----- canvas -----

        const canvasSection = h("div", { class: "ptb-canvas" });
        const stage = h("div", { class: "ptb-stage" });
        canvasSection.appendChild(stage);

        const refImg = h("img", { class: "ptb-ref-img ptb-hidden", draggable: "false", alt: "" });
        refImg.style.opacity = "0.5";
        let refUrl = null;
        let refUrlOwned = false; // true for blob URLs created here (must be revoked)
        let refManual = false; // set once the user loads or clears the reference themselves

        // ----- side panel -----

        const widthInput = h("input", { type: "number", class: "ptb-width", min: "16", step: "16", value: state.width });
        const heightInput = h("input", { type: "number", class: "ptb-height", min: "16", step: "16", value: state.height });
        const mpInput = h("input", { type: "number", class: "ptb-mp", min: "0.1", step: "0.1", value: "1" });
        const arSelect = h(
            "select",
            { class: "ptb-ar" },
            ASPECT_RATIOS.map((r) => h("option", { value: r }, [r])),
        );
        const setResBtn = h("button", { type: "button", class: "ptb-set-res" }, ["Set Resolution"]);

        const resolutionSection = h("div", { class: "ptb-section ptb-res" }, [
            h("div", { class: "ptb-section-title" }, ["Resolution"]),
            h("div", { class: "ptb-row" }, [h("label", {}, ["Width"]), widthInput, h("label", {}, ["Height"]), heightInput]),
            h("div", { class: "ptb-row" }, [h("label", {}, ["MP"]), mpInput, h("label", {}, ["AR"]), arSelect, setResBtn]),
        ]);

        const sumCaption = h("textarea", { class: "ptb-sum-caption", placeholder: "global caption", rows: "1" });
        const sumMeta = h("input", { type: "text", class: "ptb-sum-meta", placeholder: "meta tags (comma separated)" });
        const sumExtra = h("input", { type: "text", class: "ptb-sum-extra", placeholder: "e.g. LoRA" });
        const sumNegative = h("textarea", { class: "ptb-sum-negative", placeholder: "negative prompt", rows: "1" });
        sumCaption.id = P("sum-caption");
        sumMeta.id = P("sum-meta");
        sumExtra.id = P("sum-extra");
        sumNegative.id = P("sum-negative");
        sumCaption.value = state.summary.caption;
        sumMeta.value = state.summary.meta;
        sumExtra.value = state.summary.extra;
        sumNegative.value = state.summary.negative;

        const canvasRadioInputs = [];
        const canvasRadios = CANVAS_TYPES.map((t) => {
            const id = P(`canvas-${t}`);
            const radio = h("input", { type: "radio", name: P("canvas"), value: t, id, checked: state.summary.canvas === t });
            radio.addEventListener("change", () => {
                if (radio.checked) state.summary.canvas = t;
            });
            canvasRadioInputs.push(radio);
            return h("label", { class: "ptb-radio", for: id }, [radio, t]);
        });

        const summarySection = h("div", { class: "ptb-section" }, [
            h("div", { class: "ptb-section-title" }, ["Summary"]),
            h("div", { class: "ptb-row" }, canvasRadios),
            h("label", { class: "ptb-fld-label", for: sumCaption.id }, ["Caption"]),
            sumCaption,
            h("div", { class: "ptb-row" }, [
                h("div", { class: "ptb-half" }, [h("label", { class: "ptb-fld-label", for: sumMeta.id }, ["Meta"]), sumMeta]),
                h("div", { class: "ptb-half" }, [h("label", { class: "ptb-fld-label", for: sumExtra.id }, ["Extra"]), sumExtra]),
            ]),
            h("label", { class: "ptb-fld-label", for: sumNegative.id }, ["Negative prompt"]),
            sumNegative,
        ]);

        const addBtn = h("button", { type: "button", class: "ptb-add" }, ["Add Item"]);
        const clearBtn = h("button", { type: "button", class: "ptb-clear" }, ["Clear All"]);
        const listEl = h("div", { class: "ptb-list" });
        const listSection = h("div", { class: "ptb-section ptb-list-section" }, [h("div", { class: "ptb-list-toolbar" }, [addBtn, clearBtn]), listEl]);

        // ----- reference image -----

        const refAutoSize = h("input", { type: "checkbox", class: "ptb-ref-autosize" });
        const refAutoLabel = h("label", { class: "ptb-radio", title: "Resize canvas to loaded image dimensions" }, [refAutoSize, "Match size"]);
        const refLoadBtn = h("button", { type: "button", class: "ptb-ref-load" }, ["Load Image"]);
        const refClearBtn = h("button", { type: "button", class: "ptb-ref-clear" }, ["Clear"]);
        const refOpacity = h("input", { type: "range", class: "ptb-ref-opacity", min: "0", max: "100", step: "1", value: "50" });
        const refFileInput = h("input", { type: "file", accept: "image/*", class: "ptb-file" });
        refFileInput.style.display = "none";

        const refSection = h("div", { class: "ptb-section ptb-ref" }, [
            h("div", { class: "ptb-section-title" }, ["Reference Image"]),
            h("div", { class: "ptb-row" }, [refAutoLabel, refLoadBtn, refClearBtn, h("label", {}, ["Opacity"]), refOpacity]),
        ]);

        // ----- save / load -----

        const loadPromptBtn = h("button", { type: "button", class: "ptb-load-prompt" }, ["Load Prompt"]);
        const saveJsonBtn = h("button", { type: "button", class: "ptb-save-json" }, ["Save JSON"]);
        const loadJsonBtn = h("button", { type: "button", class: "ptb-load-json" }, ["Load JSON"]);
        const saveLoadSection = h("div", { class: "ptb-section ptb-save" }, [
            h("div", { class: "ptb-section-title" }, ["Save/Load"]),
            h("div", { class: "ptb-row" }, [loadPromptBtn]),
            h("div", { class: "ptb-row" }, [saveJsonBtn, loadJsonBtn]),
        ]);

        const dialogInput = h("textarea", { class: "ptb-dialog-input", placeholder: "Compiled Prompt or Layout Draft", spellcheck: "false" });
        const dialogWidth = h("input", { type: "number", min: "16", step: "16", class: "ptb-dialog-width" });
        const dialogHeight = h("input", { type: "number", min: "16", step: "16", class: "ptb-dialog-height" });
        const dialogClose = h("button", { type: "button", class: "ptb-dialog-close", title: "Close" }, ["\u00D7"]);
        const dialogLoad = h("button", { type: "button", class: "ptb-dialog-load" }, ["Load"]);
        const modal = h("div", { class: "ptb-modal ptb-hidden" }, [
            h("div", { class: "ptb-dialog" }, [
                dialogClose,
                h("div", { class: "ptb-dialog-body" }, [dialogInput, h("div", { class: "ptb-dialog-dims" }, [h("label", {}, ["Width"]), dialogWidth, h("label", {}, ["Height"]), dialogHeight])]),
                dialogLoad,
            ]),
        ]);

        const fileInput = h("input", { type: "file", accept: ".json,application/json", class: "ptb-file" });
        fileInput.style.display = "none";

        const tools = h("div", { class: "ptb-tools" }, [resolutionSection, saveLoadSection, refSection]);
        const side = h("div", { class: "ptb-side" }, [summarySection, listSection]);
        const root = h("div", { class: "ptb-root" }, [tools, canvasSection, side, modal, fileInput, refFileInput]);
        addGrowable(sumCaption);
        addGrowable(sumNegative);

        function loadDraft(draft) {
            state.width = draft.width;
            state.height = draft.height;
            state.summary.caption = draft.summary.caption;
            state.summary.meta = draft.summary.meta.join(", ");
            state.summary.canvas = draft.summary.canvas;
            state.summary.extra = "";
            // the negative prompt is not part of the layout JSON, so it is left untouched

            state.items = draft.items.map((item) => ({
                id: ++idCounter,
                label: item.label,
                caption: item.caption,
                text: item.text || "",
                bbox: item.bbox.slice(),
            }));

            widthInput.value = state.width;
            heightInput.value = state.height;
            sumCaption.value = state.summary.caption;
            sumMeta.value = state.summary.meta;
            sumExtra.value = state.summary.extra;
            autoGrow(sumCaption);
            canvasRadioInputs.forEach((radio) => {
                radio.checked = radio.value === state.summary.canvas;
            });

            fitStage();
            renderAll();
            notify();
        }

        function openDialog() {
            loadPromptBtn.classList.remove("ptb-invalid");
            dialogInput.value = "";
            dialogWidth.value = state.width;
            dialogHeight.value = state.height;
            modal.classList.remove("ptb-hidden");
            dialogInput.focus();
        }

        function closeDialog() {
            modal.classList.add("ptb-hidden");
        }

        function handleDialogLoad() {
            const text = dialogInput.value.trim();
            if (text === "") {
                closeDialog();
                return;
            }
            try {
                loadDraft(window.PromptTabsJson.decompilePrompt(text, parseFloat(dialogWidth.value), parseFloat(dialogHeight.value)));
            } catch {
                loadPromptBtn.classList.add("ptb-invalid");
            }
            closeDialog();
        }

        loadPromptBtn.addEventListener("click", openDialog);
        dialogClose.addEventListener("click", closeDialog);
        dialogLoad.addEventListener("click", handleDialogLoad);

        saveJsonBtn.addEventListener("click", () => {
            const name = window.prompt("Save JSON as", "layout.json");
            if (name === null || name.trim() === "") return;
            const blob = new Blob([JSON.stringify(buildJson(), null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = h("a", { href: url, download: name.trim() });
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        });

        loadJsonBtn.addEventListener("click", () => {
            loadJsonBtn.classList.remove("ptb-invalid");
            fileInput.value = "";
            fileInput.click();
        });

        fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.addEventListener("load", () => {
                try {
                    loadDraft(window.PromptTabsJson.decompilePrompt(reader.result, NaN, NaN));
                } catch {
                    loadJsonBtn.classList.add("ptb-invalid");
                }
            });
            reader.readAsText(file);
        });

        // ----- canvas sizing / zoom / pan -----

        function fitStage() {
            const inset = 32;
            const cw = Math.max(1, canvasSection.clientWidth - inset);
            const ch = Math.max(1, canvasSection.clientHeight - inset);
            const ratio = state.width / state.height;
            let w = cw;
            let hgt = cw / ratio;
            if (hgt > ch) {
                hgt = ch;
                w = ch * ratio;
            }
            stage.style.width = w + "px";
            stage.style.height = hgt + "px";
            clampPan();
            resetView();
        }

        function applyView() {
            stage.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`;
            stage.style.setProperty("--ptb-text-scale", String(1 / Math.max(1, view.scale)));
        }

        function clampAxis(pan, canvasSize, stageSize) {
            const diff = (stageSize - canvasSize) / 2;
            return diff >= 0 ? clamp(pan, -diff, diff) : clamp(pan, diff, -diff);
        }

        function clampPan() {
            const c = canvasSection.getBoundingClientRect();
            const r = stage.getBoundingClientRect();
            view.panX = clampAxis(view.panX, c.width, r.width);
            view.panY = clampAxis(view.panY, c.height, r.height);
        }

        function zoomAt(clientX, clientY, factor) {
            const next = clamp(view.scale * factor, MIN_ZOOM, MAX_ZOOM);
            const ratio = next / view.scale;
            if (ratio === 1) return;
            const r = stage.getBoundingClientRect();
            view.panX += (clientX - (r.left + r.width / 2)) * (1 - ratio);
            view.panY += (clientY - (r.top + r.height / 2)) * (1 - ratio);
            view.scale = next;
            applyView();
            clampPan();
            applyView();
        }

        function resetView() {
            view.scale = 1;
            view.panX = 0;
            view.panY = 0;
            applyView();
        }

        function startPan(e) {
            const sx = e.clientX;
            const sy = e.clientY;
            const px = view.panX;
            const py = view.panY;
            stage.classList.add("ptb-panning");
            function move(ev) {
                view.panX = px + (ev.clientX - sx);
                view.panY = py + (ev.clientY - sy);
                clampPan();
                applyView();
            }
            function up() {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                stage.classList.remove("ptb-panning");
            }
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
        }

        stage.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
            },
            { passive: false },
        );

        stage.addEventListener("pointerdown", (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            startPan(e);
        });

        stage.addEventListener("dblclick", (e) => {
            if (e.target.closest(".ptb-box")) return;
            resetView();
        });

        // ----- boxes -----

        function updateBoxPosition(item) {
            const ref = canvasRefs.get(item.id);
            if (!ref) return;
            const [x1, y1, x2, y2] = item.bbox;
            ref.el.style.left = (x1 / state.width) * 100 + "%";
            ref.el.style.top = (y1 / state.height) * 100 + "%";
            ref.el.style.width = ((x2 - x1) / state.width) * 100 + "%";
            ref.el.style.height = ((y2 - y1) / state.height) * 100 + "%";
        }

        function syncListNums(item) {
            const ref = listRefs.get(item.id);
            if (!ref) return;
            ref.numInputs.forEach((inp, i) => {
                if (document.activeElement !== inp) inp.value = item.bbox[i];
            });
        }

        function makeEditable(item, field) {
            const ta = h("textarea", { class: "ptb-field", placeholder: field, readonly: "", spellcheck: "false" });
            ta.value = item[field] || "";
            ta.addEventListener("dblclick", () => {
                ta.readOnly = false;
                ta.focus();
            });
            ta.addEventListener("blur", () => {
                ta.readOnly = true;
            });
            ta.addEventListener("input", () => {
                item[field] = ta.value;
                const ref = listRefs.get(item.id);
                if (!ref) return;
                const inp = field === "caption" ? ref.captionInput : ref.textInput;
                if (inp && document.activeElement !== inp) {
                    inp.value = ta.value;
                    autoGrow(inp);
                }
            });
            return ta;
        }

        function startDrag(item, e) {
            const ref = canvasRefs.get(item.id);
            const rect = stage.getBoundingClientRect();
            const scaleX = state.width / rect.width;
            const scaleY = state.height / rect.height;
            const sx = e.clientX;
            const sy = e.clientY;
            const [x1, y1, x2, y2] = item.bbox;
            const w = x2 - x1;
            const hgt = y2 - y1;
            let moved = false;

            function move(ev) {
                const dx = (ev.clientX - sx) * scaleX;
                const dy = (ev.clientY - sy) * scaleY;
                if (!moved && Math.hypot(dx, dy) < 3) return;
                moved = true;
                ref.el.classList.add("ptb-active");
                const nx1 = clamp(Math.round(x1 + dx), 0, state.width - w);
                const ny1 = clamp(Math.round(y1 + dy), 0, state.height - hgt);
                item.bbox = [nx1, ny1, nx1 + w, ny1 + hgt];
                updateBoxPosition(item);
                syncListNums(item);
            }

            function up() {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                ref.el.classList.remove("ptb-active");
                if (moved) notify();
            }

            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
        }

        function startResize(item, e) {
            e.stopPropagation();
            const ref = canvasRefs.get(item.id);
            const rect = stage.getBoundingClientRect();
            const scaleX = state.width / rect.width;
            const scaleY = state.height / rect.height;
            const sx = e.clientX;
            const sy = e.clientY;
            const [x1, y1, x2, y2] = item.bbox;
            ref.el.classList.add("ptb-active");

            function move(ev) {
                const nx2 = clamp(Math.round(x2 + (ev.clientX - sx) * scaleX), x1 + 16, state.width);
                const ny2 = clamp(Math.round(y2 + (ev.clientY - sy) * scaleY), y1 + 16, state.height);
                item.bbox = [x1, y1, nx2, ny2];
                updateBoxPosition(item);
                syncListNums(item);
            }

            function up() {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                ref.el.classList.remove("ptb-active");
                notify();
            }

            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
        }

        function createBox(item) {
            const el = h("div", { class: "ptb-box", dataset: { id: String(item.id) } });
            el.appendChild(h("div", { class: "ptb-box-tag" }, [item.label]));

            const caption = makeEditable(item, "caption");
            el.appendChild(caption);

            let text = null;
            if (item.label === "text") {
                text = makeEditable(item, "text");
                text.classList.add("ptb-box-text");
                el.appendChild(text);
            }

            const handle = h("div", { class: "ptb-box-handle" });
            handle.addEventListener("pointerdown", (ev) => {
                if (ev.button !== 0) return;
                startResize(item, ev);
            });
            el.appendChild(handle);

            el.addEventListener("pointerdown", (ev) => {
                if (ev.button !== 0) return;
                if (ev.target === handle) return;
                if (ev.target.tagName === "TEXTAREA" && !ev.target.readOnly) return;
                ev.preventDefault();
                startDrag(item, ev);
            });

            canvasRefs.set(item.id, { el, caption, text });
            updateBoxPosition(item);
            return el;
        }

        // ----- reference image -----

        function applyRefSize() {
            if (!refAutoSize.checked || refImg.classList.contains("ptb-hidden")) return;
            const w = refImg.naturalWidth;
            const hgt = refImg.naturalHeight;
            if (!w || !hgt) return;
            widthInput.value = w;
            heightInput.value = hgt;
            applyResolution(w, hgt);
            clampItemsToCanvas();
        }

        refImg.addEventListener("load", applyRefSize);
        refAutoSize.addEventListener("change", applyRefSize);

        function setRefUrl(url, owned) {
            if (refUrl && refUrlOwned) URL.revokeObjectURL(refUrl);
            refUrl = url || null;
            refUrlOwned = !!owned && !!url;
            if (refUrl) {
                refImg.src = refUrl;
                refImg.classList.remove("ptb-hidden");
            } else {
                refImg.removeAttribute("src");
                refImg.classList.add("ptb-hidden");
            }
        }

        // User-chosen reference (or an explicit clear): stops following the img2img image
        function setRefImage(file) {
            refManual = true;
            setRefUrl(file ? URL.createObjectURL(file) : null, true);
        }

        // In img2img the subject (input) image is the default reference, and the reference
        // follows it until the user loads or clears one manually
        let subjectObserver = null;

        function subjectImg() {
            return tabname === "img2img" ? gradioApp().querySelector("#img2img_image img.forge-image") : null;
        }

        function syncSubject() {
            if (refManual) return;
            const src = subjectImg()?.getAttribute("src") || null;
            if (src === refUrl && !refUrlOwned) return;
            setRefUrl(src, false);
        }

        function watchSubject() {
            if (subjectObserver) return;
            const img = subjectImg();
            if (!img) return;
            subjectObserver = new MutationObserver(syncSubject);
            subjectObserver.observe(img, { attributes: true, attributeFilter: ["src"] });
        }

        function pickRefFallback() {
            refFileInput.value = "";
            refFileInput.click();
        }

        function hasRememberedDir() {
            try {
                return localStorage.getItem(REF_DIR_KEY) === "1";
            } catch {
                return false;
            }
        }

        function markRememberedDir() {
            try {
                localStorage.setItem(REF_DIR_KEY, "1");
            } catch {}
        }

        // Before the first pick, put the output folder on the clipboard so it can be pasted
        // into the file dialog
        async function copyOutputPath() {
            try {
                const res = await fetch(`/prompt_tabs/output_dir?tab=${encodeURIComponent(tabname)}`);
                const { path } = await res.json();
                if (path) await navigator.clipboard.writeText(path);
            } catch {}
        }

        async function pickRefImage() {
            if (!hasRememberedDir()) await copyOutputPath();
            if (!window.showOpenFilePicker) {
                pickRefFallback();
                return;
            }
            try {
                // fixed id: the browser remembers the last directory used with it
                const [handle] = await window.showOpenFilePicker({ id: "ptb-ref-image", startIn: "pictures", types: IMAGE_TYPES, multiple: false });
                markRememberedDir();
                setRefImage(await handle.getFile());
            } catch (e) {
                if (e?.name !== "AbortError") pickRefFallback();
            }
        }

        refLoadBtn.addEventListener("click", pickRefImage);
        refFileInput.addEventListener("change", () => {
            const file = refFileInput.files?.[0];
            if (file) setRefImage(file);
        });
        refClearBtn.addEventListener("click", () => setRefImage(null));

        const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
        let dragDepth = 0;
        canvasSection.addEventListener("dragenter", (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth++;
            canvasSection.classList.add("ptb-dragover");
        });
        canvasSection.addEventListener("dragover", (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
        });
        canvasSection.addEventListener("dragleave", () => {
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) canvasSection.classList.remove("ptb-dragover");
        });
        canvasSection.addEventListener("drop", (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            dragDepth = 0;
            canvasSection.classList.remove("ptb-dragover");
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
            if (file) setRefImage(file);
        });
        refOpacity.addEventListener("input", () => {
            refImg.style.opacity = String(refOpacity.value / 100);
        });

        function renderCanvas() {
            stage.textContent = "";
            stage.appendChild(refImg);
            canvasRefs.clear();
            for (const item of state.items) stage.appendChild(createBox(item));
        }

        // ----- list -----

        function createRow(item) {
            const row = h("div", { class: "ptb-item", dataset: { id: String(item.id) } });

            const top = h("div", { class: "ptb-item-top" });
            const radios = LABELS.map((label) => {
                const id = P(`${item.id}-${label}`);
                const radio = h("input", {
                    type: "radio",
                    name: P(`label-${item.id}`),
                    value: label,
                    id,
                    checked: item.label === label,
                });
                radio.addEventListener("change", () => {
                    if (radio.checked) {
                        item.label = label;
                        renderAll();
                    }
                });
                return h("label", { class: "ptb-radio", for: id }, [radio, label]);
            });
            top.append(...radios);

            const remove = h("button", { type: "button", class: "ptb-remove", title: "Remove" }, ["\u00D7"]);
            remove.addEventListener("click", () => removeItem(item.id));
            top.appendChild(remove);
            row.appendChild(top);

            const caption = h("textarea", { class: "ptb-item-caption", placeholder: "caption", rows: "1", value: item.caption });
            caption.addEventListener("input", () => {
                item.caption = caption.value;
                autoGrow(caption);
                const ref = canvasRefs.get(item.id);
                if (ref && document.activeElement !== ref.caption) ref.caption.value = caption.value;
            });
            row.appendChild(caption);
            addGrowable(caption);

            let textInput = null;
            if (item.label === "text") {
                textInput = h("input", { type: "text", class: "ptb-item-text", placeholder: "text", value: item.text });
                textInput.addEventListener("input", () => {
                    item.text = textInput.value;
                    const ref = canvasRefs.get(item.id);
                    if (ref?.text && document.activeElement !== ref.text) ref.text.value = textInput.value;
                });
                row.appendChild(textInput);
            }

            const placeholders = ["x1", "y1", "x2", "y2"];
            const nums = h("div", { class: "ptb-item-nums" });
            const numInputs = item.bbox.map((value, i) => {
                const inp = h("input", { type: "number", class: "ptb-num", placeholder: placeholders[i], value });
                inp.addEventListener("input", () => {
                    const v = parseFloat(inp.value);
                    if (!Number.isNaN(v)) {
                        item.bbox[i] = v;
                        updateBoxPosition(item);
                    }
                });
                nums.appendChild(inp);
                return inp;
            });
            row.appendChild(nums);

            listRefs.set(item.id, { row, captionInput: caption, textInput, numInputs });
            return row;
        }

        function renderList() {
            listEl.textContent = "";
            listRefs.clear();
            pruneGrowables();
            for (const item of state.items) listEl.appendChild(createRow(item));
        }

        function renderAll() {
            renderList();
            renderCanvas();
        }

        function addItem() {
            state.items.push(newItem());
            renderAll();
        }

        function removeItem(id) {
            const index = state.items.findIndex((it) => it.id === id);
            if (index >= 0) state.items.splice(index, 1);
            if (state.items.length === 0) state.items.push(newItem());
            renderAll();
        }

        function clearItems() {
            state.items = [newItem()];
            renderAll();
        }

        // ----- inputs -----

        function applyResolution(w, hgt) {
            state.width = w;
            state.height = hgt;
            fitStage();
            renderCanvas();
        }

        function clampItemsToCanvas() {
            for (const item of state.items) {
                const bw = Math.min(item.bbox[2] - item.bbox[0], state.width);
                const bh = Math.min(item.bbox[3] - item.bbox[1], state.height);
                const x1 = clamp(item.bbox[0], 0, state.width - bw);
                const y1 = clamp(item.bbox[1], 0, state.height - bh);
                item.bbox = [x1, y1, x1 + bw, y1 + bh];
                syncListNums(item);
            }
            renderCanvas();
        }

        widthInput.addEventListener("input", () => {
            const v = parseInt(widthInput.value, 10);
            if (v > 0) applyResolution(v, state.height);
        });
        widthInput.addEventListener("change", clampItemsToCanvas);

        heightInput.addEventListener("input", () => {
            const v = parseInt(heightInput.value, 10);
            if (v > 0) applyResolution(state.width, v);
        });
        heightInput.addEventListener("change", clampItemsToCanvas);

        setResBtn.addEventListener("click", () => {
            const mp = parseFloat(mpInput.value);
            if (!(mp > 0)) return;
            const [aw, ah] = arSelect.value.split(":").map(Number);
            const area = mp * MP_PIXELS;
            const w = Math.sqrt((area * aw) / ah);
            const hgt = area / w;
            const width = round16(w);
            const height = round16(hgt);
            widthInput.value = width;
            heightInput.value = height;
            applyResolution(width, height);
            clampItemsToCanvas();
        });

        sumCaption.addEventListener("input", () => {
            state.summary.caption = sumCaption.value;
            autoGrow(sumCaption);
        });
        sumMeta.addEventListener("input", () => {
            state.summary.meta = sumMeta.value;
        });
        sumExtra.addEventListener("input", () => {
            state.summary.extra = sumExtra.value;
        });
        sumNegative.addEventListener("input", () => {
            state.summary.negative = sumNegative.value;
            autoGrow(sumNegative);
        });

        addBtn.addEventListener("click", addItem);
        clearBtn.addEventListener("click", clearItems);

        // Any edit inside the builder schedules a (debounced) save by the host
        ["input", "change", "click"].forEach((type) => root.addEventListener(type, notify));

        // ----- output -----

        function buildJson() {
            const meta = state.summary.meta
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            const summary = {};
            if (meta.length) summary.meta = meta;
            summary.canvas = state.summary.canvas;
            summary.caption = state.summary.caption;
            return {
                width: state.width,
                height: state.height,
                bbox_coord_space: "abs",
                bbox_format: "xyxy",
                summary,
                items: state.items.map((item) => {
                    const out = { label: item.label, caption: item.caption, bbox: item.bbox.map((n) => Math.round(n)) };
                    if (item.label === "text") out.text = item.text;
                    return out;
                }),
            };
        }

        function validate() {
            root.querySelectorAll(".ptb-invalid").forEach((el) => {
                el.classList.remove("ptb-invalid");
            });
            const invalid = [];

            if (state.summary.caption.trim() === "") invalid.push(sumCaption);

            for (const item of state.items) {
                const list = listRefs.get(item.id);
                const canvas = canvasRefs.get(item.id);

                if (item.caption.trim() === "") {
                    if (list) invalid.push(list.captionInput);
                    if (canvas) invalid.push(canvas.caption);
                }
                if (item.label === "text" && item.text.trim() === "") {
                    if (list?.textInput) invalid.push(list.textInput);
                    if (canvas?.text) invalid.push(canvas.text);
                }
            }

            invalid.forEach((el) => {
                el.classList.add("ptb-invalid");
            });
            return invalid.length === 0;
        }

        // Returns { prompt, negative, width, height }, or null if validation / compilation failed
        function compile() {
            if (!validate()) return null;
            let compiled;
            try {
                compiled = window.PromptTabsJson.compilePrompt(JSON.stringify(buildJson()));
            } catch (e) {
                alert(e);
                return null;
            }
            if (state.summary.extra.trim() !== "") compiled += "\n" + state.summary.extra;
            return {
                prompt: compiled.replaceAll("\n", " "),
                negative: state.summary.negative,
                width: state.width,
                height: state.height,
            };
        }

        // Plain-object snapshot for persistence
        function getState() {
            return {
                width: state.width,
                height: state.height,
                summary: { ...state.summary },
                items: state.items.map((it) => ({ label: it.label, caption: it.caption, text: it.text, bbox: it.bbox.slice() })),
            };
        }

        // ----- lifecycle -----

        renderAll();
        const canvasObserver = new ResizeObserver(fitStage);
        canvasObserver.observe(canvasSection);

        function show() {
            root.style.display = "";
            watchSubject();
            syncSubject();
            fitStage();
            requestAnimationFrame(fitStage);
        }

        function hide() {
            root.style.display = "none";
        }

        function destroy() {
            clearTimeout(notifyTimer);
            growObserver.disconnect();
            canvasObserver.disconnect();
            if (refUrl && refUrlOwned) URL.revokeObjectURL(refUrl);
            if (subjectObserver) subjectObserver.disconnect();
            root.remove();
        }

        return { root, show, hide, compile, getState, destroy };
    }

    window.PromptTabsBuilder = { available, create };
})();
