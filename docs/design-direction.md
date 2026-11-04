# Deadlock AR broadcast identity

The design should feel like a Deadlock broadcast produced by Deadlock AR. Keep the community's cream, parchment and olive identity; bring in the game's period display lettering, ink-dark framing, warm/cool team accents and genuine hero/item artwork. This is an interpretation of the visual language, not a claim to use Valve's proprietary UI font or an exact copy of the in-game interface.

## Reference hierarchy

1. **Current game artwork and legibility.** Bundled hero portraits, critical/gloat variants and item images are the strongest link to the game. Keep their original colors, silhouettes and readable proportions. The observer's actual HUD and the supplied reference are authoritative for positioning.
2. **Deadlock's visual vocabulary.** Use bold display typography, compact numerical columns, layered rules and restrained angular framing. Prefer a few precise strokes to decorative clutter, glowing panels or invented game symbols.
3. **Deadlock AR identity.** Parchment remains the working surface and olive the principal interaction color. Ink stages support artwork and data. Muted Amber/Sapphire accents distinguish existing source-team sides; names and explicit labels remain essential because colors alone cannot establish team identity.
4. **Production clarity.** Fixed OBS dimensions, safe areas, transparency, source status and operator controls take priority over ornament. A handsome graphic that truncates a player name or obscures a camera feed is unfinished.

## Shared treatment

- Use the bundled Bodoni font for short display headings and the bundled Oswald font for compact team names and numbers. These are open-font substitutes already supplied with the project. Keep Cairo fallbacks for Arabic and the existing body font for controls, instructions and long names.
- Use dark ink for navigation and broadcast stages, cream for data surfaces, and olive for selected controls. Keep error, stale and unavailable indicators semantically distinct.
- Use thin nested rules, squared card edges and subtle warm framing. Retain existing grids, spacing and scaling rather than imposing one layout on every graphic.
- Preserve hero artwork and the approved pick effects. Do not apply a global color filter, obscure neighboring portraits or use animation as a substitute for meaningful source state.
- Treat the redesigned scoreboard and caster desk as dedicated compositions. `DeadlockIdentity.css` does not override their screen selectors.

`src/DeadlockIdentity.css` is a presentation-only layer for existing dashboard cards, draft output, compact stat panels, brackets, player introductions and the HTML MVP output. Import it globally after the existing styles. It contains no root theme overrides, changes to canvas dimensions or structural grid rules. It also preserves transparent broadcast backgrounds.

Report canvases render their own pixels in `src/report-canvas.js`. Their shared header and display typography now use the same ink framing and local display fonts, with font loading awaited before drawing and Cairo retained for Arabic. No image color filter is used. Hero reports distinguish selections with unknown draft order using neutral hollow squares (picks) and diamonds (bans), a separate legend row and explicit wording. These selections contribute to totals without being labelled as opening or later rounds. Review the exported PNG files alongside the studio preview.

## Visual acceptance still required

- Review every permanent OBS output at its documented native resolution, including draft board/lower-third, compact stats, 2–32-team brackets, two player rows, reports and the new desk/scoreboard.
- Check the longest English and Arabic names, empty states, all twelve players, unknown statistics and broken remote assets. Verify shape and text contrast at a caster's actual output resolution, not just an enlarged studio preview.
- Confirm that transparent sources contain no unintended full-screen fill; camera holes, hero HUD windows and source crops remain aligned. Rehearse voice-widget and webcam sources on the production OBS computer.
- Compare cream/olive screens with a current in-game screenshot and the community's chosen reference. Adjust the balance through shared colors and display type before changing proven layouts.
- Check reduced motion, clear focus states, mobile admin controls, font loading and exported PNGs. Do not call visual acceptance complete from automated tests alone.
