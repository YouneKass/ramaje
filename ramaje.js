/* =====================================================================
   Ramaje · Moxen
   Un árbol fractal que crece rama a rama delante de una luna. Cada rama
   se divide en dos o tres, más cortas y finas, con ángulos y largos al
   azar (con semilla) y una leve tendencia a buscar la luz; crecen en
   cascada, del tronco a las puntas, y en las puntas abren flores. El
   cursor es el viento: las ramas finas se doblan más que las gruesas, y
   las ráfagas sueltan pétalos. Un clic deshoja el árbol, lo recoge hacia
   el tronco y hace crecer otro. En canvas, sin dependencias.

     const r = Ramaje(document.querySelector('[data-ramaje]'));
     r.crece();          // otro árbol

   El viento es un resorte: se carga con la velocidad del cursor, se
   pasa un poco y vuelve, como una rama de verdad.
   ===================================================================== */
(function () {
  'use strict';

  // un azar con semilla (mulberry32): cada árbol se puede repetir
  function semilla(s) {
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const HZ = 60, PASO = 1 / HZ;
  const PROFUNDO = 10;              // niveles de ramas como mucho
  const suave = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const sale = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);

  /* ── el árbol ──────────────────────────────────────────────────── */
  /* Una rama: su ángulo respecto a la madre, su largo, su curva y cuándo
     empieza a crecer. Los tiempos van en cascada: una hija arranca
     cuando a su madre le falta poco para terminar. */
  function arbol(sem, alto) {
    const azar = semilla(sem);
    const ramas = [];
    function rama(madre, angulo, largo, nivel, inicio) {
      const dura = .2 + largo / alto * 1.5;
      const r = { madre, angulo, largo, nivel, inicio, dura, curva: (azar() - .5) * .24, fase: azar() * 6.28, hijas: 0 };
      ramas.push(r);
      if (nivel >= PROFUNDO || largo < alto * .012) return r;
      const n = nivel > 1 && azar() < .24 ? 3 : 2;
      const abre = .32 + azar() * .22;
      for (let k = 0; k < n; k++) {
        // las hijas se abren a los lados, sin simetría perfecta
        const lado = n === 2 ? (k ? 1 : -1) : k - 1;
        let a = lado * abre * (.65 + azar() * .6) + (azar() - .5) * .14;
        if (n === 3 && lado === 0) a *= .3;
        r.hijas++;
        rama(r, a, largo * (.66 + azar() * .16), nivel + 1, inicio + dura * (.82 + azar() * .1));
      }
      return r;
    }
    rama(null, (azar() - .5) * .08, alto * .2, 0, 0);
    /* Ordenadas por nivel: al dibujar, cada madre se calcula antes que sus
       hijas, y cada nivel es un solo trazo. Cada rama guarda el índice de
       su madre para no buscarla en cada cuadro. */
    ramas.sort((a, b) => a.nivel - b.nivel);
    ramas.forEach((r, i) => { r.i = i; });
    ramas.forEach(r => { r.m = r.madre ? r.madre.i : -1; });
    // cuánto tarda el árbol entero: la última punta en terminar
    const total = Math.max(...ramas.map(r => r.inicio + r.dura));
    return { ramas, total };
  }

  function Ramaje(escena, opciones) {
    const o = Object.assign({ semilla: 3 }, opciones);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lienzo = escena.querySelector('canvas');
    const ctx = lienzo.getContext('2d');
    const azar = semilla(97);

    let W = 0, H = 0, rgb = '244, 244, 244', LUNA = .05, raizX = 0, raizY = 0, alto = 600, escala = 1;
    let sem = o.semilla, actual = null, edad = 0, estado = 'quieto', recoge = 0;
    let petalos = [];
    // por rama: dónde quedó su punta en el último cuadro (para las hijas y las flores)
    let px, py, pa;

    function ajusta() {
      const r = Math.min(2, devicePixelRatio || 1);
      W = escena.clientWidth; H = escena.clientHeight;
      lienzo.width = Math.round(W * r); lienzo.height = Math.round(H * r);
      ctx.setTransform(r, 0, 0, r, 0, 0);
      const css = getComputedStyle(escena);
      rgb = css.getPropertyValue('--rm-rama').trim() || rgb;
      LUNA = parseFloat(css.getPropertyValue('--rm-luna')) || LUNA;
      // el árbol cabe a lo alto y a lo ancho (en un teléfono, el ancho manda y se centra)
      alto = Math.min(H * .95, W * .92);
      raizX = W / 2; raizY = Math.min(H * .86, H / 2 + alto * .5);
      escala = Math.max(.6, Math.min(1, alto / 700));
      planta(sem);
      if (estado === 'quieto') edad = actual.total + 2;
    }
    function planta(s) {
      actual = arbol(s, alto);
      const n = actual.ramas.length;
      px = new Float32Array(n); py = new Float32Array(n); pa = new Float32Array(n);
    }

    /* ── el viento ────────────────────────────────────────────────── */
    let mx = 0, my = 0, pmx = null, dentro = false, viento = 0, vv = 0, empuje = 0, tiempo = 0;
    function apunta(e) {
      const r = escena.getBoundingClientRect();
      mx = e.clientX - r.left; my = e.clientY - r.top;
      dentro = true;
    }
    escena.addEventListener('pointermove', apunta);
    escena.addEventListener('pointerleave', () => { dentro = false; pmx = null; });
    escena.addEventListener('pointerdown', e => { apunta(e); crece(); });
    escena.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); crece();
    });

    /* Otro árbol: primero se le caen todas las flores, después las ramas
       se recogen hacia el tronco (de las puntas hacia dentro) y entonces
       brota el nuevo. */
    function crece() {
      if (estado === 'recoge') return;
      sueltaFlores(1);
      if (reduce) { sem++; planta(sem); edad = actual.total + 2; dibuja(); return; }
      estado = 'recoge'; recoge = 0;
    }

    function sueltaFlores(fraccion) {
      actual.ramas.forEach((r, i) => {
        if (r.hijas || azar() > fraccion) return;
        if (flor(r) < .5) return;
        petalos.push({ x: px[i], y: py[i], vx: (azar() - .5) * 30 + viento * 160, vy: -azar() * 30, giro: azar() * 6, vg: (azar() - .5) * 6, vida: 1, suelo: false, r: (1.6 + azar() * 1.6) * escala });
      });
      if (petalos.length > 1400) petalos.splice(0, petalos.length - 1400);
    }

    // cuánto ha crecido una rama (0 a 1) y cuánto se ha abierto su flor
    const crecido = r => sale((edad - r.inicio) / r.dura);
    const flor = r => sale((edad - r.inicio - r.dura) / .7);

    function paso() {
      tiempo += PASO;
      /* El viento: la velocidad del cursor carga el resorte y, si el
         cursor está quieto, el árbol se aparta un poco de él. */
      let objetivo = 0;
      if (dentro) {
        if (pmx !== null) empuje += ((mx - pmx) * HZ / 900 - empuje) * .12;
        pmx = mx;
        objetivo = Math.max(-1.4, Math.min(1.4, empuje + (raizX - mx) / W * -.35));
      } else empuje *= .9;
      vv += ((objetivo - viento) * 26 - vv * 3.4) * PASO;
      viento += vv * PASO;
      // las ráfagas fuertes sueltan algún pétalo
      if (Math.abs(vv) > .9 && estado === 'quieto' && azar() < Math.min(.6, Math.abs(vv) * .12)) sueltaFlores(.012);

      if (estado === 'recoge') {
        recoge += PASO;
        if (recoge >= .75) { sem++; planta(sem); edad = 0; estado = 'crece'; }
      } else {
        edad += PASO;
        if (estado === 'crece' && edad > actual.total + .8) estado = 'quieto';
      }

      // los pétalos caen balanceándose, el viento los lleva y en el suelo se apagan
      for (let i = petalos.length - 1; i >= 0; i--) {
        const p = petalos[i];
        if (p.suelo) { p.vida -= PASO / 2.2; if (p.vida <= 0) petalos.splice(i, 1); continue; }
        p.vx += ((viento * 120 + Math.sin(tiempo * 2 + p.giro) * 22) - p.vx) * .03;
        p.vy += (48 - p.vy) * .025;
        p.x += p.vx * PASO; p.y += p.vy * PASO; p.giro += p.vg * PASO;
        if (p.y >= raizY - 1) { p.y = raizY - 1 + azar() * 2; p.suelo = true; }
        if (p.x < -20 || p.x > W + 20) petalos.splice(i, 1);
      }
    }

    /* ── el dibujo ─────────────────────────────────────────────────── */
    const color = a => 'rgba(' + rgb + ',' + a.toFixed(3) + ')';
    function dibuja() {
      ctx.clearRect(0, 0, W, H);
      // la luna: un disco tenue detrás de la copa, con su borde
      const ly = raizY - alto * .53, lr = Math.min(W * .4, alto * .33);
      ctx.beginPath(); ctx.arc(raizX, ly, lr, 0, Math.PI * 2);
      ctx.fillStyle = color(LUNA); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = color(LUNA * 1.6); ctx.stroke();
      // el suelo: una línea que se apaga hacia los lados
      const g = ctx.createLinearGradient(raizX - W * .42, 0, raizX + W * .42, 0);
      g.addColorStop(0, color(0)); g.addColorStop(.5, color(.35)); g.addColorStop(1, color(0));
      ctx.fillStyle = g; ctx.fillRect(raizX - W * .42, raizY, W * .84, 1);

      /* Las ramas, por niveles: todas las de un nivel tienen el mismo
         grueso y van en un solo trazo. Al recoger, las puntas se retraen
         primero y el tronco al final. */
      const r0 = Math.max(4, alto * .02);
      const rec = estado === 'recoge' ? recoge / .75 : 0;
      const ramas = actual.ramas;
      ctx.lineCap = 'round';
      for (let i = 0, n = 0; n <= PROFUNDO; n++) {
        ctx.beginPath();
        let algo = false;
        for (; i < ramas.length && ramas[i].nivel === n; i++) {
          const r = ramas[i];
          // de dónde sale: la punta de su madre (o la raíz)
          const m = r.m;
          const x0 = m < 0 ? raizX : px[m], y0 = m < 0 ? raizY : py[m];
          const base = m < 0 ? -Math.PI / 2 : pa[m];
          /* El viento dobla más las ramas finas; cada una, además, se
             mece a su ritmo. */
          const flex = .018 + .026 * r.nivel;
          const a = base + r.angulo + viento * flex + Math.sin(tiempo * 1.6 + r.fase) * .012 * (r.nivel + 1) * (1 + Math.abs(viento));
          let k = crecido(r);
          if (rec > 0) k *= 1 - suave((rec - (PROFUNDO - r.nivel) / (PROFUNDO + 2) * .55) / .45);
          const L = r.largo * k;
          const x1 = x0 + Math.cos(a) * L, y1 = y0 + Math.sin(a) * L;
          px[i] = x1; py[i] = y1; pa[i] = a;
          if (L < .5) continue;
          // una curva leve, a un lado: las ramas de verdad no son rectas
          const cx = (x0 + x1) / 2 - Math.sin(a) * r.curva * L, cy = (y0 + y1) / 2 + Math.cos(a) * r.curva * L;
          ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1);
          algo = true;
        }
        if (!algo) continue;
        ctx.lineWidth = Math.max(.7, r0 * Math.pow(.68, n));
        ctx.strokeStyle = color(n < 3 ? 1 : .95 - n * .03);
        ctx.stroke();
      }

      // las flores de las puntas: un punto que se abre cuando la rama termina
      ctx.beginPath();
      for (let i = 0; i < ramas.length; i++) {
        const r = ramas[i];
        if (r.hijas) continue;
        let f = flor(r);
        if (rec > 0) f = 0;
        if (f <= .01) continue;
        const rr = (1.2 + (r.fase % 1) * 1.6) * f * escala;
        ctx.moveTo(px[i] + rr, py[i]); ctx.arc(px[i], py[i], rr, 0, Math.PI * 2);
      }
      ctx.fillStyle = color(.9); ctx.fill();

      // los pétalos que caen: elipses que giran
      petalos.forEach(p => {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r * 1.5, p.r * (.45 + .45 * Math.abs(Math.sin(p.giro))), p.giro, 0, Math.PI * 2);
        ctx.fillStyle = color(.75 * p.vida); ctx.fill();
      });
    }

    ajusta();
    if (reduce) {
      dibuja();
      new ResizeObserver(() => { ajusta(); dibuja(); }).observe(escena);
      return { crece };
    }
    let antes = W, despues = H;
    new ResizeObserver(() => {
      if (escena.clientWidth !== antes || escena.clientHeight !== despues) { ajusta(); antes = W; despues = H; }
    }).observe(escena);

    let previo = null, acumulado = 0;
    function cuadro(ahora) {
      if (previo !== null) acumulado = Math.min(acumulado + (ahora - previo) / 1000, PASO * 4);
      previo = ahora;
      let dio = false;
      while (acumulado >= PASO * .999) { paso(); acumulado -= PASO; dio = true; }
      if (dio) dibuja();
      requestAnimationFrame(cuadro);
    }
    dibuja();
    requestAnimationFrame(cuadro);

    return { crece };
  }

  window.Ramaje = Ramaje;
})();