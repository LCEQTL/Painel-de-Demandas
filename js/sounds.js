// Sons curtos e suaves, sintetizados (sem arquivos): estilo "fichas" de jogo de cartas, sem copiar sons de terceiros.
const KEY = "painel.som";
let ctx = null;
export function soundOn() { try { return localStorage.getItem(KEY) !== "0"; } catch (_) { return true; } }
export function setSound(on) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (_) { /* preferência opcional */ } }

function ac() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
// O navegador só libera áudio após um clique: ativamos no primeiro gesto.
window.addEventListener("pointerdown", () => { if (soundOn()) ac(); }, { once: true });

function note(c, freq, t, dur, vol, type = "triangle") {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function click(c, t, vol = 0.05) {
  // estalo curto de "ficha"
  const len = Math.floor(c.sampleRate * 0.02), buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = 3200; g.gain.value = vol;
  src.buffer = buf; src.connect(f).connect(g).connect(c.destination); src.start(t);
}
const PRESETS = {
  // demanda nova chegando: duas fichas subindo
  nova: (c, t) => { click(c, t); note(c, 784, t, 0.18, 0.09); click(c, t + 0.09); note(c, 1175, t + 0.09, 0.28, 0.08); },
  // ação importante concluída (concluir, confirmar, encaminhar): pequeno arpejo
  acao: (c, t) => { [523, 659, 784, 1047].forEach((f, i) => { click(c, t + i * 0.055, 0.03); note(c, f, t + i * 0.055, 0.22, 0.07); }); },
  // mensagem nova no chat: "pop" único
  mensagem: (c, t) => { click(c, t, 0.04); note(c, 988, t, 0.14, 0.06, "sine"); },
  // envio de mensagem: toque curto e grave
  envio: (c, t) => { note(c, 587, t, 0.1, 0.05, "sine"); },
};
export function play(name) {
  if (!soundOn()) return;
  const c = ac();
  if (!c || !PRESETS[name]) return;
  try { PRESETS[name](c, c.currentTime + 0.01); } catch (_) { /* áudio indisponível */ }
}
