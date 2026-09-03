// Generic, dependency-free helpers used across app.js subsystems.

export function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function signed(n) {
    return n >= 0 ? `+${n}` : `${n}`;
}

export function formatCombatHpDisplay(v) {
    return (v == null || v === '') ? '??' : String(v);
}

export function hpHealthColor(current, max) {
    const maxHp = Math.max(1, Number(max) || 1);
    let cur = Number(current);
    if (!Number.isFinite(cur)) cur = 0;
    cur = Math.max(0, Math.min(cur, maxHp));

    if (cur <= 0) {
        return { color: 'hsl(0, 78%, 38%)', level: 'dead' };
    }
    if (cur >= maxHp) {
        return { color: 'hsl(132, 58%, 42%)', level: 'full' };
    }

    // Remaining HP < 5 is the red zone (critical)
    const criticalCap = Math.min(5, maxHp);
    let t; // 0 = worst red, 1 = just below full green
    if (cur < criticalCap) {
        // 0 .. criticalCap → deep red .. orange-red (0 .. ~0.22)
        t = (cur / criticalCap) * 0.22;
    } else {
        // criticalCap .. max → orange-red .. green (0.22 .. 1)
        t = 0.22 + 0.78 * ((cur - criticalCap) / (maxHp - criticalCap));
    }
    t = Math.max(0, Math.min(1, t));
    const hue = Math.round(120 * t); // 0 red → 120 green
    const sat = Math.round(72 - 12 * t);
    const light = Math.round(40 + 6 * t);
    let level = 'mid';
    if (cur < criticalCap) level = 'critical';
    else if (t > 0.75) level = 'high';
    else if (t < 0.4) level = 'low';
    return { color: `hsl(${hue}, ${sat}%, ${light}%)`, level };
}

export function updateCharacterHpColor(current, max) {
    const curEl = document.getElementById('char-hp-current');
    const maxEl = document.getElementById('char-hp-max');
    const sepEl = document.querySelector('.stat-widget.hp .hp-separator');
    const widget = document.querySelector('.stat-widget.hp');
    if (!curEl) return;

    const { color, level } = hpHealthColor(current, max);
    curEl.style.color = color;
    if (maxEl) {
        // Keep current and max on the same spectrum color (including full = green)
        maxEl.style.color = color;
        maxEl.style.opacity = level === 'full' ? '1' : '0.85';
    }
    if (sepEl) {
        sepEl.style.color = color;
        sepEl.style.opacity = level === 'full' ? '0.85' : '0.65';
    }
    if (widget) {
        widget.dataset.hpLevel = level;
        widget.style.setProperty('--hp-color', color);
    }
}

export function fitTextareaInScrollHost(ta) {
    if (!ta) return;
    const host = ta.closest('.textarea-scroll-host');
    // Reset so scrollHeight reflects full content
    ta.style.height = '0px';
    const full = ta.scrollHeight;
    const hostH = host ? host.clientHeight : 0;
    // At least fill the host; grow beyond so the HOST scrolls when content is long
    const next = Math.max(hostH || 104, full);
    ta.style.height = next + 'px';
}

export function bindTextareaScrollHosts() {
    document.querySelectorAll('.textarea-scroll-host textarea').forEach(ta => {
        if (ta.dataset.scrollHostBound) return;
        ta.dataset.scrollHostBound = '1';
        ta.addEventListener('input', () => fitTextareaInScrollHost(ta));
    });
}

export function downloadJsonBlob(obj, filename) {
    const dataStr = JSON.stringify(obj, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const linkElement = document.createElement('a');
    linkElement.href = url;
    linkElement.download = filename;
    document.body.appendChild(linkElement);
    linkElement.click();
    linkElement.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return blob.size;
}

let audioCtx = null;
export function playDiceSound() {
    if (!document.getElementById('dice-sound-toggle').checked) return;

    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Play multiple tiny friction clicks to simulate rolling dice
        const now = audioCtx.currentTime;

        // Roll friction sound (rumble)
        const rumbleOsc = audioCtx.createOscillator();
        const rumbleGain = audioCtx.createGain();
        rumbleOsc.type = 'triangle';
        rumbleOsc.frequency.setValueAtTime(80, now);
        rumbleOsc.frequency.exponentialRampToValueAtTime(30, now + 0.5);

        rumbleGain.gain.setValueAtTime(0.3, now);
        rumbleGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

        rumbleOsc.connect(rumbleGain);
        rumbleGain.connect(audioCtx.destination);
        rumbleOsc.start(now);
        rumbleOsc.stop(now + 0.5);

        // Dynamic impact clicks (4-5 clicks spaced out)
        const clickTimes = [0.1, 0.22, 0.35, 0.44, 0.52];
        clickTimes.forEach((time, index) => {
            const clickOsc = audioCtx.createOscillator();
            const clickGain = audioCtx.createGain();
            clickOsc.type = 'sine';
            const freq = index === clickTimes.length - 1 ? 400 : 250 + Math.random() * 100;

            clickOsc.frequency.setValueAtTime(freq, now + time);
            clickOsc.frequency.exponentialRampToValueAtTime(10, now + time + 0.08);

            clickGain.gain.setValueAtTime(0.15 - (index * 0.02), now + time);
            clickGain.gain.exponentialRampToValueAtTime(0.001, now + time + 0.08);

            clickOsc.connect(clickGain);
            clickGain.connect(audioCtx.destination);
            clickOsc.start(now + time);
            clickOsc.stop(now + time + 0.08);
        });
    } catch (e) {
        console.warn('Audio Context failed to start:', e);
    }
}
