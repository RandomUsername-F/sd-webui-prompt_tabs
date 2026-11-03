from modules import script_callbacks, shared


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


script_callbacks.on_ui_settings(on_ui_settings)
