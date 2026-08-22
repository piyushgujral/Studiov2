/**
 * Payuu Studio Overlay Studio
 * Local-first overlay library with reusable templates, duplication, import/export
 * and a simple custom text source builder.
 */
const KEY = 'payuu_overlay_library_v2';

const templates = [
  { id:'clean-gaming', name:'Clean Gaming', category:'Gaming', icon:'fa-gamepad', accent:'#6366f1', description:'Minimal corner branding + social bar.', elements:[
    {type:'text',content:'PAYUU LIVE',x:70,y:76,fontSize:30,color:'#ffffff',fontWeight:800},
    {type:'badge',content:'LIVE',x:70,y:98,width:86,height:28,bgColor:'#ef4444',textColor:'#fff'},
    {type:'bar',x:0,y:1032,width:1920,height:48,color:'rgba(8,12,20,.86)',radius:0},
    {type:'text',content:'@yourhandle  •  LIVE NOW',x:960,y:1063,fontSize:18,color:'#cbd5e1',align:'center',fontWeight:700}
  ]},
  { id:'neon-gamer', name:'Neon Gamer', category:'Gaming', icon:'fa-bolt', accent:'#22d3ee', description:'High-energy frame and title treatment.', elements:[
    {type:'frame',x:24,y:24,width:1872,height:1032,color:'#22d3ee',lineWidth:4,alpha:.75,radius:22},
    {type:'badge',content:'LIVE',x:62,y:58,width:92,height:32,bgColor:'#ef4444',textColor:'#fff'},
    {type:'text',content:'PAYUU',x:174,y:82,fontSize:28,color:'#67e8f9',fontWeight:900},
    {type:'text',content:'FOLLOW FOR MORE',x:1520,y:1010,fontSize:18,color:'#67e8f9',align:'center',fontWeight:800}
  ]},
  { id:'facecam-frame', name:'Facecam Frame', category:'Camera', icon:'fa-camera', accent:'#a78bfa', description:'Clean PIP frame for facecam streams.', elements:[
    {type:'frame',x:1428,y:780,width:468,height:276,color:'#a78bfa',lineWidth:5,alpha:.95,radius:18},
    {type:'badge',content:'CAM',x:1450,y:802,width:72,height:26,bgColor:'#7c3aed',textColor:'#fff'},
    {type:'text',content:'PAYUU',x:1868,y:1030,fontSize:16,color:'#ddd6fe',align:'right',fontWeight:800}
  ]},
  { id:'starting-soon', name:'Starting Soon', category:'Scenes', icon:'fa-clock', accent:'#818cf8', description:'Simple pre-stream screen.', elements:[
    {type:'bar',x:0,y:0,width:1920,height:1080,color:'rgba(5,8,15,.84)',radius:0},
    {type:'text',content:'STREAM STARTING SOON',x:960,y:500,fontSize:64,color:'#ffffff',align:'center',fontWeight:900},
    {type:'text',content:'GET READY',x:960,y:558,fontSize:22,color:'#a5b4fc',align:'center',fontWeight:700}
  ]},
  { id:'social-lower-third', name:'Social Lower Third', category:'Branding', icon:'fa-hashtag', accent:'#34d399', description:'Creator name + social handles.', elements:[
    {type:'bar',x:52,y:932,width:760,height:92,color:'rgba(5,10,18,.92)',radius:18},
    {type:'text',content:'YOUR NAME',x:88,y:970,fontSize:26,color:'#ffffff',fontWeight:900},
    {type:'text',content:'@yourhandle  •  YouTube  •  KICK  •  Twitch',x:88,y:1004,fontSize:16,color:'#94a3b8',fontWeight:600}
  ]},
  { id:'ticker', name:'News Ticker', category:'Utility', icon:'fa-scroll', accent:'#f59e0b', description:'Bottom ticker for announcements.', elements:[
    {type:'bar',x:0,y:1018,width:1920,height:62,color:'rgba(2,6,23,.94)',radius:0},
    {type:'badge',content:'UPDATE',x:24,y:1032,width:118,height:34,bgColor:'#f59e0b',textColor:'#111827'},
    {type:'text',content:'Welcome to the stream • New gameplay • Thanks for watching!',x:170,y:1056,fontSize:20,color:'#f8fafc',fontWeight:700}
  ]},
  { id:'mobile-vertical', name:'Mobile Vertical', category:'Mobile', icon:'fa-mobile-screen', accent:'#ec4899', description:'Vertical-safe title and branding zone.', elements:[
    {type:'frame',x:30,y:30,width:1020,height:1860,color:'#ec4899',lineWidth:4,alpha:.65,radius:24},
    {type:'text',content:'PAYUU LIVE',x:540,y:100,fontSize:36,color:'#fce7f3',align:'center',fontWeight:900},
    {type:'badge',content:'LIVE',x:480,y:142,width:120,height:34,bgColor:'#ef4444',textColor:'#fff'}
  ]},
  { id:'superchat', name:'SuperChat Alert Bar', category:'Alerts', icon:'fa-bolt', accent:'#fbbf24', description:'Reusable support banner.', elements:[
    {type:'bar',x:240,y:72,width:1440,height:112,color:'rgba(15,23,42,.96)',radius:22},
    {type:'badge',content:'★ SUPPORT',x:270,y:108,width:170,height:38,bgColor:'#f59e0b',textColor:'#111827'},
    {type:'text',content:'Thanks for supporting the stream!',x:470,y:126,fontSize:25,color:'#fef3c7',fontWeight:800}
  ]}
];

