// Shared S1 token set for server-rendered chrome surfaces (preview + compare).
// Mirrors `ui/src/index.css` so dashboard / preview / compare share one
// visual vocabulary. New tokens belong in `ui/src/index.css` first, then mirrored
// here. Light values default on `:root` so the chrome stays legible if the boot
// script never runs; dark values override on `[data-theme="dark"]`.

export function chromeTokens(): string {
  return `:root {
  color-scheme: light dark;

  --ink:        #0e0f14;
  --paper:      #eef0f4;
  --mid:        #9396a1;
  --light:      #d9dce3;
  --cobalt:     #1f2b80;
  --cobalt-deep:#141d5e;
  --shiny:      #d4a233;
  --shiny-deep: #a87e22;

  --terra: #c25d3a;
  --terra-deep: #9a4729;
  --sky:   #3b6fb3;
  --moss:  #5a8a52;

  --ink-d:    #eef0f4;
  --paper-d:  #0c0e16;
  --paper-d2: #141826;
  --mid-d:    #5a607a;
  --light-d:  #232a3d;

  --hairline:          rgba(14, 15, 20, 0.10);
  --hairline-strong:   rgba(14, 15, 20, 0.18);
  --hairline-d:        rgba(238, 240, 244, 0.10);
  --hairline-d-strong: rgba(238, 240, 244, 0.20);

  --shadow-pop:   0 14px 36px rgba(14, 18, 40, 0.10), 0 1px 2px rgba(14, 18, 40, 0.04);
  --shadow-pop-d: 0 18px 44px rgba(0, 0, 0, 0.60),    0 1px 0 rgba(255, 255, 255, 0.03);
  --shadow-lift:   0 1px 2px rgba(14, 18, 40, 0.05), 0 6px 18px rgba(14, 18, 40, 0.07);
  --shadow-lift-d: 0 1px 0 rgba(255, 255, 255, 0.04), 0 8px 22px rgba(0, 0, 0, 0.50);

  --ui-font: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --display-font: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --serif-font: 'Newsreader', 'Iowan Old Style', Georgia, serif;
  --mono-font: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --fs-2xs: 10.5px;
  --fs-xs:  11.5px;
  --fs-sm:  12.5px;
  --fs-md:  13.5px;
  --fs-lg:  15px;
  --fs-xl:  18px;
  --fs-2xl: 22px;
  --fs-3xl: 32px;

  --lh-tight:  1.18;
  --lh-snug:   1.32;
  --lh-normal: 1.48;
  --lh-relaxed: 1.6;

  --tracking-mono: 0.10em;
  --tracking-mono-tight: 0.06em;
  --tracking-display: -0.014em;

  --s-0: 2px; --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px;
  --s-5: 20px; --s-6: 24px; --s-7: 32px; --s-8: 40px; --s-9: 56px;

  --shell-radius: 14px;
  --radius-xs: 2px; --radius-sm: 4px; --radius-md: 6px;
  --radius-lg: 8px; --radius-xl: 10px;

  --ease-out:    cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-soft:   cubic-bezier(0.32, 0.72, 0.24, 1);
  --ease-spring: cubic-bezier(0.34, 1.45, 0.36, 1);
  --dur-fast: 120ms; --dur-med: 180ms; --dur-slow: 240ms;

  --accent: var(--cobalt);
  --accent-deep: var(--cobalt-deep);
  --accent-soft: rgba(31, 43, 128, 0.10);
  --accent-tint: rgba(31, 43, 128, 0.06);
  --accent-ring: rgba(31, 43, 128, 0.35);
  --accent-line: rgba(31, 43, 128, 0.55);

  --shiny-fg:   var(--shiny);
  --shiny-bg:   rgba(212, 162, 51, 0.12);
  --shiny-ring: rgba(212, 162, 51, 0.45);

  --rose: #bc4c6c;
  --warn-fg: #c6841b;
  --warn-bg: rgba(198, 132, 27, 0.10);

  --fmt-html:      #c25d3a;
  --fmt-mermaid:   #3b6fb3;
  --fmt-svg:       #5a8a52;
  --fmt-markdown:  #b78320;
  --fmt-dot:       #7a4ba8;
  --fmt-vega-lite: #bc4c6c;
  --fmt-d2:        #1f7a7a;

  --bg:          var(--paper);
  --surface:     #ffffff;
  --surface-2:   #f7f8fb;
  --surface-3:   #eceff5;
  --text:        var(--ink);
  --text-mute:   #5a5e6d;
  --text-subtle: #8b8f9c;
  --hr:          var(--hairline);
  --hr-strong:   var(--hairline-strong);
  --shadow:      var(--shadow-pop);
  --shadow-card-hover: var(--shadow-lift);
  --chrome-bg:   rgba(255, 255, 255, 0.80);
  --thumb-bg:    #e6e9f0;
}
:root[data-theme="dark"] {
  --bg:          var(--paper-d);
  --surface:     var(--paper-d2);
  --surface-2:   #1a1f31;
  --surface-3:   #232a40;
  --text:        var(--ink-d);
  --text-mute:   #a3a8bb;
  --text-subtle: #6a7088;
  --hr:          var(--hairline-d);
  --hr-strong:   var(--hairline-d-strong);
  --shadow:      var(--shadow-pop-d);
  --shadow-card-hover: var(--shadow-lift-d);
  --chrome-bg:   rgba(20, 24, 38, 0.82);
  --thumb-bg:    #0f1320;
  --accent-soft: rgba(72, 96, 220, 0.18);
  --accent-tint: rgba(72, 96, 220, 0.10);
  --accent-line: rgba(72, 96, 220, 0.55);
  --accent-ring: rgba(72, 96, 220, 0.40);
}`;
}
