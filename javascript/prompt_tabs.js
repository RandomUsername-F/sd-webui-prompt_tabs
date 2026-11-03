(function () {
    "use strict";

    const TABNAMES = ["txt2img", "img2img"];
    const clearers = [];
    const COUNT_KEY = (t) => `prompt_tabs_count_${t}`;
    const DATA_KEY = (t) => `prompt_tabs_data_${t}`;
    const NAMES_KEY = (t) => `prompt_tabs_names_${t}`;
    const META_KEY = (t) => `prompt_tabs_meta_${t}`;

    function lsGet(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function lsSet(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {}
    }

    function lsRemove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {}
    }

    function loadCount(tabname) {
        const n = parseInt(lsGet(COUNT_KEY(tabname)), 10);
        return Number.isFinite(n) && n >= 1 ? Math.min(n, 50) : 1;
    }

    // Only true once the options have been fetched and the setting is enabled
    function rememberEnabled() {
        return typeof opts === "object" && !!opts.prompt_tabs_remember;
    }

    // Default is on, so only an explicit false disables it
    function expandEnabled() {
        return !(typeof opts === "object" && opts.prompt_tabs_expand === false);
    }

    // Sets value the same way a user would so Gradio and other extensions react.
    // Gradio's autosize recomputes height on input, which would discard a manual resize,
    // so the previous height is restored after its handlers have run. Then, depending on the
    // setting, the box either grows to fit the text (never shrinks) or gets a scrollbar.
    function setTextarea(textarea, value) {
        if (!textarea || textarea.value === value) return;
        const height = textarea.style.height;
        const fit = () => {
            if (height) textarea.style.height = height;
            if (expandEnabled()) {
                const border = textarea.offsetHeight - textarea.clientHeight;
                const needed = textarea.scrollHeight + border;
                if (needed > textarea.offsetHeight) textarea.style.height = `${needed}px`;
            } else {
                textarea.style.overflowY = "auto";
            }
        };
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        fit();
        requestAnimationFrame(fit);
        setTimeout(fit, 50);
    }

    function setup(tabname) {
        const container = gradioApp().getElementById(`${tabname}_prompt_container`);
        if (!container) return false;
        if (container.dataset.promptTabs) return true;

        // Looked up on demand: Gradio may re-render a textbox (e.g. when its interactive
        // state changes with CFG), which would leave a cached element reference stale.
        const getP = () => gradioApp().querySelector(`#${tabname}_prompt textarea`);
        const getN = () => gradioApp().querySelector(`#${tabname}_neg_prompt textarea`);
        if (!getP() || !getN()) return false;

        container.dataset.promptTabs = "1";

        // Slot 0 adopts whatever the real textareas hold at load (default settings / other
        // extensions decide that). The other slots start empty unless restored below.
        const count = loadCount(tabname);
        const tabs = [];
        for (let i = 0; i < count; i++) tabs.push({ p: "", n: "" });
        tabs[0] = { p: getP().value, n: getN().value };
        let active = 0;

        // Custom tab names (null = default "Prompt N"). Kept until the tab is closed; independent
        // of the prompt-memory setting.
        const names = [];
        try {
            const saved = JSON.parse(lsGet(NAMES_KEY(tabname)));
            for (let i = 0; i < count; i++) {
                const s = Array.isArray(saved) ? saved[i] : null;
                names.push(typeof s === "string" && s.trim() ? s : null);
            }
        } catch (e) {
            for (let i = 0; i < count; i++) names.push(null);
        }
        const saveNames = () => lsSet(NAMES_KEY(tabname), JSON.stringify(names));
        const tabLabel = (i) => names[i] || (i === 0 ? "Default" : `Prompt ${i + 1}`);

        // Wrapper becomes the parent; the original container (and its children) is moved
        // as-is, so ids/classes/listeners that other extensions rely on stay untouched.
        const wrapper = document.createElement("div");
        wrapper.className = "prompt-tabs-wrapper";
        wrapper.id = `${tabname}_prompt_tabs_wrapper`;
        wrapper.style.cssText = container.style.cssText; // keep Gradio's flex sizing
        container.parentNode.insertBefore(wrapper, container);

        const bar = document.createElement("div");
        bar.className = "prompt-tabs-bar";
        const list = document.createElement("div");
        list.className = "prompt-tabs-list";
        const tools = document.createElement("div");
        tools.className = "prompt-tabs-tools";

        const mkBtn = (cls, text, title, fn) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `prompt-tabs-tool ${cls}`;
            b.textContent = text;
            b.title = title;
            b.addEventListener("click", fn);
            return b;
        };

        bar.append(list, tools);
        wrapper.append(bar, container);

        function stash() {
            const p = getP();
            const n = getN();
            if (!p || !n) return;
            tabs[active] = { p: p.value, n: n.value };
        }

        function apply() {
            setTextarea(getP(), tabs[active].p);
            setTextarea(getN(), tabs[active].n);
        }

        // Persistent memory: every tab except the first. The first tab is the default tab,
        // always active after a reload so default prompt handling can write to it.
        function persist() {
            if (!rememberEnabled()) return;
            stash();
            const data = tabs.map((t, i) => (i === 0 ? null : { p: t.p, n: t.n }));
            lsSet(DATA_KEY(tabname), JSON.stringify(data));
            // The default tab's own text and which tab was active, so that a reload can detect
            // that the box held another tab's prompt (and default handling saved that instead)
            lsSet(META_KEY(tabname), JSON.stringify({ active, p: tabs[0].p, n: tabs[0].n }));
        }

        let persistTimer = null;
        function schedulePersist() {
            if (active === 0 || !rememberEnabled()) return;
            clearTimeout(persistTimer);
            persistTimer = setTimeout(persist, 500);
        }

        function restore() {
            if (!rememberEnabled()) return;
            // If another tab was active when the page closed, the prompt box held that tab's
            // text, so default prompt handling may have saved it. Put the default tab's own
            // text back instead of letting the active tab's prompt replace it.
            try {
                const meta = JSON.parse(lsGet(META_KEY(tabname)));
                if (meta && meta.active > 0 && typeof meta.p === "string" && typeof meta.n === "string") {
                    tabs[0] = { p: meta.p, n: meta.n };
                }
            } catch (e) {}

            let data;
            try {
                data = JSON.parse(lsGet(DATA_KEY(tabname)));
            } catch (e) {
                return;
            }
            if (!Array.isArray(data)) return;
            for (let i = 1; i < tabs.length; i++) {
                const t = data[i];
                if (i === active || !t || typeof t.p !== "string" || typeof t.n !== "string") continue;
                tabs[i] = { p: t.p, n: t.n };
            }
        }

        // Used by the settings button: wipes stored data and the in-session text of the
        // non-default inactive tabs, so it can't be written back.
        clearers.push(() => {
            clearTimeout(persistTimer);
            lsRemove(DATA_KEY(tabname));
            lsRemove(META_KEY(tabname));
            for (let i = 1; i < tabs.length; i++) {
                if (i !== active) tabs[i] = { p: "", n: "" };
            }
            persist();
        });

        function render() {
            list.textContent = "";
            tabs.forEach((_, i) => {
                const tab = document.createElement("div");
                tab.className = "prompt-tabs-tab" + (i === active ? " active" : "");

                const label = document.createElement("button");
                label.type = "button";
                label.className = "prompt-tabs-label";
                label.textContent = tabLabel(i);
                label.title = "Double-click to rename";
                label.addEventListener("click", () => switchTo(i));
                label.addEventListener("dblclick", () => startRename(i, label));
                tab.append(label);

                tab.append(
                    mkBtn("pt-clone", "⧉", "Clone this prompt tab", (e) => {
                        e.stopPropagation();
                        cloneTab(i);
                    })
                );

                // The first tab can't be closed, so there is always a tab to type in
                if (i > 0) {
                    tab.append(
                        mkBtn("pt-close", "✕", "Close this prompt tab", (e) => {
                            e.stopPropagation();
                            closeTab(i);
                        })
                    );
                }

                list.appendChild(tab);
            });
        }

        // Toggling classes instead of rebuilding keeps the label element alive between the
        // two clicks of a double-click, so renaming works on a not-yet-active tab too.
        function updateActive() {
            list.querySelectorAll(".prompt-tabs-tab").forEach((el, k) => {
                el.classList.toggle("active", k === active);
            });
        }

        function startRename(i, label) {
            const input = document.createElement("input");
            input.type = "text";
            input.className = "prompt-tabs-rename";
            input.maxLength = 32;
            input.value = tabLabel(i);
            label.replaceWith(input);
            input.focus();
            input.select();

            let done = false;
            const finish = (commit) => {
                if (done) return;
                done = true;
                const v = input.value.trim();
                if (commit && v) {
                    names[i] = v; // blank input keeps the last used name
                    saveNames();
                }
                render();
            };
            input.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") finish(true);
                else if (e.key === "Escape") finish(false);
            });
            input.addEventListener("blur", () => finish(true));
        }

        function switchTo(i) {
            if (i === active || i < 0 || i >= tabs.length) return;
            stash();
            active = i;
            apply();
            updateActive();
            persist();
        }

        function insertTab(at, data) {
            stash();
            tabs.splice(at, 0, data);
            names.splice(at, 0, null);
            saveNames();
            active = at;
            apply();
            render();
            lsSet(COUNT_KEY(tabname), String(tabs.length));
            persist();
        }

        function addTab() {
            insertTab(tabs.length, { p: "", n: "" });
        }

        function cloneTab(i) {
            stash();
            insertTab(i + 1, { p: tabs[i].p, n: tabs[i].n });
        }

        function closeTab(i) {
            if (i <= 0 || i >= tabs.length) return;
            stash();
            tabs.splice(i, 1); // memory and name of this tab are dropped with it
            names.splice(i, 1);
            saveNames();
            if (i < active) active--;
            else active = Math.min(active, tabs.length - 1);
            apply();
            render();
            lsSet(COUNT_KEY(tabname), String(tabs.length));
            persist();
        }

        tools.append(mkBtn("pt-new", "＋", "New empty prompt tab", addTab));

        // Keep memory in sync with any edit (typing, paste params, styles, other extensions)
        // Delegated on the (stable) container so it survives textbox re-renders
        container.addEventListener("input", (e) => {
            if (e.target === getP()) tabs[active].p = e.target.value;
            else if (e.target === getN()) tabs[active].n = e.target.value;
            else return;
            schedulePersist();
        });
        window.addEventListener("pagehide", persist);

        render();
        lsSet(COUNT_KEY(tabname), String(tabs.length));

        // Settings load asynchronously. Turning the setting off does not clear anything
        // right away; stale data is dropped here, on the next page load.
        onOptionsAvailable(() => {
            if (rememberEnabled()) {
                restore();
                apply();
                render();
                persist();
            } else {
                lsRemove(DATA_KEY(tabname));
                lsRemove(META_KEY(tabname));
            }
        });

        // Turning the setting on mid-session starts saving immediately
        onOptionsChanged(() => {
            if (rememberEnabled()) persist();
        });

        return true;
    }

    // Button injected into the description of the setting in the Settings tab
    function setupClearButton() {
        const desc = gradioApp().querySelector(".prompt-tabs-desc");
        if (!desc) return false;
        if (desc.querySelector(".prompt-tabs-clear")) return true;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "prompt-tabs-clear";
        btn.textContent = "Clear stored prompts now";
        btn.title = "Immediately erase remembered prompts of all tabs except the first";
        btn.addEventListener("click", (e) => {
            // The button lives inside the setting's <label>; don't let the click toggle the checkbox
            e.preventDefault();
            e.stopPropagation();
            clearers.forEach((fn) => fn());
            btn.textContent = "Cleared";
            setTimeout(() => { btn.textContent = "Clear stored prompts now"; }, 1500);
        });
        desc.appendChild(btn);

        // The description sits inside the setting's <label>; clicks on it must not toggle the checkbox
        desc.addEventListener("click", (e) => e.preventDefault());
        desc.style.cursor = "default";
        return true;
    }

    // onUiLoaded fires as soon as #txt2img_prompt exists, which can be before the inner
    // textareas (and the whole img2img tab) are rendered. Retry on every UI mutation
    // until each tab has been set up.
    const pending = new Set(TABNAMES);
    let buttonDone = false;
    function trySetup() {
        if (!buttonDone) buttonDone = setupClearButton();
        if (pending.size === 0) return;
        for (const t of [...pending]) {
            try {
                if (setup(t)) pending.delete(t);
            } catch (e) {
                console.error("[prompt_tabs] setup failed for", t, e);
                pending.delete(t);
            }
        }
    }
    onUiLoaded(trySetup);
    onUiUpdate(trySetup);
})();
