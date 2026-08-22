export class RemoteDeviceManager {
  constructor({ remoteVideo, apiBase = '' } = {}) {
    this.remoteVideo = remoteVideo;
    const runtime = window.PAYUU_CONFIG || {};
    this.apiBase = apiBase || runtime.apiBase || window.location.origin;
    this.authToken = localStorage.getItem('payuu_whip_token') || runtime.authToken || '';
    this.iceServers = this.loadIceServers();
    const q = new URLSearchParams(location.search);
    this.role = q.get('mode') === 'capture' ? 'capture' : 'control';
    this.sessionId = q.get('session') || '';
    this.code = (q.get('code') || '').toUpperCase();
    this.pc = null; this.localStream = null; this.remoteStream = null;
    this.pollTimer = null; this.running = false;
    this.onStatus = null; this.onRemoteStream = null; this.onError = null; this.onCode = null;
    this.onPairingExpired = null;
  }
  loadIceServers() {
    try {
      const raw = localStorage.getItem('payuu_ice_servers');
      if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed) && parsed.length) return parsed; }
    } catch (_) {}
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  setIceServers(servers) {
    this.iceServers = Array.isArray(servers) && servers.length ? servers : [{ urls: 'stun:stun.l.google.com:19302' }];
    localStorage.setItem('payuu_ice_servers', JSON.stringify(this.iceServers));
  }

  getHeaders(extra = {}) {
    const headers = { ...extra };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    return headers;
  }

  async createControlSession() {
    const r = await fetch(`${this.apiBase}/api/remote/session`, { method:'POST', headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Could not create pairing session (${r.status}).`);
    const d = await r.json(); this.role='control'; this.sessionId=d.sessionId; this.code=d.code;
    this.onCode?.(d); this.setStatus('WAITING_FOR_IPHONE'); this.pollOffer(); return d;
  }
  async joinCaptureSession(code=this.code, sessionId=this.sessionId) {
    this.role='capture'; this.code=String(code||'').trim().toUpperCase();
    if (!this.code) throw new Error('Enter the 6-character pairing code from the iPad.');
    if (!sessionId) {
      const r=await fetch(`${this.apiBase}/api/remote/session?code=${encodeURIComponent(this.code)}`, { headers: this.getHeaders() });
      if(!r.ok) throw new Error('Pairing code not found or expired.');
      this.sessionId=(await r.json()).sessionId;
    }
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera/microphone capture is not available in this browser.');
    let screen=null, mic=null;
    if(navigator.mediaDevices.getDisplayMedia){
      try { screen=await navigator.mediaDevices.getDisplayMedia({video:{cursor:'always'},audio:true}); }
      catch(e){ if(!['AbortError','NotAllowedError'].includes(e?.name)) console.warn('[Payuu Remote] screen',e); }
    }
    try { mic=await navigator.mediaDevices.getUserMedia({audio:true,video:false}); } catch(e){ console.warn('[Payuu Remote] mic',e); }
    const combined=new MediaStream();
    screen?.getTracks().forEach(t=>combined.addTrack(t)); mic?.getAudioTracks().forEach(t=>combined.addTrack(t));
    if(!combined.getTracks().length) throw new Error('No capture tracks were granted. Allow Screen Recording and/or Microphone access.');
    this.localStream=combined;
    [...(screen?.getTracks()||[]),...(mic?.getTracks()||[])].forEach(t=>t.addEventListener('ended',()=>this.setStatus('CAPTURE_TRACK_ENDED')));
    await this.createPeer();
    combined.getTracks().forEach(t=>this.pc.addTransceiver(t,{direction:'sendonly',streams:[combined]}));
    await this.pc.setLocalDescription(await this.pc.createOffer()); await this.waitForIce();
    const r=await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}/offer?code=${encodeURIComponent(this.code)}`,{method:'POST',headers:this.getHeaders({'Content-Type':'application/json'}),body:JSON.stringify({sdp:this.pc.localDescription.sdp})});
    if(!r.ok) throw new Error(`Could not send iPhone offer (${r.status}).`);
    this.setStatus('WAITING_FOR_IPAD'); this.pollAnswer();
    return {sessionId:this.sessionId,code:this.code,hasScreen:!!screen,hasAudio:combined.getAudioTracks().length>0};
  }
  async createPeer(){
    this.stopPeer(false);
    this.pc=new RTCPeerConnection({iceServers:this.iceServers,bundlePolicy:'max-bundle',rtcpMuxPolicy:'require'});
    this.pc.onconnectionstatechange=()=>{this.setStatus(`WEBRTC_${String(this.pc?.connectionState||'closed').toUpperCase()}`); if(['failed','closed'].includes(this.pc?.connectionState)) this.cleanupPoll();};
    this.pc.oniceconnectionstatechange=()=>this.setStatus(`ICE_${String(this.pc?.iceConnectionState||'closed').toUpperCase()}`);
    this.pc.ontrack=e=>{
      if(!this.remoteStream) this.remoteStream=new MediaStream();
      if(!this.remoteStream.getTracks().some(t=>t.id===e.track.id)) this.remoteStream.addTrack(e.track);
      this.remoteVideo.srcObject=this.remoteStream; this.remoteVideo.play().catch(()=>{}); this.onRemoteStream?.(this.remoteStream);
    };
  }
  async pollOffer(){
    this.cleanupPoll(); this.running=true;
    const loop=async()=>{ if(!this.running)return; try{
      const r=await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}/offer?code=${encodeURIComponent(this.code)}`, { headers: this.getHeaders() });
      if(r.ok){const d=await r.json(); if(d.sdp){
        await this.createPeer(); await this.pc.setRemoteDescription({type:'offer',sdp:d.sdp});
        await this.pc.setLocalDescription(await this.pc.createAnswer()); await this.waitForIce();
        const a=await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}/answer?code=${encodeURIComponent(this.code)}`,{method:'POST',headers:this.getHeaders({'Content-Type':'application/json'}),body:JSON.stringify({sdp:this.pc.localDescription.sdp})});
        if(!a.ok) throw new Error(`Could not send iPad answer (${a.status}).`); this.setStatus('ANSWER_SENT'); return;
      }}
    }catch(e){this.onError?.(e);} this.pollTimer=setTimeout(loop,1000);}; loop();
  }
  async pollAnswer(){
    this.cleanupPoll(); this.running=true;
    const loop=async()=>{ if(!this.running)return; try{
      const r=await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}/answer?code=${encodeURIComponent(this.code)}`, { headers: this.getHeaders() });
      if(r.ok){const d=await r.json(); if(d.sdp){await this.pc.setRemoteDescription({type:'answer',sdp:d.sdp}); this.setStatus('ANSWER_RECEIVED'); return;}}
    }catch(e){this.onError?.(e);} this.pollTimer=setTimeout(loop,1000);}; loop();
  }
  async waitForIce(){
    if(!this.pc||this.pc.iceGatheringState==='complete')return;
    await new Promise(resolve=>{let done=false; const finish=()=>{if(done)return; if(this.pc?.iceGatheringState==='complete'||Date.now()-start>5000){done=true;this.pc?.removeEventListener('icegatheringstatechange',finish);resolve();}}; const start=Date.now(); this.pc.addEventListener('icegatheringstatechange',finish); setTimeout(finish,5100);});
  }
  cleanupPoll(){this.running=false;if(this.pollTimer)clearTimeout(this.pollTimer);this.pollTimer=null;}
  stopPeer(stopLocal=true){this.cleanupPoll();this.pc?.close();this.pc=null;if(stopLocal&&this.localStream){this.localStream.getTracks().forEach(t=>t.stop());this.localStream=null;}}
  async close(){try{if(this.sessionId&&this.code)await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}?code=${encodeURIComponent(this.code)}`,{method:'DELETE',headers:this.getHeaders()});}catch(_){}this.stopPeer(true);this.remoteStream?.getTracks().forEach(t=>t.stop());this.remoteStream=null;this.sessionId='';this.code='';this.setStatus('DISCONNECTED');}
  setStatus(s){this.onStatus?.(s);}
}