function clone(v){ return JSON.parse(JSON.stringify(v)); }

export class OverlayManager {
  constructor() {
    this.overlays = this.load();
    this.activeOverlayId = this.overlays[0]?.id || null;
    this.onOverlayChange = null;
    this.onLibraryChange = null;
  }

  load(){
    try { const saved=JSON.parse(localStorage.getItem(KEY)||'null'); if(Array.isArray(saved)&&saved.length)return saved; } catch(_){}
    return templates.map(t=>({...clone(t), id:t.id}));
  }
  persist(){ localStorage.setItem(KEY, JSON.stringify(this.overlays)); this.onLibraryChange?.(this.overlays); }
  getActiveOverlay(){ return this.overlays.find(o=>o.id===this.activeOverlayId)||null; }
  setActiveOverlay(id){ this.activeOverlayId=id; this.onOverlayChange?.(this.getActiveOverlay()); }
  getTemplates(){ return clone(templates); }
  addTemplate(templateId){
    const t=templates.find(x=>x.id===templateId); if(!t)return null;
    const copy=clone(t); copy.id=`overlay_${Date.now()}`; copy.name=`${t.name} ${this.overlays.length+1}`;
    this.overlays.push(copy); this.activeOverlayId=copy.id; this.persist(); this.onOverlayChange?.(copy); return copy;
  }
  createTextOverlay(text='New Text'){
    const o={id:`overlay_${Date.now()}`,name:'Custom Text',category:'Custom',icon:'fa-font',accent:'#818cf8',description:'Custom text source',elements:[{type:'text',content:text,x:960,y:160,fontSize:48,color:'#ffffff',align:'center',fontWeight:800}]};
    this.overlays.push(o); this.activeOverlayId=o.id; this.persist(); this.onOverlayChange?.(o); return o;
  }
  duplicateActive(){
    const a=this.getActiveOverlay(); if(!a)return null; const c=clone(a); c.id=`overlay_${Date.now()}`; c.name=`${a.name} Copy`; c.elements.forEach(e=>{if(typeof e.x==='number')e.x+=20;if(typeof e.y==='number')e.y+=20;}); this.overlays.push(c); this.activeOverlayId=c.id; this.persist(); this.onOverlayChange?.(c); return c;
  }
  deleteActive(){
    if(!this.activeOverlayId)return; const idx=this.overlays.findIndex(o=>o.id===this.activeOverlayId); if(idx<0)return;
    this.overlays.splice(idx,1); this.activeOverlayId=this.overlays[Math.max(0,idx-1)]?.id||null; this.persist(); this.onOverlayChange?.(this.getActiveOverlay());
  }
  renameActive(name){ const o=this.getActiveOverlay(); if(!o)return; o.name=name.trim()||o.name; this.persist(); this.onOverlayChange?.(o); }
  updateElement(index,patch){ const o=this.getActiveOverlay(); if(!o||!o.elements[index])return; Object.assign(o.elements[index],patch); this.persist(); this.onOverlayChange?.(o); }
  exportActive(){ const o=this.getActiveOverlay(); return o?JSON.stringify(o,null,2):''; }
  importOverlay(json){
    const o=typeof json==='string'?JSON.parse(json):json; if(!o||!Array.isArray(o.elements))throw new Error('Invalid overlay JSON.');
    o.id=`overlay_${Date.now()}`; o.name=o.name||'Imported Overlay'; this.overlays.push(o); this.activeOverlayId=o.id; this.persist(); this.onOverlayChange?.(o); return o;
  }
}
