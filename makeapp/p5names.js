// p5names.js - the names p5.js takes on window in global mode, and the sketch's top-level names that collide with them (3.9 platform).
// p5 starts AFTER an app's script has run (makeapp/frame.html: the Kit and sketch.js as one script, then `new p5()`) and writes its own
// functions and values onto window. Measured with makeapp/p5.min.js (1.11.13) in Edge: a top-level `function save()` or `var LEFT` in
// sketch.js is p5's from then on (the app's save() became p5's download of the canvas, which the sandbox blocks: the app never kept
// anything), while a top-level let / const / class stays the app's own and only hides p5's of that name: from the sketch, and from the
// Kit, which shares that script. So makeapp/check.js refuses a top-level function or var with any p5 name, and a let / const / class only
// with a name the Kit itself uses from p5 (the Skeleton Guide asks for no p5 name at all; { strict: true } flags every let / const too).
// The lists are what p5.js 1.11.13 binds: its prototype's public functions and values, plus the instance's remove, canvas and
// drawingContext. Pure (no DOM); node-tested: v39/tests/platform/p5names.test.mjs.

/** p5's global functions (an app's own top-level function or var of one of these names is replaced by p5's when it starts) */
export const P5_FUNCTIONS = Object.freeze([
  'abs', 'acos', 'alpha', 'ambientLight', 'ambientMaterial', 'angleMode', 'append', 'applyMatrix', 'arc', 'arrayCopy', 'asin', 'atan',
  'atan2', 'background', 'baseColorShader', 'baseMaterialShader', 'baseNormalShader', 'baseStrokeShader', 'beginClip', 'beginContour',
  'beginGeometry', 'beginShape', 'bezier', 'bezierDetail', 'bezierPoint', 'bezierTangent', 'bezierVertex', 'blend', 'blendMode', 'blue',
  'boolean', 'box', 'brightness', 'buildGeometry', 'byte', 'callRegisteredHooksFor', 'camera', 'ceil', 'char', 'circle', 'clear',
  'clearDepth', 'clearStorage', 'clip', 'color', 'colorMode', 'concat', 'cone', 'constrain', 'copy', 'cos', 'createA', 'createAudio',
  'createButton', 'createCamera', 'createCanvas', 'createCapture', 'createCheckbox', 'createColorPicker', 'createDiv', 'createElement',
  'createFileInput', 'createFilterShader', 'createFramebuffer', 'createGraphics', 'createImage', 'createImg', 'createInput', 'createModel',
  'createNumberDict', 'createP', 'createRadio', 'createSelect', 'createShader', 'createSlider', 'createSpan', 'createStringDict',
  'createVector', 'createVideo', 'createWriter', 'cursor', 'curve', 'curveDetail', 'curvePoint', 'curveTangent', 'curveTightness',
  'curveVertex', 'cylinder', 'day', 'debugMode', 'degrees', 'describe', 'describeElement', 'directionalLight', 'displayDensity', 'dist',
  'downloadFile', 'ellipse', 'ellipseMode', 'ellipsoid', 'emissiveMaterial', 'encodeAndDownloadGif', 'endClip', 'endContour',
  'endGeometry', 'endShape', 'erase', 'exitPointerLock', 'exp', 'fill', 'filter', 'float', 'floor', 'fract', 'frameRate', 'freeGeometry',
  'frustum', 'fullscreen', 'get', 'getFilterGraphicsLayer', 'getFrameRate', 'getItem', 'getTargetFrameRate', 'getURL', 'getURLParams',
  'getURLPath', 'green', 'gridOutput', 'hex', 'hour', 'httpDo', 'httpGet', 'httpPost', 'hue', 'image', 'imageLight', 'imageMode', 'int',
  'isLooping', 'join', 'keyIsDown', 'lerp', 'lerpColor', 'lightFalloff', 'lightness', 'lights', 'line', 'linePerspective', 'loadBytes',
  'loadFont', 'loadImage', 'loadJSON', 'loadModel', 'loadPixels', 'loadShader', 'loadStrings', 'loadTable', 'loadXML', 'log', 'loop',
  'mag', 'map', 'match', 'matchAll', 'max', 'metalness', 'millis', 'min', 'minute', 'model', 'month', 'nf', 'nfc', 'nfp', 'nfs',
  'noCanvas', 'noCursor', 'noDebugMode', 'noErase', 'noFill', 'noLights', 'noLoop', 'noSmooth', 'noStroke', 'noTint', 'noise',
  'noiseDetail', 'noiseSeed', 'norm', 'normal', 'normalMaterial', 'orbitControl', 'ortho', 'paletteLerp', 'panorama', 'perspective',
  'pixelDensity', 'plane', 'point', 'pointLight', 'pop', 'popMatrix', 'popStyle', 'pow', 'print', 'push', 'pushMatrix', 'pushStyle',
  'quad', 'quadraticVertex', 'radians', 'random', 'randomGaussian', 'randomSeed', 'rect', 'rectMode', 'red', 'redraw',
  'registerPromisePreload', 'remove', 'removeElements', 'removeItem', 'requestPointerLock', 'resetMatrix', 'resetShader', 'resizeCanvas',
  'reverse', 'rotate', 'rotateX', 'rotateY', 'rotateZ', 'round', 'saturation', 'save', 'saveCanvas', 'saveFrames', 'saveGif', 'saveJSON',
  'saveJSONArray', 'saveJSONObject', 'saveStrings', 'saveTable', 'scale', 'second', 'select', 'selectAll', 'set', 'setAttributes',
  'setCamera', 'setFrameRate', 'setMoveThreshold', 'setShakeThreshold', 'shader', 'shearX', 'shearY', 'shininess', 'shorten', 'shuffle',
  'sin', 'smooth', 'sort', 'specularColor', 'specularMaterial', 'sphere', 'splice', 'split', 'splitTokens', 'spotLight', 'sq', 'sqrt',
  'square', 'storeItem', 'str', 'stroke', 'strokeCap', 'strokeJoin', 'strokeWeight', 'subset', 'tan', 'text', 'textAlign', 'textAscent',
  'textDescent', 'textFont', 'textLeading', 'textOutput', 'textSize', 'textStyle', 'textWidth', 'textWrap', 'texture', 'textureMode',
  'textureWrap', 'tint', 'torus', 'translate', 'triangle', 'trim', 'unchar', 'unhex', 'updatePixels', 'vertex', 'writeFile', 'year']);

