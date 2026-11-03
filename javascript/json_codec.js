// Bundled copy of the MOSS-Image prompt compiler / decompiler, namespaced so it neither
// depends on nor collides with the MOSS JSON Builder extension's globals.
// Source: https://github.com/OpenMOSS/MOSS-Image/blob/main/skills/moss-image-prompt-enhancer/scripts/compile_prompt.py

(function () {
    "use strict";

    function compilePrompt(input) {
        function require(condition, message) {
            if (!condition) {
                throw new Error(message);
            }
        }

        function fields(value, allowed, required, location) {
            require(value !== null && typeof value === "object" && !Array.isArray(value), `${location} must be an object`);

            const keys = Object.keys(value);
            const unknown = keys.filter((key) => !allowed.has(key));
            const missing = [...required].filter((key) => !Object.prototype.hasOwnProperty.call(value, key));

            require(unknown.length === 0, `${location}: unknown fields ${JSON.stringify(unknown.sort())}`);
            require(missing.length === 0, `${location}: missing fields ${JSON.stringify(missing.sort())}`);
        }

        function text(value, location) {
            require(typeof value === "string" && value.trim().length > 0, `${location} must be nonempty text`);
        }

        function strings(value, location) {
            require(Array.isArray(value), `${location} must be an array`);

            value.forEach((item, index) => {
                text(item, `${location}[${index}]`);
            });
        }

        // escaped parenthesis for emphasis
        function escapeParens(prompt) {
            return prompt.replace(/\\*\(/g, "\\(").replace(/\\*\)/g, "\\)");
        }

        function centeredBox(box, width, height, location) {
            require(Array.isArray(box) && box.length === 4, `${location} must be [x1,y1,x2,y2]`);

            require(box.every((v) => typeof v === "number" && Number.isFinite(v)), `${location} must contain four finite numbers`);

            const [x1, y1, x2, y2] = box;

            require(x1 < x2 && y1 < y2, `${location} must have positive width and height`);

            require(0 <= x1 && x1 < x2 && x2 <= width && 0 <= y1 && y1 < y2 && y2 <= height, `${location} exceeds the ${width}x${height} canvas`);

            const pyRound9 = (value) => {
                const rounded = Number(value.toFixed(9));
                return Object.is(rounded, -0) ? 0 : rounded;
            };

            const result = [
                Math.floor(pyRound9(y1)) - Math.floor(height / 2),
                Math.floor(pyRound9(x1)) - Math.floor(width / 2),
                Math.ceil(pyRound9(y2)) - Math.floor(height / 2),
                Math.ceil(pyRound9(x2)) - Math.floor(width / 2),
            ];

            require(result[0] < result[2] && result[1] < result[3], `${location} is too small at export precision`);

            return result;
        }

        function parseUniqueJson(source) {
            let pos = 0;

            function skipWhitespace() {
                while (/\s/.test(source[pos] || "") && pos < source.length) {
                    pos++;
                }
            }

            function parseString() {
                const start = pos++;
                while (pos < source.length) {
                    if (source[pos] === "\\") {
                        pos += 2;
                    } else if (source[pos++] === '"') {
                        return JSON.parse(source.slice(start, pos));
                    }
                }
                throw new Error("Invalid JSON");
            }

            function parseValue() {
                skipWhitespace();

                if (source[pos] === "{") {
                    pos++;
                    skipWhitespace();
                    const keys = new Set();

                    if (source[pos] === "}") {
                        pos++;
                        return;
                    }

                    while (pos < source.length) {
                        skipWhitespace();
                        if (source[pos] !== '"') {
                            throw new Error("Invalid JSON");
                        }

                        const key = parseString();

                        require(!keys.has(key), `Duplicate JSON key: ${key}`);
                        keys.add(key);

                        skipWhitespace();
                        require(source[pos++] === ":", "Invalid JSON");

                        parseValue();
                        skipWhitespace();

                        if (source[pos] === "}") {
                            pos++;
                            return;
                        }

                        require(source[pos++] === ",", "Invalid JSON");
                    }

                    throw new Error("Invalid JSON");
                }

                if (source[pos] === "[") {
                    pos++;
                    skipWhitespace();

                    if (source[pos] === "]") {
                        pos++;
                        return;
                    }

                    while (pos < source.length) {
                        parseValue();
                        skipWhitespace();

                        if (source[pos] === "]") {
                            pos++;
                            return;
                        }

                        require(source[pos++] === ",", "Invalid JSON");
                    }

                    throw new Error("Invalid JSON");
                }

                if (source[pos] === '"') {
                    parseString();
                    return;
                }

                const match = source.slice(pos).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);

                require(match !== null, "Invalid JSON");

                const token = match[0];
                require(!/^-?(?:NaN|Infinity)$/.test(token), `Invalid JSON number: ${token}`);

                const value = Number(token);
                require(Number.isFinite(value), `Invalid JSON number: ${token}`);

                pos += token.length;
            }

            parseValue();
            skipWhitespace();
            require(pos === source.length, "Invalid JSON");

            return JSON.parse(source);
        }

        const draft = typeof input === "string" ? parseUniqueJson(input) : input;

        require(draft !== null && typeof draft === "object" && !Array.isArray(draft), "Draft must be a JSON object");

        if (Object.prototype.hasOwnProperty.call(draft, "caption")) {
            fields(draft, new Set(["caption"]), new Set(["caption"]), "Caption draft");
            text(draft.caption, "caption");
            return escapeParens(draft.caption);
        }

        const rootFields = new Set(["width", "height", "bbox_coord_space", "bbox_format", "summary", "items"]);

        fields(draft, rootFields, rootFields, "Layout draft");

        const { width, height } = draft;

        for (const [name, value] of [
            ["width", width],
            ["height", height],
        ]) {
            require(Number.isInteger(value) && value > 0 && value % 16 === 0, `${name} must be a positive integer multiple of 16`);
        }

        require(draft.bbox_coord_space === "abs", "Draft bbox_coord_space must be abs");

        require(draft.bbox_format === "xyxy", "Draft bbox_format must be xyxy");

        const summary = draft.summary;

        fields(summary, new Set(["caption", "meta", "canvas", "palette"]), new Set(["caption"]), "summary");

        text(summary.caption, "summary.caption");

        if ("canvas" in summary) {
            require(["single", "multi_panel", "collage"].includes(summary.canvas), "summary.canvas must be single, multi_panel or collage");
        }

        for (const key of ["meta", "palette"]) {
            if (key in summary) {
                strings(summary[key], `summary.${key}`);
            }
        }

        const items = draft.items;

        require(Array.isArray(items) && items.length > 0, "items must be a nonempty flat array");

        const compiledItems = items.map((item, index) => {
            const location = `items[${index}]`;

            fields(item, new Set(["label", "caption", "bbox", "text", "tags", "palette"]), new Set(["label", "caption", "bbox"]), location);

            require(["object", "character", "text"].includes(item.label), `${location}.label must be object, character or text`);

            text(item.caption, `${location}.caption`);

            if (item.label === "text") {
                require("text" in item, `${location}: text items require literal text`);
            }

            if ("text" in item) {
                text(item.text, `${location}.text`);
            }

            for (const key of ["tags", "palette"]) {
                if (key in item) {
                    strings(item[key], `${location}.${key}`);
                }
            }

            const compiled = {};

            for (const [key, value] of Object.entries(item)) {
                compiled[key] = key === "bbox" ? centeredBox(value, width, height, `${location}.bbox`) : value;
            }

            return compiled;
        });

        const result = {
            summary,
            items: compiledItems,
            bbox_coord_space: "abs_centralized",
            bbox_format: "yxyx",
        };

        return escapeParens(JSON.stringify(result));
    }

    // Reconstructs an editable Layout draft from a compiled MOSS-Image prompt
    function decompilePrompt(input, width, height) {
        function require(condition, message) {
            if (!condition) {
                throw new Error(message);
            }
        }

        function normalizeDraft(value) {
            require(value !== null && typeof value === "object" && !Array.isArray(value), "Draft must be an object");

            const draftWidth = value.width;
            const draftHeight = value.height;

            for (const [name, dim] of [
                ["width", draftWidth],
                ["height", draftHeight],
            ]) {
                require(typeof dim === "number" && Number.isFinite(dim) && dim > 0, `${name} must be a positive number`);
            }

            const summary = value.summary;
            require(summary !== null && typeof summary === "object" && !Array.isArray(summary), "summary must be an object");
            require(typeof summary.caption === "string" && summary.caption.trim().length > 0, "summary.caption must be nonempty text");

            const canvas = summary.canvas === undefined ? "single" : summary.canvas;
            require(["single", "multi_panel", "collage"].includes(canvas), "summary.canvas must be single, multi_panel or collage");

            let meta = [];
            if (summary.meta !== undefined) {
                require(Array.isArray(summary.meta), "summary.meta must be an array");
                meta = summary.meta.map((entry, index) => {
                    require(typeof entry === "string" && entry.trim().length > 0, `summary.meta[${index}] must be nonempty text`);
                    return entry;
                });
            }

            const items = value.items;
            require(Array.isArray(items) && items.length > 0, "items must be a nonempty array");

            const cleanItems = items.map((item, index) => {
                const location = `items[${index}]`;

                require(item !== null && typeof item === "object" && !Array.isArray(item), `${location} must be an object`);
                require(["object", "character", "text"].includes(item.label), `${location}.label must be object, character or text`);
                require(typeof item.caption === "string" && item.caption.trim().length > 0, `${location}.caption must be nonempty text`);

                const box = item.bbox;
                require(Array.isArray(box) && box.length === 4, `${location}.bbox must be [x1,y1,x2,y2]`);
                require(box.every((v) => typeof v === "number" && Number.isFinite(v)), `${location}.bbox must contain four finite numbers`);
                require(box[0] < box[2] && box[1] < box[3], `${location}.bbox must have positive width and height`);

                const clean = { label: item.label, caption: item.caption, bbox: box.slice() };

                if (item.label === "text") {
                    require(typeof item.text === "string" && item.text.trim().length > 0, `${location}.text must be nonempty text`);
                    clean.text = item.text;
                }

                return clean;
            });

            return {
                width: draftWidth,
                height: draftHeight,
                summary: { caption: summary.caption, meta, canvas },
                items: cleanItems,
            };
        }

        // escaped parenthesis is not valid JSON
        function restoreJsonParens(prompt) {
            return prompt.replace(/(?<!\\)((?:\\\\)*)\\([()])/g, (match, runs, paren) => runs + "\\\\" + paren);
        }

        const draft = typeof input === "string" ? JSON.parse(restoreJsonParens(input)) : input;

        require(draft !== null && typeof draft === "object" && !Array.isArray(draft), "Prompt must be a JSON object");

        if (typeof draft.width === "number" && typeof draft.height === "number") {
            return normalizeDraft(draft);
        }

        require(Number.isFinite(width) && width > 0, "A valid width is required to decompile a prompt");
        require(Number.isFinite(height) && height > 0, "A valid height is required to decompile a prompt");
        require(draft.bbox_coord_space === "abs_centralized", "Prompt bbox_coord_space must be abs_centralized");
        require(draft.bbox_format === "yxyx", "Prompt bbox_format must be yxyx");
        require(Array.isArray(draft.items), "Prompt items must be an array");

        const halfWidth = Math.floor(width / 2);
        const halfHeight = Math.floor(height / 2);

        const items = draft.items.map((item, index) => {
            require(item !== null && typeof item === "object" && !Array.isArray(item), `items[${index}] must be an object`);

            const box = item.bbox;
            require(Array.isArray(box) && box.length === 4, `items[${index}].bbox must be [y1,x1,y2,x2]`);
            require(box.every((v) => typeof v === "number" && Number.isFinite(v)), `items[${index}].bbox must contain four finite numbers`);

            const [y1, x1, y2, x2] = box;
            return { ...item, bbox: [x1 + halfWidth, y1 + halfHeight, x2 + halfWidth, y2 + halfHeight] };
        });

        return normalizeDraft({
            width,
            height,
            bbox_coord_space: "abs",
            bbox_format: "xyxy",
            summary: draft.summary,
            items,
        });
    }

    window.PromptTabsJson = { compilePrompt, decompilePrompt };
})();
