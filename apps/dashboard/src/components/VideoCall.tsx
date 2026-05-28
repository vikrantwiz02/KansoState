"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Video, VideoOff, Mic, MicOff, PhoneOff, Users, RefreshCw } from "lucide-react";

interface Props {
  meetingId: string;
  peerId: string;
}

interface RemotePeer {
  id: string;
  stream: MediaStream | null;
}

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

export function VideoCall({ meetingId, peerId }: Props) {
  const [joined, setJoined] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [permError, setPermError] = useState<"blocked" | "macos-blocked" | "no-device" | "in-use" | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  // Remote video elements — keyed by peerId
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  function getPeerConn(remotePeerId: string, polite: boolean): RTCPeerConnection {
    if (pcsRef.current.has(remotePeerId)) {
      return pcsRef.current.get(remotePeerId)!;
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcsRef.current.set(remotePeerId, pc);

    // Add local tracks if we have a stream
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({ type: "ice", to: remotePeerId, payload: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      remoteStreamsRef.current.set(remotePeerId, stream);

      // Attach to video element if it's already mounted
      const vid = remoteVideoRefs.current.get(remotePeerId);
      if (vid) {
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }

      setPeers((prev) => {
        const exists = prev.find((p) => p.id === remotePeerId);
        if (exists) return prev.map((p) => p.id === remotePeerId ? { ...p, stream } : p);
        return [...prev, { id: remotePeerId, stream }];
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        pcsRef.current.delete(remotePeerId);
      }
    };

    // Polite peer handles offer collision
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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSignal = useCallback(async (msg: any) => {
    switch (msg.type) {
      case "room-state": {
        // Create connections to all existing peers (we are impolite / initiator)
        for (const existingId of (msg.payload?.peers ?? [])) {
          const pc = getPeerConn(existingId, false);
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            send({ type: "offer", to: existingId, payload: pc.localDescription });
          } catch {/* ignore */}
        }
        break;
      }
      case "peer-joined": {
        // They will send us an offer — just ensure the connection object is ready (polite)
        getPeerConn(msg.from, true);
        break;
      }
      case "peer-left": {
        const pc = pcsRef.current.get(msg.from);
        if (pc) { pc.close(); pcsRef.current.delete(msg.from); }
        remoteStreamsRef.current.delete(msg.from);
        setPeers((prev) => prev.filter((p) => p.id !== msg.from));
        break;
      }
      case "offer": {
        const pc = getPeerConn(msg.from, true);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: "answer", to: msg.from, payload: pc.localDescription });
        } catch {/* ignore */}
        break;
      }
      case "answer": {
        const pc = pcsRef.current.get(msg.from);
        if (pc) {
          try { await pc.setRemoteDescription(new RTCSessionDescription(msg.payload)); } catch {/* ignore */}
        }
        break;
      }
      case "ice": {
        const pc = pcsRef.current.get(msg.from);
        if (pc) {
          try { await pc.addIceCandidate(new RTCIceCandidate(msg.payload)); } catch {/* ignore */}
        }
        break;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function joinCall() {
    setPermError(null);
    setRawError(null);

    async function tryGetMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
      return navigator.mediaDevices.getUserMedia(constraints);
    }

    let stream: MediaStream | null = null;

    // Try video+audio first, fall back to audio-only
    for (const constraints of [
      { video: true, audio: true },
      { video: false, audio: true },
    ]) {
      try {
        stream = await tryGetMedia(constraints);
        if (constraints.video === false) setCameraOn(false);
        else setCameraOn(true);
        break;
      } catch (err) {
        const e = err instanceof DOMException ? err : null;
        const name = e?.name ?? "UnknownError";
        const msg = e?.message ?? String(err);

        if (constraints.video === false) {
          // Both attempts failed — determine best error to show
          if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            // Check if Chrome itself has "granted" permission — if so, macOS is blocking at OS level
            let permState: PermissionState | null = null;
            try {
              const [cam, mic] = await Promise.all([
                navigator.permissions.query({ name: "camera" as PermissionName }),
                navigator.permissions.query({ name: "microphone" as PermissionName }),
              ]);
              if (cam.state === "granted" || mic.state === "granted") permState = "granted";
            } catch { /* ignore */ }
            setPermError(permState === "granted" ? "macos-blocked" : "blocked");
          } else if (name === "NotReadableError" || name === "AbortError") {
            setPermError("in-use");
          } else {
            setPermError("no-device");
          }
          setRawError(`${name}: ${msg}`);
          return;
        }
        // First attempt failed — continue to audio-only
      }
    }

    if (!stream) return;
    localStreamRef.current = stream;
    if (localVideoRef.current && stream.getVideoTracks().length > 0) {
      localVideoRef.current.srcObject = stream;
      await localVideoRef.current.play().catch(() => {});
    }

    const res = await fetch(`/api/signal-ticket?meetingId=${encodeURIComponent(meetingId)}&peerId=${encodeURIComponent(peerId)}`);
    const { url } = await res.json();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try { handleSignal(JSON.parse(e.data)); } catch {/* ignore */}
    };
    ws.onclose = () => setJoined(false);

    await new Promise<void>((resolve) => { ws.onopen = () => resolve(); });
    setJoined(true);
  }

  function leaveCall() {
    wsRef.current?.close();
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setPeers([]);
    setJoined(false);
    setCameraOn(false);
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

  // Attach local stream to video element once the grid renders (joined=true).
  // joinCall() sets srcObject before setJoined(true), so localVideoRef is null at that point.
  useEffect(() => {
    if (!joined || !localVideoRef.current || !localStreamRef.current) return;
    const stream = localStreamRef.current;
    if (stream.getVideoTracks().length > 0) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [joined]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      pcsRef.current.forEach((pc) => pc.close());
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const allParticipants = joined ? [{ id: peerId, self: true }, ...peers.map((p) => ({ id: p.id, self: false }))] : [];

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
          <p className="text-xs text-slate-500">Everyone who joins this meeting can see and hear each other live.</p>
        </div>
        <button
          onClick={joinCall}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]"
        >
          <Video className="w-4 h-4" /> Join video call
        </button>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Video grid */}
      <div className={`grid gap-1.5 p-2 bg-black/40 ${allParticipants.length === 1 ? "grid-cols-1" : allParticipants.length <= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
        {/* Self */}
        <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video">
          <video ref={localVideoRef} autoPlay muted playsInline className={`w-full h-full object-cover ${cameraOn ? "scale-x-[-1]" : "hidden"}`} />
          {!cameraOn && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-bold">
                {peerId.slice(0, 2).toUpperCase()}
              </div>
            </div>
          )}
          <div className="absolute bottom-1.5 left-2 flex items-center gap-1 bg-black/60 rounded-md px-1.5 py-0.5">
            <span className="text-[10px] text-white font-medium">{peerId} (you)</span>
            {!micOn && <MicOff className="w-2.5 h-2.5 text-red-400" />}
          </div>
        </div>

        {/* Remote peers */}
        {peers.map((p) => (
          <RemoteVideo
            key={p.id}
            peerId={p.id}
            stream={p.stream}
            onRef={(el) => {
              if (el) {
                remoteVideoRefs.current.set(p.id, el);
                const stream = remoteStreamsRef.current.get(p.id);
                if (stream) { el.srcObject = stream; el.play().catch(() => {}); }
              }
            }}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 px-4 py-3 border-t border-white/[0.06]">
        <button
          onClick={toggleCamera}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${cameraOn ? "bg-white/[0.08] hover:bg-white/[0.12] text-slate-200" : "bg-red-500/20 border border-red-500/30 text-red-400"}`}
          title={cameraOn ? "Turn off camera" : "Turn on camera"}
        >
          {cameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </button>
        <button
          onClick={toggleMic}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${micOn ? "bg-white/[0.08] hover:bg-white/[0.12] text-slate-200" : "bg-red-500/20 border border-red-500/30 text-red-400"}`}
          title={micOn ? "Mute" : "Unmute"}
        >
          {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>
        <button
          onClick={leaveCall}
          className="w-9 h-9 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white transition-all"
          title="Leave call"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
        <span className="text-xs text-slate-500 ml-1">
          {allParticipants.length} participant{allParticipants.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

const PERMISSION_CONTENT = {
  blocked: {
    title: "Camera & microphone access denied",
    subtitle: "Chrome is blocking this site. Fix it in the address bar, then click Retry.",
    steps: [
      {
        label: "Step 1 — Chrome in-browser",
        color: "border-indigo-500/30 bg-indigo-500/[0.06]",
        num: "text-indigo-300",
        items: [
          <>Click the <strong className="text-slate-200">🔒 lock icon</strong> in Chrome&apos;s address bar</>,
          <>Set <strong className="text-slate-200">Camera</strong> and <strong className="text-slate-200">Microphone</strong> to <span className="text-emerald-400">Allow</span></>,
          <>Click <strong className="text-slate-200">Retry</strong> below — no page refresh needed</>,
        ],
      },
    ],
  },
  "macos-blocked": {
    title: "macOS is blocking Chrome's camera & mic",
    subtitle: "Chrome has permission, but macOS is blocking it at the system level. Fix it in System Settings.",
    steps: [
      {
        label: "macOS System Settings",
        color: "border-violet-500/30 bg-violet-500/[0.06]",
        num: "text-violet-300",
        items: [
          <>Open <strong className="text-slate-200">Apple menu → System Settings → Privacy & Security → Camera</strong></>,
          <>Find <strong className="text-slate-200">Google Chrome</strong> and enable its toggle</>,
          <>Do the same under <strong className="text-slate-200">Privacy & Security → Microphone</strong></>,
          <>Quit and reopen Chrome, then click <strong className="text-slate-200">Retry</strong></>,
        ],
      },
    ],
  },
  "in-use": {
    title: "Camera or microphone is already in use",
    subtitle: "Another app has the camera or mic open. Close it and try again.",
    steps: [
      {
        label: "How to fix",
        color: "border-amber-500/30 bg-amber-500/[0.06]",
        num: "text-amber-300",
        items: [
          <>Quit <strong className="text-slate-200">Zoom, FaceTime, Teams, Meet</strong> or any other video app</>,
          <>Close other <strong className="text-slate-200">Chrome tabs</strong> that might be using the camera</>,
          <>Click <strong className="text-slate-200">Retry</strong> below</>,
        ],
      },
    ],
  },
  "no-device": {
    title: "No camera or microphone detected",
    subtitle: "Make sure a camera and microphone are connected to your Mac.",
    steps: [
      {
        label: "How to fix",
        color: "border-slate-500/30 bg-slate-500/[0.06]",
        num: "text-slate-300",
        items: [
          <>Plug in a USB or Bluetooth camera/mic, or use a MacBook&apos;s built-in ones</>,
          <>Check <strong className="text-slate-200">System Settings → Privacy & Security → Camera</strong> that Chrome is listed</>,
        ],
      },
    ],
  },
};

function PermissionModal({
  type,
  rawError,
  onRetry,
}: {
  type: "blocked" | "macos-blocked" | "no-device" | "in-use";
  rawError: string | null;
  onRetry: () => void;
}) {
  const content = PERMISSION_CONTENT[type];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="glass rounded-2xl p-7 w-full max-w-lg">
        {/* Icons */}
        <div className="flex items-center justify-center gap-3 mb-5">
          {[Video, Mic].map((Icon, i) => (
            <div key={i} className="relative w-13 h-13 w-12 h-12 rounded-xl bg-slate-800 border border-white/[0.08] flex items-center justify-center">
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

        <button
          onClick={onRetry}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    </div>
  );
}

function RemoteVideo({
  peerId,
  stream,
  onRef,
}: {
  peerId: string;
  stream: MediaStream | null;
  onRef: (el: HTMLVideoElement | null) => void;
}) {
  const hasVideo = stream && stream.getVideoTracks().length > 0;

  return (
    <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video">
      <video
        ref={onRef}
        playsInline
        autoPlay
        className={`w-full h-full object-cover ${hasVideo ? "" : "hidden"}`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-cyan-600 flex items-center justify-center text-sm font-bold">
            {peerId.slice(0, 2).toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-1.5 left-2 bg-black/60 rounded-md px-1.5 py-0.5">
        <span className="text-[10px] text-white font-medium">{peerId}</span>
      </div>
      {!stream && (
        <div className="absolute top-1.5 right-1.5 text-[10px] text-amber-400 bg-black/60 rounded px-1.5 py-0.5">
          connecting…
        </div>
      )}
    </div>
  );
}