/** p5's global values: its constants and the variables it keeps up to date (an app's own top-level function or var of one of these
 *  names is overwritten when p5 starts; a let / const only hides p5's value, so there only the Kit's own reads count) */
export const P5_VALUES = Object.freeze([
  'ADD', 'ALT', 'ARROW', 'AUDIO', 'AUTO', 'AXES', 'BACKSPACE', 'BASELINE', 'BEVEL', 'BEZIER', 'BLEND', 'BLUR', 'BOLD', 'BOLDITALIC',
  'BOTTOM', 'BURN', 'CENTER', 'CHAR', 'CHORD', 'CLAMP', 'CLOSE', 'CONTAIN', 'CONTROL', 'CORNER', 'CORNERS', 'COVER', 'CROSS', 'CURVE',
  'DARKEST', 'DEGREES', 'DEG_TO_RAD', 'DELETE', 'DIFFERENCE', 'DILATE', 'DODGE', 'DOWN_ARROW', 'ENTER', 'ERODE', 'ESCAPE', 'EXCLUSION',
  'FALLBACK', 'FILL', 'FLAT', 'FLOAT', 'GRAY', 'GRID', 'HALF_FLOAT', 'HALF_PI', 'HAND', 'HARD_LIGHT', 'HSB', 'HSL', 'IMAGE', 'IMMEDIATE',
  'INVERT', 'ITALIC', 'LABEL', 'LANDSCAPE', 'LEFT', 'LEFT_ARROW', 'LIGHTEST', 'LINEAR', 'LINES', 'LINE_LOOP', 'LINE_STRIP', 'MIRROR',
  'MITER', 'MOVE', 'MULTIPLY', 'NEAREST', 'NORMAL', 'OPAQUE', 'OPEN', 'OPTION', 'OVERLAY', 'P2D', 'PI', 'PIE', 'POINTS', 'PORTRAIT',
  'POSTERIZE', 'PROJECT', 'QUADRATIC', 'QUADS', 'QUAD_STRIP', 'QUARTER_PI', 'RADIANS', 'RADIUS', 'RAD_TO_DEG', 'REMOVE', 'REPEAT',
  'REPLACE', 'RETURN', 'RGB', 'RGBA', 'RIGHT', 'RIGHT_ARROW', 'ROUND', 'SCREEN', 'SHIFT', 'SMOOTH', 'SOFT_LIGHT', 'SQUARE', 'STROKE',
  'SUBTRACT', 'TAB', 'TAU', 'TESS', 'TEXT', 'TEXTURE', 'THRESHOLD', 'TOP', 'TRIANGLES', 'TRIANGLE_FAN', 'TRIANGLE_STRIP', 'TWO_PI',
  'UNSIGNED_BYTE', 'UNSIGNED_INT', 'UP_ARROW', 'VERSION', 'VIDEO', 'WAIT', 'WEBGL', 'WEBGL2', 'WORD', 'accelerationX', 'accelerationY',
  'accelerationZ', 'canvas', 'deltaTime', 'deviceOrientation', 'displayHeight', 'displayWidth', 'drawingContext', 'focused', 'frameCount',
  'height', 'isKeyPressed', 'key', 'keyCode', 'keyIsPressed', 'mouseButton', 'mouseIsPressed', 'mouseX', 'mouseY', 'movedX', 'movedY',
  'pAccelerationX', 'pAccelerationY', 'pAccelerationZ', 'pRotateDirectionX', 'pRotateDirectionY', 'pRotateDirectionZ', 'pRotationX',
  'pRotationY', 'pRotationZ', 'pixels', 'pmouseX', 'pmouseY', 'pwinMouseX', 'pwinMouseY', 'rotationX', 'rotationY', 'rotationZ',
  'touches', 'turnAxis', 'webglVersion', 'width', 'winMouseX', 'winMouseY', 'windowHeight', 'windowWidth']);

