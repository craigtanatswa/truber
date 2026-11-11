document.documentElement.classList.add('js');
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var reveals = document.querySelectorAll('[data-reveal]');
  var scene = document.querySelector('.scene');
  var steps = document.querySelectorAll('.scene-step');
  var wide = matchMedia('(min-width: 960px)');
  var revealObserver = null;
  var sceneObserver = null;

  function showAll() {
    for (var i = 0; i < reveals.length; i++) reveals[i].classList.add('is-visible');
  }

  function observeReveals() {
    if (reduce.matches || !('IntersectionObserver' in window)) {
      showAll();
      return;
    }
    revealObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('is-visible');
          revealObserver.unobserve(entries[i].target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
    for (var i = 0; i < reveals.length; i++) revealObserver.observe(reveals[i]);
  }

  function stopScene() {
    if (sceneObserver) {
      sceneObserver.disconnect();
      sceneObserver = null;
    }
    if (scene) scene.removeAttribute('data-active');
  }

  function startScene() {
    stopScene();
    if (!scene || !steps.length || !wide.matches || reduce.matches || !('IntersectionObserver' in window)) return;
    sceneObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) scene.dataset.active = Array.prototype.indexOf.call(steps, entries[i].target);
      }
    }, { threshold: 0.5 });
    for (var i = 0; i < steps.length; i++) sceneObserver.observe(steps[i]);
  }

  function load(p) {
    p.querySelectorAll('[data-srcset], [data-src]').forEach(function (el) {
      var srcset = el.getAttribute('data-srcset');
      var src = el.getAttribute('data-src');
      if (srcset) el.srcset = srcset;
      if (src) el.src = src;
      el.removeAttribute('data-srcset');
      el.removeAttribute('data-src');
    });
    p.removeAttribute('data-defer');
  }

  function defer() {
    var pictures = document.querySelectorAll('picture[data-defer]');
    if (!('IntersectionObserver' in window)) return pictures.forEach(load);
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          load(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '300px 0px' });
    pictures.forEach(function (p) { observer.observe(p); });
  }

  function onMotionChange() {
    if (reduce.matches) {
      showAll();
      stopScene();
    } else {
      startScene();
    }
  }

  observeReveals();
  startScene();
  defer();
  if (wide.addEventListener) {
    wide.addEventListener('change', startScene);
    reduce.addEventListener('change', onMotionChange);
  }
})();
