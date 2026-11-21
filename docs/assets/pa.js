// portable-artifacts site behaviour: theme, copy buttons, sheet index, plates and leader lines.
// No dependencies. Everything degrades to a readable static page without it.
(() => {
  const doc = document.documentElement;
  const motionOK = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // ---- old anchors from the previous one-page site keep working ----
  const REPO = "https://github.com/abhijitbansal/portable-artifacts/blob/main/";
  const LEGACY = {
    "gallery-dashboard": "gallery.html#dashboards",
    "gallery-diagram": "gallery.html#diagrams",
    "gallery-explainer": "gallery.html#explainers",
    "gallery-motion": "gallery.html#films",
    "gallery-motion-1-4": "gallery.html#films",
    "gallery-scene": "gallery.html#scenes",
    inventory: "gallery.html",
    "film-whats-new": "gallery.html#films",
    "film-pro": "gallery.html#films",
    "film-viral": "gallery.html#films",
    "featured-diagram": "#make-diagram",
    "whats-new-0-8-0": REPO + "plugins/portable-artifacts/CHANGELOG.md",
    "showcase-motion": "#make-motion",
    "showcase-dashboard": "#make-dashboard",
    overview: "#showcase",
    why: "#notes",
    details: "#notes",
    skills: "#showcase",
    "quick-install": "#install",
    "whats-new": REPO + "plugins/portable-artifacts/CHANGELOG.md",
    requirements: REPO + "plugins/portable-artifacts/USAGE.md",
    usability: REPO + "plugins/portable-artifacts/USAGE.md",
    security: REPO + "plugins/portable-artifacts/README.md#security-model",
    licences: REPO + "plugins/portable-artifacts/README.md#licences",
  };
  const oldId = location.hash.slice(1);
  const legacy = LEGACY[oldId] || (oldId.startsWith("clip-") ? "gallery.html#films" : null);
  if (legacy && !document.getElementById(oldId)) {
    if (legacy.startsWith("#")) {
      history.replaceState(null, "", legacy);
      document.getElementById(legacy.slice(1))?.scrollIntoView();
    } else {
      location.replace(legacy);
    }
  }

  // ---- theme: auto -> light -> dark ----
  const themeBtn = document.querySelector("[data-theme-toggle]");
  const paintTheme = (t) => {
    if (t === "light" || t === "dark") doc.dataset.theme = t; else delete doc.dataset.theme;
    if (themeBtn) {
      themeBtn.setAttribute("aria-label", `Theme: ${t || "auto"}. Change theme`);
      themeBtn.querySelector("[data-theme-label]").textContent = t || "auto";
    }
  };
  paintTheme(store.get("theme"));
  themeBtn?.addEventListener("click", () => {
    const order = [null, "light", "dark"];
    const next = order[(order.indexOf(store.get("theme")) + 1) % order.length];
    store.set("theme", next);
    paintTheme(next);
  });

  // ---- copy buttons ----
  const live = Object.assign(document.createElement("div"), { className: "vh" });
  live.setAttribute("aria-live", "polite");
  document.body.append(live);
  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      try { return await navigator.clipboard.writeText(text); } catch { /* fall through to execCommand */ }
    }
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("copy refused");
  };
  document.querySelectorAll(".copy[data-copy]").forEach((btn) => {
    btn.setAttribute("aria-label", `Copy: ${btn.dataset.copy}`);
    btn.addEventListener("click", async () => {
      try {
        await copyText(btn.dataset.copy);
        btn.classList.add("ok"); btn.textContent = "copied"; live.textContent = "Copied to clipboard";
      } catch {
        btn.classList.add("err"); btn.textContent = "failed"; live.textContent = "Copy failed: select the command and copy it by hand";
      }
      setTimeout(() => { btn.classList.remove("ok", "err"); btn.textContent = "copy"; }, 1400);
    });
  });

  // ---- sheet index: mark the sheet in view ----
  const navLinks = [...document.querySelectorAll(".sheets a[href^='#']")];
  if (navLinks.length && "IntersectionObserver" in window) {
    const byId = new Map(navLinks.map((a) => [a.hash.slice(1), a]));
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        navLinks.forEach((a) => a.removeAttribute("aria-current"));
        byId.get(e.target.id)?.setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    byId.forEach((_, id) => { const el = document.getElementById(id); if (el) spy.observe(el); });
  }

  // ---- plates: muted loops play only in view, and never under reduced motion ----
  const loops = [...document.querySelectorAll("video[data-loop]")];
  if (loops.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(({ target: v, isIntersecting }) => {
        if (v.dataset.full === "1") return;
        if (isIntersecting && motionOK()) v.play().catch(() => {});
        else v.pause();
      });
    }, { threshold: 0.35 });
    loops.forEach((v) => io.observe(v));
  }

  // "Watch with sound": swap the loop for the full film with native controls
  document.querySelectorAll("[data-full-film]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.closest(".plate-frame").querySelector("video");
      v.dataset.full = "1";
      v.src = btn.dataset.fullFilm;
      v.poster = btn.dataset.poster || v.poster;
      v.loop = false; v.muted = false; v.controls = true;
      v.setAttribute("aria-label", btn.dataset.label || "Full film");
      v.closest(".plate-frame").classList.add("full");
      v.play().catch(() => {});
      btn.remove();
      v.focus();
    });
  });

  // ---- leader lines: a spec line points at the part of the artifact it built ----
  const SVGNS = "http://www.w3.org/2000/svg";
  document.querySelectorAll("[data-leader]").forEach((sheet) => {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "leader");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVGNS, "path");
    const dot = document.createElementNS(SVGNS, "circle");
    dot.setAttribute("r", "3");
    svg.append(path, dot);
    sheet.append(svg);
    const spec = sheet.querySelector(".spec");
    const video = sheet.querySelector(".plate video");
    const lines = [...sheet.querySelectorAll(".spec [data-tag]")];
    const tags = [...sheet.querySelectorAll(".plate .tag[data-tag]")];
    let active = null, pinned = null;

    const draw = (n, animate) => {
      const line = lines.find((l) => l.dataset.tag === n);
      const tag = tags.find((t) => t.dataset.tag === n);
      if (!line || !tag) return;
      const o = sheet.getBoundingClientRect();
      const s = spec.getBoundingClientRect();
      const l = line.getBoundingClientRect();
      const t = tag.getBoundingClientRect();
      const ex = t.left + t.width / 2 - o.left, ey = t.top + t.height / 2 - o.top;
      let d, sx, sy;
      if (ex > s.right - o.left || ex < s.left - o.left) { // plate beside the spec
        const right = ex > s.right - o.left;
        sx = (right ? s.right : s.left) - o.left;
        sy = l.top + l.height / 2 - o.top;
        const kx = sx + (right ? 18 : -18);
        d = `M${sx},${sy} H${kx} L${ex},${ey}`;
      } else { // plate above the spec (narrow screens)
        sx = Math.min(l.left + 56, s.right - 24) - o.left;
        sy = s.top - o.top;
        d = `M${sx},${sy} V${sy - 14} L${ex},${ey + t.height / 2}`;
      }
      path.setAttribute("d", d);
      dot.setAttribute("cx", sx); dot.setAttribute("cy", sy);
      svg.style.visibility = "visible";
      if (animate && motionOK() && path.animate) {
        const len = path.getTotalLength();
        path.style.strokeDasharray = `${len}`;
        path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 420, easing: "cubic-bezier(.16,1,.3,1)" });
      } else {
        path.style.strokeDasharray = "";
      }
    };
    const clear = () => { svg.style.visibility = "hidden"; };
    const set = (n, animate = true) => {
      active = n;
      lines.forEach((l) => {
        l.classList.toggle("on", l.dataset.tag === n);
        l.setAttribute("aria-pressed", String(pinned != null && l.dataset.tag === pinned));
      });
      tags.forEach((t) => t.classList.toggle("on", t.dataset.tag === n));
      if (n == null) { clear(); return; }
      draw(n, animate);
      const line = lines.find((l) => l.dataset.tag === n);
      if (video && line?.dataset.t && video.dataset.full !== "1") {
        video.currentTime = Number(line.dataset.t);
        if (motionOK()) video.play().catch(() => {});
      }
    };
    const enter = (n) => { if (pinned == null) set(n); };
    const leave = () => { if (pinned == null) set(null); };
    const toggle = (n) => { pinned = pinned === n ? null : n; set(pinned ?? null); };

    [...lines, ...tags].forEach((el) => {
      const n = el.dataset.tag;
      el.addEventListener("mouseenter", () => enter(n));
      el.addEventListener("mouseleave", leave);
      el.addEventListener("click", () => toggle(n));
    });
    lines.forEach((el) => {
      el.addEventListener("focus", () => enter(el.dataset.tag));
      el.addEventListener("blur", leave);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(el.dataset.tag); }
        if (e.key === "Escape") { pinned = null; set(null); }
      });
    });
    addEventListener("resize", () => { if (active != null) draw(active, false); }, { passive: true });
    clear();
  });
})();