const FN = new Set(P5_FUNCTIONS), VAL = new Set(P5_VALUES);
/** what the Kit (makeapp/kit.js) itself uses from p5 by its global name: an app's top-level let / const / class of one of these would
 *  hide it from the Kit too (the unit test re-reads kit.js to keep this list whole) */
export const KIT_USES = Object.freeze(['createCanvas', 'displayDensity', 'drawingContext', 'frameRate', 'height', 'pixelDensity', 'pop', 'push',
  'resetMatrix', 'resizeCanvas', 'scale', 'textFont', 'translate', 'width', 'windowHeight', 'windowWidth']);
const KIT = new Set(KIT_USES);
const SUGGEST = { save: 'saveState', map: 'gameMap', text: 'label', print: 'say', color: 'mainColor', image: 'picture', remove: 'dropItem',
  random: 'pickOne', key: 'keyName', K: 'kState' };
/** a name to offer instead (never one p5 or the Kit uses) */
export const suggestName = (name) => SUGGEST[name] || ('my' + String(name).charAt(0).toUpperCase() + String(name).slice(1));

// ------------------------------------------------------------------------------------------------ reading the code (no parser: a scanner)
const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 160 || c === 0xfeff || c === 0x2028 || c === 0x2029;
const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95 || c > 127;
const isId = (c) => isIdStart(c) || (c >= 48 && c <= 57);
const RX_AFTER = '(,=:[!&|?{};+-*%<>~^';   // a '/' after one of these (or at the start) begins a regular expression, else it divides
const RX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/** maskCode(src) -> the same text, the same length, with every comment, string, template text and regular expression blanked (spaces;
 *  line ends kept): what is left is code, and the braces of a template's ${...} stay paired */
