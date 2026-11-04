import json
import os

from fastapi import FastAPI, HTTPException, Request

from modules import script_callbacks, shared

# Tab / prompt state lives next to the extension instead of in the browser's limited localStorage
EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(EXTENSION_DIR, "prompt_tabs_data.json")
MAX_STATE_BYTES = 50 * 1024 * 1024


def on_ui_settings():
    section = ("prompt_tabs", "Prompt Tabs")

    # Custom markup (instead of .info()) so the text can be width-limited and the warning styled.
    # The "Clear stored prompts now" button is appended into .prompt-tabs-desc by the extension's JS.
    description = (
        "<div class='prompt-tabs-desc'>"
        "<span class='info'>Stored in the browser for every tab except the first "
        "(the default tab, which follows default prompt handling). "
        "Closing a tab clears its memory.</span>"
        "<br>"
        "<span class='prompt-tabs-warning'>WARNING: turning this off does not erase stored data immediately; "
        "it is erased on the next page reload. Use the button below to clear it now.</span>"
        "</div>"
    )

    shared.opts.add_option(
        "prompt_tabs_remember",
        shared.OptionInfo(
            True,
            "Remember prompts of extra prompt tabs",
            section=section,
            category_id="ui",
        ).html(description),
    )

    shared.opts.add_option(
        "prompt_tabs_expand",
        shared.OptionInfo(
            True,
            "Expand prompt boxes to fit text when switching tabs",
            section=section,
            category_id="ui",
        ).info("boxes only grow, never shrink; when off, a scrollbar is added for long prompts instead"),
    )


def on_app_started(_, app: FastAPI):
    # Used by the JSON Builder tab's reference image picker: the output folder is copied to the
    # clipboard so it can be pasted into the file dialog
    @app.get("/prompt_tabs/output_dir")
    def output_dir(tab: str = "txt2img"):
        key = "outdir_img2img_samples" if tab == "img2img" else "outdir_txt2img_samples"
        path = getattr(shared.opts, key, "") or shared.opts.outdir_samples
        return {"path": os.path.abspath(path) if path else ""}

    @app.get("/prompt_tabs/state")
    def get_state():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    @app.post("/prompt_tabs/state")
    async def save_state(request: Request):
        raw = await request.body()
        if len(raw) > MAX_STATE_BYTES:
            raise HTTPException(status_code=413, detail="State too large")
        try:
            data = json.loads(raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid JSON")
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="Expected a JSON object")

        # write to a temp file first so a crash can't leave a half-written state file
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, STATE_FILE)
        return {"ok": True}


script_callbacks.on_ui_settings(on_ui_settings)
script_callbacks.on_app_started(on_app_started)
