/**
 * COBOL CoreBank Admin — Live Server Load Visualization
 * Canvas charts, gauges, particles — driven by /api/system-status samples.
 */
(function (global) {
    const HISTORY = 60;
    const COLORS = {
        tps: '#22d3ee',
        tpsFill: 'rgba(34, 211, 238, 0.22)',
        clients: '#fbbf24',
        conn: '#a78bfa',
        workers: '#34d399',
        grid: 'rgba(148, 163, 184, 0.12)',
        text: 'rgba(148, 163, 184, 0.75)',
        track: 'rgba(255,255,255,0.08)'
    };

    const state = {
        ready: false,
        samples: [],
        display: { tps: 0, clients: 0, conn: 0, workers: 0, load: 0 },
        target: { tps: 0, clients: 0, conn: 0, workers: 0, load: 0 },
        peakTps: 0,
        workerMax: 16,
        particles: [],
        raf: 0
    };

    let els = {};

    function clamp(n, a, b) {
        return Math.max(a, Math.min(b, n));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function loadIndex(sample) {
        const tpsN = clamp(sample.tps / 40, 0, 1);
        const clientN = clamp(sample.clients / 50, 0, 1);
        const connN = clamp(sample.connections / 40, 0, 1);
        const workerN = clamp(sample.workers / Math.max(1, sample.workerMax), 0, 1);
        const queueN = clamp(sample.queueDepth / 30, 0, 1);
        const httpN = clamp(sample.httpInFlight / 20, 0, 1);
        return Math.round(
            (tpsN * 0.34 + workerN * 0.22 + clientN * 0.16 + connN * 0.12 + queueN * 0.1 + httpN * 0.06) * 100
        );
    }

    function loadLabel(idx) {
        if (idx < 12) return 'Idle';
        if (idx < 35) return 'Nominal';
        if (idx < 60) return 'Elevated';
        if (idx < 80) return 'High';
        return 'Critical';
    }

    function resizeCanvas(canvas, cssH) {
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

    function drawMainChart(canvas) {
        const { w, h, dpr } = resizeCanvas(canvas, 260);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const pad = { l: 42 * dpr, r: 14 * dpr, t: 16 * dpr, b: 28 * dpr };
        const plotW = w - pad.l - pad.r;
        const plotH = h - pad.t - pad.b;

        const samples = state.samples;
        const maxTps = Math.max(8, ...samples.map((s) => s.tps), state.peakTps);
        const maxClients = Math.max(8, ...samples.map((s) => s.clients));
        const maxConn = Math.max(8, ...samples.map((s) => s.connections));
        const maxWorkers = Math.max(state.workerMax, ...samples.map((s) => s.workers));

        // grid
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1 * dpr;
        ctx.font = `${11 * dpr}px JetBrains Mono, monospace`;
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const y = pad.t + (plotH * i) / 4;
            ctx.beginPath();
            ctx.moveTo(pad.l, y);
            ctx.lineTo(w - pad.r, y);
            ctx.stroke();
            const label = ((maxTps * (4 - i)) / 4).toFixed(0);
            ctx.fillText(label, pad.l - 8 * dpr, y + 4 * dpr);
        }

        function seriesPath(key, maxV, close) {
            if (samples.length < 2) return null;
            const pts = samples.map((s, i) => {
                const x = pad.l + (plotW * i) / Math.max(1, HISTORY - 1);
                const y = pad.t + plotH - (clamp(s[key] / maxV, 0, 1) * plotH);
                return { x, y };
            });
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            if (close) {
                ctx.lineTo(pts[pts.length - 1].x, pad.t + plotH);
                ctx.lineTo(pts[0].x, pad.t + plotH);
                ctx.closePath();
            }
            return pts;
        }

        // TPS area
        if (samples.length >= 2) {
            seriesPath('tps', maxTps, true);
            const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
            grad.addColorStop(0, COLORS.tpsFill);
            grad.addColorStop(1, 'rgba(34, 211, 238, 0)');
            ctx.fillStyle = grad;
            ctx.fill();

            seriesPath('tps', maxTps, false);
            ctx.strokeStyle = COLORS.tps;
            ctx.lineWidth = 2.4 * dpr;
            ctx.shadowColor = 'rgba(34, 211, 238, 0.55)';
            ctx.shadowBlur = 12 * dpr;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // secondary lines
            [
                ['clients', maxClients, COLORS.clients, 1.5],
                ['connections', maxConn, COLORS.conn, 1.4],
                ['workers', maxWorkers, COLORS.workers, 1.5]
            ].forEach(([key, maxV, color, lw]) => {
                seriesPath(key, maxV, false);
                ctx.strokeStyle = color;
                ctx.lineWidth = lw * dpr;
                ctx.globalAlpha = 0.9;
                ctx.stroke();
                ctx.globalAlpha = 1;
            });

            // head glow on latest TPS
            const last = samples[samples.length - 1];
            const lx = pad.l + (plotW * (samples.length - 1)) / Math.max(1, HISTORY - 1);
            const ly = pad.t + plotH - (clamp(last.tps / maxTps, 0, 1) * plotH);
            ctx.beginPath();
            ctx.arc(lx, ly, 4.5 * dpr, 0, Math.PI * 2);
            ctx.fillStyle = '#ecfeff';
            ctx.shadowColor = COLORS.tps;
            ctx.shadowBlur = 16 * dpr;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'left';
        ctx.fillText('TPS scale', pad.l, h - 8 * dpr);
    }

    function drawGauge(canvas, value, max, color, asInt) {
        const { w, h, dpr } = resizeCanvas(canvas, 120);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2 + 6 * dpr;
        const r = Math.min(w, h) * 0.36;
        const start = Math.PI * 0.75;
        const end = Math.PI * 2.25;
        const pct = clamp(value / Math.max(max, 0.0001), 0, 1);
        const angle = start + (end - start) * pct;

        ctx.lineCap = 'round';
        ctx.lineWidth = 10 * dpr;
        ctx.strokeStyle = COLORS.track;
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, end);
        ctx.stroke();

        const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
        grad.addColorStop(0, color);
        grad.addColorStop(1, '#ecfeff');
        ctx.strokeStyle = grad;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, angle);
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#f8fafc';
        ctx.font = `600 ${18 * dpr}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = asInt ? String(Math.round(value)) : value.toFixed(1);
        ctx.fillText(label, cx, cy - 2 * dpr);

        ctx.fillStyle = COLORS.text;
        ctx.font = `${9 * dpr}px JetBrains Mono, monospace`;
        ctx.fillText(` / ${Math.round(max)}`, cx, cy + 16 * dpr);
    }

    function ensureParticles(count) {
        while (state.particles.length < count) {
            state.particles.push({
                x: Math.random(),
                y: Math.random(),
                vx: (Math.random() - 0.5) * 0.004,
                vy: -0.002 - Math.random() * 0.006,
                r: 0.6 + Math.random() * 1.8,
                a: 0.25 + Math.random() * 0.55
            });
        }
        if (state.particles.length > count) {
            state.particles.length = count;
        }
    }

    function drawParticles(canvas) {
        const { w, h, dpr } = resizeCanvas(canvas, 56);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const intensity = clamp(state.display.load / 100, 0, 1);
        const count = Math.round(8 + intensity * 42);
        ensureParticles(count);

        // soft base wash
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, 'rgba(6, 182, 212, 0.05)');
        g.addColorStop(0.5, `rgba(52, 211, 153, ${0.05 + intensity * 0.12})`);
        g.addColorStop(1, 'rgba(251, 191, 36, 0.05)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        state.particles.forEach((p) => {
            p.x += p.vx * (0.6 + intensity * 2.2);
            p.y += p.vy * (0.6 + intensity * 2.5);
            if (p.y < -0.05) {
                p.y = 1.05;
                p.x = Math.random();
            }
            if (p.x < 0) p.x = 1;
            if (p.x > 1) p.x = 0;

            const x = p.x * w;
            const y = p.y * h;
            ctx.beginPath();
            ctx.arc(x, y, p.r * dpr, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(34, 211, 238, ${p.a * (0.35 + intensity * 0.65)})`;
            ctx.fill();
        });
    }

    function tickUiText() {
        const load = Math.round(state.display.load);
        if (els.loadIndexValue) els.loadIndexValue.textContent = String(load);
        if (els.gaugeLoadSub) els.gaugeLoadSub.textContent = loadLabel(load);
        if (els.gaugeTpsSub) els.gaugeTpsSub.textContent = `${state.display.tps.toFixed(1)} TPS`;
        if (els.gaugeWorkersSub) {
            els.gaugeWorkersSub.textContent = `${Math.round(state.display.workers)} / ${state.workerMax}`;
        }
        if (els.loadPeakTps) els.loadPeakTps.textContent = state.peakTps.toFixed(1);
        if (els.loadStudio) {
            els.loadStudio.classList.toggle('is-active', load > 15);
        }
        if (els.loadLivePill) {
            els.loadLivePill.classList.toggle('is-hot', load >= 60);
        }
    }

    function frame() {
        // smooth display toward targets
        const t = 0.12;
        state.display.tps = lerp(state.display.tps, state.target.tps, t);
        state.display.clients = lerp(state.display.clients, state.target.clients, t);
        state.display.conn = lerp(state.display.conn, state.target.conn, t);
        state.display.workers = lerp(state.display.workers, state.target.workers, t);
        state.display.load = lerp(state.display.load, state.target.load, t);

        if (els.mainChart) drawMainChart(els.mainChart);
        if (els.gaugeLoad) drawGauge(els.gaugeLoad, state.display.load, 100, '#22d3ee', true);
        if (els.gaugeTps) {
            const tmax = Math.max(10, state.peakTps * 1.15, state.display.tps * 1.2);
            drawGauge(els.gaugeTps, state.display.tps, tmax, '#34d399', false);
        }
        if (els.gaugeWorkers) {
            drawGauge(els.gaugeWorkers, state.display.workers, state.workerMax, '#fbbf24', true);
        }
        if (els.particles) drawParticles(els.particles);
        tickUiText();

        state.raf = requestAnimationFrame(frame);
    }

    function setBar(elFill, elVal, value, max) {
        if (elVal) elVal.textContent = String(Math.round(value));
        if (elFill) elFill.style.width = `${clamp((value / Math.max(max, 1)) * 100, 0, 100)}%`;
    }

    function pushSample(raw) {
        if (!state.ready) return;
        const sample = {
            t: Date.now(),
            tps: Number(raw.tps) || 0,
            clients: Number(raw.clients) || 0,
            connections: Number(raw.connections) || 0,
            workers: Number(raw.workers) || 0,
            workerMax: Number(raw.workerMax) || state.workerMax || 16,
            queueDepth: Number(raw.queueDepth) || 0,
            httpInFlight: Number(raw.httpInFlight) || 0
        };
        state.workerMax = sample.workerMax;
        state.peakTps = Math.max(state.peakTps, sample.tps);
        state.samples.push(sample);
        if (state.samples.length > HISTORY) state.samples.shift();

        const idx = loadIndex(sample);
        state.target.tps = sample.tps;
        state.target.clients = sample.clients;
        state.target.conn = sample.connections;
        state.target.workers = sample.workers;
        state.target.load = idx;

        setBar(els.barHttpFill, els.barHttpVal, sample.httpInFlight, 24);
        setBar(els.barQueueFill, els.barQueueVal, sample.queueDepth, 40);
        setBar(els.barClientsFill, els.barClientsVal, sample.clients, 60);
    }

    function init() {
        els = {
            loadStudio: document.getElementById('loadStudio'),
            mainChart: document.getElementById('loadMainChart'),
            gaugeLoad: document.getElementById('gaugeLoad'),
            gaugeTps: document.getElementById('gaugeTps'),
            gaugeWorkers: document.getElementById('gaugeWorkers'),
            particles: document.getElementById('loadParticles'),
            loadIndexValue: document.getElementById('loadIndexValue'),
            loadPeakTps: document.getElementById('loadPeakTps'),
            loadLivePill: document.getElementById('loadLivePill'),
            gaugeLoadSub: document.getElementById('gaugeLoadSub'),
            gaugeTpsSub: document.getElementById('gaugeTpsSub'),
            gaugeWorkersSub: document.getElementById('gaugeWorkersSub'),
            barHttpFill: document.getElementById('barHttpFill'),
            barHttpVal: document.getElementById('barHttpVal'),
            barQueueFill: document.getElementById('barQueueFill'),
            barQueueVal: document.getElementById('barQueueVal'),
            barClientsFill: document.getElementById('barClientsFill'),
            barClientsVal: document.getElementById('barClientsVal')
        };
        if (!els.mainChart) return;
        state.ready = true;
        // seed flat history for smooth first paint
        for (let i = 0; i < 12; i++) {
            state.samples.push({
                t: Date.now() - (12 - i) * 1000,
                tps: 0,
                clients: 0,
                connections: 0,
                workers: 0,
                workerMax: 16,
                queueDepth: 0,
                httpInFlight: 0
            });
        }
        cancelAnimationFrame(state.raf);
        state.raf = requestAnimationFrame(frame);
        window.addEventListener('resize', () => {
            // next frame redraws at new size
        });
    }

    global.LoadViz = { init, pushSample };
})(window);
