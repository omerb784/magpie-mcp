// Cross-origin postMessage envelope between unified preview shell and pane iframes.
//
// Panes run with sandbox="allow-scripts" (NO allow-same-origin) so they cannot
// reach into the parent. All shell ↔ pane coordination flows through this
// envelope. Origin checks are skipped because sandboxed iframes have a "null"
// origin — the source identity is established by which iframe element posts.
//
// Contract:
//
//   pane → shell:
//     { kind: "ready",  vid, ver }                    on load complete
//     { kind: "scroll", vid, ver, fx, fy }            on scroll (debounced),
//                                                      fx/fy are fractions [0,1]
//     { kind: "error",  vid, ver, message }           on script error / fail
//
//   shell → pane:
//     { kind: "scrollTo", fx, fy }                    sync-scroll relay from peer
//     { kind: "theme",    theme: "light"|"dark" }     theme bake (future)
//
// fx/fy are content-size-normalized so panes with different scrollHeights stay
// in sync. shell does not validate origin — sandboxed null origin is the
// integrity gate.

export interface PaneBridgeCtx {
  vid: string;
  ver: number;
}

export function paneBridgeScript(ctx: PaneBridgeCtx): string {
  const vid = JSON.stringify(ctx.vid);
  const ver = JSON.stringify(ctx.ver);
  return `<script>(function(){
  var VID=${vid}, VER=${ver};
  function post(msg){ try{ parent.postMessage(Object.assign({source:"magpie-pane",vid:VID,ver:VER},msg),"*"); }catch(e){} }
  function frac(){
    var de=document.documentElement, b=document.body;
    var sx=window.scrollX||de.scrollLeft||b.scrollLeft||0;
    var sy=window.scrollY||de.scrollTop||b.scrollTop||0;
    var sw=Math.max(de.scrollWidth,b.scrollWidth)-window.innerWidth;
    var sh=Math.max(de.scrollHeight,b.scrollHeight)-window.innerHeight;
    return { fx: sw>0 ? sx/sw : 0, fy: sh>0 ? sy/sh : 0 };
  }
  var sending=false, lastSent=0;
  function onScroll(){
    if(sending) return;
    var now=Date.now();
    if(now-lastSent < 32){ sending=true; setTimeout(function(){ sending=false; var f=frac(); post({kind:"scroll",fx:f.fx,fy:f.fy}); lastSent=Date.now(); },32-(now-lastSent)); return; }
    var f=frac(); post({kind:"scroll",fx:f.fx,fy:f.fy}); lastSent=now;
  }
  var inbound=false;
  window.addEventListener("message",function(e){
    var d=e.data; if(!d||typeof d!=="object") return;
    if(d.kind==="scrollTo" && typeof d.fx==="number" && typeof d.fy==="number"){
      inbound=true;
      var de=document.documentElement, b=document.body;
      var sw=Math.max(de.scrollWidth,b.scrollWidth)-window.innerWidth;
      var sh=Math.max(de.scrollHeight,b.scrollHeight)-window.innerHeight;
      window.scrollTo(sw*d.fx, sh*d.fy);
      setTimeout(function(){ inbound=false; },50);
    }
    if(d.kind==="theme" && (d.theme==="light"||d.theme==="dark")){
      try{ document.documentElement.setAttribute("data-theme",d.theme); }catch(e){}
    }
  });
  window.addEventListener("scroll",function(){ if(!inbound) onScroll(); },{passive:true});
  window.addEventListener("error",function(e){ post({kind:"error",message:String(e&&e.message||e)}); });
  if(document.readyState==="complete") post({kind:"ready"});
  else window.addEventListener("load",function(){ post({kind:"ready"}); });
})();</script>`;
}

export const PANE_BRIDGE_MARKER = "magpie-pane";
