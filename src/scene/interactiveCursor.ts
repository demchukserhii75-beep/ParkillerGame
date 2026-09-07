// Requested directly ("주사위와 말, 파키한테 마우스지표가 갈때만 마우스 유표를 다르게 만들어달라...
// 오락의 특성에 맞게 멋지게" - only when the mouse pointer goes over the dice, pawns, or Parkiller,
// make the cursor different - something new, fitting the game's own character): the plain OS hand/
// pointer cursor (document.body.style.cursor = 'pointer') read as generic next to every other piece
// of this board already carrying the same carved-wood/gold-trim treatment (BRAND_GOLD #c9a24b,
// used throughout StartScreen/OnlineLobbyScreen/the reward toasts/etc.). A classic arrow-pointer
// silhouette instead of a hand - recognizable as "you can click here" the same way - recolored as a
// small gold gem with a dark outline for contrast against any of the board's own light/dark
// squares, plus a small sparkle accent for a touch of "magical antique" flourish matching the
// game's own tone. `url(...) hotspotX hotspotY, pointer` - the plain pointer is the fallback for
// any browser/context that can't load the inline SVG cursor, so hovering these pieces is never
// worse than the previous behavior, only better where supported.
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f5e2a8"/>
      <stop offset="55%" stop-color="#c9a24b"/>
      <stop offset="100%" stop-color="#8a6a2c"/>
    </linearGradient>
  </defs>
  <path d="M3 1 L3 17.5 L7 13.8 L9.7 19.8 L12.4 18.5 L9.7 12.6 L15 12.6 Z" fill="url(#g)" stroke="#2b2013" stroke-width="1.2" stroke-linejoin="round"/>
  <circle cx="18.5" cy="4.5" r="1.6" fill="#fff3cf"/>
  <path d="M18.5 2.2 L18.9 3.9 L20.6 4.3 L18.9 4.7 L18.5 6.4 L18.1 4.7 L16.4 4.3 L18.1 3.9 Z" fill="#fff3cf" opacity="0.9"/>
</svg>`

/** Hotspot (3,1) matches the SVG's own arrow tip, same as a normal OS pointer's hotspot sits at
 * its own tip - clicks register where the tip points, not the cursor's bounding-box corner. */
export const INTERACTIVE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 3 1, pointer`
