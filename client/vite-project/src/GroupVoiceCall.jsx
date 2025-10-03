import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Users, UserPlus } from 'lucide-react';
import io from 'socket.io-client';

const SOCKET_URL = '';

// ICE servers for better connectivity
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

export default function GroupVoiceCall() {
  const [userId, setUserId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [isInRoom, setIsInRoom] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [callStatus, setCallStatus] = useState('');
  const [participants, setParticipants] = useState([]);
  
  const socketRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // userId -> peerConnection
  const localStreamRef = useRef(null);
  const remoteAudioRefs = useRef(new Map()); // userId -> audio element
  const audioContainerRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);

    socketRef.current.on('connect', () => {
      console.log('Connected to signaling server');
    });

    // Room events
    socketRef.current.on('room-joined', (roomData) => {
      console.log('Joined room:', roomData);
      setIsInRoom(true);
      setParticipants(roomData.participants || []);
      setCallStatus(`Joined room ${roomData.roomId} with ${roomData.participants.length} participants`);
    });

    socketRef.current.on('user-joined', (userData) => {
      console.log('User joined:', userData);
      setParticipants(prev => [...prev, userData]);
      setCallStatus(`${userData.userId} joined the room`);
    });

    socketRef.current.on('user-left', (userData) => {
      console.log('User left:', userData);
      setParticipants(prev => prev.filter(p => p.userId !== userData.userId));
      setCallStatus(`${userData.userId} left the room`);
      
      // Clean up peer connection
      if (peerConnectionsRef.current.has(userData.userId)) {
        peerConnectionsRef.current.get(userData.userId).close();
        peerConnectionsRef.current.delete(userData.userId);
      }
    });

    // WebRTC signaling events
    socketRef.current.on('offer', async ({ offer, from }) => {
      console.log('Received offer from', from);
      await handleReceiveOffer(offer, from);
    });

    socketRef.current.on('answer', async ({ answer, from }) => {
      console.log('Received answer from', from);
      if (peerConnectionsRef.current.has(from)) {
        await peerConnectionsRef.current.get(from).setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      }
    });

    socketRef.current.on('ice-candidate', ({ candidate, from }) => {
      console.log('Received ICE candidate from', from);
      if (peerConnectionsRef.current.has(from) && candidate) {
        peerConnectionsRef.current.get(from).addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      // Close all peer connections
      peerConnectionsRef.current.forEach(pc => pc.close());
    };
  }, []);

  const registerUser = () => {
    if (userId.trim()) {
      socketRef.current.emit('register', userId);
      setIsRegistered(true);
      setCallStatus('Registered. Ready to join room.');
    }
  };

  const createPeerConnection = (targetUserId) => {
    console.log('Creating peer connection for', targetUserId);
    const pc = new RTCPeerConnection(iceServers);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to', targetUserId);
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: targetUserId
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track from', targetUserId);
      if (event.streams && event.streams[0]) {
        const remoteStream = event.streams[0];
        
        // Create audio element for this user
        const audioElement = document.createElement('audio');
        audioElement.srcObject = remoteStream;
        audioElement.autoplay = true;
        audioElement.controls = false;
        audioElement.style.display = 'none';
        
        // Store reference
        remoteAudioRefs.current.set(targetUserId, audioElement);
        
        // Add to container
        if (audioContainerRef.current) {
          audioContainerRef.current.appendChild(audioElement);
        }
        
        audioElement.play().catch(err => console.log('Audio play error:', err));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${targetUserId}:`, pc.connectionState);
      if (pc.connectionState === 'connected') {
        setCallStatus(`Connected to ${targetUserId}`);
      } else if (pc.connectionState === 'disconnected' || 
                 pc.connectionState === 'failed') {
        setCallStatus(`Connection lost with ${targetUserId}`);
      }
    };

    return pc;
  };

  const joinRoom = async () => {
    if (!roomId.trim()) {
      alert('Please enter room ID');
      return;
    }

    try {
      setCallStatus('Getting microphone access...');
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }, 
        video: false 
      });
      
      console.log('Got local stream');
      localStreamRef.current = stream;
      
      // Join room
      socketRef.current.emit('join-room', roomId);
      
    } catch (err) {
      console.error('Error joining room:', err);
      setCallStatus('Error: ' + err.message);
    }
  };

  const startCallWithUser = async (targetUserId) => {
    if (!localStreamRef.current) {
      console.error('No local stream available');
      return;
    }

    try {
      console.log('Starting call with', targetUserId);
      
      const pc = createPeerConnection(targetUserId);
      peerConnectionsRef.current.set(targetUserId, pc);

      // Add local stream tracks
      localStreamRef.current.getAudioTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current.emit('offer', {
        offer,
        to: targetUserId
      });

      console.log('Offer sent to', targetUserId);

    } catch (err) {
      console.error('Error starting call with', targetUserId, err);
    }
  };

  const handleReceiveOffer = async (offer, from) => {
    if (!localStreamRef.current) {
      console.error('No local stream available for answer');
      return;
    }

    try {
      console.log('Handling offer from', from);
      
      const pc = createPeerConnection(from);
      peerConnectionsRef.current.set(from, pc);

      // Add local stream tracks
      localStreamRef.current.getAudioTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current.emit('answer', {
        answer,
        to: from
      });

      console.log('Answer sent to', from);

    } catch (err) {
      console.error('Error handling offer from', from, err);
    }
  };

  const leaveRoom = () => {
    if (isInRoom) {
      socketRef.current.emit('leave-room', { roomId });
    }

    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Remove all remote audio elements
    remoteAudioRefs.current.forEach(audio => audio.remove());
    remoteAudioRefs.current.clear();

    setIsInRoom(false);
    setParticipants([]);
    setCallStatus('Left room');
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
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">
          Group Voice Call
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
        ) : !isInRoom ? (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Logged in as:</p>
              <p className="text-lg font-semibold text-gray-800">{userId}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Room ID
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter room ID to join"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={joinRoom}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2"
            >
              <UserPlus size={20} />
              Join Room
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-gray-600">Room ID:</p>
              <p className="text-lg font-semibold text-gray-800">{roomId}</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users size={20} className="text-blue-600" />
                <span className="font-semibold text-blue-800">Participants ({participants.length})</span>
              </div>
              <div className="space-y-2">
                {participants.map((participant, index) => (
                  <div key={index} className="flex items-center justify-between bg-white p-2 rounded">
                    <span className="text-sm">{participant.userId}</span>
                    <button
                      onClick={() => startCallWithUser(participant.userId)}
                      className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
                    >
                      Call
                    </button>
                  </div>
                ))}
              </div>
            </div>

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
                onClick={leaveRoom}
                className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition flex items-center justify-center gap-2"
              >
                <PhoneOff size={20} />
                Leave Room
              </button>
            </div>

            {callStatus && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">{callStatus}</p>
              </div>
            )}
          </div>
        )}

        {/* Hidden audio container for remote streams */}
        <div ref={audioContainerRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