export function maskCode(src) {
  const s = String(src == null ? '' : src), n = s.length, R = [];   // the ranges to blank, in order
  const blank = (a, b) => { if (b > a) R.push(a, Math.min(b, n)); };
  const tpl = [];   // for each open ${ of a template: the brace depth its } closes back to
  let i = 0, depth = 0, prev = '', word = '';
  const text = (j) => {   // a template's text from j: to its closing backtick (returns the index after it) or into a ${ (code again)
    const a = j;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === 92) { j += 2; continue; }   // \
      if (c === 96) { blank(a, j); return j + 1; }   // `
      if (c === 36 && s.charCodeAt(j + 1) === 123) { blank(a, j); tpl.push(depth); depth++; return j + 2; }   // ${
      j++;
    }
    blank(a, n); return n;
  };
  while (i < n) {
    const c = s.charCodeAt(i), d = s.charCodeAt(i + 1);
    if (c === 47 && d === 47) { let j = s.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue; }   // // comment
    if (c === 47 && d === 42) { let j = s.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue; }   // /* comment */
    if (c === 34 || c === 39) {   // "..." or '...' (a string never runs past its line)
      let j = i + 1;
      while (j < n) { const e = s.charCodeAt(j); if (e === c || e === 10) break; j += e === 92 ? 2 : 1; }
      blank(i + 1, j); i = Math.min(n, j + 1); prev = ')'; word = ''; continue;
    }
    if (c === 96) { i = text(i + 1); prev = ')'; word = ''; continue; }
    if (c === 47 && (prev === '' || RX_AFTER.includes(prev) || RX_WORDS.has(word))) {   // a regular expression (on one line)
      let j = i + 1, cls = false, ok = false;
      while (j < n) {
        const e = s.charCodeAt(j);
        if (e === 10) break;
        if (e === 92) { j += 2; continue; }
        if (cls) { if (e === 93) cls = false; } else if (e === 91) cls = true; else if (e === 47) { ok = true; break; }
        j++;
      }
      if (ok) { blank(i + 1, j); j++; while (j < n && isId(s.charCodeAt(j))) j++; i = j; prev = ')'; word = ''; continue; }
    }
    if (c === 123) depth++;   // {
    else if (c === 125) {   // }
      if (tpl.length && tpl[tpl.length - 1] === depth - 1) { tpl.pop(); depth--; i = text(i + 1); prev = ')'; word = ''; continue; }
      depth--;
    }
    if (isId(c)) { let j = i; while (j < n && isId(s.charCodeAt(j))) j++; word = s.slice(i, j); prev = s[j - 1]; i = j; continue; }
    if (!isSpace(c)) { prev = s[i]; word = ''; }
    i++;
  }
  if (!R.length) return s;
  const out = []; let pos = 0;
  for (let k = 0; k < R.length; k += 2) { out.push(s.slice(pos, R[k]), s.slice(R[k], R[k + 1]).replace(/[^\n\r]/g, ' ')); pos = R[k + 1]; }
  out.push(s.slice(pos));
  return out.join('');
}

const OPS = '=([{,:?!&|+-*/%<>~^.';   // a line that ends with one of these goes on in the next
const EXPR_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await', 'export', 'default']);
const GOES_ON = '.,?:+-*/%&|^=<>)]}';   // a line that starts with one of these continues the line before

/** topDeclarations(src) -> [{name, kind, at}]: the names sketch.js declares at its top level (they become globals): function (also async
 *  and function*), class, var, let and const (with comma lists and destructuring). Not: anything inside a function, block or object,
 *  function or class EXPRESSIONS, let / const in a for(...) head, words in comments, strings, templates or regular expressions */
