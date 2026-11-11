(function () {
"use strict";

var v = document.querySelector(".hero-video");
if (!v) return;

var conn = navigator.connection;
var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
var attached = false, raf = 0;

function lowData() {
return !!(conn && (conn.saveData || /(^|-)2g$|^3g$/.test(conn.effectiveType || "")));
}

function allowed() {
return !reduce.matches && !lowData();
}

function setPoster() {
var img = v.parentNode.querySelector("picture img");
var src = img && img.currentSrc;
if (!src || v.getAttribute("poster")) return;
v.setAttribute("poster", src);
v.classList.add("has-poster");
}
if (allowed()) setPoster();

function stop() {
if (raf) cancelAnimationFrame(raf);
raf = 0;
}

function hide() {
v.pause();
v.classList.remove("is-playing", "is-looping");
v.classList.add("is-paused");
stop();
}

function play() {
v.classList.remove("is-paused");
var p = v.play();
if (p && p.catch) p.catch(hide);
}

function tick() {
if (v.paused) {
raf = 0;
} else {
if (isFinite(v.duration) && v.currentTime >= v.duration - 0.4) v.classList.add("is-looping");
else if (v.currentTime < 0.4) v.classList.remove("is-looping");
raf = requestAnimationFrame(tick);
}
}

function attach() {
if (attached || !allowed()) return;
setPoster();
attached = true;
v.src = v.getAttribute("data-src");
play();
}

function resume() {
if (attached) play();
else if (document.readyState === "complete") attach();
}

function onMotion() {
if (reduce.matches) hide();
else if (allowed()) resume();
}

v.addEventListener("playing", function () {
v.classList.add("is-playing");
if (!raf) raf = requestAnimationFrame(tick);
});
v.addEventListener("pause", stop);

if (document.readyState === "complete") setTimeout(attach, 0);
else window.addEventListener("load", attach, { once: true });

if (reduce.addEventListener) reduce.addEventListener("change", onMotion);
else if (reduce.addListener) reduce.addListener(onMotion);

if (conn && conn.addEventListener) {
conn.addEventListener("change", function () {
if (lowData()) hide();
else if (allowed()) resume();
});
}

document.addEventListener("visibilitychange", function () {
if (document.hidden) hide();
else if (allowed() && attached) play();
});
})();
