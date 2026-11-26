/**
 * Shared Motion Module for SimpleGST v2
 * Centralizes all motion tokens, prefers-reduced-motion / Settings switch checks,
 * nav sliding pill, upward page curtain, count-up, progress ring, desktop-only
 * pointer effects, scroll progress, and celebration confetti.
 */
import { formatPaiseINR } from "./utils.js";

export const MOTION_TOKENS = {
  ease: "cubic-bezier(.2, .8, .2, 1)",
  curtainInMs: 500,
  curtainHoldMs: 560,
  curtainOutMs: 550,
  countUpMs: 1300,
  rowDeleteMs: 420
};

export function isMotionReduced() {
  if (typeof window === "undefined") return true;
  if (document.documentElement.dataset.reduceMotion === "true") return true;
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return true;
  }
  return false;
}

export function applyReducedMotionPref(enabled) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.reduceMotion = enabled ? "true" : "false";
  try {
    localStorage.setItem("simplegst_reduce_motion", enabled ? "1" : "0");
  } catch {}
}

export function initReducedMotionPref() {
  if (typeof document === "undefined") return false;
  let stored = null;
  try { stored = localStorage.getItem("simplegst_reduce_motion"); } catch {}
  const sys = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reduced = stored !== null ? stored === "1" : sys;
  document.documentElement.dataset.reduceMotion = reduced ? "true" : "false";
  return reduced;
}

/**
 * Positions the shared sliding nav pill (.ni.a) over the active button
 * and binds hover preview (.ni) across nav items.
 */
export function placeNavPill() {
  const activeBtn = document.querySelector(".nv button.on");
  const indicator = document.getElementById("nav-active-pill");
  if (!activeBtn || !indicator) return;
  indicator.style.width = `${activeBtn.offsetWidth}px`;
  indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
}

export function bindNavPillHover() {
  const hoverPill = document.getElementById("nav-hover-pill");
  if (!hoverPill) return;
  document.querySelectorAll(".nv button").forEach((btn) => {
    btn.addEventListener("mouseenter", () => {
      hoverPill.style.width = `${btn.offsetWidth}px`;
      hoverPill.style.transform = `translateX(${btn.offsetLeft}px)`;
      hoverPill.style.opacity = btn.classList.contains("on") ? "0" : "1";
      btn.classList.add("h");
    });
    btn.addEventListener("mouseleave", () => {
      hoverPill.style.opacity = "0";
      btn.classList.remove("h");
    });
  });
  window.addEventListener("resize", placeNavPill);
}

let curtainBusy = false;
export function isCurtainRunning() {
  return curtainBusy;
}

/**
 * Sweeps the accent curtain UP only (never down), renders the new view underneath,
 * and never delays async data loading (caller starts fetching immediately).
 */
export function sweepPageTransition(info, onRenderUnderneath) {
  const cu = document.getElementById("curtain");
  if (!cu || isMotionReduced()) {
    onRenderUnderneath();
    return;
  }
  if (curtainBusy) return;
  curtainBusy = true;

  const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const wordsHtml = esc(info.title).split(" ").map((w) => `<span><i>${w}</i></span>`).join(" ");
  const chipsHtml = (info.chips || []).map((c) => `<span>${esc(c)}</span>`).join("");

  cu.innerHTML = `
    <div class="ci">
      <div class="ey">${esc(info.eyebrow)}</div>
      <h2 class="ctt">${wordsHtml}</h2>
      <p class="cs2">${esc(info.subtitle)}</p>
      <div class="cc">${chipsHtml}</div>
      <div class="cbar"><i></i></div>
    </div>
  `;
  cu.className = "cu go";

  setTimeout(() => {
    onRenderUnderneath();
    setTimeout(() => {
      cu.className = "cu out";
      setTimeout(() => {
        cu.style.transition = "none";
        cu.className = "cu";
        cu.innerHTML = "";
        void cu.offsetHeight;
        cu.style.transition = "";
        curtainBusy = false;
      }, MOTION_TOKENS.curtainOutMs);
    }, MOTION_TOKENS.curtainHoldMs);
  }, MOTION_TOKENS.curtainInMs);
}

/**
 * Counts up [data-count-paise] elements using quartic ease-out (1300ms)
 * formatting from integer paise with Indian grouping.
 */
export function animateCountUps(root = document) {
  const reduced = isMotionReduced();
  root.querySelectorAll("[data-count-paise]").forEach((el) => {
    const targetPaise = Math.trunc(Number(el.dataset.countPaise) || 0);
    if (reduced || el.dataset.counted === "1") {
      el.textContent = formatPaiseINR(targetPaise);
      return;
    }
    el.dataset.counted = "1";
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / MOTION_TOKENS.countUpMs);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = formatPaiseINR(Math.round(targetPaise * eased));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = formatPaiseINR(targetPaise);
    };
    requestAnimationFrame(tick);
  });
}

export function animateProgressRing(root = document) {
  const ring = root.querySelector(".rg .p");
  if (!ring) return;
  const toVal = ring.dataset.to;
  if (!toVal) return;
  if (isMotionReduced()) {
    ring.style.strokeDashoffset = toVal;
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ring.style.strokeDashoffset = toVal;
    });
  });
}

/**
 * Desktop-only pointer effects:
 * - Card cursor glow (--mx / --my)
 * - Magnetic primary buttons (.mag)
 * - Mascot eye tracking (#mas .pp)
 */
export function bindDesktopPointerMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  if (!window.matchMedia("(pointer: fine)").matches) return;

  document.addEventListener("mousemove", (e) => {
    if (isMotionReduced()) return;

    const mas = document.getElementById("mas");
    if (mas) {
      const r0 = mas.getBoundingClientRect();
      const angle = Math.atan2(e.clientY - (r0.top + r0.height * 0.45), e.clientX - (r0.left + r0.width / 2));
      mas.querySelectorAll(".pp").forEach((pupil) => {
        pupil.style.transform = `translate(${Math.cos(angle) * 3.5}px, ${Math.sin(angle) * 3.5}px)`;
      });
    }

    const card = e.target.closest(".kc, .ex, .bz");
    if (card) {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    }

    const mag = e.target.closest(".mag");
    if (mag) {
      const q = mag.getBoundingClientRect();
      const dx = (e.clientX - q.left - q.width / 2) * 0.14;
      const dy = (e.clientY - q.top - q.height / 2) * 0.22;
      mag.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  });

  document.addEventListener("mouseout", (e) => {
    const mag = e.target.closest(".mag");
    if (mag) mag.style.transform = "";
  });
}

export function bindScrollProgress() {
  const pb = document.getElementById("scroll-pb");
  if (!pb) return;
  window.addEventListener("scroll", () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    pb.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
    const gr = document.querySelector(".gr");
    if (gr && !isMotionReduced()) {
      gr.style.transform = `translateY(${window.scrollY * 0.16}px)`;
      gr.style.opacity = String(Math.max(0, 1 - window.scrollY / 520));
    }
  }, { passive: true });
}

/**
 * Celebration confetti — ONLY called after genuine "Filed (simulation)" API response.
 */
export function launchCelebrationConfetti() {
  if (isMotionReduced()) return;
  const cu = document.getElementById("curtain");
  if (!cu) return;
  const colors = ["#FFC857", "#ffffff", "#8B84FF", "#FF7A59"];
  for (let i = 0; i < 48; i++) {
    const c = document.createElement("i");
    c.className = "cf2";
    c.style.left = `${(i * 2.1) % 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${(i % 8) * 0.09}s`;
    c.style.animationDuration = `${1.8 + (i % 5) * 0.28}s`;
    cu.appendChild(c);
  }
}
