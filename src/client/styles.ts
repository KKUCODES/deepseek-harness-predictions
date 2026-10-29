import { icons } from './settings-ui.js'

export const styles = `
.dshp-settings {
  --dshp-surface: light-dark(#fff, #17191f); --dshp-canvas: light-dark(#f7f8fa, #22252d);
  --dshp-ink: light-dark(#18181b, #f2f3f5); --dshp-secondary: light-dark(#62666d, #b5bac4);
  --dshp-muted: light-dark(#707680, #a8aeba); --dshp-border: light-dark(#e4e7ec, #393e48);
  --dshp-action: light-dark(#202124, #edf0f5); --dshp-inverse: light-dark(#fff, #17191f);
  --dshp-hover: light-dark(#3d4147, #d4d9e3); --dshp-disabled: light-dark(#f1f3f5, #292d36);
  --dshp-disabled-text: light-dark(#9ca3af, #747d8d); --dshp-focus: #376ce5;
  --dshp-danger: light-dark(#b93830, #ffa49c); --dshp-danger-bg: light-dark(#fff1f0, #3b2226);
  --dshp-warning: light-dark(#925c0c, #f3c976); --dshp-warning-bg: light-dark(#fff7e8, #352d1e);
  --dshp-success: light-dark(#147d50, #82d9ae); --dshp-success-bg: light-dark(#edf8f1, #1c332b);
  box-sizing: border-box; width: 100%; max-width: 640px; min-width: 0; margin-inline: auto;
  padding: 8px 0; color: var(--dshp-ink); font-family: inherit; font-size: 14px; line-height: 22px; font-weight: 400;
  container-type: inline-size;
}
.dshp-settings *, .dshp-settings *::before, .dshp-settings *::after { box-sizing: border-box; }
.dshp-settings h2, .dshp-settings h3, .dshp-settings p, .dshp-settings dl { margin: 0; }
.dshp-settings h2 { font-size: 24px; line-height: 34px; font-weight: 500; outline: none; }
.dshp-settings h3, .dshp-settings strong { font-size: 14px; line-height: 22px; font-weight: 500; }
.dshp-settings .dshp-section-title { font-size: 18px; line-height: 28px; }
.dshp-settings hr { width: 100%; height: 1px; margin: 0; background: var(--dshp-border); border: 0; }
.dshp-stack { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
.dshp-heading { display: flex; flex-direction: column; gap: 4px; }
.dshp-caption { color: var(--dshp-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dshp-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.dshp-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; min-width: 0; }
.dshp-settings .dshp-button { display: inline-flex; align-items: center; justify-content: center; flex: none; gap: 8px;
  min-height: 36px; padding: 6px 14px; border: 1px solid var(--dshp-border); border-radius: 8px;
  font: inherit; font-size: 14px; font-weight: 500; line-height: 22px; color: var(--dshp-ink); background: var(--dshp-surface); cursor: pointer; }
.dshp-settings .dshp-button:hover:not(:disabled) { background: var(--dshp-canvas); }
.dshp-settings .dshp-button-primary { min-width: 128px; background: var(--dshp-action); border-color: transparent; color: var(--dshp-inverse); }
.dshp-settings .dshp-button-primary:hover:not(:disabled) { background: var(--dshp-hover); }
.dshp-settings .dshp-button-ghost { background: transparent; border-color: transparent; }
.dshp-settings .dshp-button:disabled { cursor: default; background: var(--dshp-disabled); border-color: transparent; color: var(--dshp-disabled-text); }
.dshp-settings .dshp-icon-button { width: 32px; min-height: 32px; padding: 8px; }
.dshp-icon { display: inline-block; flex: none; vertical-align: middle; }
.dshp-settings button:focus-visible, .dshp-settings select:focus-visible, .dshp-settings input:focus-visible { outline: 2px solid var(--dshp-focus); outline-offset: 2px; }
.dshp-sample { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 8px; background: var(--dshp-canvas); color: var(--dshp-muted); }
.dshp-sample > div { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--dshp-secondary); font-size: 12px; line-height: 18px; }
.dshp-sample > div > span:first-of-type { margin-right: 16px; }
.dshp-sample kbd { padding: 4px; border: 1px solid var(--dshp-border); border-radius: 4px; background: var(--dshp-surface); font: inherit; white-space: nowrap; }
.dshp-enable { display: flex; flex-direction: column; gap: 8px; }
.dshp-toggle { position: relative; display: inline-flex; width: 36px; height: 20px; flex: none; cursor: pointer; }
.dshp-toggle input { position: absolute; inset: 0; width: 36px; height: 20px; opacity: 0; margin: 0; cursor: inherit; }
.dshp-toggle:has(input:focus-visible) { outline: 2px solid var(--dshp-focus); outline-offset: 3px; border-radius: 999px; }
.dshp-toggle:has(input:disabled) { opacity: .45; cursor: default; }
.dshp-options { display: flex; flex-direction: column; gap: 16px; }
.dshp-option { display: grid; grid-template-columns: minmax(0, 1fr) 280px; align-items: center; gap: 16px; }
.dshp-segment { display: flex; gap: 4px; height: 40px; padding: 4px; border-radius: 8px; background: var(--dshp-canvas); }
.dshp-segment button { flex: 1; min-width: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dshp-secondary); font: inherit; font-weight: 500; cursor: pointer; }
.dshp-segment button[aria-pressed=true] { background: var(--dshp-surface); color: var(--dshp-ink); }
.dshp-segment button:hover:not(:disabled) { color: var(--dshp-ink); }
.dshp-segment button:disabled { color: var(--dshp-disabled-text); cursor: default; }
.dshp-settings select, .dshp-settings input[type=text], .dshp-input-wrap { width: 100%; min-width: 0; height: 40px; border: 1px solid var(--dshp-border); border-radius: 8px; background-color: var(--dshp-surface); color: var(--dshp-ink); font: inherit; }
.dshp-settings select { appearance: none; padding: 8px 36px 8px 12px; text-overflow: ellipsis; background-image: url('${icons.down}'); background-position: right 12px center; background-repeat: no-repeat; }
.dshp-settings select option { color: CanvasText; background: Canvas; }
.dshp-settings select:disabled, .dshp-settings input:disabled { color: var(--dshp-disabled-text); cursor: default; }
.dshp-settings select:hover:not(:disabled), .dshp-input-wrap:hover:not(:has(input:disabled)) { border-color: var(--dshp-muted); }
.dshp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.dshp-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; color: var(--dshp-secondary); font-size: 12px; line-height: 18px; }
.dshp-input-wrap { display: flex; align-items: center; gap: 8px; padding: 0 12px; }
.dshp-input-wrap input { flex: 1; width: 0; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 14px; appearance: textfield; }
.dshp-input-wrap input::-webkit-inner-spin-button, .dshp-input-wrap input::-webkit-outer-spin-button { appearance: none; margin: 0; }
.dshp-input-wrap:focus-within { outline: 2px solid var(--dshp-focus); outline-offset: 0; }
.dshp-input-wrap input:focus-visible { outline: none; }
.dshp-unit { flex: none; color: var(--dshp-secondary); font-size: 12px; line-height: 18px; white-space: nowrap; }
.dshp-settings input[type=text] { padding: 8px 12px; }
.dshp-settings .dshp-input-wrap > input { border: 0; padding: 0; background: transparent; }
.dshp-input-wrap[data-error=true], .dshp-settings input[aria-invalid=true] { border-color: var(--dshp-danger); }
.dshp-field-error { font-size: 12px; line-height: 18px; color: var(--dshp-danger); }
.dshp-usage-summary { gap: 16px; }
.dshp-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.dshp-metrics > div { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dshp-metrics strong { font-family: inherit; font-variant-numeric: tabular-nums; font-size: 26px; line-height: 34px; overflow-wrap: anywhere; }
.dshp-settings .dshp-more { justify-content: space-between; width: 100%; min-height: 48px; padding: 12px; }
.dshp-footer { align-items: center; justify-content: flex-end; }
.dshp-model-choice { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshp-model-choice select { flex: 1; width: 0; }
.dshp-custom-heading h2 { font-size: 18px; line-height: 28px; }
.dshp-custom-intro { display: flex; flex-direction: column; gap: 6px; }
.dshp-custom-subtitle { font-size: 14px; line-height: 22px; }
.dshp-custom .dshp-field > span:first-child { color: var(--dshp-ink); font-size: 14px; line-height: 22px; font-weight: 500; }
.dshp-secret input[type=text], .dshp-secret input[type=password] { width: 0; padding: 0; border: 0; border-radius: 0; font-size: 14px; }
.dshp-secret .dshp-button { min-height: 30px; padding: 4px 0 4px 8px; font-size: 12px; line-height: 18px; color: var(--dshp-secondary); }
.dshp-custom-test { display: flex; flex-direction: column; gap: 8px; }
.dshp-request-section { display: flex; flex-direction: column; gap: 8px; }
.dshp-request-title { margin: 0; color: var(--dshp-ink); font-size: 14px; line-height: 22px; font-weight: 500; }
.dshp-parameter { display: grid; grid-template-columns: minmax(0, 224fr) 96px minmax(0, 264fr) 32px; align-items: start; gap: 8px; }
.dshp-parameter-remove { margin-top: 4px; }
.dshp-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@container (max-width: 599px) {
  .dshp-parameter { grid-template-columns: 96px minmax(0, 1fr) 32px; }
  .dshp-parameter-key { grid-column: 1 / 3; grid-row: 1; }
  .dshp-parameter-remove { grid-column: 3; grid-row: 1; }
  .dshp-parameter-type { grid-column: 1; grid-row: 2; }
  .dshp-parameter-value { grid-column: 2 / 4; grid-row: 2; }
}
.dshp-custom-test-actions { display: flex; align-items: center; gap: 12px; }
.dshp-custom-test-actions > .dshp-button:first-child { min-width: 128px; }
.dshp-subhead h2 { font-size: 14px; line-height: 22px; }
.dshp-test { gap: 12px; }
.dshp-notice { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: 8px; background: var(--dshp-canvas); }
.dshp-notice > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshp-notice > img { margin-top: 3px; }
.dshp-tone-error { background: var(--dshp-danger-bg); }.dshp-tone-error strong { color: var(--dshp-danger); }
.dshp-tone-warning { background: var(--dshp-warning-bg); }.dshp-tone-warning strong { color: var(--dshp-warning); }
.dshp-tone-success { background: var(--dshp-success-bg); }.dshp-tone-success strong { color: var(--dshp-success); }
.dshp-settings .dshp-dialog { width: 600px; max-width: calc(100vw - 48px); max-height: calc(100dvh - 48px); margin: auto; padding: 32px; border: 0; border-radius: 12px; background: var(--dshp-surface); color: var(--dshp-ink); font: inherit; box-shadow: 0 8px 24px #0000001a; }
.dshp-dialog::backdrop { background: #00000026; }
.dshp-dialog h2 { font-size: 14px; line-height: 22px; }
.dshp-settings .dshp-dialog-compact { width: 420px; padding: 24px; }.dshp-dialog-compact h2 { font-size: 18px; line-height: 28px; }
.dshp-data { display: flex; flex-direction: column; gap: 24px; }
.dshp-data > div { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dshp-data dt { color: var(--dshp-secondary); }.dshp-data dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dshp-empty { display: flex; align-items: center; flex-direction: column; gap: 8px; padding: 24px; border-radius: 8px; background: var(--dshp-canvas); text-align: center; }
.dshp-skeleton { display: flex; flex-direction: column; gap: 16px; }.dshp-skeleton span, .dshp-skeleton-bar { display: block; width: 104px; height: 26px; border-radius: 4px; background: var(--dshp-disabled); }.dshp-skeleton span:last-child { width: 74px; height: 12px; }
@container (max-width: 599px) { .dshp-option { grid-template-columns: minmax(0, 1fr); gap: 8px; }.dshp-options { gap: 16px; }.dshp-grid { grid-template-columns: minmax(0, 1fr); gap: 24px; }.dshp-footer { flex-wrap: wrap; }.dshp-footer > .dshp-actions { margin-left: auto; }.dshp-test .dshp-actions > button { width: 100%; } }
@media (max-width: 640px) { .dshp-settings .dshp-dialog:not(.dshp-dialog-compact) { width: 100%; max-width: 100%; max-height: 100dvh; border-radius: 0; padding: 32px 16px; }.dshp-dialog-compact .dshp-actions { flex-wrap: nowrap; }.dshp-dialog-compact .dshp-button { min-width: 0; } }
@container (max-width: 599px) { .dshp-custom-footer > button { width: 100%; } }
/* 仅灰字展示使用定位；不改变宿主编辑器和布局。 */
.dshp-anchor { position: absolute; inset: 0; height: 0; pointer-events: none; }
.dshp-ghost { position: absolute; display: block; box-sizing: border-box; margin: 0;
  pointer-events: none; user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-composer-card]:has([data-dsh-prediction-active=true]) [data-composer-placeholder] { visibility: hidden; }
.dshp-prediction-status { display: inline-flex; position: relative; align-items: center; justify-content: center;
  flex: none; width: 28px; height: 28px; margin-inline-end: -4px; cursor: default; }
.dshp-prediction-status > img { display: block; flex: none; }
.dshp-prediction-status[data-dsh-prediction-status=loading] > img { animation: dshp-prediction-spin 1s linear infinite; }
.dshp-prediction-tooltip { display: flex; position: fixed; z-index: 1000; box-sizing: border-box; flex-direction: column;
  gap: 4px; height: 68px; padding: 12px; border: 1px solid light-dark(#e4e7ec, #393e48); border-radius: 8px;
  background: light-dark(#fff, #17191f); color: light-dark(#18181b, #f2f3f5); box-shadow: 0 8px 24px #0000001a;
  font-family: inherit; pointer-events: none; white-space: nowrap; }
.dshp-prediction-tooltip strong { font-size: 14px; font-weight: 500; line-height: 22px; }
.dshp-prediction-tooltip > span { color: light-dark(#62666d, #b5bac4); font-size: 12px; font-weight: 400; line-height: 18px; }
.dshp-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes dshp-prediction-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dshp-prediction-status > img { animation: none !important; } }
@media (prefers-color-scheme: dark) { .dshp-prediction-status > img { filter: brightness(1.5); } }
`