export function topDeclarations(src) {
  const m = maskCode(src), n = m.length, out = [];
  const at = (j) => m.charCodeAt(j);
  const skipWs = (j) => { while (j < n && isSpace(at(j))) j++; return j; };
  const wordAt = (j) => { let k = j; if (k < n && isIdStart(at(k))) { k++; while (k < n && isId(at(k))) k++; } return m.slice(j, k); };
  const closeOf = (j) => {   // the index of the bracket that closes the one at j (or n)
    let dd = 0;
    for (let k = j; k < n; k++) { const c = m[k]; if (c === '(' || c === '[' || c === '{') dd++; else if (c === ')' || c === ']' || c === '}') { dd--; if (!dd) return k; } }
    return n;
  };
  const prevSigOf = (j) => { let k = j - 1; while (k >= 0 && isSpace(at(k))) k--; return k < 0 ? '' : m[k]; };
  const nextSigOf = (j) => { const k = skipWs(j); return k < n ? m[k] : ''; };
  /** the names a destructuring pattern declares: inner = the text inside its brackets, obj = { } (else [ ]) */
  const patternNames = (inner, obj, into) => {
    const parts = []; let dd = 0, a = 0;
    for (let k = 0; k <= inner.length; k++) {
      const c = inner[k];
      if (k === inner.length || (c === ',' && !dd)) { parts.push(inner.slice(a, k)); a = k + 1; continue; }
      if (c === '(' || c === '[' || c === '{') dd++; else if (c === ')' || c === ']' || c === '}') dd--;
    }
    for (let p of parts) {
      p = p.trim(); if (!p) continue;
      if (p.startsWith('...')) p = p.slice(3).trim();
      if (obj) {   // key: target (a computed [key] too), else the shorthand name
        let dd2 = 0, colon = -1;
        for (let k = 0; k < p.length; k++) { const c = p[k]; if (c === '(' || c === '[' || c === '{') dd2++; else if (c === ')' || c === ']' || c === '}') dd2--; else if (c === ':' && !dd2) { colon = k; break; } }
        if (colon >= 0) p = p.slice(colon + 1).trim();
      }
      let dd3 = 0, eq = -1;   // a default value: name = ...
      for (let k = 0; k < p.length; k++) { const c = p[k]; if (c === '(' || c === '[' || c === '{') dd3++; else if (c === ')' || c === ']' || c === '}') dd3--; else if (c === '=' && !dd3 && p[k + 1] !== '=' && p[k + 1] !== '>' && p[k - 1] !== '=' && p[k - 1] !== '!' && p[k - 1] !== '<' && p[k - 1] !== '>') { eq = k; break; } }
      if (eq >= 0) p = p.slice(0, eq).trim();
      if (p[0] === '{' || p[0] === '[') { const e = p.lastIndexOf(p[0] === '{' ? '}' : ']'); patternNames(p.slice(1, e > 0 ? e : p.length), p[0] === '{', into); continue; }
      const w = /^[A-Za-z_$][\w$]*$/.exec(p); if (w) into.push(w[0]);
    }
  };
  /** from just after an initializer's '=': the index of the ',' that ends it, or where its statement ends */
  const skipInit = (j) => {
    let dd = 0;
    for (let k = j; k < n; k++) {
      const c = m[k];
      if (c === '(' || c === '[' || c === '{') dd++;
      else if (c === ')' || c === ']' || c === '}') { if (!dd) return k; dd--; }
      else if (!dd && (c === ',' || c === ';')) return k;
      else if (!dd && c === '\n') { const p = prevSigOf(k), q = nextSigOf(k); if (!(p && OPS.includes(p)) && !(q && GOES_ON.includes(q))) return k; }
    }
    return n;
  };
  let i = 0, brace = 0, paren = 0, prevSig = '', prevWord = '', nl = false;
  const stmtStart = () => prevSig === '' || prevSig === ';' || prevSig === '}' || prevSig === '{'
    || (nl && !OPS.includes(prevSig) && !EXPR_WORDS.has(prevWord));   // a function / class keyword where a statement starts: a declaration
  while (i < n) {
    const c = at(i);
    if (c === 10) { nl = true; i++; continue; }
    if (isSpace(c)) { i++; continue; }
    if (isIdStart(c)) {
      const w = wordAt(i), j = i + w.length;
      if (!brace && prevSig !== '.') {
        if (w === 'function' || (w === 'async' && wordAt(skipWs(j)) === 'function')) {
          let k = w === 'async' ? skipWs(j) + 8 : j;
          k = skipWs(k); if (m[k] === '*') k = skipWs(k + 1);
          const name = wordAt(k);
          if (name && stmtStart()) out.push({ name, kind: 'function', at: i });
        } else if (w === 'class') {
          const name = wordAt(skipWs(j));
          if (name && name !== 'extends' && stmtStart()) out.push({ name, kind: 'class', at: i });
        } else if (w === 'var' || ((w === 'let' || w === 'const') && !paren)) {
          let k = j;
          for (;;) {
            k = skipWs(k);
            const names = [];
            if (m[k] === '{' || m[k] === '[') { const e = closeOf(k); patternNames(m.slice(k + 1, e), m[k] === '{', names); k = e + 1; }
            else { const nm = wordAt(k); if (!nm) break; names.push(nm); k += nm.length; }
            for (const nm of names) out.push({ name: nm, kind: w, at: i });
            let q = k; while (q < n && isSpace(at(q)) && m[q] !== '\n') q++;
            if (m[q] === '\n' && nextSigOf(q) === ',') q = skipWs(q);
            if (m[q] === '=' && m[q + 1] !== '=') { q = skipInit(q + 1); if (m[q] === '\n' && nextSigOf(q) === ',') q = skipWs(q); }
            if (m[q] === ',') { k = q + 1; continue; }
            break;
          }
        }
      }
      prevSig = m[j - 1]; prevWord = w; nl = false; i = j; continue;
    }
    if (c === 123) brace++;
    else if (c === 125) brace = Math.max(0, brace - 1);
    else if (c === 40 || c === 91) paren++;
    else if (c === 41 || c === 93) paren = Math.max(0, paren - 1);
    prevSig = m[i]; prevWord = ''; nl = false; i++;
  }
  return out;
}

