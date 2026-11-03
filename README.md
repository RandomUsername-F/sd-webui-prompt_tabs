# sd-webui-prompt_tabs

**Multiple prompt tabs for the txt2img and img2img extension for [Stable Diffusion WebUI Forge - Neo](https://github.com/Haoming02/sd-webui-forge-classic/tree/neo)**

## Install

Place `sd-webui-prompt_tabs` in `extensions/` or use UI extension installer and restart Forge.

## Usage

A tab bar is added above the positive/negative prompt boxes. Only the active tab's prompts are sent on Generate.

- **Switch:** click a tab. The textboxes swap to that tab's positive and negative prompts.
- **＋** adds an empty tab at the end.
- **⧉** (per tab) clones that tab next to it.
- **✕** (per tab) closes it. The first tab ("Default") can't be closed.
- **Rename:** double-click a tab name. Enter/click away saves, Esc cancels, blank keeps the previous name.

The real prompt textareas are never replaced; their values are swapped and `input` events are fired, so other extensions keep working.

## Persistence

| What | Stored | Notes |
| --- | --- | --- |
| Tab count, names, types | Browser (localStorage) | Kept until the tab is closed |
| Prompts of extra tabs | Browser (localStorage) | Needs the "Remember" setting |
| Default tab prompt | Not stored by this extension | Handled by default prompt handling / other extensions |

## Settings

Settings → UI → Prompt Tabs

- **Remember prompts of extra prompt tabs** (default on). Turning it off erases stored data on the next page reload, not immediately.
- **Clear stored prompts now** button. Erases stored data immediately.
- **Expand prompt boxes to fit text when switching tabs** (default on). Boxes only grow, never shrink. When off, a scrollbar is used instead.

## JSON Builder tab (MOSS preset)

Available only while the UI Preset is `moss`; otherwise the button and builder tabs are hidden. The builder is bundled with this extension (based on the MOSS JSON Builder), so no other extension is required.

- **`{ }`** button adds a JSON Builder tab. It replaces the positive/negative prompt boxes while active.
- On **Generate** the layout is validated and compiled into the positive prompt, the **Negative prompt** box (bottom of the Summary section) is used as the negative prompt, and width/height are set to the canvas size. Invalid layouts (empty captions) block generation and are outlined in red.
- With no saved canvas size, the txt2img/img2img width/height is used as default.
- **Reference image:** load an image (button or drag & drop onto the canvas) with adjustable opacity and optional "Match size". Session only, not stored. In img2img, the input (subject) image is used as the reference by default and followed until you load or clear one yourself.
- Layouts, including the negative prompt, are stored under the same "Remember" setting.

## Files

- `javascript/prompt_tabs.js`: tab logic
- `javascript/json_builder_tab.js`: embeddable JSON Builder
- `javascript/json_codec.js`: bundled MOSS prompt compiler/decompiler
- `scripts/prompt_tabs.py`: settings and an output-folder endpoint
- `style.css`
