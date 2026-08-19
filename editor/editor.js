/* SX3 Display Editor
 * ==================
 * Single-file, no-build, runs from any static host or even file:// — just
 * open index.html. The data model:
 *
 *   project = { frames: Frame[], selectedIdx: number }
 *   Frame   = { pixels: Uint8Array(180), duration: number }   // intensity 0..7
 *
 * Pixel layout in `pixels`: row-major, row r, col c at index r*9 + c.
 * That is the *logical* layout the editor uses; the export step rearranges
 * the data into the frame-interleaved container format described in
 * guide/README.md, section 4.
 */

(() => {
  'use strict';

  // 5x7 ASCII font, ASCII 0x20..0x7E. Each glyph: 5 column bytes,
  // bit 0 = top row, bit 6 = bottom row (bit 7 unused).
  const SX3_FONT5X7 = [
    [0x00,0x00,0x00,0x00,0x00], // ' '
    [0x00,0x00,0x2F,0x00,0x00], // '!'
    [0x00,0x03,0x00,0x03,0x00], // '"'
    [0x14,0x7F,0x14,0x7F,0x14], // '#'
    [0x24,0x2A,0x7F,0x2A,0x12], // '$'
    [0x23,0x13,0x08,0x64,0x62], // '%'
    [0x36,0x49,0x55,0x22,0x50], // '&'
    [0x00,0x00,0x03,0x00,0x00], // "'"
    [0x00,0x1C,0x22,0x41,0x00], // '('
    [0x00,0x41,0x22,0x1C,0x00], // ')'
    [0x14,0x08,0x3E,0x08,0x14], // '*'
    [0x08,0x08,0x3E,0x08,0x08], // '+'
    [0x00,0x00,0x30,0x70,0x00], // ','
    [0x08,0x08,0x08,0x08,0x08], // '-'
    [0x00,0x00,0x60,0x60,0x00], // '.'
    [0x20,0x10,0x08,0x04,0x02], // '/'
    [0x3E,0x51,0x49,0x45,0x3E], // '0'
    [0x00,0x42,0x7F,0x40,0x00], // '1'
    [0x42,0x61,0x51,0x49,0x46], // '2'
    [0x22,0x41,0x49,0x49,0x36], // '3'
    [0x18,0x14,0x12,0x7F,0x10], // '4'
    [0x27,0x45,0x45,0x45,0x39], // '5'
    [0x3C,0x4A,0x49,0x49,0x30], // '6'
    [0x01,0x71,0x09,0x05,0x03], // '7'
    [0x36,0x49,0x49,0x49,0x36], // '8'
    [0x06,0x49,0x49,0x29,0x1E], // '9'
    [0x00,0x00,0x36,0x36,0x00], // ':'
    [0x00,0x40,0x36,0x36,0x00], // ';'
    [0x08,0x14,0x22,0x41,0x00], // '<'
    [0x14,0x14,0x14,0x14,0x14], // '='
    [0x00,0x41,0x22,0x14,0x08], // '>'
    [0x02,0x01,0x51,0x09,0x06], // '?'
    [0x3E,0x41,0x5D,0x55,0x1E], // '@'
    [0x7E,0x11,0x11,0x11,0x7E], // 'A'
    [0x7F,0x49,0x49,0x49,0x36], // 'B'
    [0x3E,0x41,0x41,0x41,0x22], // 'C'
    [0x7F,0x41,0x41,0x41,0x3E], // 'D'
    [0x7F,0x49,0x49,0x49,0x41], // 'E'
    [0x7F,0x09,0x09,0x09,0x01], // 'F'
    [0x3E,0x41,0x41,0x49,0x7A], // 'G'
    [0x7F,0x08,0x08,0x08,0x7F], // 'H'
    [0x00,0x41,0x7F,0x41,0x00], // 'I'
    [0x20,0x40,0x40,0x40,0x3F], // 'J'
    [0x7F,0x08,0x14,0x22,0x41], // 'K'
    [0x7F,0x40,0x40,0x40,0x40], // 'L'
    [0x7F,0x02,0x0C,0x02,0x7F], // 'M'
    [0x7F,0x04,0x08,0x10,0x7F], // 'N'
    [0x3E,0x41,0x41,0x41,0x3E], // 'O'
    [0x7F,0x09,0x09,0x09,0x06], // 'P'
    [0x3E,0x41,0x51,0x21,0x5E], // 'Q'
    [0x7F,0x09,0x19,0x29,0x46], // 'R'
    [0x46,0x49,0x49,0x49,0x31], // 'S'
    [0x01,0x01,0x7F,0x01,0x01], // 'T'
    [0x3F,0x40,0x40,0x40,0x3F], // 'U'
    [0x1F,0x20,0x40,0x20,0x1F], // 'V'
    [0x7F,0x20,0x18,0x20,0x7F], // 'W'
    [0x63,0x14,0x08,0x14,0x63], // 'X'
    [0x07,0x08,0x70,0x08,0x07], // 'Y'
    [0x61,0x51,0x49,0x45,0x43], // 'Z'
    [0x00,0x7F,0x41,0x41,0x00], // '['
    [0x02,0x04,0x08,0x10,0x20], // '\\'
    [0x00,0x41,0x41,0x7F,0x00], // ']'
    [0x04,0x02,0x01,0x02,0x04], // '^'
    [0x40,0x40,0x40,0x40,0x40], // '_'
    [0x00,0x01,0x02,0x00,0x00], // '`'
    [0x20,0x54,0x54,0x54,0x78], // 'a'
    [0x7F,0x48,0x44,0x44,0x38], // 'b'
    [0x38,0x44,0x44,0x44,0x28], // 'c'
    [0x38,0x44,0x44,0x48,0x7F], // 'd'
    [0x38,0x54,0x54,0x54,0x18], // 'e'
    [0x08,0x7E,0x09,0x01,0x02], // 'f'
    [0x08,0x54,0x54,0x54,0x3C], // 'g'
    [0x7F,0x08,0x04,0x04,0x78], // 'h'
    [0x00,0x00,0x7D,0x00,0x00], // 'i'
    [0x20,0x40,0x40,0x3D,0x00], // 'j'
    [0x7F,0x10,0x28,0x44,0x00], // 'k'
    [0x00,0x41,0x7F,0x40,0x00], // 'l'
    [0x7C,0x04,0x38,0x04,0x78], // 'm'
    [0x7C,0x08,0x04,0x04,0x78], // 'n'
    [0x38,0x44,0x44,0x44,0x38], // 'o'
    [0x7C,0x14,0x14,0x14,0x08], // 'p'
    [0x08,0x14,0x14,0x1C,0x7C], // 'q'
    [0x7C,0x08,0x04,0x04,0x08], // 'r'
    [0x48,0x54,0x54,0x54,0x24], // 's'
    [0x04,0x3F,0x44,0x40,0x20], // 't'
    [0x3C,0x40,0x40,0x20,0x7C], // 'u'
    [0x1C,0x20,0x40,0x20,0x1C], // 'v'
    [0x3C,0x40,0x30,0x40,0x3C], // 'w'
    [0x44,0x28,0x10,0x28,0x44], // 'x'
    [0x0C,0x50,0x50,0x50,0x3C], // 'y'
    [0x44,0x64,0x54,0x4C,0x44], // 'z'
    [0x00,0x08,0x36,0x41,0x41], // '{'
    [0x00,0x00,0x7F,0x00,0x00], // '|'
    [0x41,0x41,0x36,0x08,0x00], // '}'
    [0x02,0x01,0x02,0x04,0x02], // '~'
  ];
  const SX3_FONT_FIRST = 0x20;
  const SX3_FONT_LAST  = 0x7E;
  const SX3_FONT_W = 5, SX3_FONT_H = 7;

  // 3x5 compact ASCII font (0x20..0x7E). 3 column bytes per glyph, bit 0 = top.
  // Lowercase aliases to uppercase.
  const SX3_FONT3X5 = [
    [0x00,0x00,0x00], // ' '
    [0x00,0x17,0x00], // '!'
    [0x03,0x00,0x03], // '"'
    [0x1F,0x0A,0x1F], // '#'
    [0x12,0x15,0x09], // '$'
    [0x19,0x04,0x13], // '%'
    [0x0A,0x15,0x1A], // '&'
    [0x00,0x03,0x00], // "'"
    [0x00,0x0E,0x11], // '('
    [0x11,0x0E,0x00], // ')'
    [0x0A,0x04,0x0A], // '*'
    [0x04,0x0E,0x04], // '+'
    [0x10,0x08,0x00], // ','
    [0x04,0x04,0x04], // '-'
    [0x00,0x10,0x00], // '.'
    [0x18,0x04,0x03], // '/'
    [0x1F,0x11,0x1F], // '0'
    [0x12,0x1F,0x10], // '1'
    [0x1D,0x15,0x17], // '2'
    [0x11,0x15,0x1F], // '3'
    [0x07,0x04,0x1F], // '4'
    [0x17,0x15,0x1D], // '5'
    [0x1F,0x15,0x1D], // '6'
    [0x01,0x01,0x1F], // '7'
    [0x1F,0x15,0x1F], // '8'
    [0x17,0x15,0x1F], // '9'
    [0x00,0x0A,0x00], // ':'
    [0x10,0x0A,0x00], // ';'
    [0x04,0x0A,0x11], // '<'
    [0x0A,0x0A,0x0A], // '='
    [0x11,0x0A,0x04], // '>'
    [0x01,0x15,0x03], // '?'
    [0x0E,0x15,0x16], // '@'
    [0x1E,0x05,0x1E], // 'A'
    [0x1F,0x15,0x0A], // 'B'
    [0x0E,0x11,0x11], // 'C'
    [0x1F,0x11,0x0E], // 'D'
    [0x1F,0x15,0x11], // 'E'
    [0x1F,0x05,0x01], // 'F'
    [0x0E,0x11,0x1D], // 'G'
    [0x1F,0x04,0x1F], // 'H'
    [0x11,0x1F,0x11], // 'I'
    [0x08,0x10,0x0F], // 'J'
    [0x1F,0x04,0x1B], // 'K'
    [0x1F,0x10,0x10], // 'L'
    [0x1F,0x06,0x1F], // 'M'
    [0x1F,0x0E,0x1F], // 'N'
    [0x0E,0x11,0x0E], // 'O'
    [0x1F,0x05,0x02], // 'P'
    [0x0E,0x19,0x16], // 'Q'
    [0x1F,0x05,0x1A], // 'R'
    [0x12,0x15,0x09], // 'S'
    [0x01,0x1F,0x01], // 'T'
    [0x1F,0x10,0x1F], // 'U'
    [0x0F,0x10,0x0F], // 'V'
    [0x1F,0x0C,0x1F], // 'W'
    [0x1B,0x04,0x1B], // 'X'
    [0x03,0x1C,0x03], // 'Y'
    [0x19,0x15,0x13], // 'Z'
    [0x1F,0x11,0x00], // '['
    [0x03,0x04,0x18], // '\\'
    [0x00,0x11,0x1F], // ']'
    [0x02,0x01,0x02], // '^'
    [0x10,0x10,0x10], // '_'
    [0x01,0x02,0x00], // '`'
    [0x1E,0x05,0x1E], // 'a'
    [0x1F,0x15,0x0A], // 'b'
    [0x0E,0x11,0x11], // 'c'
    [0x1F,0x11,0x0E], // 'd'
    [0x1F,0x15,0x11], // 'e'
    [0x1F,0x05,0x01], // 'f'
    [0x0E,0x11,0x1D], // 'g'
    [0x1F,0x04,0x1F], // 'h'
    [0x11,0x1F,0x11], // 'i'
    [0x08,0x10,0x0F], // 'j'
    [0x1F,0x04,0x1B], // 'k'
    [0x1F,0x10,0x10], // 'l'
    [0x1F,0x06,0x1F], // 'm'
    [0x1F,0x0E,0x1F], // 'n'
    [0x0E,0x11,0x0E], // 'o'
    [0x1F,0x05,0x02], // 'p'
    [0x0E,0x19,0x16], // 'q'
    [0x1F,0x05,0x1A], // 'r'
    [0x12,0x15,0x09], // 's'
    [0x01,0x1F,0x01], // 't'
    [0x1F,0x10,0x1F], // 'u'
    [0x0F,0x10,0x0F], // 'v'
    [0x1F,0x0C,0x1F], // 'w'
    [0x1B,0x04,0x1B], // 'x'
    [0x03,0x1C,0x03], // 'y'
    [0x19,0x15,0x13], // 'z'
    [0x04,0x1F,0x11], // '{'
    [0x00,0x1F,0x00], // '|'
    [0x11,0x1F,0x04], // '}'
    [0x02,0x04,0x02], // '~'
  ];
  const SX3_FONT3X5_FIRST = 0x20;
  const SX3_FONT3X5_LAST  = 0x7E;
  const SX3_FONT3X5_W = 3, SX3_FONT3X5_H = 5;

  const ROWS = 20, COLS = 9, PIXELS_PER_FRAME = ROWS * COLS;
  const LUT = [0x00, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0xFF];
  const STORAGE_KEY = 'sx3-editor-project-v1';

  // Physically absent LEDs (rounded corners). NOT point-symmetric — only the
  // topmost row has the extreme 3-LED notch (this is where the BLE indicator
  // sits in the firmware). The bottom edge is gently rounded but full width.
  //   R0          : only C3, C4, C5 exist  (C0,C1,C2,C6,C7,C8 absent)
  //   R1, R2      : C0 and C8 absent
  //   R18, R19    : C0 and C8 absent
  const ABSENT = new Set();
  // R0: extreme notch
  [0, 1, 2, 6, 7, 8].forEach(c => ABSENT.add(0 * 9 + c));
  // R1, R2, R18, R19: only the outer columns missing
  [1, 2, 18, 19].forEach(r => {
    ABSENT.add(r * 9 + 0);
    ABSENT.add(r * 9 + 8);
  });

  // ------------------------------------------------------------------ state
  const state = {
    project: makeEmptyProject(),
    activeBrightness: 7,
    mouseDown: false,
    paintValue: null,         // value currently being painted (for drag)
    playTimer: null,
    playingIdx: 0,
    onionSkin: false,
    clipboardFrame: null,
  };

  function makeEmptyProject() {
    return {
      frames: [ makeEmptyFrame() ],
      selectedIdx: 0,
    };
  }
  function makeEmptyFrame(duration = 100) {
    return { pixels: new Uint8Array(PIXELS_PER_FRAME), duration };
  }
  function currentFrame() { return state.project.frames[state.project.selectedIdx]; }

  // ----------------------------------------------------------- DOM shortcuts
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const gridEl    = $('#grid');
  const previewEl = $('#preview');
  const paletteEl = $('#palette');
  const frameListEl = $('#frame-list');
  const previewMeta = $('#preview-meta');
  const boundsInfo  = $('#bounds-info');
  const durInput    = $('#dur-input');

  // ------------------------------------------------------- toast & modal
  function toast(msg, isErr=false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', isErr);
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>t.classList.remove('show'), 2400);
  }
  function showModal(title, html) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal-bg').classList.add('show');
  }
  window.closeModal = () => $('#modal-bg').classList.remove('show');
  $('#modal-bg').addEventListener('click', e => {
    if (e.target === $('#modal-bg')) closeModal();
  });

  // =====================================================================
  // RENDERING
  // =====================================================================
  function intensityToCss(i) {
    if (i <= 0) return 'transparent';
    // amber glow, opacity scales with intensity
    const a = 0.18 + (i / 7) * 0.78;
    return `rgba(240, 181, 66, ${a.toFixed(3)})`;
  }
  function intensityToShadow(i) {
    if (i <= 0) return 'none';
    const blur = 2 + i * 1.5;
    return `0 0 ${blur}px rgba(240, 181, 66, ${(0.18 + i*0.06).toFixed(2)})`;
  }

  // Build the edit grid (20*9 cells) once. Re-render only updates colours.
  function buildGrid() {
    gridEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r*9 + c;
        const cell = document.createElement('div');
        cell.className = 'cell' + (ABSENT.has(idx) ? ' absent' : '');
        cell.dataset.idx = idx;
        const lbl = document.createElement('span');
        lbl.className = 'lbl';
        cell.appendChild(lbl);
        gridEl.appendChild(cell);
      }
    }
  }
  function buildPreview() {
    previewEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r*9 + c;
        const d = document.createElement('div');
        d.className = 'pdot' + (ABSENT.has(idx) ? ' absent' : '');
        d.dataset.idx = idx;
        previewEl.appendChild(d);
      }
    }
  }
  function buildPalette() {
    paletteEl.innerHTML = '';
    for (let i = 0; i <= 7; i++) {
      const b = document.createElement('button');
      b.dataset.val = i;
      b.style.background = i === 0 ? 'var(--bg-elev2)' : intensityToCss(i);
      b.style.boxShadow = intensityToShadow(i);
      b.textContent = i;
      if (i === state.activeBrightness) b.classList.add('active');
      b.addEventListener('click', () => setBrightness(i));
      paletteEl.appendChild(b);
    }
  }
  function setBrightness(i) {
    state.activeBrightness = i;
    $$('#palette button').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.val) === i);
    });
  }

  function renderGrid() {
    const f = currentFrame();
    const onion = state.onionSkin && state.project.selectedIdx > 0
      ? state.project.frames[state.project.selectedIdx - 1].pixels
      : null;
    const cells = gridEl.children;
    for (let i = 0; i < PIXELS_PER_FRAME; i++) {
      const cell = cells[i];
      const v = f.pixels[i];
      const lit = v > 0;
      cell.classList.toggle('lit', lit);
      cell.style.background = lit ? intensityToCss(v) : 'transparent';
      cell.style.boxShadow  = lit ? intensityToShadow(v) : 'none';
      cell.querySelector('.lbl').textContent = lit ? String(v) : '';
      // onion ghost
      if (onion && !lit && onion[i] > 0) {
        cell.style.background = 'rgba(120, 80, 30, 0.18)';
      }
    }
  }
  function renderPreview(frameOverride=null) {
    const f = frameOverride || currentFrame();
    const dots = previewEl.children;
    for (let i = 0; i < PIXELS_PER_FRAME; i++) {
      const v = f.pixels[i];
      const dot = dots[i];
      if (v > 0) {
        dot.style.background = intensityToCss(v);
        dot.style.boxShadow  = intensityToShadow(v);
      } else {
        dot.style.background = ABSENT.has(i) ? '#0c1015' : '#11161e';
        dot.style.boxShadow  = 'none';
      }
    }
  }
  function renderFrameList() {
    frameListEl.innerHTML = '';
    state.project.frames.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'frame-item'
        + (idx === state.project.selectedIdx ? ' selected' : '')
        + (f.sel ? ' marked' : '');
      item.dataset.idx = idx;

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'frame-check';
      chk.checked = !!f.sel;
      chk.title = 'Mark this frame. Shift-click to select a range from the last clicked one.';
      // Single click handler covers both a normal toggle and shift-click range
      // selection (extends from the last-clicked checkbox to this one).
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = chk.checked;   // state after this click
        if (e.shiftKey && state.lastCheckedFrame != null) {
          const a = Math.min(state.lastCheckedFrame, idx);
          const b = Math.max(state.lastCheckedFrame, idx);
          for (let k = a; k <= b; k++) state.project.frames[k].sel = target;
          renderFrameList();
        } else {
          f.sel = target;
          item.classList.toggle('marked', f.sel);
          updateSelCount();
        }
        state.lastCheckedFrame = idx;
      });

      const thumb = document.createElement('div');
      thumb.className = 'frame-thumb';
      for (let i = 0; i < PIXELS_PER_FRAME; i++) {
        const d = document.createElement('div');
        d.className = 'tdot';
        const v = f.pixels[i];
        if (v > 0) d.style.background = intensityToCss(v);
        thumb.appendChild(d);
      }
      const meta = document.createElement('div');
      meta.className = 'frame-meta';
      meta.innerHTML = `<b>Frame ${idx+1}</b>${f.duration} ms`;
      item.append(chk, thumb, meta);
      item.addEventListener('click', () => selectFrame(idx));
      frameListEl.appendChild(item);
    });
    updateSelCount();
  }

  // Update the "N selected" indicator, the Reverse button's visibility/label
  // and the Delete button's tooltip from the per-frame `sel` flags.
  function updateSelCount() {
    const idxs = selectedIndices();
    const n = idxs.length;
    const cnt = document.getElementById('sel-count');
    if (cnt) cnt.textContent = `${n} selected`;

    const revBtn = document.getElementById('btn-frame-reverse');
    if (revBtn) {
      const contiguous = isContiguous(idxs);
      // Visible when nothing is selected (reverse all) or the selection is a
      // single unbroken run (reverse that block). Hidden otherwise.
      revBtn.style.display = (n === 0 || contiguous) ? '' : 'none';
      revBtn.textContent = n >= 2 ? '⇅ Reverse sel.' : '⇅ Reverse';
      revBtn.title = n >= 2
        ? 'Reverse the selected block of frames'
        : 'Reverse the order of all frames';
    }
    const delBtn = document.getElementById('btn-frame-del');
    if (delBtn) {
      delBtn.title = n ? `Delete the ${n} checked frame(s)` : 'Delete the current frame';
    }
  }
  function renderBoundsInfo() {
    const b = computeBounds();
    if (!b.any) {
      boundsInfo.textContent = 'empty';
    } else {
      boundsInfo.innerHTML =
        `start_row = <b>${b.minRow}</b><br>` +
        `graphic_rows = <b>${b.maxRow - b.minRow + 1}</b><br>` +
        `num_frames = <b>${state.project.frames.length}</b>`;
    }
    previewMeta.textContent =
      `frame ${state.project.selectedIdx+1} / ${state.project.frames.length}`;
  }

  function renderAll() {
    renderGrid();
    renderPreview();
    renderFrameList();
    renderBoundsInfo();
    durInput.value = currentFrame().duration;
    autoSave();
  }

  // =====================================================================
  // EDITING
  // =====================================================================
  function setPixel(idx, value) {
    const f = currentFrame();
    if (f.pixels[idx] === value) return;
    f.pixels[idx] = value;
    // partial update — fast path, don't re-render the whole grid
    const cell = gridEl.children[idx];
    const lit = value > 0;
    cell.classList.toggle('lit', lit);
    cell.style.background = lit ? intensityToCss(value) : 'transparent';
    cell.style.boxShadow  = lit ? intensityToShadow(value) : 'none';
    cell.querySelector('.lbl').textContent = lit ? String(value) : '';
    // preview & thumb update can be coalesced via rAF
    queueLightUpdate();
  }

  let lightFrame = null;
  function queueLightUpdate() {
    if (lightFrame) return;
    lightFrame = requestAnimationFrame(() => {
      lightFrame = null;
      renderPreview();
      // update only the active thumb
      const idx = state.project.selectedIdx;
      const item = frameListEl.children[idx];
      if (item) {
        const dots = item.querySelector('.frame-thumb').children;
        const f = currentFrame();
        for (let i = 0; i < PIXELS_PER_FRAME; i++) {
          dots[i].style.background = f.pixels[i] > 0 ? intensityToCss(f.pixels[i]) : '';
        }
      }
      renderBoundsInfo();
      autoSave();
    });
  }

  // pointer paint handling
  gridEl.addEventListener('mousedown', e => {
    if (!e.target.classList.contains('cell') && !e.target.classList.contains('lbl')) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    e.preventDefault();
    const idx = Number(cell.dataset.idx);
    if (e.button === 2) {
      state.paintValue = 0;
    } else {
      // if cell already has the active brightness, toggle off; else paint active
      const cur = currentFrame().pixels[idx];
      state.paintValue = (cur === state.activeBrightness) ? 0 : state.activeBrightness;
    }
    state.mouseDown = true;
    setPixel(idx, state.paintValue);
  });
  gridEl.addEventListener('mousemove', e => {
    if (!state.mouseDown) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    setPixel(Number(cell.dataset.idx), state.paintValue);
  });
  window.addEventListener('mouseup', () => { state.mouseDown = false; state.paintValue = null; });
  gridEl.addEventListener('contextmenu', e => e.preventDefault());

  // =====================================================================
  // FRAME OPERATIONS
  // =====================================================================
  function selectFrame(idx) {
    if (idx < 0 || idx >= state.project.frames.length) return;
    state.project.selectedIdx = idx;
    renderAll();
  }
  function addFrame() {
    const f = makeEmptyFrame(currentFrame().duration);
    state.project.frames.splice(state.project.selectedIdx + 1, 0, f);
    state.project.selectedIdx += 1;
    renderAll();
  }
  function dupFrame() {
    const f = currentFrame();
    const copy = { pixels: new Uint8Array(f.pixels), duration: f.duration };
    state.project.frames.splice(state.project.selectedIdx + 1, 0, copy);
    state.project.selectedIdx += 1;
    renderAll();
  }
  // Indices of the checkbox-marked frames, in order.
  function selectedIndices() {
    const idxs = [];
    state.project.frames.forEach((f, i) => { if (f.sel) idxs.push(i); });
    return idxs;
  }
  // True if the given sorted index list is a single unbroken run (or ≤1 item).
  function isContiguous(idxs) {
    for (let k = 1; k < idxs.length; k++) {
      if (idxs[k] !== idxs[k - 1] + 1) return false;
    }
    return true;
  }

  function delFrame() {
    const marked = selectedIndices();
    // If frames are checked, delete those; otherwise delete the current one.
    if (marked.length) {
      if (marked.length >= state.project.frames.length) {
        // Deleting everything isn't allowed — keep one cleared frame instead.
        state.project.frames = [makeEmptyFrame()];
        state.project.selectedIdx = 0;
        renderAll();
        toast("Can't delete all frames — cleared instead", true);
        return;
      }
      const firstIdx = marked[0];
      state.project.frames = state.project.frames.filter(f => !f.sel);
      state.project.selectedIdx = Math.max(0, Math.min(firstIdx, state.project.frames.length - 1));
      renderAll();
      toast(`Deleted ${marked.length} frame(s)`);
      return;
    }
    if (state.project.frames.length <= 1) {
      currentFrame().pixels.fill(0);
      renderAll();
      return;
    }
    state.project.frames.splice(state.project.selectedIdx, 1);
    if (state.project.selectedIdx >= state.project.frames.length) {
      state.project.selectedIdx = state.project.frames.length - 1;
    }
    renderAll();
  }
  function moveFrame(delta) {
    const i = state.project.selectedIdx, j = i + delta;
    if (j < 0 || j >= state.project.frames.length) return;
    const fs = state.project.frames;
    [fs[i], fs[j]] = [fs[j], fs[i]];
    state.project.selectedIdx = j;
    renderAll();
  }
  // Reverse the whole project when nothing is checked, or a contiguous checked
  // block when one is selected. (The button is hidden for non-contiguous
  // selections, but guard here too.)
  function reverseFrames() {
    const fs = state.project.frames;
    const idxs = selectedIndices();
    if (idxs.length === 0) {
      if (fs.length < 2) return;
      fs.reverse();
      state.project.selectedIdx = fs.length - 1 - state.project.selectedIdx;
      renderAll();
      toast('Reversed all frames');
      return;
    }
    if (!isContiguous(idxs)) {
      toast('Select a contiguous block to reverse', true);
      return;
    }
    const a = idxs[0], b = idxs[idxs.length - 1];
    if (b > a) {
      const block = fs.slice(a, b + 1).reverse();
      for (let k = 0; k < block.length; k++) fs[a + k] = block[k];
    }
    renderAll();
    toast(`Reversed ${idxs.length} selected frame(s)`);
  }

  // ---- tools ----
  function clearFrame() { currentFrame().pixels.fill(0); renderAll(); }
  function fillFrame()  { currentFrame().pixels.fill(state.activeBrightness); renderAll(); }
  function invertFrame() {
    const p = currentFrame().pixels;
    for (let i = 0; i < p.length; i++) p[i] = 7 - p[i];
    renderAll();
  }
  function shiftFrame(dr, dc) {
    const src = currentFrame().pixels;
    const dst = new Uint8Array(PIXELS_PER_FRAME);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const sr = r - dr, sc = c - dc;
      if (sr >= 0 && sr < ROWS && sc >= 0 && sc < COLS) dst[r*9+c] = src[sr*9+sc];
    }
    currentFrame().pixels = dst;
    renderAll();
  }
  function flipH() {
    const p = currentFrame().pixels;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < 4; c++) {
        const a = r*9 + c, b = r*9 + (8 - c);
        [p[a], p[b]] = [p[b], p[a]];
      }
    }
    renderAll();
  }
  function flipV() {
    const p = currentFrame().pixels;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r*9 + c, b = (19-r)*9 + c;
        [p[a], p[b]] = [p[b], p[a]];
      }
    }
    renderAll();
  }
  function copyFrame() {
    const f = currentFrame();
    state.clipboardFrame = { pixels: new Uint8Array(f.pixels), duration: f.duration };
    toast('Frame copied');
  }
  function pasteFrame() {
    if (!state.clipboardFrame) { toast('Nothing to paste', true); return; }
    const f = currentFrame();
    f.pixels = new Uint8Array(state.clipboardFrame.pixels);
    renderAll();
  }

  // =====================================================================
  // PLAYBACK
  // =====================================================================
  function playPause() {
    if (state.playTimer) {
      stopPlay();
    } else {
      startPlay();
    }
  }
  function startPlay() {
    if (state.project.frames.length <= 1) { toast('Need at least 2 frames'); return; }
    state.playingIdx = 0;
    $('#btn-play').textContent = '■ Stop';
    tickPlay();
  }
  function stopPlay() {
    clearTimeout(state.playTimer);
    state.playTimer = null;
    $('#btn-play').textContent = '▶ Play';
    renderPreview();   // back to selected frame
  }
  function tickPlay() {
    const f = state.project.frames[state.playingIdx];
    renderPreview(f);
    previewMeta.textContent =
      `▶ frame ${state.playingIdx+1} / ${state.project.frames.length}  (${f.duration} ms)`;
    state.playTimer = setTimeout(() => {
      state.playingIdx = (state.playingIdx + 1) % state.project.frames.length;
      tickPlay();
    }, Math.max(20, f.duration));
  }

  // =====================================================================
  // BOUNDS COMPUTATION (auto-fit start_row / graphic_rows)
  // =====================================================================
  function computeBounds() {
    let minRow = ROWS, maxRow = -1, minCol = COLS, maxCol = -1;
    let any = false;
    for (const f of state.project.frames) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (f.pixels[r*9+c] > 0) {
          any = true;
          if (r < minRow) minRow = r;
          if (r > maxRow) maxRow = r;
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
        }
      }
    }
    if (!any) return { any: false, minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 };
    return { any: true, minRow, maxRow, minCol, maxCol };
  }

  // =====================================================================
  // EXPORT — SX3 image container (frame-interleaved)
  // =====================================================================
  function exportContainer() {
    const b = computeBounds();
    const start_row = b.any ? b.minRow : 0;
    const graphic_rows = b.any ? (b.maxRow - b.minRow + 1) : 1;
    const num_frames = state.project.frames.length;

    // total words = 3 (header) + num_frames (timing) + num_frames * graphic_rows (pixels)
    const totalWords = 3 + num_frames + num_frames * graphic_rows;
    const buf = new ArrayBuffer(totalWords * 4);
    const dv = new DataView(buf);

    // header (little-endian)
    dv.setUint32(0,  start_row,    true);
    dv.setUint32(4,  graphic_rows, true);
    dv.setUint32(8,  num_frames,   true);

    // timing
    for (let f = 0; f < num_frames; f++) {
      dv.setUint32(12 + f*4, state.project.frames[f].duration, true);
    }

    // pixels: frame-interleaved
    // pixelWord(relRow, frame) = num_frames*relRow + frame + num_frames + 3
    for (let rel = 0; rel < graphic_rows; rel++) {
      const absRow = start_row + rel;
      for (let f = 0; f < num_frames; f++) {
        const px = state.project.frames[f].pixels;
        let word = 0;
        for (let c = 0; c < COLS; c++) {
          const inten = px[absRow*9 + c] & 0x7;
          // col 0 = bits 26..24, col 8 = bits 2..0
          word |= (inten << (24 - 3*c)) >>> 0;
        }
        const wordIdx = num_frames * rel + f + num_frames + 3;
        dv.setUint32(wordIdx * 4, word >>> 0, true);
      }
    }

    return new Uint8Array(buf);
  }

  function bytesToHex(bytes, perLine=16) {
    const out = [];
    for (let i = 0; i < bytes.length; i += perLine) {
      const chunk = Array.from(bytes.slice(i, i + perLine))
        .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(' ');
      out.push(chunk);
    }
    return out.join('\n');
  }
  function bytesToCArray(bytes, name='myImage') {
    const lines = [];
    lines.push(`const uint8_t SX3IMG_${name}[] PROGMEM = {`);
    for (let i = 0; i < bytes.length; i += 12) {
      const chunk = Array.from(bytes.slice(i, i + 12))
        .map(b => '0x' + b.toString(16).toUpperCase().padStart(2,'0'))
        .join(', ');
      lines.push('  ' + chunk + ',');
    }
    lines.push('};');
    return lines.join('\n');
  }

  // =====================================================================
  // IMPORT — parse hex / paste content into project frames
  // =====================================================================
  function parseHexInput(text) {
    // Accept space-, comma- or newline-separated hex bytes, with or
    // without 0x prefix. Also accept "0xAB, 0xCD"-style C arrays.
    const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */
                        .replace(/\/\/.*$/mg, '')           // // ...
                        .replace(/[{};]/g, ' ')
                        .replace(/0x/gi, ' ')
                        .replace(/,/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const bytes = [];
    for (const t of tokens) {
      if (!/^[0-9A-Fa-f]{1,2}$/.test(t)) continue;
      bytes.push(parseInt(t, 16));
    }
    return new Uint8Array(bytes);
  }
  function bytesToProject(bytes) {
    if (bytes.length < 16) throw new Error('Too short for a valid image');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start_row = dv.getUint32(0, true);
    const graphic_rows = dv.getUint32(4, true);
    const num_frames = dv.getUint32(8, true);

    if (start_row + graphic_rows > ROWS || num_frames < 1 || num_frames > 1000) {
      throw new Error('Invalid header: rows or frames out of range');
    }
    const expected = 4 * (3 + num_frames + num_frames * graphic_rows);
    if (bytes.length < expected) {
      throw new Error(`Expected at least ${expected} bytes for ${num_frames}f×${graphic_rows}r, got ${bytes.length}`);
    }

    const frames = [];
    for (let f = 0; f < num_frames; f++) {
      const duration = dv.getUint32(12 + f*4, true) || 50;
      const pixels = new Uint8Array(PIXELS_PER_FRAME);
      for (let rel = 0; rel < graphic_rows; rel++) {
        const wordIdx = num_frames * rel + f + num_frames + 3;
        const word = dv.getUint32(wordIdx * 4, true);
        const absRow = start_row + rel;
        for (let c = 0; c < COLS; c++) {
          const inten = (word >>> (24 - 3*c)) & 0x7;
          pixels[absRow*9 + c] = inten;
        }
      }
      frames.push({ pixels, duration });
    }
    return { frames, selectedIdx: 0 };
  }

  // =====================================================================
  // PNG / GIF IMPORT
  // =====================================================================
  async function importImageFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'gif' || file.type === 'image/gif') {
      return importGifFile(file);
    }
    // PNG/JPG: single image
    const img = await loadImage(file);
    showImportDialog([{ bitmap: img, delay: 200 }]);
  }

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      // do NOT revoke yet — we still need to draw it later. Revoke in showImportDialog after use.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  // Inline GIF decoder. Compact implementation tailored to "extract every
  // frame as a fully-composed ImageData of canvas size". Handles LZW
  // decompression, disposal methods 1/2/3, transparency.
  async function importGifFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let frames;
    try { frames = decodeGif(buf); }
    catch (e) { toast('GIF decode failed: ' + e.message, true); console.error(e); return; }
    if (!frames.length) { toast('No frames in GIF', true); return; }
    showImportDialog(frames);
  }

  function decodeGif(buf) {
    // Minimal GIF89a parser. Returns array of {bitmap: ImageBitmap-like (canvas), delay: ms}.
    let p = 0;
    if (String.fromCharCode(...buf.slice(0,3)) !== 'GIF') throw new Error('not a GIF');
    p = 6;
    const W = buf[p] | (buf[p+1] << 8); p += 2;
    const H = buf[p] | (buf[p+1] << 8); p += 2;
    const packed = buf[p++]; const bgIdx = buf[p++]; p++;
    let gct = null;
    if (packed & 0x80) {
      const n = 1 << ((packed & 7) + 1);
      gct = buf.subarray(p, p + n*3); p += n*3;
    }
    const frames = [];
    // Composed canvas across frames (for disposal handling)
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    let prevImage = null;   // for disposal = 3 (restore to previous)
    let gce = null;         // active graphic control extension

    while (p < buf.length) {
      const b = buf[p++];
      if (b === 0x3B) break;                          // trailer
      if (b === 0x21) {                                // extension
        const label = buf[p++];
        if (label === 0xF9) {
          // graphic control extension: 4 bytes + terminator
          const size = buf[p++];
          const flags = buf[p];
          const delay = buf[p+1] | (buf[p+2] << 8);
          const transIdx = buf[p+3];
          p += size; p++;   // skip block terminator
          gce = {
            disposal: (flags >> 2) & 0x07,
            transparent: !!(flags & 1),
            transIdx,
            delayMs: delay * 10 || 100,
          };
        } else {
          // skip sub-blocks
          while (p < buf.length) {
            const sz = buf[p++];
            if (sz === 0) break;
            p += sz;
          }
        }
      } else if (b === 0x2C) {                         // image descriptor
        const left = buf[p] | (buf[p+1] << 8); p += 2;
        const top  = buf[p] | (buf[p+1] << 8); p += 2;
        const iw   = buf[p] | (buf[p+1] << 8); p += 2;
        const ih   = buf[p] | (buf[p+1] << 8); p += 2;
        const ipack = buf[p++];
        let lct = null;
        if (ipack & 0x80) {
          const n = 1 << ((ipack & 7) + 1);
          lct = buf.subarray(p, p + n*3); p += n*3;
        }
        const interlaced = !!(ipack & 0x40);
        const lzwMin = buf[p++];
        // gather sub-blocks
        const sub = [];
        while (true) {
          const sz = buf[p++];
          if (sz === 0) break;
          sub.push(buf.subarray(p, p + sz));
          p += sz;
        }
        const compressed = concat(sub);
        const indices = lzwDecode(lzwMin, compressed, iw * ih);
        if (interlaced) deinterlace(indices, iw, ih);
        const palette = lct || gct;
        // backup current canvas for disposal=3
        const backup = ctx.getImageData(0, 0, W, H);
        // draw frame
        const imgd = ctx.getImageData(0, 0, W, H);
        const data = imgd.data;
        for (let y = 0; y < ih; y++) {
          for (let x = 0; x < iw; x++) {
            const ix = indices[y*iw + x];
            if (gce && gce.transparent && ix === gce.transIdx) continue;
            const dst = ((top + y) * W + (left + x)) * 4;
            data[dst]   = palette[ix*3];
            data[dst+1] = palette[ix*3+1];
            data[dst+2] = palette[ix*3+2];
            data[dst+3] = 255;
          }
        }
        ctx.putImageData(imgd, 0, 0);
        // capture composed frame
        const snap = document.createElement('canvas');
        snap.width = W; snap.height = H;
        snap.getContext('2d').drawImage(canvas, 0, 0);
        frames.push({ bitmap: snap, delay: gce ? gce.delayMs : 100 });
        // disposal
        if (gce) {
          if (gce.disposal === 2) {
            const clr = ctx.getImageData(0, 0, W, H);
            for (let y = top; y < top+ih; y++) {
              for (let x = left; x < left+iw; x++) {
                const i = (y*W + x) * 4;
                clr.data[i] = clr.data[i+1] = clr.data[i+2] = clr.data[i+3] = 0;
              }
            }
            ctx.putImageData(clr, 0, 0);
          } else if (gce.disposal === 3) {
            ctx.putImageData(backup, 0, 0);
          }
        }
      } else {
        // unknown byte, bail
        break;
      }
    }
    return frames;
  }

  function concat(arrs) {
    let n = 0; for (const a of arrs) n += a.length;
    const out = new Uint8Array(n);
    let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  function lzwDecode(minCodeSize, data, pixelCount) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    let dict = []; for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push(null); dict.push(null);
    const out = new Uint8Array(pixelCount);
    let outPos = 0;
    let buf = 0, bufBits = 0, pos = 0;
    let prev = null;
    while (outPos < pixelCount) {
      while (bufBits < codeSize) {
        if (pos >= data.length) return out;
        buf |= data[pos++] << bufBits;
        bufBits += 8;
      }
      const code = buf & ((1 << codeSize) - 1);
      buf >>>= codeSize; bufBits -= codeSize;
      if (code === clearCode) {
        codeSize = minCodeSize + 1;
        nextCode = eoiCode + 1;
        dict.length = eoiCode + 1;
        for (let i = 0; i < clearCode; i++) dict[i] = [i];
        dict[clearCode] = null; dict[eoiCode] = null;
        prev = null;
        continue;
      }
      if (code === eoiCode) break;
      let entry;
      if (code < dict.length && dict[code]) {
        entry = dict[code];
      } else if (code === dict.length && prev) {
        entry = prev.concat([prev[0]]);
      } else {
        // malformed — bail with what we have
        break;
      }
      for (let i = 0; i < entry.length && outPos < pixelCount; i++) {
        out[outPos++] = entry[i];
      }
      if (prev) {
        dict.push(prev.concat([entry[0]]));
        if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
      }
      prev = entry;
    }
    return out;
  }
  function deinterlace(arr, w, h) {
    const tmp = new Uint8Array(arr.length);
    let src = 0;
    for (const [start, step] of [[0,8],[4,8],[2,4],[1,2]]) {
      for (let y = start; y < h; y += step) {
        tmp.set(arr.subarray(src, src + w), y*w);
        src += w;
      }
    }
    arr.set(tmp);
  }

  // ----- Import dialog with live preview -----
  function showImportDialog(frames) {
    const isMulti = frames.length > 1;
    showModal(`Import ${isMulti ? frames.length + ' frames (GIF)' : 'image'}`, `
      <div class="field">
        <label>Fit mode</label>
        <select id="fit-mode">
          <option value="contain" selected>Contain (letterbox)</option>
          <option value="cover">Cover (crop edges)</option>
          <option value="stretch">Stretch (ignore aspect)</option>
        </select>
      </div>
      <div class="field">
        <label>Brightness threshold: <span id="thr-val">0.50</span></label>
        <input type="range" id="thr" min="0" max="1" step="0.02" value="0.50">
      </div>
      <div class="field">
        <label>Dithering</label>
        <select id="dither">
          <option value="off" selected>None (clean quantize)</option>
          <option value="fs">Floyd–Steinberg</option>
        </select>
      </div>
      <div class="field">
        <label>Inversion</label>
        <select id="invert">
          <option value="0" selected>Bright pixels are bright LEDs</option>
          <option value="1">Dark pixels are bright LEDs (invert)</option>
        </select>
      </div>
      <div class="import-preview" id="ip-row"></div>
      <div class="row">
        <button onclick="closeModal()">Cancel</button>
        <span class="spacer"></span>
        ${isMulti ? '<button id="ip-replace" class="primary">Replace as ' + frames.length + '-frame animation</button>' :
                    '<button id="ip-replace-frame" class="primary">Replace current frame</button> ' +
                    '<button id="ip-add-frame">Add as new frame</button>'}
      </div>
    `);
    // Render preview rendering
    const ipRow = $('#ip-row');
    const previewCanvases = [];
    const previewFrames  = [];
    const maxShown = Math.min(frames.length, 8);
    // create small canvases
    for (let i = 0; i < maxShown; i++) {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex'; wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'center'; wrap.style.gap = '4px';
      const cv = document.createElement('canvas');
      cv.width = 9; cv.height = 20;
      cv.style.width = '54px'; cv.style.height = '120px';
      const lbl = document.createElement('div');
      lbl.className = 'small muted mono';
      lbl.textContent = `${i+1}/${frames.length}`;
      wrap.append(cv, lbl);
      ipRow.appendChild(wrap);
      previewCanvases.push(cv);
    }
    if (frames.length > maxShown) {
      const more = document.createElement('div');
      more.className = 'small muted';
      more.textContent = `+ ${frames.length - maxShown} more…`;
      ipRow.appendChild(more);
    }

    const update = () => {
      const fit = $('#fit-mode').value;
      const thr = parseFloat($('#thr').value);
      const dither = $('#dither').value;
      const invert = $('#invert').value === '1';
      $('#thr-val').textContent = thr.toFixed(2);
      previewFrames.length = 0;
      for (let i = 0; i < frames.length; i++) {
        const px = quantizeImage(frames[i].bitmap, { fit, thr, dither, invert });
        previewFrames.push({ pixels: px, duration: frames[i].delay || 100 });
      }
      // draw previews
      for (let i = 0; i < maxShown; i++) {
        const cv = previewCanvases[i];
        const cctx = cv.getContext('2d');
        const img = cctx.createImageData(9, 20);
        const p = previewFrames[i].pixels;
        for (let k = 0; k < p.length; k++) {
          const v = p[k];
          const op = v === 0 ? 0 : (0.2 + (v/7) * 0.8);
          const off = k * 4;
          img.data[off]   = 240;
          img.data[off+1] = 181;
          img.data[off+2] = 66;
          img.data[off+3] = Math.round(op * 255);
        }
        cctx.putImageData(img, 0, 0);
      }
    };
    ['#fit-mode', '#thr', '#dither', '#invert'].forEach(s => {
      $(s).addEventListener('input', update);
      $(s).addEventListener('change', update);
    });
    update();

    if (isMulti) {
      $('#ip-replace').addEventListener('click', () => {
        state.project = { frames: previewFrames.map(f => ({
          pixels: new Uint8Array(f.pixels), duration: f.duration
        })), selectedIdx: 0 };
        closeModal(); renderAll();
        toast(`Imported ${previewFrames.length} frames`);
      });
    } else {
      $('#ip-replace-frame').addEventListener('click', () => {
        currentFrame().pixels = new Uint8Array(previewFrames[0].pixels);
        closeModal(); renderAll();
        toast('Frame replaced');
      });
      $('#ip-add-frame').addEventListener('click', () => {
        const f = { pixels: new Uint8Array(previewFrames[0].pixels),
                    duration: previewFrames[0].duration };
        state.project.frames.splice(state.project.selectedIdx + 1, 0, f);
        state.project.selectedIdx += 1;
        closeModal(); renderAll();
        toast('Frame added');
      });
    }
  }

  // Quantize an image (Image or canvas) into a 9x20 Uint8Array of intensities.
  function quantizeImage(src, { fit, thr, dither, invert }) {
    // 1. Sample src into a 9x20 grey canvas using the chosen fit mode.
    const work = document.createElement('canvas');
    work.width = 9; work.height = 20;
    const wctx = work.getContext('2d');
    wctx.imageSmoothingEnabled = true;
    wctx.fillStyle = '#000';
    wctx.fillRect(0, 0, 9, 20);
    const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    if (fit === 'stretch') {
      wctx.drawImage(src, 0, 0, 9, 20);
    } else {
      const targetAspect = 9 / 20;
      const srcAspect = sw / sh;
      let dw, dh, dx, dy;
      if ((fit === 'contain') === (srcAspect > targetAspect)) {
        // contain & wide  OR  cover & tall  -> fit by width
        dw = 9; dh = 9 / srcAspect; dx = 0; dy = (20 - dh) / 2;
      } else {
        dh = 20; dw = 20 * srcAspect; dy = 0; dx = (9 - dw) / 2;
      }
      if (fit === 'cover') {
        // swap: cover means fill, no letterbox -> dimensions should be the bigger axis
        if (srcAspect > targetAspect) {
          dh = 20; dw = 20 * srcAspect; dy = 0; dx = (9 - dw) / 2;
        } else {
          dw = 9; dh = 9 / srcAspect; dx = 0; dy = (20 - dh) / 2;
        }
      }
      wctx.drawImage(src, dx, dy, dw, dh);
    }
    // 2. Read greyscale (luma) array
    const data = wctx.getImageData(0, 0, 9, 20).data;
    const lum = new Float32Array(9 * 20);
    for (let i = 0; i < 180; i++) {
      const r = data[i*4], g = data[i*4+1], b = data[i*4+2], a = data[i*4+3];
      let y = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
      // Pre-multiply by alpha so transparent backgrounds appear dark.
      y *= a / 255;
      if (invert) y = 1 - y;
      lum[i] = y;
    }
    // 3. Threshold-bias and quantize to 0..7. The threshold slider remaps
    //    the mid-grey point: thr=0.5 -> linear; thr<0.5 -> brighter overall.
    // Map y through y' = clamp((y - thr + 0.5)) and then *7 -> 0..7.
    const out = new Uint8Array(180);
    const bias = 0.5 - thr;
    if (dither === 'fs') {
      // Work on a mutable copy
      const buf = new Float32Array(lum);
      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 9; x++) {
          const i = y*9 + x;
          const v = Math.max(0, Math.min(1, buf[i] + bias));
          const q = Math.max(0, Math.min(7, Math.round(v * 7)));
          out[i] = q;
          const err = v - q / 7;
          if (x + 1 < 9)            buf[i+1]   += err * 7/16;
          if (y + 1 < 20) {
            if (x - 1 >= 0)        buf[i+9-1] += err * 3/16;
            buf[i+9]               += err * 5/16;
            if (x + 1 < 9)         buf[i+9+1] += err * 1/16;
          }
        }
      }
    } else {
      for (let i = 0; i < 180; i++) {
        const v = Math.max(0, Math.min(1, lum[i] + bias));
        out[i] = Math.max(0, Math.min(7, Math.round(v * 7)));
      }
    }
    return out;
  }

  // =====================================================================
  // PERSISTENCE
  // =====================================================================
  function autoSave() {
    try {
      const serial = {
        v: 1,
        frames: state.project.frames.map(f => ({
          duration: f.duration,
          pixels: Array.from(f.pixels),
        })),
        selectedIdx: state.project.selectedIdx,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch (e) { /* quota */ }
  }
  function autoLoad() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const obj = JSON.parse(raw);
      if (obj.v !== 1 || !Array.isArray(obj.frames) || !obj.frames.length) return false;
      state.project = {
        frames: obj.frames.map(f => ({
          pixels: new Uint8Array(f.pixels),
          duration: f.duration,
        })),
        selectedIdx: Math.min(obj.selectedIdx || 0, obj.frames.length - 1),
      };
      return true;
    } catch (e) { return false; }
  }

  // =====================================================================
  // IO DIALOGS
  // =====================================================================
  function openImportDialog() {
    showModal('Import image / animation', `
      <p class="muted small">
        Paste hex bytes (any format — comma, space, newline, with or without
        <span class="mono">0x</span>), or load a <span class="mono">.hex</span> /
        <span class="mono">.bin</span> file. The image header is parsed and the
        frames appear in the editor.
      </p>
      <textarea id="hex-in" placeholder="01 00 00 00 10 00 00 00 01 00 00 00 ..."></textarea>
      <div class="row" style="margin-top:10px">
        <input type="file" id="hex-file" accept=".hex,.bin,text/*">
        <span class="spacer"></span>
        <button onclick="closeModal()">Cancel</button>
        <button id="hex-go" class="primary">Import</button>
      </div>
    `);
    $('#hex-file').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const text = await f.text();
      $('#hex-in').value = text;
    });
    $('#hex-go').addEventListener('click', () => {
      try {
        const bytes = parseHexInput($('#hex-in').value);
        if (bytes.length === 0) throw new Error('No bytes found');
        const proj = bytesToProject(bytes);
        state.project = proj;
        closeModal(); renderAll();
        toast(`Imported ${proj.frames.length} frame(s), ${bytes.length} bytes`);
      } catch (e) {
        toast('Import failed: ' + e.message, true);
      }
    });
  }

  function openExportDialog() {
    const bytes = exportContainer();
    const b = computeBounds();
    const headerInfo = b.any
      ? `start_row=${b.minRow}, graphic_rows=${b.maxRow - b.minRow + 1}, num_frames=${state.project.frames.length}`
      : 'empty';
    showModal('Export image / animation', `
      <p class="muted small">
        ${headerInfo}<br>
        Container size: <b>${bytes.length} bytes</b>.
      </p>
      <div class="row" style="margin-bottom:8px">
        <label>Name (for C array):</label>
        <input type="text" id="exp-name" value="myImage" style="flex:1">
      </div>
      <details open>
        <summary>Hex bytes</summary>
        <textarea id="exp-hex" readonly>${bytesToHex(bytes)}</textarea>
        <div class="row" style="margin-top:6px">
          <button id="exp-copy-hex">Copy hex</button>
          <button id="exp-dl-bin">Download .bin</button>
        </div>
      </details>
      <details>
        <summary>C array (PROGMEM)</summary>
        <textarea id="exp-c" readonly>${bytesToCArray(bytes)}</textarea>
        <div class="row" style="margin-top:6px">
          <button id="exp-copy-c">Copy C array</button>
        </div>
      </details>
      <details>
        <summary>Project JSON (full editor state)</summary>
        <textarea id="exp-json" readonly>${JSON.stringify({
          v:1,
          frames: state.project.frames.map(f => ({
            duration: f.duration, pixels: Array.from(f.pixels)
          })),
        }, null, 2)}</textarea>
        <div class="row" style="margin-top:6px">
          <button id="exp-copy-json">Copy JSON</button>
          <button id="exp-dl-json">Download .json</button>
        </div>
      </details>
    `);
    const rename = () => {
      $('#exp-c').value = bytesToCArray(bytes, $('#exp-name').value || 'myImage');
    };
    $('#exp-name').addEventListener('input', rename);
    rename();
    const copy = (sel) => () => {
      const ta = $(sel); ta.select(); document.execCommand('copy');
      toast('Copied');
    };
    $('#exp-copy-hex').addEventListener('click', copy('#exp-hex'));
    $('#exp-copy-c').addEventListener('click', copy('#exp-c'));
    $('#exp-copy-json').addEventListener('click', copy('#exp-json'));
    $('#exp-dl-bin').addEventListener('click', () => downloadBytes(bytes, ($('#exp-name').value || 'image') + '.bin'));
    $('#exp-dl-json').addEventListener('click', () => {
      const json = $('#exp-json').value;
      downloadBytes(new TextEncoder().encode(json), ($('#exp-name').value || 'project') + '.json');
    });
  }
  function downloadBytes(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // =====================================================================
  // TEXT → ANIMATION (scrolling-text generator)
  // =====================================================================
  // Font descriptors so we can swap between 5x7 and 3x5 by a single object.
  const FONT_5x7 = {
    name: '5x7',
    width: SX3_FONT_W,           // 5
    height: SX3_FONT_H,          // 7
    first: SX3_FONT_FIRST,
    last:  SX3_FONT_LAST,
    glyphs: SX3_FONT5X7,
  };
  const FONT_3x5 = {
    name: '3x5',
    width: SX3_FONT3X5_W,        // 3
    height: SX3_FONT3X5_H,       // 5
    first: SX3_FONT3X5_FIRST,
    last:  SX3_FONT3X5_LAST,
    glyphs: SX3_FONT3X5,
  };

  // Lookup a column of glyph `ch` (0..width-1). Returns a column byte; bit 0=top.
  function glyphColumn(font, ch, colInGlyph) {
    if (colInGlyph >= font.width) return 0;
    const code = ch.charCodeAt(0);
    if (code < font.first || code > font.last) return 0;
    return font.glyphs[code - font.first][colInGlyph];
  }
  // Pixel column of the laid-out text (font.width pixels per char + 1 px gap).
  function textColumnAt(font, text, pixelX) {
    for (let i = 0; i < text.length; i++) {
      if (pixelX < font.width) {
        if (pixelX < 0) return 0;
        return glyphColumn(font, text[i], pixelX);
      }
      pixelX -= font.width;
      if (pixelX < 1) return 0;     // inter-char gap
      pixelX -= 1;
    }
    return 0;
  }
  function textPixelWidth(font, text) {
    return text.length * (font.width + 1);
  }
  // MODE 3 — "Scroll horizontal, left → right (rotate display 90°)".
  // The text runs as a long ticker along the 20-row axis. On the un-rotated
  // panel the letters lie on their side; turn the display 90° COUNTER-CLOCKWISE
  // and the text is upright and reads left-to-right. This is the roomiest mode
  // (the 20-long axis fits whole words), so it's the most practical ticker.
  function renderHorizontalRotatedFrame(font, text, scrollX, intensity) {
    const px = new Uint8Array(PIXELS_PER_FRAME);
    const textTopCol = Math.floor((COLS - font.height) / 2);   // centre in 9 cols
    for (let row = 0; row < ROWS; row++) {
      const colBits = textColumnAt(font, text, scrollX + row);
      for (let b = 0; b < font.height; b++) {
        if (colBits & (1 << b)) {
          // bit 0 (top of glyph) -> rightmost column of the band
          const matCol = (textTopCol + font.height - 1) - b;
          px[row * 9 + matCol] = intensity;
        }
      }
    }
    return px;
  }

  // MODE 1 — "Scroll vertical, bottom → top (upright, no rotation)".
  // Letters stand upright and are stacked vertically, one above the next, and
  // the whole column scrolls upward like film credits. Read straight off the
  // panel with no rotation. Glyph WIDTH -> display columns (centred in the 9
  // wide axis), glyph HEIGHT -> display rows; successive letters occupy
  // consecutive (height + 1)-row cells along the 20-row axis.
  function renderVerticalUprightFrame(font, text, scrollY, intensity) {
    const px = new Uint8Array(PIXELS_PER_FRAME);
    const colStart = Math.floor((COLS - font.width) / 2);   // centre glyph horizontally
    const cellH = font.height + 1;                          // glyph height + 1px gap
    for (let r = 0; r < ROWS; r++) {
      const virtY = scrollY + r;                            // position in the tall virtual canvas
      if (virtY < 0) continue;
      const letterIdx = Math.floor(virtY / cellH);
      if (letterIdx >= text.length) continue;
      const yInCell = virtY - letterIdx * cellH;            // glyph row (0 = top)
      if (yInCell >= font.height) continue;                 // inter-letter gap row
      for (let c = 0; c < font.width; c++) {
        const colBits = glyphColumn(font, text[letterIdx], c);
        if (colBits & (1 << yInCell)) {
          px[r * 9 + (colStart + c)] = intensity;
        }
      }
    }
    return px;
  }

  // MODE 2 — "Scroll horizontal, left → right (upright, no rotation)".
  // The display stays upright and letters stand normally; text scrolls
  // horizontally across the 9-column width, vertically centred. Reads
  // left-to-right (leftmost column = earlier text); the strip enters from the
  // right edge and slides left, like a classic news ticker. Because the panel
  // is only 9 columns wide, ~1–2 characters are visible at once.
  function renderHorizontalUprightFrame(font, text, scrollX, intensity) {
    const px = new Uint8Array(PIXELS_PER_FRAME);
    const yTop = Math.floor((ROWS - font.height) / 2);   // vertical centre
    for (let c = 0; c < COLS; c++) {
      const textPixelX = scrollX - (COLS - 1 - c);
      const colBits = textColumnAt(font, text, textPixelX);
      for (let b = 0; b < font.height; b++) {
        if (colBits & (1 << b)) {
          px[(yTop + b) * 9 + c] = intensity;
        }
      }
    }
    return px;
  }

  // Build the full scroll animation. Exactly three modes:
  //   'vertical-upright'   — upright letters, stacked, scroll bottom → top
  //   'horizontal-upright' — upright letters, ticker, reads left → right
  //   'horizontal-rotated' — long ticker along the 20-axis, reads left → right
  //                          when the display is turned 90°
  function buildScrollAnimation(text, opts) {
    const { duration, intensity, mode, font } = opts;
    const textW = textPixelWidth(font, text);
    const frames = [];
    if (mode === 'vertical-upright') {
      const cellH = font.height + 1;
      const totalH = text.length * cellH;
      for (let y = -ROWS; y <= totalH; y++) {
        frames.push({ pixels: renderVerticalUprightFrame(font, text, y, intensity), duration });
      }
    } else if (mode === 'horizontal-upright') {
      const endX = textW + COLS - 1;
      for (let x = 0; x <= endX; x++) {
        frames.push({ pixels: renderHorizontalUprightFrame(font, text, x, intensity), duration });
      }
    } else if (mode === 'horizontal-rotated') {
      for (let x = -ROWS; x <= textW; x++) {
        frames.push({ pixels: renderHorizontalRotatedFrame(font, text, x, intensity), duration });
      }
    }
    return frames;
  }

  function openTextDialog() {
    showModal('Text → Animation', `
      <p class="muted small">
        Generate a scrolling-text animation. Pick how the text moves across
        the 20×9 panel. The first two read straight off the upright panel; the
        third is the long ticker you read with the display turned 90°.
      </p>
      <div class="field">
        <label>Text</label>
        <input type="text" id="tx-text" value="VanMoof SX3" maxlength="120" style="font-size:15px">
      </div>
      <div class="field">
        <label>Font</label>
        <select id="tx-font">
          <option value="5x7" selected>5×7 — larger, classic</option>
          <option value="3x5">3×5 — compact, fits more on screen</option>
        </select>
      </div>
      <div class="field">
        <label>Mode</label>
        <select id="tx-mode">
          <option value="vertical-upright" selected>Scroll vertical — bottom → top (upright, no rotation)</option>
          <option value="horizontal-upright">Scroll horizontal — left → right (upright, no rotation)</option>
          <option value="horizontal-rotated">Scroll horizontal — left → right (rotate display 90°)</option>
        </select>
      </div>
      <div class="field">
        <label>Speed: <span id="tx-dur-val">70</span> ms per pixel step</label>
        <input type="range" id="tx-dur" min="20" max="200" step="5" value="70">
      </div>
      <div class="field">
        <label>Brightness: <span id="tx-bri-val">5</span> / 7</label>
        <input type="range" id="tx-bri" min="1" max="7" step="1" value="5">
      </div>
      <div id="tx-preview-row" style="margin:12px 0; display:flex; gap:12px; align-items:center; flex-wrap:wrap;"></div>
      <div class="muted small" id="tx-meta"></div>
      <div class="row" style="margin-top:14px">
        <button onclick="closeModal()">Cancel</button>
        <span class="spacer"></span>
        <button id="tx-replace" class="primary">Replace project</button>
        <button id="tx-append">Append to current</button>
      </div>
    `);

    let lastFrames = [];
    const update = () => {
      const text = $('#tx-text').value || ' ';
      const dur = parseInt($('#tx-dur').value, 10);
      const bri = parseInt($('#tx-bri').value, 10);
      const mode = $('#tx-mode').value;
      const fontName = $('#tx-font').value;
      const font = fontName === '3x5' ? FONT_3x5 : FONT_5x7;
      $('#tx-dur-val').textContent = dur;
      $('#tx-bri-val').textContent = bri;
      lastFrames = buildScrollAnimation(text, { duration: dur, intensity: bri, mode, font });
      // Preview row: show every Nth frame as a thumbnail, max 10.
      const rotated = (mode === 'horizontal-rotated');
      const pv = $('#tx-preview-row');
      pv.innerHTML = '';
      const sample = Math.max(1, Math.floor(lastFrames.length / 10));
      for (let i = 0; i < lastFrames.length; i += sample) {
        const cv = document.createElement('canvas');
        cv.width = 9; cv.height = 20;
        cv.style.width = '36px'; cv.style.height = '80px';
        cv.style.background = '#07090c';
        cv.style.borderRadius = '4px';
        const cx = cv.getContext('2d');
        const img = cx.createImageData(9, 20);
        const f = lastFrames[i].pixels;
        for (let k = 0; k < 180; k++) {
          const v = f[k];
          const op = v === 0 ? 0 : (0.2 + (v/7) * 0.8);
          img.data[k*4]   = 240;
          img.data[k*4+1] = 181;
          img.data[k*4+2] = 66;
          img.data[k*4+3] = Math.round(op * 255);
        }
        cx.putImageData(img, 0, 0);
        if (rotated) {
          // Show the thumbnail the way you'd read it after turning the
          // display 90° counter-clockwise: rotate -90° inside a box sized to
          // the rotated footprint so the flex row lays out cleanly.
          const box = document.createElement('div');
          box.style.cssText =
            'width:80px; height:36px; display:flex; align-items:center; justify-content:center; flex:0 0 auto;';
          cv.style.transform = 'rotate(-90deg)';
          box.appendChild(cv);
          pv.appendChild(box);
        } else {
          pv.appendChild(cv);
        }
      }
      const totalMs = lastFrames.reduce((s, f) => s + f.duration, 0);
      const rotHint = rotated
        ? ' — preview rotated to reading orientation (turn the panel 90° to read)'
        : '';
      $('#tx-meta').innerHTML =
        `<b>${lastFrames.length} frames</b>, total ${totalMs} ms — ` +
        `container size ≈ <b>${4 * (3 + lastFrames.length + lastFrames.length * 9)} bytes</b>` +
        `<span class="muted">${rotHint}</span>`;
    };
    ['#tx-text', '#tx-font', '#tx-mode', '#tx-dur', '#tx-bri'].forEach(s => {
      $(s).addEventListener('input', update);
      $(s).addEventListener('change', update);
    });
    update();

    $('#tx-replace').addEventListener('click', () => {
      state.project = { frames: lastFrames.map(f => ({
        pixels: new Uint8Array(f.pixels), duration: f.duration
      })), selectedIdx: 0 };
      closeModal(); renderAll();
      toast(`Generated ${lastFrames.length}-frame text animation`);
    });
    $('#tx-append').addEventListener('click', () => {
      for (const f of lastFrames) {
        state.project.frames.push({ pixels: new Uint8Array(f.pixels), duration: f.duration });
      }
      state.project.selectedIdx = state.project.frames.length - lastFrames.length;
      closeModal(); renderAll();
      toast(`Appended ${lastFrames.length} frames`);
    });
  }

  // =====================================================================
  // SHARED PREVIEW HELPER (used by the Number and Battery generators)
  // =====================================================================
  // Renders up to ~10 sampled frames as little panel thumbnails into `pvEl`.
  // When `rotated` is true the thumbnails are turned -90° so the content is
  // shown in its reading orientation (display turned 90° counter-clockwise).
  function buildPreviewThumbs(frames, pvEl, rotated) {
    pvEl.innerHTML = '';
    const sample = Math.max(1, Math.floor(frames.length / 10));
    for (let i = 0; i < frames.length; i += sample) {
      const cv = document.createElement('canvas');
      cv.width = 9; cv.height = 20;
      cv.style.width = '36px'; cv.style.height = '80px';
      cv.style.background = '#07090c';
      cv.style.borderRadius = '4px';
      const cx = cv.getContext('2d');
      const img = cx.createImageData(9, 20);
      const f = frames[i].pixels;
      for (let k = 0; k < 180; k++) {
        const v = f[k];
        const op = v === 0 ? 0 : (0.2 + (v / 7) * 0.8);
        img.data[k*4]   = 240;
        img.data[k*4+1] = 181;
        img.data[k*4+2] = 66;
        img.data[k*4+3] = Math.round(op * 255);
      }
      cx.putImageData(img, 0, 0);
      if (rotated) {
        const box = document.createElement('div');
        box.style.cssText =
          'width:80px; height:36px; display:flex; align-items:center; justify-content:center; flex:0 0 auto;';
        cv.style.transform = 'rotate(-90deg)';
        box.appendChild(cv);
        pvEl.appendChild(box);
      } else {
        pvEl.appendChild(cv);
      }
    }
  }

  // Commit a list of {pixels,duration} frames to the project (replace/append).
  function commitGeneratedFrames(frames, replace, label) {
    if (!frames.length) { toast('Nothing to generate', true); return; }
    if (replace) {
      state.project = {
        frames: frames.map(f => ({ pixels: new Uint8Array(f.pixels), duration: f.duration })),
        selectedIdx: 0,
      };
    } else {
      for (const f of frames) {
        state.project.frames.push({ pixels: new Uint8Array(f.pixels), duration: f.duration });
      }
      state.project.selectedIdx = state.project.frames.length - frames.length;
    }
    closeModal(); renderAll();
    toast(label);
  }

  // =====================================================================
  // NUMBER → IMAGE (speed / power-level / percentage readouts)
  // =====================================================================
  // The firmware draws numbers with its own dedicated digit bitmaps, NOT the
  // 5x7/3x5 text font. Recovered from Display_UpperNumbersBitmapTable in
  // mainware 1.9.3: row-major, 7 bytes per digit (one byte per row). The low
  // nibble holds a 4-pixel-wide glyph — bit 3 = left column … bit 0 = right.
  // (Display_UpperNumber only reads bits 3..0, so bit 4 of the table is never
  // drawn and the digits are 4 wide.)
  const FW_UPPER_DIGITS = [
    [0x06,0x09,0x09,0x09,0x09,0x09,0x06], // 0
    [0x04,0x0c,0x04,0x04,0x04,0x04,0x0e], // 1
    [0x06,0x09,0x01,0x02,0x04,0x08,0x1f], // 2
    [0x0e,0x01,0x01,0x06,0x01,0x01,0x0e], // 3
    [0x09,0x09,0x09,0x07,0x01,0x01,0x01], // 4
    [0x0f,0x08,0x08,0x0e,0x01,0x01,0x0e], // 5
    [0x07,0x08,0x08,0x0e,0x09,0x09,0x06], // 6
    [0x0f,0x01,0x02,0x04,0x08,0x08,0x08], // 7
    [0x06,0x09,0x09,0x06,0x09,0x09,0x06], // 8
    [0x06,0x09,0x09,0x07,0x01,0x01,0x01], // 9
  ];

  // Draw one 4-wide firmware digit. baseCol is the column for the glyph's
  // bit 3 (leftmost); bits 3..0 map to baseCol..baseCol+3. 7 rows from topRow.
  function drawFirmwareDigit(px, digit, topRow, baseCol, intensity) {
    const rows = FW_UPPER_DIGITS[digit];
    for (let r = 0; r < 7; r++) {
      const byte = rows[r];
      for (let b = 0; b < 4; b++) {                 // bit 3,2,1,0
        if ((byte >> (3 - b)) & 1) {
          const col = baseCol + b, row = topRow + r;
          if (row >= 0 && row < ROWS && col >= 0 && col < COLS) px[row * 9 + col] = intensity;
        }
      }
    }
  }

  // Render a number exactly the way Display_UpperNumber(number, offset) does:
  // a two-digit value with the tens digit in columns 0..3 and the ones digit
  // in columns 5..8 (column 4 is the gap between them), upright — no rotation.
  // Firmware offset 0 puts the 7 glyph rows at rows 1..7; topRow generalises
  // that. Single-digit values land in the right half (cols 5..8) like the
  // firmware, unless `centreSingle` nudges them inward.
  function renderFirmwareNumber(value, topRow, intensity, centreSingle) {
    const px = new Uint8Array(PIXELS_PER_FRAME);
    value = Math.max(0, Math.min(99, value | 0));
    const tens = Math.floor(value / 10), ones = value % 10;
    if (value >= 10) {
      drawFirmwareDigit(px, tens, topRow, 0, intensity);   // tens → left half
      drawFirmwareDigit(px, ones, topRow, 5, intensity);   // ones → right half
    } else if (centreSingle) {
      drawFirmwareDigit(px, ones, topRow, 3, intensity);   // roughly centred (cols 3..6)
    } else {
      drawFirmwareDigit(px, ones, topRow, 5, intensity);   // firmware: right half
    }
    return px;
  }

  function openNumberDialog() {
    showModal('Number → Image', `
      <p class="muted small">
        Render a number the way the firmware's <code>Display_UpperNumber</code>
        does: two digits side by side — tens in the left columns (0–3), ones in
        the right (5–8), a blank column between — upright, no rotation. Values
        are clamped to 0–99 to match the firmware.
      </p>
      <div class="field">
        <label>Number (0–99)</label>
        <input type="text" id="nm-text" value="25" maxlength="2" inputmode="numeric" style="font-size:15px">
      </div>
      <div class="field">
        <label>Vertical position</label>
        <select id="nm-pos">
          <option value="center" selected>Centred (rows 6–12)</option>
          <option value="top">Top (rows 3–9)</option>
          <option value="bottom">Bottom (rows 11–17)</option>
        </select>
      </div>
      <div class="field">
        <label><input type="checkbox" id="nm-centre1"> Centre single digits (firmware places them on the right)</label>
      </div>
      <div class="field">
        <label>Brightness: <span id="nm-bri-val">6</span> / 7</label>
        <input type="range" id="nm-bri" min="1" max="7" step="1" value="6">
      </div>
      <div id="nm-preview-row" style="margin:12px 0; display:flex; gap:12px; align-items:center; flex-wrap:wrap;"></div>
      <div class="muted small" id="nm-meta"></div>
      <div class="row" style="margin-top:14px">
        <button onclick="closeModal()">Cancel</button>
        <span class="spacer"></span>
        <button id="nm-replace" class="primary">Replace project</button>
        <button id="nm-append">Append to current</button>
      </div>
    `);

    const POS = { top: 3, center: 6, bottom: 11 };
    let frame = null;
    const update = () => {
      let raw = ($('#nm-text').value || '').replace(/[^0-9]/g, '').slice(0, 2);
      if (raw === '') raw = '0';
      $('#nm-text').value = raw;
      const val = parseInt(raw, 10);
      const bri = parseInt($('#nm-bri').value, 10);
      const topRow = POS[$('#nm-pos').value] ?? 6;
      const centreSingle = $('#nm-centre1').checked;
      $('#nm-bri-val').textContent = bri;
      frame = { pixels: renderFirmwareNumber(val, topRow, bri, centreSingle), duration: 2000 };
      buildPreviewThumbs([frame], $('#nm-preview-row'), false);   // upright — read straight on
      $('#nm-meta').innerHTML =
        `Firmware layout — "${val}" upright, read straight off the panel (no rotation).`;
    };
    ['#nm-text', '#nm-pos', '#nm-centre1', '#nm-bri'].forEach(s => {
      $(s).addEventListener('input', update);
      $(s).addEventListener('change', update);
    });
    update();

    $('#nm-replace').addEventListener('click', () =>
      commitGeneratedFrames([frame], true, `Generated number "${$('#nm-text').value}"`));
    $('#nm-append').addEventListener('click', () =>
      commitGeneratedFrames([frame], false, `Appended number "${$('#nm-text').value}"`));
  }

  // =====================================================================
  // BATTERY → IMAGE (firmware-accurate battery frame + proportional fill)
  // =====================================================================
  // The firmware draws a rounded-rectangle battery body at rows 13..17:
  //     ·#######·   row 13  (top edge,  cols 1..7)
  //     #·······#   row 14  (sides,     cols 0 & 8)
  //     #·······#   row 15
  //     #·······#   row 16
  //     ·#######·   row 17  (bottom edge)
  // Interior fillable area: rows 14..16 (3 rows) × cols 1..7 (7 cols).
  // Fill grows left → right (= bottom → top when the display is read rotated).
  const BAT_TOP = 13;          // top edge row
  const BAT_BOT = 17;          // bottom edge row
  const BAT_INT_COL0 = 1;      // first interior column
  const BAT_INT_COLS = 7;      // interior column count
  const BAT_INT_ROW0 = 14;     // first interior row
  const BAT_INT_ROWS = 3;      // interior row count

  function renderBatteryBase(frameIntensity) {
    const px = new Uint8Array(PIXELS_PER_FRAME);
    for (let c = 1; c <= 7; c++) {           // top & bottom edges
      px[BAT_TOP * 9 + c] = frameIntensity;
      px[BAT_BOT * 9 + c] = frameIntensity;
    }
    for (let r = BAT_INT_ROW0; r < BAT_INT_ROW0 + BAT_INT_ROWS; r++) {  // sides
      px[r * 9 + 0] = frameIntensity;
      px[r * 9 + 8] = frameIntensity;
    }
    return px;
  }

  // CalculateBatteryDots(soc, 7, 92, 0, 21) from the firmware: clamps the
  // state-of-charge to [7,92] % and maps it linearly to 0..21 lit dots.
  //   dots = floor(21 * (clamp(soc,7,92) - 7) / 85)
  function calcBatteryDots(soc) {
    const minV = 7, maxV = 92, minD = 0, maxD = 21;
    const s = soc < minV ? minV : soc;
    const span = s < maxV ? s - minV : maxV - minV;
    return Math.floor(((maxD - minD) * span) / (maxV - minV)) + minD;
  }

  // Display_UpdateBatteryDots: light `dotCount` of the 21 interior cells
  // (7 columns × 3 rows). The firmware fills column by column — all 3 rows of
  // a column before moving to the next — so a partial last column shows 1–2
  // cells. Columns fill left → right (= bottom → top when read rotated); within
  // a column the cells fill bottom-up.
  function fillBatteryDots(px, dotCount, fillIntensity) {
    dotCount = Math.max(0, Math.min(BAT_INT_COLS * BAT_INT_ROWS, dotCount | 0));
    for (let i = 0; i < BAT_INT_COLS * BAT_INT_ROWS; i++) {
      if (i >= dotCount) continue;
      const ci = Math.floor(i / BAT_INT_ROWS);                 // column 0..6
      const j  = i % BAT_INT_ROWS;                             // 0=bottom row
      const col = BAT_INT_COL0 + ci;                           // cols 1..7
      const row = BAT_INT_ROW0 + (BAT_INT_ROWS - 1 - j);       // 16,15,14
      px[row * 9 + col] = fillIntensity;
    }
  }

  // Build the gauge frame(s). `soc` is state-of-charge in %. The number of lit
  // dots comes from the firmware formula. The frame is normally the DARK frame
  // (the everyday battery frame). The BRIGHT frame is used only while a power
  // bank is charging the main battery — it does NOT blink; it's just swapped
  // in for the duration of power-bank charging.
  function buildBatteryFrames(opts) {
    const { soc, powerBank, frameIntensity, brightFrameIntensity, fillIntensity } = opts;
    const dots = calcBatteryDots(soc);
    const px = renderBatteryBase(powerBank ? brightFrameIntensity : frameIntensity);
    fillBatteryDots(px, dots, fillIntensity);
    return [{ pixels: px, duration: 2000 }];
  }

  function openBatteryDialog() {
    showModal('Battery → Image', `
      <p class="muted small">
        Draw the firmware battery gauge: the body (rows 13–17) plus 0–21 lit
        dots (7 cols × 3 rows) computed from the state-of-charge exactly like
        <code>CalculateBatteryDots</code> (7 %→0 dots, 92 %→full). The everyday
        frame is the dark one; the bright frame is shown only while a power bank
        is charging the main battery.
      </p>
      <div class="field">
        <label>State of charge: <span id="bt-pct-val">80</span> % → <span id="bt-dots-val">0</span>/21 dots</label>
        <input type="range" id="bt-pct" min="0" max="100" step="1" value="80">
      </div>
      <div class="field">
        <label><input type="checkbox" id="bt-powerbank"> Charging from power bank (use bright frame)</label>
      </div>
      <div class="field">
        <label>Fill brightness: <span id="bt-fill-val">7</span> / 7</label>
        <input type="range" id="bt-fill" min="1" max="7" step="1" value="7">
      </div>
      <div class="field">
        <label>Frame brightness (normal): <span id="bt-frame-val">4</span> / 7</label>
        <input type="range" id="bt-frame" min="1" max="7" step="1" value="4">
      </div>
      <div class="field">
        <label>Frame brightness (power bank): <span id="bt-bright-val">7</span> / 7</label>
        <input type="range" id="bt-bright" min="1" max="7" step="1" value="7">
      </div>
      <div id="bt-preview-row" style="margin:12px 0; display:flex; gap:12px; align-items:center; flex-wrap:wrap;"></div>
      <div class="muted small" id="bt-meta"></div>
      <div class="row" style="margin-top:14px">
        <button onclick="closeModal()">Cancel</button>
        <span class="spacer"></span>
        <button id="bt-replace" class="primary">Replace project</button>
        <button id="bt-append">Append to current</button>
      </div>
    `);

    let frames = [];
    const update = () => {
      const soc = parseInt($('#bt-pct').value, 10);
      const powerBank = $('#bt-powerbank').checked;
      const fillIntensity = parseInt($('#bt-fill').value, 10);
      const frameIntensity = parseInt($('#bt-frame').value, 10);
      const brightFrameIntensity = parseInt($('#bt-bright').value, 10);
      const dots = calcBatteryDots(soc);
      $('#bt-pct-val').textContent = soc;
      $('#bt-dots-val').textContent = dots;
      $('#bt-fill-val').textContent = fillIntensity;
      $('#bt-frame-val').textContent = frameIntensity;
      $('#bt-bright-val').textContent = brightFrameIntensity;
      frames = buildBatteryFrames({ soc, powerBank, frameIntensity, brightFrameIntensity, fillIntensity });
      buildPreviewThumbs(frames, $('#bt-preview-row'), true);
      let note = `${frames.length} frame — preview rotated to reading orientation.`;
      if (soc < 6) {
        note += ` <span style="color:var(--danger,#e66)">Under 6 % the firmware shows "Low battery (no digits)" instead of dots — load <code>low_battery_no_digits</code> from the gallery.</span>`;
      } else if (soc <= 22) {
        note += ` <span style="color:var(--danger,#e66)">Between 6–22 % the firmware shows a blinking reserve-dot warning (1/2/3 dots) rather than calculated dots — see the <code>battery_*_reserve_dots_blinking</code> images in the gallery.</span>`;
      }
      $('#bt-meta').innerHTML = note;
    };
    ['#bt-pct', '#bt-powerbank', '#bt-fill', '#bt-frame', '#bt-bright'].forEach(s => {
      $(s).addEventListener('input', update);
      $(s).addEventListener('change', update);
    });
    update();

    $('#bt-replace').addEventListener('click', () =>
      commitGeneratedFrames(frames, true, `Generated battery (${$('#bt-pct').value}%)`));
    $('#bt-append').addEventListener('click', () =>
      commitGeneratedFrames(frames, false, `Appended battery (${$('#bt-pct').value}%)`));
  }

  // =====================================================================
  // BLE TRANSFER — send current image to an SX3 BLE receiver
  // =====================================================================
  // The receiver sketch advertises a Nordic-UART-style service with one
  // write characteristic (RX) and one notify characteristic (TX). See
  // sx3_display_ble_receiver.ino for the full protocol description.
  const BLE_SERVICE_UUID = '6e400001-c352-11e6-9598-0800200c9a66';
  const BLE_RX_CHAR_UUID = '6e400002-c352-11e6-9598-0800200c9a66';
  const BLE_TX_CHAR_UUID = '6e400003-c352-11e6-9598-0800200c9a66';

  const BLE_OP_START    = 0x01;
  const BLE_OP_DATA     = 0x02;
  const BLE_OP_END      = 0x03;
  const BLE_ACK_CHUNK   = 0xA0;
  const BLE_ACK_ERROR   = 0xA1;
  const BLE_ACK_COMPLETE= 0xA2;

  // CRC-16-CCITT-FALSE — matches the ESP-side implementation.
  function crc16(bytes) {
    let crc = 0xFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= (bytes[i] << 8);
      for (let b = 0; b < 8; b++) {
        crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
      }
    }
    return crc;
  }

  // Active connection state. We keep this across "send" clicks so the user
  // can iterate quickly without re-pairing every time.
  const bleState = {
    device: null,         // BluetoothDevice
    server: null,         // BluetoothRemoteGATTServer
    rxChar: null,         // write characteristic
    txChar: null,         // notify characteristic
    pendingAck: null,     // { resolve, reject, expectedSeq, timeoutId }
  };

  // Promise that resolves on the next notification matching `expectedSeq`
  // (or any "complete"/"error" message). Used to wait for ACKs serially.
  function awaitAck(expectedSeq, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        bleState.pendingAck = null;
        reject(new Error(`Timeout waiting for ACK seq=${expectedSeq}`));
      }, timeoutMs);
      bleState.pendingAck = { resolve, reject, expectedSeq, timeoutId };
    });
  }

  function onTxNotification(evt) {
    const v = evt.target.value;     // DataView
    if (!v || v.byteLength < 1) return;
    const op = v.getUint8(0);
    const pending = bleState.pendingAck;
    if (op === BLE_ACK_ERROR) {
      const code = v.byteLength >= 2 ? v.getUint8(1) : 0;
      const MSG = {
        1: 'image too big for the receiver — reduce the number of frames, or raise MAX_IMAGE_BYTES in the receiver sketch and reflash',
        2: 'CRC mismatch — data was corrupted during transfer, try again',
        3: 'invalid image header',
        4: 'protocol error',
        5: 'parse error (image data malformed)',
      };
      const detail = MSG[code] || `code ${code}`;
      if (pending) {
        clearTimeout(pending.timeoutId);
        bleState.pendingAck = null;
        pending.reject(new Error(`Receiver error: ${detail}`));
      }
      return;
    }
    if (op === BLE_ACK_COMPLETE) {
      if (pending) {
        clearTimeout(pending.timeoutId);
        bleState.pendingAck = null;
        pending.resolve({ complete: true });
      }
      return;
    }
    if (op === BLE_ACK_CHUNK) {
      const seq = v.byteLength >= 3 ? (v.getUint8(1) | (v.getUint8(2) << 8)) : -1;
      if (pending && (pending.expectedSeq === seq || pending.expectedSeq === 0xFFFF)) {
        clearTimeout(pending.timeoutId);
        bleState.pendingAck = null;
        pending.resolve({ seq });
      }
      // else: stray ACK, ignore
    }
  }

  async function bleConnect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not available in this browser. Use Chrome or Edge on desktop or Android.');
    }
    if (bleState.server && bleState.server.connected) return; // already up

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE_UUID] }],
      // alternative: leave wide-open with acceptAllDevices + optionalServices
    });
    device.addEventListener('gattserverdisconnected', () => {
      bleState.server = null;
      bleState.rxChar = null;
      bleState.txChar = null;
      toast('BLE disconnected');
    });
    const server  = await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    const rxChar  = await service.getCharacteristic(BLE_RX_CHAR_UUID);
    const txChar  = await service.getCharacteristic(BLE_TX_CHAR_UUID);
    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged', onTxNotification);

    bleState.device = device;
    bleState.server = server;
    bleState.rxChar = rxChar;
    bleState.txChar = txChar;
  }

  async function bleDisconnect() {
    if (bleState.device && bleState.device.gatt.connected) {
      bleState.device.gatt.disconnect();
    }
    bleState.device = null;
    bleState.server = null;
    bleState.rxChar = null;
    bleState.txChar = null;
  }

  // Send `bytes` as an image to the connected receiver. Reports progress as
  // fraction 0..1 via onProgress(p, status).
  async function bleSendImage(bytes, onProgress) {
    if (!bleState.rxChar) throw new Error('Not connected');
    const totalLen = bytes.length;
    const crc = crc16(bytes);

    // 1. START header: [0x01] total_len_u32  crc_u16   (7 bytes)
    const startBuf = new Uint8Array(7);
    startBuf[0] = BLE_OP_START;
    startBuf[1] =  totalLen        & 0xFF;
    startBuf[2] = (totalLen >>  8) & 0xFF;
    startBuf[3] = (totalLen >> 16) & 0xFF;
    startBuf[4] = (totalLen >> 24) & 0xFF;
    startBuf[5] =  crc        & 0xFF;
    startBuf[6] = (crc >>  8) & 0xFF;
    const startWait = awaitAck(0xFFFF, 4000);
    await bleState.rxChar.writeValueWithoutResponse(startBuf);
    await startWait;
    onProgress(0, 'Header sent, streaming data…');

    // 2. DATA chunks. We try to use chunks of ~180 bytes payload so each BLE
    //    write fits inside a single 247-byte MTU packet (3 bytes header +
    //    180 payload = 183, plus ATT overhead). If the negotiated MTU is
    //    smaller the write will fragment automatically.
    const CHUNK_PAYLOAD = 180;
    let seq = 0;
    let pos = 0;
    while (pos < totalLen) {
      const n = Math.min(CHUNK_PAYLOAD, totalLen - pos);
      const buf = new Uint8Array(3 + n);
      buf[0] = BLE_OP_DATA;
      buf[1] =  seq       & 0xFF;
      buf[2] = (seq >> 8) & 0xFF;
      buf.set(bytes.subarray(pos, pos + n), 3);
      const wait = awaitAck(seq, 3000);
      await bleState.rxChar.writeValueWithoutResponse(buf);
      await wait;
      pos += n;
      seq++;
      onProgress(pos / totalLen, `Sent ${pos} / ${totalLen} bytes (${seq} chunks)`);
    }

    // 3. END marker: [0x03]
    const endBuf = new Uint8Array(1);
    endBuf[0] = BLE_OP_END;
    const endWait = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        bleState.pendingAck = null;
        reject(new Error('Timeout waiting for completion'));
      }, 4000);
      bleState.pendingAck = {
        resolve, reject,
        expectedSeq: -999,   // anything; the COMPLETE check fires first
        timeoutId,
      };
    });
    await bleState.rxChar.writeValueWithoutResponse(endBuf);
    await endWait;
    onProgress(1, 'Done. Image is playing on the display.');
  }

  function openBleDialog() {
    const supported = !!navigator.bluetooth;
    showModal('Send via BLE', `
      <p class="muted small">
        Sends the current animation to an SX3 display running the
        <span class="mono">sx3_display_ble_receiver</span> sketch. Make sure the ESP32
        is powered on; it advertises as <b>SX3 Display</b>.
      </p>
      ${supported ? '' : `
        <div style="background:#5c2027;color:#ffdcdc;padding:10px;border-radius:6px;margin:10px 0;">
          ⚠ Web Bluetooth is not available in this browser.<br>
          Use desktop <b>Chrome</b>, <b>Edge</b> or <b>Opera</b>, or Chrome on Android.
          Firefox, Safari and any browser on iOS/iPadOS won't work (no API support).
        </div>
      `}
      <div class="field">
        <label>Animation size</label>
        <div id="ble-size" class="mono small" style="background:var(--bg-elev2);padding:8px;border-radius:6px;">—</div>
      </div>
      <div class="field">
        <label>Status</label>
        <div id="ble-status" class="mono small" style="background:var(--bg-elev2);padding:8px;border-radius:6px;">Not connected.</div>
      </div>
      <div class="field">
        <label>Progress</label>
        <div style="background:var(--bg-elev2);border-radius:6px;height:14px;overflow:hidden;">
          <div id="ble-bar" style="background:var(--accent);height:100%;width:0%;transition:width 150ms;"></div>
        </div>
        <div id="ble-bar-text" class="muted small mono" style="margin-top:4px;">—</div>
      </div>
      <div class="row" style="margin-top:14px">
        <button id="ble-connect" ${supported ? '' : 'disabled'}>Connect…</button>
        <button id="ble-send" class="primary" ${supported ? '' : 'disabled'} disabled>Send animation</button>
        <span class="spacer"></span>
        <button id="ble-disconnect" disabled>Disconnect</button>
        <button onclick="closeModal()">Close</button>
      </div>
    `);

    const setStatus = (txt, isErr = false) => {
      const el = $('#ble-status');
      el.textContent = txt;
      el.style.color = isErr ? 'var(--danger)' : 'var(--fg)';
    };
    const setProgress = (frac, txt) => {
      $('#ble-bar').style.width = (frac * 100).toFixed(1) + '%';
      $('#ble-bar-text').textContent = txt || '';
    };
    const refreshButtons = () => {
      const connected = bleState.server && bleState.server.connected;
      $('#ble-connect').disabled = connected;
      $('#ble-send').disabled = !connected;
      $('#ble-disconnect').disabled = !connected;
      if (connected && bleState.device) {
        setStatus(`Connected to "${bleState.device.name || '(unnamed)'}".`);
      } else if (!connected) {
        setStatus('Not connected.');
      }
    };
    refreshButtons();

    // Show the current animation's encoded size so the user can gauge whether
    // it fits the receiver. The updated sketch accepts up to 64 KB.
    const RECEIVER_MAX_BYTES = 65536;
    (function showSize() {
      const el = $('#ble-size');
      if (!el) return;
      let bytes;
      try { bytes = exportContainer(); } catch (e) { el.textContent = 'n/a'; return; }
      const n = bytes.length, frames = state.project.frames.length;
      el.textContent = `${n} bytes · ${frames} frame(s)`;
      if (n > RECEIVER_MAX_BYTES) {
        el.style.color = 'var(--danger)';
        el.textContent += ` — exceeds the 64 KB receiver limit; reduce frames`;
      } else if (n > 8192) {
        el.textContent += ` — needs a receiver with MAX_IMAGE_BYTES ≥ ${n} (updated sketch allows 64 KB)`;
      }
    })();

    $('#ble-connect').addEventListener('click', async () => {
      try {
        setStatus('Picking device…');
        await bleConnect();
        refreshButtons();
        toast('BLE connected');
      } catch (e) {
        setStatus(e.message, true);
        if (e.name === 'NotFoundError') toast('No device selected', true);
        else toast('Connect failed: ' + e.message, true);
      }
    });
    $('#ble-disconnect').addEventListener('click', async () => {
      await bleDisconnect();
      refreshButtons();
      setProgress(0, '—');
    });
    $('#ble-send').addEventListener('click', async () => {
      try {
        const bytes = exportContainer();
        if (bytes.length === 0) { toast('Nothing to send', true); return; }
        setStatus(`Sending ${bytes.length} bytes…`);
        setProgress(0, 'Starting…');
        $('#ble-send').disabled = true;
        await bleSendImage(bytes, (frac, txt) => setProgress(frac, txt));
        setStatus(`Sent ${bytes.length} bytes. Display is playing.`);
        toast('Image delivered');
      } catch (e) {
        setStatus(e.message, true);
        toast('Send failed: ' + e.message, true);
      } finally {
        refreshButtons();
      }
    });
  }

  // =====================================================================
  // FIRMWARE GALLERY — browse and load images extracted from mainware
  // =====================================================================
  // The SX3_FIRMWARE_GALLERY constant comes from firmware_gallery.js
  // (loaded as a separate <script> tag in index.html).

  // Convert a hex string to Uint8Array.
  function hexToBytes(hex) {
    const n = hex.length / 2;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = parseInt(hex.substr(i*2, 2), 16);
    return out;
  }

  // Render one frame of a gallery image into a small canvas (for thumbnails).
  // Returns the canvas element.
  function renderGalleryThumbCanvas(imageBytes, frameIdx, scale = 3) {
    const cv = document.createElement('canvas');
    cv.width  = COLS * scale;
    cv.height = ROWS * scale;
    cv.style.background = '#07090c';
    cv.style.borderRadius = '4px';
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, cv.width, cv.height);

    // Parse header
    const dv = new DataView(imageBytes.buffer, imageBytes.byteOffset, imageBytes.byteLength);
    const start_row    = dv.getUint32(0, true);
    const graphic_rows = dv.getUint32(4, true);
    const num_frames   = dv.getUint32(8, true);
    if (frameIdx >= num_frames) frameIdx = 0;

    for (let rel = 0; rel < graphic_rows; rel++) {
      const wordIdx = num_frames * rel + frameIdx + num_frames + 3;
      if (wordIdx * 4 + 4 > imageBytes.length) break;
      const word = dv.getUint32(wordIdx * 4, true);
      const absRow = start_row + rel;
      if (absRow >= ROWS) continue;
      for (let c = 0; c < COLS; c++) {
        const inten = (word >>> (24 - 3*c)) & 0x7;
        if (inten === 0) continue;
        const alpha = 0.18 + (inten / 7) * 0.78;
        ctx.fillStyle = `rgba(240, 181, 66, ${alpha.toFixed(3)})`;
        ctx.fillRect(c * scale, absRow * scale, scale, scale);
      }
    }
    return cv;
  }

  // Convert raw gallery image bytes into a fresh `project` (editor state).
  function galleryBytesToProject(bytes) {
    // Reuse the existing bytesToProject() parser — gallery bytes are the
    // exact same SX3 container format the editor exports.
    return bytesToProject(bytes);
  }

  function openGalleryDialog() {
    if (typeof SX3_FIRMWARE_GALLERY === 'undefined' || !SX3_FIRMWARE_GALLERY.length) {
      toast('Gallery data not loaded. Check firmware_gallery.js path.', true);
      return;
    }
    showModal('Firmware gallery', `
      <p class="muted small">
        ${SX3_FIRMWARE_GALLERY.length} images extracted from the SX3 firmware.
        Click a thumbnail to select it (double-click = replace), then choose an
        action below. Animations replay live.
      </p>
      <div id="gal-grid" style="
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
        gap: 12px;
        max-height: 52vh;
        overflow-y: auto;
        padding: 4px;
      "></div>
      <div class="field" style="margin-top:10px">
        <label><input type="checkbox" id="gal-keepopen"> Keep gallery open after importing (to add several images)</label>
      </div>
      <div class="muted small" id="gal-sel-info" style="margin-bottom:8px;">No image selected.</div>
      <div class="row">
        <button onclick="closeModal()">Cancel</button>
        <span class="spacer"></span>
        <button id="gal-replace" class="primary" disabled>Replace project</button>
        <button id="gal-append" disabled>Append to current</button>
      </div>
    `);

    const grid = $('#gal-grid');
    // Per-thumbnail animation state: keep small for memory
    const animations = [];     // { bytes, container, frame, lastSwitch, cv }
    let raf = null;

    // ---- selection + action buttons -----------------------------------------
    let selectedWrap = null;
    let selected = null;       // { bytes, idx, shortName, numFrames }

    function selectThumb(wrap, bytes, idx, shortName, numFrames) {
      if (selectedWrap && selectedWrap !== wrap) {
        selectedWrap.style.borderColor = 'var(--border)';
        selectedWrap.style.boxShadow = 'none';
        selectedWrap.style.background = 'var(--bg-elev)';
      }
      selectedWrap = wrap;
      selected = { bytes, idx, shortName, numFrames };
      wrap.style.borderColor = 'var(--accent)';
      wrap.style.boxShadow = 'inset 0 0 0 2px var(--accent)';
      wrap.style.background = '#0e2a4a';
      $('#gal-replace').disabled = false;
      $('#gal-append').disabled = false;
      $('#gal-sel-info').textContent = `Selected #${idx}: ${shortName} (${numFrames}f)`;
    }

    const keepOpen = () => $('#gal-keepopen') && $('#gal-keepopen').checked;

    const doReplace = () => {
      if (!selected) { toast('Select an image first', true); return; }
      try {
        state.project = galleryBytesToProject(selected.bytes);
        renderAll();
        toast(`Loaded #${selected.idx}: ${selected.shortName}`);
        if (!keepOpen()) closeModal();
      } catch (e) { toast('Load failed: ' + e.message, true); }
    };
    const doAppend = () => {
      if (!selected) { toast('Select an image first', true); return; }
      try {
        const proj = galleryBytesToProject(selected.bytes);
        for (const f of proj.frames) {
          state.project.frames.push({ pixels: new Uint8Array(f.pixels), duration: f.duration });
        }
        state.project.selectedIdx = state.project.frames.length - proj.frames.length;
        renderAll();
        toast(`Appended #${selected.idx}: ${selected.shortName} (${proj.frames.length}f)`);
        if (!keepOpen()) closeModal();
      } catch (e) { toast('Append failed: ' + e.message, true); }
    };
    $('#gal-replace').addEventListener('click', doReplace);
    $('#gal-append').addEventListener('click', doAppend);

    SX3_FIRMWARE_GALLERY.forEach((img, idx) => {
      const bytes = hexToBytes(img.hex);
      const wrap = document.createElement('div');
      wrap.style.cssText = `
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 6px; border: 1px solid var(--border); border-radius: 6px;
        background: var(--bg-elev); cursor: pointer; transition: border-color 80ms;
      `;
      wrap.addEventListener('mouseenter', () => { if (wrap !== selectedWrap) wrap.style.borderColor = 'var(--accent)'; });
      wrap.addEventListener('mouseleave', () => { if (wrap !== selectedWrap) wrap.style.borderColor = 'var(--border)'; });

      const cv = renderGalleryThumbCanvas(bytes, 0, 3);
      const nameEl = document.createElement('div');
      nameEl.style.cssText =
        'font-size: 10px; color: var(--fg); text-align: center; ' +
        'line-height: 1.2; max-width: 84px; overflow-wrap: break-word;';
      const shortName = img.display || img.name.replace(/_/g, ' ');
      nameEl.textContent = shortName;

      const metaEl = document.createElement('div');
      metaEl.style.cssText = 'font-size: 9px; color: var(--fg-dim); font-family: ui-monospace, monospace;';
      metaEl.textContent = `#${idx} · ${img.num_frames}f`;
      wrap.append(cv, nameEl, metaEl);

      wrap.addEventListener('click', () => {
        selectThumb(wrap, bytes, idx, shortName, img.num_frames);
      });
      wrap.addEventListener('dblclick', () => {
        selectThumb(wrap, bytes, idx, shortName, img.num_frames);
        doReplace();
      });

      wrap.title = [
        `Image #${idx}`,
        `Name: ${img.display || img.name}`,
        img.name ? `Identifier: ${img.name}` : null,
        img.description ? `Description: ${img.description}` : null,
        `Firmware address: ${img.addr}`,
        `start_row=${img.start_row}, graphic_rows=${img.graphic_rows}, frames=${img.num_frames}`,
        `${img.size} bytes`,
      ].filter(Boolean).join('\n');

      grid.appendChild(wrap);

      if (img.num_frames > 1) {
        // Schedule animation: just rotate frames at uniform 100ms — easier
        // than honouring per-frame durations for tiny thumbnails.
        animations.push({
          bytes,
          frame: 0,
          numFrames: img.num_frames,
          lastSwitch: performance.now(),
          duration: 120,
          cv,
          wrap,
        });
      }
    });

    // Run the animation loop. Stops automatically when modal is closed because
    // the canvases are no longer in the DOM and we'll detect that.
    const animate = () => {
      const now = performance.now();
      let anyAlive = false;
      for (const a of animations) {
        if (!a.cv.isConnected) continue;
        anyAlive = true;
        if (now - a.lastSwitch >= a.duration) {
          a.frame = (a.frame + 1) % a.numFrames;
          a.lastSwitch = now;
          // Re-render: drop old canvas content, paint new frame.
          const ctx = a.cv.getContext('2d');
          ctx.fillStyle = '#07090c';
          ctx.fillRect(0, 0, a.cv.width, a.cv.height);
          const dv = new DataView(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength);
          const start_row    = dv.getUint32(0, true);
          const graphic_rows = dv.getUint32(4, true);
          const num_frames   = dv.getUint32(8, true);
          const scale = 3;
          for (let rel = 0; rel < graphic_rows; rel++) {
            const wordIdx = num_frames * rel + a.frame + num_frames + 3;
            if (wordIdx * 4 + 4 > a.bytes.length) break;
            const word = dv.getUint32(wordIdx * 4, true);
            const absRow = start_row + rel;
            if (absRow >= ROWS) continue;
            for (let c = 0; c < COLS; c++) {
              const inten = (word >>> (24 - 3*c)) & 0x7;
              if (inten === 0) continue;
              const alpha = 0.18 + (inten / 7) * 0.78;
              ctx.fillStyle = `rgba(240, 181, 66, ${alpha.toFixed(3)})`;
              ctx.fillRect(c * scale, absRow * scale, scale, scale);
            }
          }
        }
      }
      if (anyAlive) {
        raf = requestAnimationFrame(animate);
      } else {
        raf = null;
      }
    };
    if (animations.length) raf = requestAnimationFrame(animate);
  }

  function openHelp() {
    showModal('Help & keyboard shortcuts', `
      <ul class="small">
        <li><kbd>0</kbd>–<kbd>7</kbd> — set active brightness</li>
        <li><kbd>←</kbd> <kbd>→</kbd> — previous / next frame</li>
        <li><kbd>Space</kbd> — play / pause</li>
        <li><kbd>Ctrl/⌘ D</kbd> — duplicate frame</li>
        <li><kbd>Delete</kbd> — clear frame (Shift = delete frame)</li>
        <li><kbd>Ctrl/⌘ C</kbd> / <kbd>V</kbd> — copy / paste frame</li>
        <li>Click — paint with active brightness (toggles off if same value)</li>
        <li>Right-click — clear pixel</li>
        <li>Drag — paint multiple cells</li>
        <li>Drop a <b>.hex</b>, <b>.bin</b>, <b>PNG</b> or <b>GIF</b> anywhere on the page</li>
        <li><b>Text…</b> — generate a scrolling-text animation from a string</li>
        <li><b>Number…</b> — render a centred number (speed / power level / %)</li>
        <li><b>Battery…</b> — draw the firmware battery frame filled to a charge level</li>
        <li><b>Gallery…</b> — browse 54 images extracted from the SX3 firmware</li>
        <li><b>⇅ Reverse</b> — reverse the order of all frames</li>
        <li><b>Frame checkboxes</b> — tick frames, then <b>Selected</b> applies the duration to just those. Shift-click a checkbox to select a range; or use the <b>Range</b> from–to box. <b>Select all</b> / <b>Clear</b> help. Checked frames also drive <b>Delete</b> and (when contiguous) <b>Reverse</b>.</li>
        <li><b>Gallery</b> — click a thumbnail to select, then <b>Replace</b> / <b>Append</b>; tick "Keep gallery open" to import several in a row (double-click = replace)</li>
        <li><b>Send via BLE…</b> — send the current animation to a connected SX3 display (Chrome/Edge/Opera only)</li>
      </ul>
      <hr>
      <p class="small muted">
        Auto-saves to browser LocalStorage. Use Export → JSON to back up
        between devices.
      </p>
    `);
  }

  // =====================================================================
  // FILE DROP — entire window
  // =====================================================================
  const dz = $('#dropZone');
  ['dragenter','dragover'].forEach(ev => {
    window.addEventListener(ev, e => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        dz.classList.add('show');
      }
    });
  });
  ['dragleave','drop'].forEach(ev => {
    window.addEventListener(ev, e => {
      if (ev === 'dragleave' && e.relatedTarget) return;
      dz.classList.remove('show');
    });
  });
  window.addEventListener('drop', async e => {
    e.preventDefault();
    if (!e.dataTransfer.files.length) return;
    const file = e.dataTransfer.files[0];
    const name = (file.name || '').toLowerCase();
    if (file.type.startsWith('image/') || name.endsWith('.gif') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
      importImageFile(file);
    } else if (name.endsWith('.hex') || name.endsWith('.bin') || file.type.startsWith('text/')) {
      const text = name.endsWith('.bin')
        ? await file.arrayBuffer().then(b => bytesToHex(new Uint8Array(b)))
        : await file.text();
      try {
        const bytes = parseHexInput(text);
        if (!bytes.length) throw new Error('no bytes');
        const proj = bytesToProject(bytes);
        state.project = proj; renderAll();
        toast(`Loaded ${proj.frames.length} frame(s) from ${file.name}`);
      } catch (e) { toast('Import failed: ' + e.message, true); }
    } else {
      toast('Unsupported file type', true);
    }
  });

  // =====================================================================
  // WIRING — buttons & keyboard
  // =====================================================================
  $('#btn-help').addEventListener('click', openHelp);
  $('#btn-new').addEventListener('click', () => {
    if (!confirm('Discard the current project and start a new one?')) return;
    state.project = makeEmptyProject(); renderAll();
  });
  $('#btn-import').addEventListener('click', openImportDialog);
  $('#btn-export').addEventListener('click', openExportDialog);
  $('#btn-pngimport').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,.gif';
    inp.addEventListener('change', () => inp.files[0] && importImageFile(inp.files[0]));
    inp.click();
  });
  $('#btn-gallery').addEventListener('click', openGalleryDialog);
  $('#btn-text').addEventListener('click', openTextDialog);
  $('#btn-number').addEventListener('click', openNumberDialog);
  $('#btn-battery').addEventListener('click', openBatteryDialog);
  $('#btn-ble').addEventListener('click', openBleDialog);

  $('#btn-frame-add').addEventListener('click', addFrame);
  $('#btn-frame-dup').addEventListener('click', dupFrame);
  $('#btn-frame-del').addEventListener('click', delFrame);
  $('#btn-frame-up').addEventListener('click', () => moveFrame(-1));
  $('#btn-frame-down').addEventListener('click', () => moveFrame(+1));
  $('#btn-frame-reverse').addEventListener('click', reverseFrames);
  $('#btn-play').addEventListener('click', playPause);

  $('#btn-clear').addEventListener('click', clearFrame);
  $('#btn-fill').addEventListener('click', fillFrame);
  $('#btn-invert').addEventListener('click', invertFrame);
  $('#btn-shift-l').addEventListener('click', () => shiftFrame( 0,-1));
  $('#btn-shift-r').addEventListener('click', () => shiftFrame( 0, 1));
  $('#btn-shift-u').addEventListener('click', () => shiftFrame(-1, 0));
  $('#btn-shift-d').addEventListener('click', () => shiftFrame( 1, 0));
  $('#btn-flip-h').addEventListener('click', flipH);
  $('#btn-flip-v').addEventListener('click', flipV);
  $('#btn-copy-frame').addEventListener('click', copyFrame);
  $('#btn-paste-frame').addEventListener('click', pasteFrame);

  $('#cb-onion').addEventListener('change', e => {
    state.onionSkin = e.target.checked; renderGrid();
  });

  durInput.addEventListener('change', () => {
    let v = parseInt(durInput.value, 10);
    if (isNaN(v) || v < 10) v = 10;
    if (v > 60000) v = 60000;
    currentFrame().duration = v;
    durInput.value = v;
    renderFrameList(); renderBoundsInfo(); autoSave();
  });
  $('#btn-dur-all').addEventListener('click', () => {
    const v = parseInt(durInput.value, 10) || 50;
    state.project.frames.forEach(f => f.duration = v);
    renderFrameList(); autoSave();
    toast('Applied to all frames');
  });
  $('#btn-dur-sel').addEventListener('click', () => {
    const v = parseInt(durInput.value, 10) || 50;
    const marked = state.project.frames.filter(f => f.sel);
    if (!marked.length) { toast('No frames checked — tick the boxes first', true); return; }
    marked.forEach(f => f.duration = v);
    renderFrameList(); renderBoundsInfo(); autoSave();
    toast(`Applied ${v} ms to ${marked.length} frame(s)`);
  });
  $('#btn-sel-all').addEventListener('click', () => {
    state.project.frames.forEach(f => f.sel = true);
    renderFrameList();
  });
  $('#btn-sel-none').addEventListener('click', () => {
    state.project.frames.forEach(f => f.sel = false);
    renderFrameList();
  });
  $('#btn-sel-range').addEventListener('click', () => {
    const n = state.project.frames.length;
    let a = parseInt($('#sel-from').value, 10);
    let b = parseInt($('#sel-to').value, 10);
    if (!Number.isFinite(a)) a = 1;
    if (!Number.isFinite(b)) b = n;
    a = Math.max(1, Math.min(n, a));
    b = Math.max(1, Math.min(n, b));
    if (a > b) { const t = a; a = b; b = t; }
    for (let i = a - 1; i <= b - 1; i++) state.project.frames[i].sel = true;
    renderFrameList();
    toast(`Selected frames ${a}–${b}`);
  });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT') return;
    if (e.key >= '0' && e.key <= '7') { setBrightness(Number(e.key)); return; }
    if (e.key === ' ') { e.preventDefault(); playPause(); return; }
    if (e.key === 'ArrowLeft')  { selectFrame(state.project.selectedIdx - 1); return; }
    if (e.key === 'ArrowRight') { selectFrame(state.project.selectedIdx + 1); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault(); dupFrame(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { copyFrame(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { pasteFrame(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (e.shiftKey) delFrame(); else clearFrame();
      return;
    }
  });

  // =====================================================================
  // BOOT
  // =====================================================================
  buildGrid();
  buildPreview();
  buildPalette();
  if (!autoLoad()) state.project = makeEmptyProject();
  renderAll();
})();
