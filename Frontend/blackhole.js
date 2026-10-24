/* =====================================================================
   J.A.R.V.I.S — Black hole core visual
   ---------------------------------------------------------------------
   A real-time, physically-flavoured black hole renderer.

   Each pixel traces a light ray backwards through a Schwarzschild-like
   gravitational field (acceleration  a = -1.5 * h² * p / r⁵, i.e. the
   photon orbit equation), so the accretion disk is genuinely lensed over
   and under the shadow instead of being faked with sprites.

   Renderers, in order of preference:
     1. WebGL   — full ray-traced black hole
     2. Canvas2D— animated fallback for devices without WebGL
     3. none    — page still works, just no visual

   States (driven by J.A.R.V.I.S): idle, listening, thinking, speaking, error
   ===================================================================== */
(function (global) {
  'use strict';

  var VERTEX_SRC = [
    'attribute vec2 aPosition;',
    'void main() {',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAGMENT_SRC = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    '',
    'uniform vec2  uRes;',
    'uniform float uTime;',
    'uniform float uEnergy;',   // 0..1 — urgency of the current state
    'uniform float uSpin;',     // disk rotation speed multiplier
    'uniform float uSteps;',    // adaptive step budget
    'uniform float uCamY;',
    'uniform float uCamZ;',
    'uniform float uFov;',
    'uniform float uYaw;',
    'uniform vec3  uPalMid;',
    'uniform vec3  uPalOuter;',
    'uniform vec3  uPalRing;',
    'uniform vec3  uPalNebula;',
    'uniform float uError;',    // 0..1 red shift for the error state
    '',
    'const float HORIZON = 1.0;',
    'const float R_IN    = 1.30;',
    'const float R_OUT   = 4.60;',
    'const float ESCAPE  = 60.0;',
    '',
    'float hash2(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    '',
    'float noise2(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = hash2(i);',
    '  float b = hash2(i + vec2(1.0, 0.0));',
    '  float c = hash2(i + vec2(0.0, 1.0));',
    '  float d = hash2(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    '',
    'float fbm(vec2 p) {',
    '  float sum = 0.0;',
    '  float amp = 0.5;',
    '  for (int i = 0; i < 4; i++) {',
    '    sum += amp * noise2(p);',
    '    p *= 2.03;',
    '    amp *= 0.5;',
    '  }',
    '  return sum;',
    '}',
    '',
    '// Turbulent plasma emission of the accretion disk at radius r, angle a.',
    'vec3 diskEmission(float r, float a, float t) {',
    '  float tt   = clamp((r - R_IN) / (R_OUT - R_IN), 0.0, 1.0);',
    '  float heat = pow(1.0 - tt, 1.55);',
    '  float edge = 1.0 - smoothstep(0.72, 1.0, tt);',
    '  float n = fbm(vec2(a * 1.9 + t * 0.55 * uSpin + log(r) * 2.6, r * 2.2 - t * 0.8 * uSpin));',
    '  n = 0.35 + 1.25 * smoothstep(0.30, 0.85, n);',
    '  float beam = 0.26 + 1.70 * pow(max(0.0, cos(a - 2.2)), 2.6);',
    '  vec3 col = mix(vec3(1.0, 0.99, 1.0), uPalMid, smoothstep(0.0, 0.22, tt));',
    '  col = mix(col, uPalOuter, smoothstep(0.18, 1.0, tt));',
    '  float intensity = (3.6 * heat + 0.05) * n * beam * edge;',
    '  intensity *= 1.0 + uEnergy * 0.65;',
    '  return col * intensity;',
    '}',
    '',
    '// Distant star field. Cubic hash cells => stable point stars.',
    'float starField(vec3 dir, float t) {',
    '  float sum = 0.0;',
    '  for (int k = 1; k <= 3; k++) {',
    '    float fk = float(k);',
    '    float sc = 30.0 * fk * fk;',
    '    vec3 p = dir * sc;',
    '    vec3 cell = floor(p);',
    '    float h = hash2(vec2(cell.x * 1.37 + cell.z * 7.13, cell.y * 2.71 + cell.z * 1.91));',
    '    if (h > 0.90) {',
    '      vec3 f = fract(p) - 0.5;',
    '      float d = length(f);',
    '      float core = pow(max(0.0, 1.0 - d * 4.2), 11.0);',
    '      float halo = pow(max(0.0, 1.0 - d * 2.0), 3.0) * 0.05;',
    '      float tw = 0.68 + 0.32 * sin(t * 1.6 + h * 44.0);',
    '      sum += (core + halo) * (h - 0.90) * 30.0 * tw;',
    '    }',
    '  }',
    '  return sum * 0.75;',
    '}',
    '',
    'vec3 sky(vec3 dir, float t) {',
    '  float st = starField(dir, t);',
    '  vec3 col = vec3(st * 0.95, st * 0.98, st * 1.05);',
    '  float neb = smoothstep(0.42, 0.86, fbm(vec2(dir.x * 2.3 + t * 0.02, dir.y * 2.3 + dir.z * 1.8))) * 0.10;',
    '  return col + uPalNebula * neb;',
    '}',
    '',
    'void main() {',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',
    '',
    '  vec3 camPos = vec3(sin(uYaw) * uCamZ, uCamY, cos(uYaw) * uCamZ);',
    '  vec3 fwd    = normalize(-camPos);',
    '  vec3 right  = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));',
    '  vec3 up     = cross(right, fwd);',
    '  vec3 dir    = normalize(fwd + right * uv.x * uFov + up * uv.y * uFov);',
    '',
    '  // --- geodesic integration -------------------------------------------',
    '  vec3  p = camPos;',
    '  vec3  v = dir;',
    '  vec3  hVec = cross(p, v);',
    '  float h2 = dot(hVec, hVec);',
    '  float dt = 0.06;',
    '  float minR = length(p);',
    '  float t = uTime;',
    '  bool  absorbed = false;',
    '  vec3  diskCol = vec3(0.0);',
    '  float crossings = 0.0;',
    '',
    '  for (int i = 0; i < 220; i++) {',
    '    if (float(i) >= uSteps) break;',
    '    float r = length(p);',
    '    if (r < HORIZON) { absorbed = true; break; }',
    '    if (r > ESCAPE) break;',
    '',
    '    // a = -1.5 * h² * p / r⁵  (photon orbit equation, unit speed)',
    '    v += p * (-1.5 * h2 * dt / (r * r * r * r * r));',
    '    vec3 prev = p;',
    '    p += v * dt;',
    '',
    '    // crossed the (flat) disk plane?',
    '    if (prev.y * p.y < 0.0) {',
    '      float s = prev.y / (prev.y - p.y);',
    '      vec3 hit = prev + (p - prev) * s;',
    '      float rr = length(hit.xz);',
    '      if (rr > R_IN && rr < R_OUT) {',
    '        float w = crossings < 0.5 ? 1.0 : 0.45;',
    '        diskCol += diskEmission(rr, atan(hit.z, hit.x), t) * w;',
    '        crossings += 1.0;',
    '      }',
    '    }',
    '',
    '    minR = min(minR, length(p));',
    '    dt = clamp(0.045 * (length(p) - HORIZON), 0.004, 0.22);',
    '  }',
    '',
    '  vec3 col;',
    '  if (absorbed) {',
    '    col = diskCol;',
    '  } else {',
    '    col = diskCol + sky(normalize(v), t);',
    '    // photon ring hugging the outside of the shadow',
    '    float prox = 1.0 - clamp((minR - HORIZON) / 0.55, 0.0, 1.0);',
    '    col += uPalRing * pow(prox, 7.0) * (0.9 + uEnergy * 0.8);',
    '  }',
    '',
    '  // error state: bleed toward red',
    '  col = mix(col, col * vec3(1.6, 0.25, 0.30), uError);',
    '',
    '  // soft vignette so the hole sits inside the page',
    '  float vig = smoothstep(1.35, 0.25, length(uv));',
    '  col *= 0.55 + 0.45 * vig;',
    '',
    '  // filmic-ish tonemap + gamma',
    '  col = col / (1.0 + col);',
    '  col = pow(max(col, 0.0), vec3(1.0 / 2.2));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var PALETTES = {
    idle: {
      mid: [0.30, 0.92, 1.00],
      outer: [0.55, 0.24, 0.95],
      ring: [0.55, 0.95, 1.00],
      nebula: [0.06, 0.05, 0.16],
      spin: 1.0,
      energy: 0.15,
      error: 0.0
    },
    listening: {
      mid: [0.35, 1.00, 0.72],
      outer: [0.18, 0.65, 0.95],
      ring: [0.45, 1.00, 0.80],
      nebula: [0.05, 0.12, 0.12],
      spin: 1.35,
      energy: 0.55,
      error: 0.0
    },
    thinking: {
      mid: [1.00, 0.82, 0.42],
      outer: [0.95, 0.36, 0.55],
      ring: [1.00, 0.90, 0.60],
      nebula: [0.14, 0.08, 0.06],
      spin: 2.6,
      energy: 1.0,
      error: 0.0
    },
    speaking: {
      mid: [0.72, 0.95, 1.00],
      outer: [0.70, 0.36, 1.00],
      ring: [0.80, 0.98, 1.00],
      nebula: [0.08, 0.06, 0.20],
      spin: 1.6,
      energy: 0.75,
      error: 0.0
    },
    error: {
      mid: [1.00, 0.55, 0.55],
      outer: [0.75, 0.12, 0.25],
      ring: [1.00, 0.45, 0.55],
      nebula: [0.14, 0.03, 0.06],
      spin: 0.5,
      energy: 0.35,
      error: 1.0
    }
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerp3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function mixState(a, b, t) {
    return {
      mid: lerp3(a.mid, b.mid, t),
      outer: lerp3(a.outer, b.outer, t),
      ring: lerp3(a.ring, b.ring, t),
      nebula: lerp3(a.nebula, b.nebula, t),
      spin: lerp(a.spin, b.spin, t),
      energy: lerp(a.energy, b.energy, t),
      error: lerp(a.error, b.error, t)
    };
  }

  function createBlackHole(container, options) {
    options = options || {};
    var reduceMotion = false;
    try {
      reduceMotion = !!global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { reduceMotion = false; }

    var canvas = document.createElement('canvas');
    canvas.className = 'blackhole-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.replaceChildren(canvas);

    // NB: plain factory calls — these return null when unsupported, which a
    // `new` call would silently turn into a truthy empty object.
    var renderer = WebGLBlackHole(canvas, options) || CanvasBlackHole(canvas, options);
    if (!renderer) {
      canvas.remove();
      return {
        canvas: null,
        mode: 'none',
        setState: function () {},
        getState: function () { return 'idle'; },
        resize: function () {},
        start: function () {},
        stop: function () {},
        destroy: function () {}
      };
    }
    var current = PALETTES.idle;
    var target = PALETTES.idle;
    var state = 'idle';
    var running = false;
    var visible = true;
    var frameId = null;
    var lastTime = 0;
    var time = 0;
    var paused = false;
    var yaw = 0;
    var targetYaw = 0;
    var pointerBound = false;

    function setState(next) {
      var key = String(next || 'idle').toLowerCase();
      if (!PALETTES[key]) key = 'idle';
      state = key;
      target = PALETTES[key];
      if (reduceMotion) { time = 2.4; renderer.render(current, time, { steps: 300 }); }
    }

    function tick(now) {
      frameId = global.requestAnimationFrame(tick);
      if (!lastTime) lastTime = now;
      var delta = Math.min(now - lastTime, 64);
      lastTime = now;
      if (paused || !visible) return;

      var blend = 1 - Math.pow(0.001, delta / 1000);
      current = mixState(current, target, Math.min(1, blend * 1.6));
      time += (delta / 1000) * (0.55 + current.spin * 0.25);

      // Camera parallax: follow the pointer when there is one, otherwise drift.
      var drift = Math.sin(time * 0.13) * 0.06;
      yaw += ((targetYaw + drift) - yaw) * Math.min(1, (delta / 1000) * 2.4);
      if (typeof renderer.setYaw === 'function') renderer.setYaw(yaw);
      if (typeof renderer.noteFrame === 'function') renderer.noteFrame(delta);
      renderer.render(current, time, renderer.tuning);
    }

    function start() {
      if (running) return;
      running = true;
      frameId = global.requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      if (frameId) global.cancelAnimationFrame(frameId);
      frameId = null;
      lastTime = 0;
    }

    function onVisibility() {
      paused = document.hidden;
      if (!paused) lastTime = 0;
    }

    function resize() {
      renderer.resize();
      if (reduceMotion) renderer.render(current, time || 2.4, { steps: 300 });
    }

    if (reduceMotion) {
      renderer.resize();
      renderer.render(current, 2.4, { steps: 300 });
    } else {
      renderer.resize();
      start();
      document.addEventListener('visibilitychange', onVisibility);
      global.addEventListener('resize', resize, { passive: true });

      // Only mice / trackpads get parallax; touch devices keep a calm drift.
      var finePointer = true;
      try { finePointer = !global.matchMedia || global.matchMedia('(pointer: fine)').matches; } catch (e) { finePointer = false; }
      if (finePointer) {
        var onPointer = function (event) {
          var w = global.innerWidth || 1;
          var nx = (event.clientX / w) * 2 - 1;
          targetYaw = Math.max(-0.55, Math.min(0.55, nx * 0.5));
        };
        global.addEventListener('pointermove', onPointer, { passive: true });
        pointerBound = onPointer;
      }
      if (typeof IntersectionObserver === 'function') {
        new IntersectionObserver(function (entries) {
          visible = entries[0] ? entries[0].isIntersecting : true;
          if (visible) lastTime = 0;
        }, { threshold: 0.01 }).observe(container);
      }
    }

    return {
      canvas: canvas,
      setState: setState,
      getState: function () { return state; },
      get mode() { return renderer.mode; },
      resize: resize,
      start: start,
      stop: stop,
      destroy: function () {
        stop();
        document.removeEventListener('visibilitychange', onVisibility);
        global.removeEventListener('resize', resize);
        if (pointerBound) global.removeEventListener('pointermove', pointerBound);
        renderer.destroy && renderer.destroy();
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* WebGL renderer                                                     */
  /* ------------------------------------------------------------------ */
  function WebGLBlackHole(canvas, options) { // factory, not a constructor
    var gl = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false
      }) || canvas.getContext('experimental-webgl');
    } catch (e) { gl = null; }
    if (!gl) return null;

    var program = buildProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
    if (!program) return null;

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPosition = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);

    var uniforms = {};
    ['uRes', 'uTime', 'uEnergy', 'uSpin', 'uSteps', 'uCamY', 'uCamZ', 'uFov', 'uYaw',
      'uPalMid', 'uPalOuter', 'uPalRing', 'uPalNebula', 'uError'
    ].forEach(function (name) { uniforms[name] = gl.getUniformLocation(program, name); });

    // Camera framing (tuned against offline renders of the same integrator).
    var camY = options.camY || 4.9;
    var camZ = options.camZ || 15.5;
    var fov = options.fov || 0.95;

    var yaw = 0;
    var quality = { scale: 1, steps: 190 };
    try {
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var pixels = (global.innerWidth || 800) * (global.innerHeight || 600) * dpr * dpr;
      if (pixels > 2600000) quality = { scale: 0.72, steps: 130 };
      else if (pixels > 1400000) quality = { scale: 0.88, steps: 160 };
    } catch (e) { /* keep defaults */ }

    var frameTimes = [];
    var slowFrames = 0;

    function resize() {
      var rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 800, height: 600 };
      var dpr = Math.min(global.devicePixelRatio || 1, 2) * quality.scale;
      var width = Math.max(1, Math.round((rect.width || 800) * dpr));
      var height = Math.max(1, Math.round((rect.height || 600) * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      gl.viewport(0, 0, width, height);
    }

    function render(palette, t) {
      if (!gl || gl.isContextLost && gl.isContextLost()) return;
      gl.useProgram(program);
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uTime, t);
      gl.uniform1f(uniforms.uEnergy, palette.energy);
      gl.uniform1f(uniforms.uSpin, palette.spin);
      gl.uniform1f(uniforms.uSteps, quality.steps);
      gl.uniform1f(uniforms.uCamY, camY);
      gl.uniform1f(uniforms.uCamZ, camZ);
      gl.uniform1f(uniforms.uFov, fov);
      gl.uniform1f(uniforms.uYaw, yaw);
      gl.uniform3f(uniforms.uPalMid, palette.mid[0], palette.mid[1], palette.mid[2]);
      gl.uniform3f(uniforms.uPalOuter, palette.outer[0], palette.outer[1], palette.outer[2]);
      gl.uniform3f(uniforms.uPalRing, palette.ring[0], palette.ring[1], palette.ring[2]);
      gl.uniform3f(uniforms.uPalNebula, palette.nebula[0], palette.nebula[1], palette.nebula[2]);
      gl.uniform1f(uniforms.uError, palette.error);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Lightweight adaptive quality: drop resolution, then steps, if we
    // cannot hold a reasonable frame rate on this device.
    function noteFrame(delta) {
      frameTimes.push(delta);
      if (frameTimes.length > 45) frameTimes.shift();
      if (frameTimes.length < 45) return;
      var avg = frameTimes.reduce(function (a, b) { return a + b; }, 0) / frameTimes.length;
      if (avg > 24) {
        slowFrames++;
        if (slowFrames >= 3 && quality.steps > 100) {
          quality.steps = Math.max(100, quality.steps - 40);
          slowFrames = 0;
        } else if (slowFrames >= 3 && quality.scale > 0.62) {
          quality.scale = Math.max(0.62, quality.scale - 0.15);
          frameTimes = [];
          slowFrames = 0;
          resize();
        }
      } else if (avg < 15 && slowFrames > 0) {
        slowFrames--;
      }
    }

    canvas.addEventListener('webglcontextlost', function (event) {
      event.preventDefault();
    });

    // The hero stage animates its height (e.g. when a chat starts), so watch
    // the element box instead of relying on window resize alone.
    var observer = null;
    if (typeof global.ResizeObserver === 'function') {
      try {
        observer = new global.ResizeObserver(function () { resize(); });
        observer.observe(canvas.parentElement || canvas);
      } catch (e) { observer = null; }
    }

    return {
      mode: 'webgl',
      tuning: { steps: 190 },
      resize: resize,
      render: render,
      noteFrame: noteFrame,
      setYaw: function (value) { yaw = value; },
      destroy: function () {
        if (observer) observer.disconnect();
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    };
  }

  function buildProgram(gl, vertexSrc, fragmentSrc) {
    var vertex = compile(gl, gl.VERTEX_SHADER, vertexSrc);
    var fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc);
    if (!vertex || !fragment) return null;
    var program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Black hole shader link failed:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Black hole shader compile failed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /* ------------------------------------------------------------------ */
  /* Canvas2D fallback                                                  */
  /* ------------------------------------------------------------------ */
  function CanvasBlackHole(canvas, options) { // factory, not a constructor
    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return null;
    var stars = [];
    var i;
    for (i = 0; i < 160; i++) {
      stars.push({
        a: Math.random() * Math.PI * 2,
        r: 0.55 + Math.random() * 0.7,
        s: 0.4 + Math.random() * 1.5,
        o: 0.25 + Math.random() * 0.7,
        p: Math.random() * Math.PI * 2
      });
    }

    function resize() {
      var rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 800, height: 600 };
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round((rect.width || 800) * dpr));
      canvas.height = Math.max(1, Math.round((rect.height || 600) * dpr));
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    }

    function rgba(colour, alpha) {
      return 'rgba(' + colour.map(function (c) {
        return Math.round(Math.min(1, Math.max(0, c)) * 255);
      }).join(',') + ',' + Math.max(0, Math.min(1, alpha)) + ')';
    }

    // Annulus sector path in the (flattened) disk plane.
    function band(ctx, rIn, rOut, from, to) {
      ctx.beginPath();
      ctx.arc(0, 0, rOut, from, to);
      ctx.arc(0, 0, rIn, to, from, true);
      ctx.closePath();
    }

    function diskBand(ctx, palette, rIn, rOut, from, to, alpha, t) {
      // Doppler beaming: one side of the disk is brighter.
      var grad = ctx.createLinearGradient(-rOut, 0, rOut, 0);
      grad.addColorStop(0, rgba(palette.outer, alpha * 0.55));
      grad.addColorStop(0.32, rgba(palette.mid, alpha));
      grad.addColorStop(0.62, rgba(palette.ring, alpha * 0.85));
      grad.addColorStop(1, rgba(palette.outer, alpha * 0.35));
      band(ctx, rIn, rOut, from, to);
      ctx.fillStyle = grad;
      ctx.fill();

      // turbulent streaks
      var streaks = 7;
      for (var i = 0; i < streaks; i++) {
        var phase = (i / streaks) * (to - from) + from + Math.sin(t * 0.9 + i * 2.1) * 0.09;
        var rr = rIn + (rOut - rIn) * (0.18 + 0.62 * ((i * 37) % 17) / 17);
        ctx.beginPath();
        ctx.arc(0, 0, rr, phase, phase + 0.22 + 0.14 * Math.sin(i * 3.7));
        ctx.lineWidth = (rOut - rIn) * 0.10;
        ctx.strokeStyle = rgba(palette.mid, alpha * (0.18 + 0.22 * ((i * 13) % 7) / 7));
        ctx.stroke();
      }
    }

    function render(palette, t) {
      var w = canvas.width, h = canvas.height;
      var cx = w / 2, cy = h / 2;
      var size = Math.min(w, h);
      var horizon = size * 0.155;
      var rIn = horizon * 1.30;
      var rOut = horizon * 3.10;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';

      // deep space
      var space = ctx.createRadialGradient(cx, cy * 0.9, size * 0.05, cx, cy, size * 0.85);
      space.addColorStop(0, '#0a1230');
      space.addColorStop(0.55, '#05080f');
      space.addColorStop(1, '#02030a');
      ctx.fillStyle = space;
      ctx.fillRect(0, 0, w, h);

      // stars
      for (var i = 0; i < stars.length; i++) {
        var star = stars[i];
        var angle = star.a + t * 0.04 * star.s;
        var dist = size * star.r * 0.92;
        var sx = cx + Math.cos(angle) * dist;
        var sy = cy + Math.sin(angle) * dist * 0.78;
        var tw = 0.55 + 0.45 * Math.sin(t * 1.5 + star.p);
        ctx.globalAlpha = star.o * tw;
        ctx.fillStyle = '#d6ecff';
        var pixel = Math.max(1, star.s * (size / 700));
        ctx.fillRect(sx, sy, pixel, pixel);
      }
      ctx.globalAlpha = 1;

      // ambient glow behind the disk
      var amb = ctx.createRadialGradient(cx, cy, horizon * 1.1, cx, cy, horizon * 4.2);
      amb.addColorStop(0, rgba(palette.mid, 0.20 + palette.energy * 0.12));
      amb.addColorStop(0.55, rgba(palette.outer, 0.07));
      amb.addColorStop(1, rgba(palette.outer, 0));
      ctx.fillStyle = amb;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.30);

      // far half of the disk (passes behind the hole)
      diskBand(ctx, palette, rIn, rOut, Math.PI, Math.PI * 2, 0.45, t);
      ctx.restore();

      // lensed image of the far disk: thin arc over the shadow
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.62);
      ctx.beginPath();
      ctx.arc(0, 0, horizon * 1.22, Math.PI * 1.12, Math.PI * 1.88);
      ctx.lineWidth = horizon * 0.24;
      ctx.strokeStyle = rgba(palette.ring, 0.55 + palette.energy * 0.25);
      ctx.stroke();
      ctx.restore();

      // event horizon
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, horizon, 0, Math.PI * 2);
      var shadowGrad = ctx.createRadialGradient(cx, cy, horizon * 0.2, cx, cy, horizon);
      shadowGrad.addColorStop(0, '#000000');
      shadowGrad.addColorStop(0.82, '#000000');
      shadowGrad.addColorStop(1, 'rgba(2,4,10,0.98)');
      ctx.fillStyle = shadowGrad;
      ctx.fill();

      // photon ring
      ctx.lineWidth = Math.max(1.2, size * 0.0045);
      ctx.strokeStyle = rgba(palette.ring, 0.95);
      ctx.shadowBlur = horizon * 0.55;
      ctx.shadowColor = rgba(palette.ring, 0.9);
      ctx.stroke();
      ctx.restore();

      // near half of the disk (in front of the hole)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.30);
      diskBand(ctx, palette, rIn, rOut, 0, Math.PI, 0.78, t);
      ctx.restore();

      if (palette.error > 0.2) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = 'rgba(255,40,70,' + (palette.error * 0.16) + ')';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }

    return {
      mode: 'canvas2d',
      tuning: { steps: 0 },
      resize: resize,
      render: render
    };
  }

  global.JarvisBlackHole = {
    create: createBlackHole,
    palettes: PALETTES
  };
})(typeof window !== 'undefined' ? window : this);
