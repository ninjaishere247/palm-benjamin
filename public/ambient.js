// Shared ambient effect, loaded on every page.
// Spawns a small number of slow-drifting ember particles for atmosphere only.
// Purely decorative: makes no claim about anything real, so unlike the
// palm-line overlay experiment this can never be visually "wrong".
(function(){
  try{
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var container = document.createElement('div');
    container.id = 'ambientEmbers';
    container.setAttribute('aria-hidden', 'true');

    var count = window.innerWidth < 640 ? 7 : 12;

    for (var i = 0; i < count; i++){
      var e = document.createElement('div');
      e.className = 'ember';
      var size = 2 + Math.random() * 2.5;
      e.style.width = size + 'px';
      e.style.height = size + 'px';
      e.style.left = (Math.random() * 100) + 'vw';
      e.style.setProperty('--ember-drift', (Math.random() * 60 - 30) + 'px');
      e.style.setProperty('--ember-op', (0.35 + Math.random() * 0.35).toFixed(2));
      var duration = 14 + Math.random() * 16;
      e.style.animationDuration = duration + 's';
      e.style.animationDelay = (-Math.random() * duration) + 's';
      container.appendChild(e);
    }

    function mount(){
      if (document.body) document.body.appendChild(container);
    }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }catch(e){
    // Ambient decoration failing silently should never affect the actual page.
  }
})();