/** p5Clashes(src, {strict}) -> [{name, kind, by}]: each top-level name of sketch.js that breaks next to p5 (by 'p5') or the Kit (by
 *  'kit': K), once: a function or var with any p5 name; a let / const / class with a name the Kit uses (strict: any p5 function's) */
export function p5Clashes(src, o) {
  const strict = !!(o && o.strict), seen = new Set(), out = [];
  for (const d of topDeclarations(src)) {
    if (seen.has(d.name)) continue;
    const replaced = d.kind === 'function' || d.kind === 'var';
    const by = d.name === 'K' ? 'kit'
      : (replaced && (FN.has(d.name) || VAL.has(d.name))) || KIT.has(d.name) || (strict && FN.has(d.name)) ? 'p5' : null;
    if (by) { seen.add(d.name); out.push({ name: d.name, kind: d.kind, by }); }
  }
  return out;
}

/** clashProblems(src) -> check.js's problems, one per name: 'sketch.js uses the name "save", which p5 uses: rename it (e.g. saveState)' */
export function clashProblems(src, o) {
  return p5Clashes(src, o).map((x) => (x.by === 'kit'
    ? `sketch.js uses the name "K", which the p0pc0rn Kit uses: rename it (e.g. ${suggestName('K')})`
    : `sketch.js uses the name "${x.name}", which p5 uses: rename it (e.g. ${suggestName(x.name)})`));
}
