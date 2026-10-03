const WaveMobile = (() => {
  function tabTap(clock=()=>Date.now()) {
    let previous=null, time=0;
    return view => {
      const now=clock(), repeated=view===previous && now-time<=350;
      previous=repeated?null:view; time=now;
      return repeated;
    };
  }
  function preventZoom(doc) {
    const stop=e=>{if(e.cancelable)e.preventDefault();};
    doc.addEventListener('gesturestart',stop,{passive:false});
    doc.addEventListener('gesturechange',stop,{passive:false});
    doc.addEventListener('touchmove',e=>{if(e.touches.length>1)stop(e);},{passive:false});
    doc.addEventListener('dblclick',e=>{
      if(!e.target.closest('input,textarea,[contenteditable="true"]'))stop(e);
    });
    doc.addEventListener('wheel',e=>{if(e.ctrlKey)stop(e);},{passive:false});
  }
  return {tabTap,preventZoom};
})();
