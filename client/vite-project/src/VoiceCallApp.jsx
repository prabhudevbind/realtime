import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import io from 'socket.io-client';

const SOCKET_URL = 'http://localhost:5000';

// Enhanced ICE servers configuration
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.ekiga.net' },
    { urls: 'stun:stun.ideasip.com' },
    { urls: 'stun:stun.schlund.de' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.voiparound.com' },
    { urls: 'stun:stun.voipbuster.com' },
    { urls: 'stun:stun.voipstunt.com' },
    { urls: 'stun:stun.counterpath.com' },
    { urls: 'stun:stun.1und1.de' },
    { urls: 'stun:stun.gmx.net' },
    { urls: 'stun:stun.callwithus.com' },
    { urls: 'stun:stun.counterpath.com' },
    { urls: 'stun:stun.1und1.de' },
    { urls: 'stun:stun.gmx.net' },
    { urls: 'stun:stun.callwithus.com' },
    { urls: 'stun:stun.internetcalls.com' }
  ],
  iceCandidatePoolSize: 10
};

export default function VoiceCallApp() {
  const [userId, setUserId] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isRemoteMuted, setIsRemoteMuted] = useState(false);
  const [callStatus, setCallStatus] = useState('');
  const [connectionState, setConnectionState] = useState('disconnected');
  
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const localAudioRef = useRef(null);
  const isInitiatorRef = useRef(false);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);

    socketRef.current.on('connect', () => {
      console.log('Connected to signaling server');
    });

    socketRef.current.on('offer', async ({ offer, from }) => {
      console.log('Received offer from', from);
      setCallStatus(`Incoming call from ${from}...`);
      await handleReceiveOffer(offer, from);
    });

    socketRef.current.on('answer', async ({ answer, from }) => {
      console.log('Received answer from', from);
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
        setCallStatus('Connected');
      }
    });

    socketRef.current.on('ice-candidate', ({ candidate, from }) => {
      console.log('Received ICE candidate from', from);
      if (peerConnectionRef.current && candidate) {
        peerConnectionRef.current.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      }
    });

    socketRef.current.on('call-ended', ({ from }) => {
      console.log('Call ended by', from);
      endCall();
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const registerUser = () => {
    if (userId.trim()) {
      socketRef.current.emit('register', userId);
      setIsRegistered(true);
      setCallStatus('Registered. Ready to call.');
    }
  };

  const createPeerConnection = () => {
    console.log('Creating peer connection with ICE servers:', iceServers);
    const pc = new RTCPeerConnection(iceServers);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to', targetUserId);
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: targetUserId
        });
      } else {
        console.log('ICE gathering complete');
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind, event.track.label);
      if (event.streams && event.streams[0]) {
        const remoteStream = event.streams[0];
        console.log('Remote stream tracks:', remoteStream.getTracks());
        
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch(err => {
            console.log('Audio play error:', err);
            // Try to play again after a short delay
            setTimeout(() => {
              remoteAudioRef.current.play().catch(e => console.log('Retry play failed:', e));
            }, 100);
          });
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state changed:', pc.connectionState);
      setConnectionState(pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        setCallStatus('Call connected - Audio should be working now!');
      } else if (pc.connectionState === 'disconnected' || 
                 pc.connectionState === 'failed') {
        setCallStatus('Connection lost');
        endCall();
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setCallStatus('ICE connection established - Audio should work!');
      }
    };

    pc.ondatachannel = (event) => {
      console.log('Data channel received');
    };

    return pc;
  };

  const startCall = async () => {
    if (!targetUserId.trim()) {
      alert('Please enter target user ID');
      return;
    }

    try {
      setCallStatus('Getting microphone access...');
      
      // Request audio with enhanced constraints
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 1
        }, 
        video: false 
      });
      
      console.log('Got local stream with tracks:', stream.getTracks().map(t => ({
        kind: t.kind,
        enabled: t.enabled,
        muted: t.muted,
        label: t.label
      })));
      
      localStreamRef.current = stream;
      isInitiatorRef.current = true;
      
      // Set local audio for debugging (muted to prevent echo)
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
        localAudioRef.current.muted = true;
      }
      
      setIsInCall(true);
      setCallStatus('Creating peer connection...');

      // Create peer connection
      peerConnectionRef.current = createPeerConnection();

      // Add audio tracks to peer connection
      const audioTracks = stream.getAudioTracks();
      console.log('Adding audio tracks to peer connection:', audioTracks.length);
      
      audioTracks.forEach(track => {
        console.log('Adding audio track:', track.label, track.enabled);
        peerConnectionRef.current.addTrack(track, stream);
      });

      setCallStatus('Creating offer...');
      
      // Create offer with specific options
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        voiceActivityDetection: true
      });
      
      console.log('Created offer:', offer.type, offer.sdp.substring(0, 100) + '...');
      
      await peerConnectionRef.current.setLocalDescription(offer);
      setCallStatus('Sending offer...');

      // Send offer to target user
      socketRef.current.emit('offer', {
        offer,
        to: targetUserId
      });

      setCallStatus('Offer sent, waiting for answer...');

    } catch (err) {
      console.error('Error starting call:', err);
      setCallStatus('Error: ' + err.message);
      endCall();
    }
  };

  const handleReceiveOffer = async (offer, from) => {
    try {
      setCallStatus('Incoming call, getting microphone access...');
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 1
        }, 
        video: false 
      });
      
      console.log('Got local stream for answer with tracks:', stream.getTracks().map(t => ({
        kind: t.kind,
        enabled: t.enabled,
        muted: t.muted,
        label: t.label
      })));
      
      localStreamRef.current = stream;
      isInitiatorRef.current = false;
      
      // Set local audio for debugging (muted to prevent echo)
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
        localAudioRef.current.muted = true;
      }
      
      setIsInCall(true);
      setTargetUserId(from);
      setCallStatus('Creating peer connection...');

      // Create peer connection
      peerConnectionRef.current = createPeerConnection();

      // Add audio tracks to peer connection
      const audioTracks = stream.getAudioTracks();
      console.log('Adding audio tracks to peer connection (answer):', audioTracks.length);
      
      audioTracks.forEach(track => {
        console.log('Adding audio track (answer):', track.label, track.enabled);
        peerConnectionRef.current.addTrack(track, stream);
      });

      setCallStatus('Setting remote description...');
      console.log('Setting remote description:', offer.type);
      
      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      setCallStatus('Creating answer...');
      const answer = await peerConnectionRef.current.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        voiceActivityDetection: true
      });
      
      console.log('Created answer:', answer.type, answer.sdp.substring(0, 100) + '...');
      await peerConnectionRef.current.setLocalDescription(answer);

      setCallStatus('Sending answer...');
      socketRef.current.emit('answer', {
        answer,
        to: from
      });

      setCallStatus('Answer sent, establishing connection...');

    } catch (err) {
      console.error('Error handling offer:', err);
      setCallStatus('Error: ' + err.message);
      endCall();
    }
  };

  const endCall = () => {
    if (isInCall) {
      socketRef.current.emit('end-call', { to: targetUserId });
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    setIsInCall(false);
    setCallStatus('Call ended');
    setIsMuted(false);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">
          Voice Call App
        </h1>

        {!isRegistered ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Your User ID
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Enter your user ID"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={registerUser}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Register
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Logged in as:</p>
              <p className="text-lg font-semibold text-gray-800">{userId}</p>
            </div>

            {!isInCall ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Call User ID
                  </label>
                  <input
                    type="text"
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    placeholder="Enter user ID to call"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={startCall}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2"
                >
                  <Phone size={20} />
                  Start Call
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-gray-600">In call with:</p>
                  <p className="text-lg font-semibold text-gray-800">
                    {targetUserId}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex gap-3">
                    <button
                      onClick={toggleMute}
                      className={`flex-1 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2 ${
                        isMuted
                          ? 'bg-yellow-600 hover:bg-yellow-700'
                          : 'bg-gray-600 hover:bg-gray-700'
                      } text-white`}
                    >
                      {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                      {isMuted ? 'Unmute' : 'Mute'}
                    </button>

                    <button
                      onClick={endCall}
                      className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition flex items-center justify-center gap-2"
                    >
                      <PhoneOff size={20} />
                      End Call
                    </button>
                  </div>
                  
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm text-blue-800">
                      <div className={`w-2 h-2 rounded-full ${
                        connectionState === 'connected' ? 'bg-green-500' : 
                        connectionState === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
                      }`}></div>
                      Connection: {connectionState}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {callStatus && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">{callStatus}</p>
              </div>
            )}
          </div>
        )}

        <audio ref={remoteAudioRef} autoPlay />
        <audio ref={localAudioRef} muted />
      </div>
    </div>
  );
}