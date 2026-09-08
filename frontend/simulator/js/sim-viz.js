/**
 * Simulator visual engine — orbit of clients + TPS sparkline
 */
(function (global) {
    const state = {
        clients: [],
        tpsHistory: [],
        running: false,
        pulses: [],
        raf: 0
    };

    let orbitCanvas;
    let sparkCanvas;

    function resize(canvas, cssH) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor((cssH || rect.height) * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        return { w, h, dpr };
    }

    function actionColor(action) {
        switch (action) {
            case 'TRANSFER': return '#818cf8';
            case 'DEPOSIT': return '#fbbf24';
            case 'READ': return '#34d399';
            case 'WAIT': return '#64748b';
            case 'DONE': return '#6ee7b7';
            case 'STOP': return '#f59e0b';
            default: return '#22d3ee';
        }
    }

    function drawOrbit() {
        if (!orbitCanvas) return;
        const { w, h, dpr } = resize(orbitCanvas, 300);
        const ctx = orbitCanvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const cx = w * 0.5;
        const cy = h * 0.52;
        const t = performance.now() / 1000;

        // ambient rings
        for (let i = 1; i <= 3; i++) {
            ctx.beginPath();
            ctx.arc(cx, cy, (42 + i * 38) * dpr, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(34, 211, 238, ${0.04 + i * 0.02})`;
            ctx.lineWidth = 1 * dpr;
            ctx.stroke();
        }

        // core
        const coreR = 22 * dpr;
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, coreR * 2.2);
        g.addColorStop(0, state.running ? 'rgba(34, 211, 238, 0.55)' : 'rgba(100, 116, 139, 0.35)');
        g.addColorStop(1, 'rgba(34, 211, 238, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fillStyle = '#0b1220';
        ctx.fill();
        ctx.strokeStyle = state.running ? '#22d3ee' : '#475569';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = `600 ${11 * dpr}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('CORE', cx, cy);

        const n = Math.max(state.clients.length, 1);
        const show = state.clients.length ? state.clients : [];

        show.forEach((c, i) => {
            const ring = 70 + (i % 3) * 36;
            const speed = 0.18 + (i % 5) * 0.03;
            const ang = (i / n) * Math.PI * 2 + t * speed * (state.running ? 1 : 0.15);
            const x = cx + Math.cos(ang) * ring * dpr;
            const y = cy + Math.sin(ang) * ring * dpr * 0.72;
            const active = c.status === 'running' && c.action && c.action !== 'WAIT' && c.action !== 'DONE';
            const color = actionColor(c.action);

            if (active) {
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(x, y);
                ctx.strokeStyle = `${color}55`;
                ctx.lineWidth = 1.2 * dpr;
                ctx.stroke();
            }

            const r = (active ? 6.5 : 4.5) * dpr;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            if (active) {
                ctx.shadowColor = color;
                ctx.shadowBlur = 14 * dpr;
            }
            ctx.fill();
            ctx.shadowBlur = 0;

            if (active || n <= 24) {
                ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
                ctx.font = `${9 * dpr}px JetBrains Mono, monospace`;
                ctx.fillText(String(c.id), x, y - 10 * dpr);
            }
        });

        // pulses from recent activity
        state.pulses = state.pulses.filter((p) => {
            p.life += 0.03;
            if (p.life >= 1) return false;
            ctx.beginPath();
            ctx.arc(cx, cy, (28 + p.life * 90) * dpr, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(34, 211, 238, ${(1 - p.life) * 0.35})`;
            ctx.lineWidth = 2 * dpr;
            ctx.stroke();
            return true;
        });
    }

    function drawSpark() {
        if (!sparkCanvas) return;
        const { w, h, dpr } = resize(sparkCanvas, 120);
        const ctx = sparkCanvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const hist = state.tpsHistory;
        const pad = 8 * dpr;
        const max = Math.max(4, ...hist);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = 1 * dpr;
        for (let i = 0; i < 3; i++) {
            const y = pad + ((h - pad * 2) * i) / 2;
            ctx.beginPath();
            ctx.moveTo(pad, y);
            ctx.lineTo(w - pad, y);
            ctx.stroke();
        }

        if (hist.length < 2) return;

        ctx.beginPath();
        hist.forEach((v, i) => {
            const x = pad + ((w - pad * 2) * i) / Math.max(1, hist.length - 1);
            const y = h - pad - (v / max) * (h - pad * 2);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2 * dpr;
        ctx.shadowColor = 'rgba(52, 211, 153, 0.5)';
        ctx.shadowBlur = 10 * dpr;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // fill
        const lastX = pad + (w - pad * 2);
        ctx.lineTo(lastX, h - pad);
        ctx.lineTo(pad, h - pad);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, pad, 0, h);
        grad.addColorStop(0, 'rgba(52, 211, 153, 0.25)');
        grad.addColorStop(1, 'rgba(52, 211, 153, 0)');
        ctx.fillStyle = grad;
        ctx.fill();
    }

    function frame() {
        drawOrbit();
        drawSpark();
        state.raf = requestAnimationFrame(frame);
    }

    function init() {
        orbitCanvas = document.getElementById('simOrbitCanvas');
        sparkCanvas = document.getElementById('simSparkCanvas');
        if (!orbitCanvas) return;
        cancelAnimationFrame(state.raf);
        state.raf = requestAnimationFrame(frame);
    }

    function update(payload) {
        state.running = !!payload.running;
        state.clients = payload.clients || [];
        if (typeof payload.tps === 'number') {
            state.tpsHistory.push(payload.tps);
            if (state.tpsHistory.length > 48) state.tpsHistory.shift();
        }
        if (payload.pulse) {
            state.pulses.push({ life: 0 });
            if (state.pulses.length > 6) state.pulses.shift();
        }
    }

    global.SimViz = { init, update };
})(window);
