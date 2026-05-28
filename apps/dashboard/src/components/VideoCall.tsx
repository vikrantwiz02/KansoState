"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video, VideoOff, Mic, MicOff, PhoneOff, Users, RefreshCw,
  Maximize2, Minimize2, Monitor, MonitorOff, LayoutGrid, Expand,
} from "lucide-react";

interface Props { meetingId: string; peerId: string; onJoinedChange?: (joined: boolean) => void; }
interface RemotePeer { id: string; stream: MediaStream | null; }

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1920, min: 1280 },
  height: { ideal: 1080, min: 720 },
  frameRate: { ideal: 30, min: 15 },
  facingMode: "user",
};

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  sampleRate: 48000,
};

const WS_CONNECT_TIMEOUT_MS = 10_000;

export function VideoCall({ meetingId, peerId, onJoinedChange }: Props) {
  const [joined, setJoined]             = useState(false);
  const [cameraOn, setCameraOn]         = useState(false);
  const [micOn, setMicOn]               = useState(true);
  const [peers, setPeers]               = useState<RemotePeer[]>([]);
  const [permError, setPermError]       = useState<"blocked" | "macos-blocked" | "no-device" | "in-use" | null>(null);
  const [rawError, setRawError]         = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pinnedPeer, setPinnedPeer]     = useState<string | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const localVideoRef     = useRef<HTMLVideoElement | null>(null);
  const localStreamRef    = useRef<MediaStream | null>(null);
  const wsRef             = useRef<WebSocket | null>(null);
  const joiningRef        = useRef(false);
  const pcsRef            = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef  = useRef<Map<string, MediaStream>>(new Map());
  const remoteVideoRefs   = useRef<Map<string, HTMLVideoElement>>(new Map());
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const screenStreamRef   = useRef<MediaStream | null>(null);
  // ICE candidates that arrived before the remote description was set.
  const iceCandidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // ── Callback ref: re-attaches stream on every mount ───────────────────────
  // Switching grid ↔ speaker unmounts/remounts the element; this re-attaches.
  const attachLocalStream = useCallback((el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    if (!el) return;
    const stream = localStreamRef.current;
    if (stream && stream.getVideoTracks().length > 0) {
      el.srcObject = stream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, []);

  // ── Fullscreen sync ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      pcsRef.current.forEach((pc) => pc.close());
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // ── WebRTC: create or retrieve peer connection ─────────────────────────────
  function getPeerConn(remotePeerId: string, polite: boolean): RTCPeerConnection {
    if (pcsRef.current.has(remotePeerId)) return pcsRef.current.get(remotePeerId)!;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcsRef.current.set(remotePeerId, pc);

    // Add local tracks immediately so the offer carries them.
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: "ice", to: remotePeerId, payload: e.candidate });
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      remoteStreamsRef.current.set(remotePeerId, stream);
      const vid = remoteVideoRefs.current.get(remotePeerId);
      if (vid) { vid.srcObject = stream; vid.play().catch(() => {}); }
      setPeers((prev) => {
        const exists = prev.find((p) => p.id === remotePeerId);
        if (exists) return prev.map((p) => p.id === remotePeerId ? { ...p, stream } : p);
        return [...prev, { id: remotePeerId, stream }];
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed" || state === "closed") {
        pc.onconnectionstatechange = null; // prevent repeated firing
        pcsRef.current.delete(remotePeerId);
        iceCandidateQueueRef.current.delete(remotePeerId);
      }
    };

    // Impolite peer creates the offer; polite peer waits.
    if (!polite) {
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription();
          send({ type: "offer", to: remotePeerId, payload: pc.localDescription });
        } catch {/* ignore */}
      };
    }

    setPeers((prev) => prev.find((p) => p.id === remotePeerId) ? prev : [...prev, { id: remotePeerId, stream: null }]);
    return pc;
  }

  function send(msg: object) {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }

  // ── Signal message handler ────────────────────────────────────────────────
  // Stable callback — uses only refs and setters, never stale state.
  const handleSignal = useCallback(async (msg: Record<string, unknown>) => {
    const from = msg.from as string;

    switch (msg.type) {
      case "room-state": {
        const existingPeers = ((msg.payload as Record<string, unknown>)?.peers as string[]) ?? [];
        for (const existingId of existingPeers) {
          const pc = getPeerConn(existingId, false);
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            send({ type: "offer", to: existingId, payload: pc.localDescription });
          } catch {/* ignore */}
        }
        break;
      }

      case "peer-joined":
        getPeerConn(from, true);
        break;

      case "peer-left": {
        const pc = pcsRef.current.get(from);
        if (pc) {
          pc.onconnectionstatechange = null;
          pc.close();
          pcsRef.current.delete(from);
        }
        remoteStreamsRef.current.delete(from);
        remoteVideoRefs.current.delete(from);
        iceCandidateQueueRef.current.delete(from);
        setPeers((prev) => prev.filter((p) => p.id !== from));
        setPinnedPeer((prev) => (prev === from ? null : prev));
        break;
      }

      case "offer": {
        const pc = getPeerConn(from, true);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
          // Drain queued ICE candidates now that remote description is set.
          const queued = iceCandidateQueueRef.current.get(from) ?? [];
          for (const c of queued) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {/* ignore */} }
          iceCandidateQueueRef.current.delete(from);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: "answer", to: from, payload: pc.localDescription });
        } catch {
          // Offer failed — close the broken PC so renegotiation can create a fresh one.
          const brokenPc = pcsRef.current.get(from);
          if (brokenPc) { brokenPc.close(); pcsRef.current.delete(from); }
        }
        break;
      }

      case "answer": {
        const pc = pcsRef.current.get(from);
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
            // Drain queued ICE candidates.
            const queued = iceCandidateQueueRef.current.get(from) ?? [];
            for (const c of queued) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {/* ignore */} }
            iceCandidateQueueRef.current.delete(from);
          } catch {/* ignore */}
        }
        break;
      }

      case "ice": {
        const pc = pcsRef.current.get(from);
        if (!pc) break;
        const candidate = new RTCIceCandidate(msg.payload as RTCIceCandidateInit);
        if (pc.remoteDescription) {
          // Remote description already set — add immediately.
          pc.addIceCandidate(candidate).catch(() => {});
        } else {
          // Queue until setRemoteDescription completes (race condition fix).
          const queue = iceCandidateQueueRef.current.get(from) ?? [];
          queue.push(msg.payload as RTCIceCandidateInit);
          iceCandidateQueueRef.current.set(from, queue);
        }
        break;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────────
  async function joinCall() {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setPermError(null);
    setRawError(null);

    let stream: MediaStream | null = null;

    for (const constraints of [
      { video: VIDEO_CONSTRAINTS, audio: AUDIO_CONSTRAINTS },
      { video: false, audio: AUDIO_CONSTRAINTS },
    ]) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        setCameraOn(!!(constraints.video));
        break;
      } catch (err) {
        const e = err instanceof DOMException ? err : null;
        const name = e?.name ?? "UnknownError";
        const errMsg = e?.message ?? String(err);

        if (!constraints.video) {
          if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            let permState: PermissionState | null = null;
            try {
              const [cam, mic] = await Promise.all([
                navigator.permissions.query({ name: "camera" as PermissionName }),
                navigator.permissions.query({ name: "microphone" as PermissionName }),
              ]);
              if (cam.state === "granted" || mic.state === "granted") permState = "granted";
            } catch {/* ignore */}
            setPermError(permState === "granted" ? "macos-blocked" : "blocked");
          } else if (name === "NotReadableError" || name === "AbortError") {
            setPermError("in-use");
          } else {
            setPermError("no-device");
          }
          setRawError(`${name}: ${errMsg}`);
          joiningRef.current = false;
          return;
        }
      }
    }

    if (!stream) { joiningRef.current = false; return; }
    localStreamRef.current = stream;

    let url: string | undefined;
    try {
      const res = await fetch(`/api/signal-ticket?meetingId=${encodeURIComponent(meetingId)}&peerId=${encodeURIComponent(peerId)}`);
      if (!res.ok) throw new Error(`Signal ticket HTTP ${res.status}`);
      ({ url } = await res.json());
    } catch (err) {
      setRawError(err instanceof Error ? err.message : "Failed to fetch signal ticket");
      stream.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      joiningRef.current = false;
      return;
    }

    if (!url) {
      setRawError("No signal URL returned");
      stream.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      joiningRef.current = false;
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    // Attach all handlers BEFORE awaiting open to avoid race on early close.
    ws.onmessage = (e) => {
      try { handleSignal(JSON.parse(e.data)); } catch {/* ignore */}
    };
    ws.onclose = () => { setJoined(false); onJoinedChange?.(false); };
    ws.onerror = () => { setJoined(false); onJoinedChange?.(false); };

    try {
      await Promise.race([
        new Promise<void>((resolve) => { ws.onopen = () => resolve(); }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("WebSocket connection timed out")), WS_CONNECT_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      ws.close();
      stream.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setRawError(err instanceof Error ? err.message : "Connection failed");
      joiningRef.current = false;
      return;
    }

    joiningRef.current = false;
    setJoined(true);
    onJoinedChange?.(true);
  }

  function leaveCall() {
    // Detach handlers before closing so ws.onclose doesn't double-fire onJoinedChange.
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); }
    pcsRef.current.forEach((pc) => { pc.onconnectionstatechange = null; pc.close(); });
    pcsRef.current.clear();
    iceCandidateQueueRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    remoteStreamsRef.current.clear();
    remoteVideoRefs.current.clear();
    setPeers([]);
    setJoined(false);
    onJoinedChange?.(false);
    setCameraOn(false);
    setIsScreenSharing(false);
    setPinnedPeer(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  function toggleCamera() {
    if (!localStreamRef.current) return;
    const video = localStreamRef.current.getVideoTracks()[0];
    if (video) { video.enabled = !video.enabled; setCameraOn(video.enabled); }
  }

  function toggleMic() {
    if (!localStreamRef.current) return;
    const audio = localStreamRef.current.getAudioTracks()[0];
    if (audio) { audio.enabled = !audio.enabled; setMicOn(audio.enabled); }
  }

  async function toggleFullscreen() {
    if (!videoContainerRef.current) return;
    try {
      if (!document.fullscreenElement) await videoContainerRef.current.requestFullscreen();
      else await document.exitFullscreen();
    } catch {/* ignore */}
  }

  async function toggleScreenShare() {
    // Store original video track for atomic rollback if anything fails.
    const originalTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;

    if (isScreenSharing) {
      // Switch back to camera.
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false });
        const newTrack = camStream.getVideoTracks()[0];
        // Replace on all peer connections atomically.
        await Promise.all(
          Array.from(pcsRef.current.values()).map((pc) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === "video");
            return sender ? sender.replaceTrack(newTrack) : Promise.resolve();
          })
        );
        if (originalTrack) { originalTrack.stop(); localStreamRef.current?.removeTrack(originalTrack); }
        localStreamRef.current?.addTrack(newTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
        setCameraOn(true);
      } catch {
        // Camera re-acquisition failed — mute video gracefully.
        setCameraOn(false);
      }
      setIsScreenSharing(false);
      return;
    }

    // Switch to screen share.
    let screenStream: MediaStream;
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return; // User cancelled
    }

    const screenTrack = screenStream.getVideoTracks()[0];

    try {
      // Atomically replace on all connections before modifying local state.
      await Promise.all(
        Array.from(pcsRef.current.values()).map((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          return sender ? sender.replaceTrack(screenTrack) : Promise.resolve();
        })
      );
    } catch {
      // Failed on at least one peer — roll back.
      screenStream.getTracks().forEach((t) => t.stop());
      if (originalTrack) {
        await Promise.all(
          Array.from(pcsRef.current.values()).map((pc) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === "video");
            return sender ? sender.replaceTrack(originalTrack) : Promise.resolve();
          })
        ).catch(() => {});
      }
      return;
    }

    screenStreamRef.current = screenStream;
    if (originalTrack) { originalTrack.stop(); localStreamRef.current?.removeTrack(originalTrack); }
    localStreamRef.current?.addTrack(screenTrack);
    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    setIsScreenSharing(true);
    setCameraOn(true);

    // When the user clicks "Stop sharing" in the browser chrome, restore camera.
    // Runs async — all captures are refs or stable setters so closure is safe.
    screenTrack.onended = async () => {
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false });
        const newTrack = camStream.getVideoTracks()[0];
        await Promise.all(
          Array.from(pcsRef.current.values()).map((pc) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === "video");
            return sender ? sender.replaceTrack(newTrack) : Promise.resolve();
          })
        );
        const old = localStreamRef.current?.getVideoTracks()[0];
        if (old) { old.stop(); localStreamRef.current?.removeTrack(old); }
        localStreamRef.current?.addTrack(newTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
        setCameraOn(true);
      } catch {
        setCameraOn(false);
      }
    };
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (permError) {
    return <PermissionModal type={permError} rawError={rawError} onRetry={() => { setPermError(null); joinCall(); }} />;
  }

  if (!joined) {
    return (
      <div className="glass rounded-2xl p-6 text-center space-y-4">
        <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center mx-auto">
          <Users className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h3 className="font-semibold text-sm text-slate-200 mb-1">Group video call</h3>
          <p className="text-xs text-slate-500">HD video · Noise cancellation · Screen share</p>
        </div>
        {rawError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{rawError}</p>
        )}
        <button
          onClick={joinCall}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]"
        >
          <Video className="w-4 h-4" /> Join video call
        </button>
      </div>
    );
  }

  const allParticipants = [{ id: peerId, self: true }, ...peers.map((p) => ({ id: p.id, self: false }))];
  const pinned = pinnedPeer;
  const others = allParticipants.filter((p) => p.id !== pinned);
  const gridCols = allParticipants.length === 1 ? "grid-cols-1" : allParticipants.length <= 4 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div ref={videoContainerRef} className="glass rounded-2xl overflow-hidden flex flex-col">
      {/* ── Video area ──────────────────────────────────────────────────────── */}
      <div className="relative bg-black/60 flex-1">
        {pinned ? (
          <div className="flex gap-1 p-1.5 h-full">
            {/* Main large tile */}
            <div className="flex-1 relative rounded-xl overflow-hidden bg-slate-900 min-h-0">
              {pinned === peerId ? (
                <>
                  <video ref={attachLocalStream} autoPlay muted playsInline
                    className={`w-full h-full object-cover ${cameraOn ? (isScreenSharing ? "" : "scale-x-[-1]") : "hidden"}`} />
                  {!cameraOn && <AvatarPlaceholder id={peerId} large />}
                  <TileLabel id={peerId} suffix="(you)" micOn={micOn} />
                  {isScreenSharing && <ScreenShareBadge />}
                </>
              ) : (
                <RemoteVideoTile
                  peerId={pinned}
                  stream={remoteStreamsRef.current.get(pinned) ?? null}
                  onRef={(el) => {
                    if (el) {
                      remoteVideoRefs.current.set(pinned, el);
                      const s = remoteStreamsRef.current.get(pinned);
                      if (s) { el.srcObject = s; el.play().catch(() => {}); }
                    }
                  }}
                />
              )}
              <button
                onClick={() => setPinnedPeer(null)}
                className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white text-[10px] px-2 py-1 rounded-md transition-all"
              >
                Grid view
              </button>
            </div>

            {/* Sidebar thumbnails */}
            {others.length > 0 && (
              <div className="w-28 flex flex-col gap-1 overflow-y-auto">
                {others.map((p) => (
                  <div
                    key={p.id}
                    className="relative rounded-lg overflow-hidden bg-slate-900 aspect-video cursor-pointer ring-2 ring-transparent hover:ring-indigo-500/50 transition-all flex-shrink-0"
                    onClick={() => setPinnedPeer(p.id)}
                  >
                    {p.self ? (
                      <>
                        <video ref={attachLocalStream} autoPlay muted playsInline
                          className={`w-full h-full object-cover ${cameraOn ? (isScreenSharing ? "" : "scale-x-[-1]") : "hidden"}`} />
                        {!cameraOn && <AvatarPlaceholder id={peerId} />}
                      </>
                    ) : (
                      <RemoteVideoTile
                        peerId={p.id}
                        stream={peers.find((peer) => peer.id === p.id)?.stream ?? null}
                        onRef={(el) => {
                          if (el) {
                            remoteVideoRefs.current.set(p.id, el);
                            const s = remoteStreamsRef.current.get(p.id);
                            if (s) { el.srcObject = s; el.play().catch(() => {}); }
                          } else {
                            remoteVideoRefs.current.delete(p.id);
                          }
                        }}
                      />
                    )}
                    <div className="absolute bottom-0.5 left-1 text-[9px] text-white bg-black/60 rounded px-1">
                      {p.self ? "you" : p.id}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Grid view */
          <div className={`grid gap-1.5 p-2 ${gridCols}`}>
            <div
              className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video cursor-pointer group"
              onClick={() => setPinnedPeer(peerId)}
            >
              <video ref={attachLocalStream} autoPlay muted playsInline
                className={`w-full h-full object-cover ${cameraOn ? (isScreenSharing ? "" : "scale-x-[-1]") : "hidden"}`} />
              {!cameraOn && <AvatarPlaceholder id={peerId} />}
              <TileLabel id={peerId} suffix="(you)" micOn={micOn} />
              {isScreenSharing && <ScreenShareBadge />}
              <PinHint />
            </div>

            {peers.map((p) => (
              <div key={p.id} className="cursor-pointer group" onClick={() => setPinnedPeer(p.id)}>
                <RemoteVideoTile
                  peerId={p.id}
                  stream={p.stream}
                  onRef={(el) => {
                    if (el) {
                      remoteVideoRefs.current.set(p.id, el);
                      const s = remoteStreamsRef.current.get(p.id);
                      if (s) { el.srcObject = s; el.play().catch(() => {}); }
                    } else {
                      remoteVideoRefs.current.delete(p.id);
                    }
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Controls bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/[0.06] bg-black/20">
        <span className="text-xs text-slate-500 tabular-nums">
          {allParticipants.length} participant{allParticipants.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-2">
          <ControlBtn active={cameraOn} onClick={toggleCamera} title={cameraOn ? "Turn off camera" : "Turn on camera"}
            icon={cameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />} danger={!cameraOn} />
          <ControlBtn active={micOn} onClick={toggleMic} title={micOn ? "Mute" : "Unmute"}
            icon={micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />} danger={!micOn} />
          <ControlBtn active={!isScreenSharing} onClick={toggleScreenShare}
            title={isScreenSharing ? "Stop sharing" : "Share screen"}
            icon={isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            highlight={isScreenSharing} />
          <ControlBtn active onClick={() => setPinnedPeer(pinned ? null : peerId)}
            title={pinned ? "Grid view" : "Speaker view"}
            icon={pinned ? <LayoutGrid className="w-4 h-4" /> : <Expand className="w-4 h-4" />} />
          <ControlBtn active onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            icon={isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />} />
          <button onClick={leaveCall}
            className="w-9 h-9 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white transition-all"
            title="Leave call">
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reusable UI components ─────────────────────────────────────────────────────

function ControlBtn({ active, onClick, title, icon, danger, highlight }: {
  active: boolean; onClick: () => void; title: string; icon: React.ReactNode;
  danger?: boolean; highlight?: boolean;
}) {
  const style = danger
    ? "bg-red-500/20 border border-red-500/30 text-red-400"
    : highlight
    ? "bg-indigo-500/30 border border-indigo-500/40 text-indigo-300"
    : active
    ? "bg-white/[0.08] hover:bg-white/[0.14] text-slate-200"
    : "bg-white/[0.04] text-slate-500";
  return (
    <button className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${style}`}
      onClick={onClick} title={title}>
      {icon}
    </button>
  );
}

function AvatarPlaceholder({ id, large }: { id: string; large?: boolean }) {
  const sz = large ? "w-16 h-16 text-xl" : "w-10 h-10 text-sm";
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className={`${sz} rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold`}>
        {id.slice(0, 2).toUpperCase()}
      </div>
    </div>
  );
}

function TileLabel({ id, suffix, micOn }: { id: string; suffix?: string; micOn?: boolean }) {
  return (
    <div className="absolute bottom-1.5 left-2 flex items-center gap-1 bg-black/60 rounded-md px-1.5 py-0.5">
      <span className="text-[10px] text-white font-medium">{id}{suffix ? ` ${suffix}` : ""}</span>
      {micOn === false && <MicOff className="w-2.5 h-2.5 text-red-400" />}
    </div>
  );
}

function ScreenShareBadge() {
  return (
    <div className="absolute top-2 left-2 flex items-center gap-1 bg-indigo-600/80 rounded-md px-1.5 py-0.5">
      <Monitor className="w-2.5 h-2.5 text-white" />
      <span className="text-[9px] text-white font-medium">Sharing</span>
    </div>
  );
}

function PinHint() {
  return (
    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded-xl">
      <span className="text-[10px] text-white bg-black/60 px-2 py-1 rounded-md">Click to pin</span>
    </div>
  );
}

function RemoteVideoTile({ peerId, stream, onRef }: {
  peerId: string; stream: MediaStream | null; onRef: (el: HTMLVideoElement | null) => void;
}) {
  const hasVideo = stream && stream.getVideoTracks().length > 0;
  return (
    <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video w-full h-full">
      <video ref={onRef} playsInline autoPlay className={`w-full h-full object-cover ${hasVideo ? "" : "hidden"}`} />
      {!hasVideo && <AvatarPlaceholder id={peerId} />}
      <TileLabel id={peerId} />
      {!stream && (
        <div className="absolute top-1.5 right-1.5 text-[10px] text-amber-400 bg-black/60 rounded px-1.5 py-0.5">
          connecting…
        </div>
      )}
    </div>
  );
}

// ── Permission modal ───────────────────────────────────────────────────────────

const PERMISSION_CONTENT = {
  blocked: {
    title: "Camera & microphone access denied",
    subtitle: "Chrome is blocking this site. Fix it in the address bar, then click Retry.",
    steps: [{ label: "Step 1 — Chrome in-browser", color: "border-indigo-500/30 bg-indigo-500/[0.06]", num: "text-indigo-300",
      items: [
        <>Click the <strong className="text-slate-200">🔒 lock icon</strong> in Chrome&apos;s address bar</>,
        <>Set <strong className="text-slate-200">Camera</strong> and <strong className="text-slate-200">Microphone</strong> to <span className="text-emerald-400">Allow</span></>,
        <>Click <strong className="text-slate-200">Retry</strong> below</>,
      ],
    }],
  },
  "macos-blocked": {
    title: "macOS is blocking Chrome's camera & mic",
    subtitle: "Chrome has permission, but macOS is blocking it at the system level.",
    steps: [{ label: "macOS System Settings", color: "border-violet-500/30 bg-violet-500/[0.06]", num: "text-violet-300",
      items: [
        <>Open <strong className="text-slate-200">Apple menu → System Settings → Privacy & Security → Camera</strong></>,
        <>Find <strong className="text-slate-200">Google Chrome</strong> and enable its toggle</>,
        <>Do the same under <strong className="text-slate-200">Privacy & Security → Microphone</strong></>,
        <>Quit and reopen Chrome, then click <strong className="text-slate-200">Retry</strong></>,
      ],
    }],
  },
  "in-use": {
    title: "Camera or microphone is already in use",
    subtitle: "Another app has the camera or mic open. Close it and try again.",
    steps: [{ label: "How to fix", color: "border-amber-500/30 bg-amber-500/[0.06]", num: "text-amber-300",
      items: [
        <>Quit <strong className="text-slate-200">Zoom, FaceTime, Teams, Meet</strong> or any other video app</>,
        <>Close other Chrome tabs using the camera</>,
        <>Click <strong className="text-slate-200">Retry</strong> below</>,
      ],
    }],
  },
  "no-device": {
    title: "No camera or microphone detected",
    subtitle: "Make sure a camera and microphone are connected.",
    steps: [{ label: "How to fix", color: "border-slate-500/30 bg-slate-500/[0.06]", num: "text-slate-300",
      items: [
        <>Plug in a USB or Bluetooth camera/mic, or use a MacBook&apos;s built-in ones</>,
        <>Check <strong className="text-slate-200">System Settings → Privacy & Security → Camera</strong></>,
      ],
    }],
  },
};

function PermissionModal({ type, rawError, onRetry }: {
  type: "blocked" | "macos-blocked" | "no-device" | "in-use";
  rawError: string | null;
  onRetry: () => void;
}) {
  const content = PERMISSION_CONTENT[type];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="glass rounded-2xl p-7 w-full max-w-lg">
        <div className="flex items-center justify-center gap-3 mb-5">
          {[Video, Mic].map((Icon, i) => (
            <div key={i} className="relative w-12 h-12 rounded-xl bg-slate-800 border border-white/[0.08] flex items-center justify-center">
              <Icon className="w-5 h-5 text-slate-400" />
              <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 border-2 border-[#070810] flex items-center justify-center">
                <span className="text-[9px] font-bold leading-none text-white">✕</span>
              </div>
            </div>
          ))}
        </div>
        <h2 className="text-base font-bold text-center mb-1">{content.title}</h2>
        <p className="text-xs text-slate-400 text-center mb-5 leading-relaxed">{content.subtitle}</p>
        <div className="space-y-3 mb-5">
          {content.steps.map(({ label, color, num, items }) => (
            <div key={label} className={`rounded-xl border p-4 ${color}`}>
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">{label}</div>
              <div className="space-y-2">
                {items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className={`text-[11px] font-bold mt-0.5 flex-shrink-0 ${num}`}>{i + 1}</span>
                    <p className="text-xs text-slate-300 leading-relaxed">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {rawError && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-black/30 border border-white/[0.06]">
            <p className="text-[10px] text-slate-600 font-mono truncate">{rawError}</p>
          </div>
        )}
        <button onClick={onRetry}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold transition-all">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    </div>
  );
}
