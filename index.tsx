
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Chat } from "@google/genai";

declare global {
    interface Window {
        L: any; // Leaflet library
    }
}

type ChatMessage = { role: 'user' | 'bot'; text: string; };

const App = () => {
    const [view, setView] = useState('home');
    const [isEmergency, setIsEmergency] = useState(false);
    const [location, setLocation] = useState<{latitude: number, longitude: number} | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [showFakeCall, setShowFakeCall] = useState(false);
    const [fakeCallContact, setFakeCallContact] = useState('');
    const [showContactSelector, setShowContactSelector] = useState(false);
    const [isCallActive, setIsCallActive] = useState(false);
    const [callTimer, setCallTimer] = useState(0);
    const [aiResponse, setAiResponse] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [showSharingOptions, setShowSharingOptions] = useState(false);
    const [isSharingLocation, setIsSharingLocation] = useState(false);
    const [sharingEndTime, setSharingEndTime] = useState<number | null>(null);
    const [remainingTime, setRemainingTime] = useState('');
    const [volumeUpCount, setVolumeUpCount] = useState(0);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const ai = useRef(new GoogleGenAI({ apiKey: process.env.API_KEY })).current;
    const chatRef = useRef<Chat | null>(null);
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null); // Leaflet map instance
    const markerRef = useRef<any>(null); // Leaflet marker instance
    const locationWatchIdRef = useRef<number | null>(null);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const locationSharingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isSpeakingRef = useRef(false);
    const volumeUpTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const sirenAudioRef = useRef<HTMLAudioElement | null>(null);

    const requestPermissions = useCallback(async () => {
        try {
            await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            navigator.geolocation.getCurrentPosition(
                (position: GeolocationPosition) => setLocation({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                }),
                () => setError('Location permission denied. Please enable it in your browser settings.'),
                { enableHighAccuracy: true }
            );
        } catch (err) {
            setError('Permissions for camera and microphone are required for full functionality.');
        }
    }, []);

    useEffect(() => {
        requestPermissions();
    }, [requestPermissions]);
    
    useEffect(() => {
        chatRef.current = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: "You are a calming and helpful safety assistant. Provide clear, concise, and supportive advice. If the user seems to be in immediate danger, strongly advise them to contact emergency services immediately.",
            },
        });
    }, [ai]);

    const handleStopSharing = useCallback(() => {
        setIsSharingLocation(false);
        setSharingEndTime(null);
        setRemainingTime('');
    }, []);
    
    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'video/webm' });
            mediaRecorderRef.current.ondataavailable = (event: BlobEvent) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };
            mediaRecorderRef.current.start();
            setIsRecording(true);
        } catch (err) {
            setError('Could not start recording. Permissions may be denied.');
        }
    }, []);
    
    const activateEmergencyMode = useCallback((isDiscreet: boolean = false) => {
        if (isEmergency) return;

        if (!isDiscreet) {
            if (sirenAudioRef.current) {
                sirenAudioRef.current.play().catch(e => console.error("Audio play failed", e));
            }
            if ('vibrate' in navigator) {
                navigator.vibrate([500, 200, 500, 200, 500]);
            }
        }

        navigator.geolocation.getCurrentPosition(
            (position: GeolocationPosition) => {
                setLocation({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                });
                setIsEmergency(true);
                startRecording();
            },
            () => {
                setError('Could not get location. Please ensure location services are enabled.');
            },
            { enableHighAccuracy: true }
        );
    }, [isEmergency, startRecording]);

    useEffect(() => {
        // This effect handles the map and live location updates
        if ((isEmergency || isSharingLocation) && location) {
            // Initialize map if it doesn't exist
            if (mapRef.current && !mapInstanceRef.current && window.L) {
                // Set default icon path for Leaflet
                delete window.L.Icon.Default.prototype._getIconUrl;
                window.L.Icon.Default.mergeOptions({
                  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
                  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
                });
                
                const map = window.L.map(mapRef.current).setView([location.latitude, location.longitude], 17);
                window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }).addTo(map);
                const marker = window.L.marker([location.latitude, location.longitude]).addTo(map);
                
                mapInstanceRef.current = map;
                markerRef.current = marker;
            }
            // Start watching location
            if (locationWatchIdRef.current === null) {
                locationWatchIdRef.current = navigator.geolocation.watchPosition(
                    (position: GeolocationPosition) => {
                        const newPos = {
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                        };
                        setLocation(newPos); 

                        if (mapInstanceRef.current && markerRef.current) {
                            const newLatLng = [newPos.latitude, newPos.longitude];
                            markerRef.current.setLatLng(newLatLng);
                            if (!mapInstanceRef.current.dragging?._active) {
                                mapInstanceRef.current.panTo(newLatLng);
                            }
                        }
                    },
                    (err: GeolocationPositionError) => {
                         if (isSharingLocation) {
                            setRemainingTime('Live tracking paused. Sharing last known location.');
                        } else {
                            setError('Live location tracking failed. Sharing last known location.');
                        }
                        console.error('watchPosition Error:', err);
                    },
                    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
                );
            }
        }
        // Cleanup function
        return () => {
            if (locationWatchIdRef.current !== null) {
                navigator.geolocation.clearWatch(locationWatchIdRef.current);
                locationWatchIdRef.current = null;
            }
            if (!isEmergency && !isSharingLocation && mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
                markerRef.current = null;
            }
        };
    }, [isEmergency, isSharingLocation, location]);
    
    useEffect(() => {
        if (isCallActive) {
            timerIntervalRef.current = setInterval(() => {
                setCallTimer(prev => prev + 1);
            }, 1000);
        } else {
            if(timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            setCallTimer(0);
        }
        return () => {
            if(timerIntervalRef.current) clearInterval(timerIntervalRef.current)
        };
    }, [isCallActive]);

    useEffect(() => {
        if (isSharingLocation && sharingEndTime) {
            locationSharingTimerRef.current = setInterval(() => {
                const now = Date.now();
                const remaining = sharingEndTime - now;
    
                if (remaining <= 0) {
                    handleStopSharing();
                } else {
                    const totalSeconds = Math.floor(remaining / 1000);
                    const hours = Math.floor(totalSeconds / 3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);
                    const seconds = totalSeconds % 60;
                    
                    let timeString = '';
                    if (hours > 0) {
                        timeString += `${hours}h `;
                    }
                    timeString += `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} remaining`;
                    setRemainingTime(timeString);
                }
            }, 1000);
        } else if (isSharingLocation && sharingEndTime === null) {
            setRemainingTime('Sharing indefinitely');
        }
    
        return () => {
            if (locationSharingTimerRef.current) {
                clearInterval(locationSharingTimerRef.current);
            }
        };
    }, [isSharingLocation, sharingEndTime, handleStopSharing]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (isEmergency || isCallActive || showFakeCall || showContactSelector || isSharingLocation || showSharingOptions) {
                return;
            }
    
            if (event.key === 'AudioVolumeUp') {
                event.preventDefault();
                if (event.repeat) return; // Ignore repeated events from holding the key

                // Long Press Logic
                longPressTimeoutRef.current = setTimeout(() => {
                    activateEmergencyMode(false); // Not discreet
                    setVolumeUpCount(0);
                    if (volumeUpTimeoutRef.current) clearTimeout(volumeUpTimeoutRef.current);
                }, 1000); // 1-second long press

                // 4-Quick-Press Logic
                if (volumeUpTimeoutRef.current) clearTimeout(volumeUpTimeoutRef.current);
    
                const newCount = volumeUpCount + 1;
                setVolumeUpCount(newCount);
    
                if (newCount >= 4) {
                    if(longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current); // Cancel long press
                    activateEmergencyMode(true); // Discreet
                    setVolumeUpCount(0);
                } else {
                    volumeUpTimeoutRef.current = setTimeout(() => {
                        setVolumeUpCount(0);
                    }, 1500); // 1.5-second window for multiple presses
                }
            } 
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === 'AudioVolumeUp') {
                if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                }
            }
        };
    
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
    
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            if (volumeUpTimeoutRef.current) clearTimeout(volumeUpTimeoutRef.current);
            if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
        };
    }, [volumeUpCount, isEmergency, isCallActive, showFakeCall, showContactSelector, isSharingLocation, showSharingOptions, activateEmergencyMode]);


    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
            setIsRecording(false);
            
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `emergency-recording-${new Date().toISOString()}.webm`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            recordedChunksRef.current = [];
        }
    };
    
    const handleSos = () => {
        if (window.confirm('Are you sure you want to activate emergency mode? This will start recording and track your location.')) {
            activateEmergencyMode(false);
        }
    };
    
    const handleStopEmergency = () => {
        setIsEmergency(false);
        stopRecording();
        if (sirenAudioRef.current) {
            sirenAudioRef.current.pause();
            sirenAudioRef.current.currentTime = 0;
        }
        if ('vibrate' in navigator) {
            navigator.vibrate(0);
        }
    };

    const startFakeCall = (contactName: string) => {
        setFakeCallContact(contactName);
        setShowContactSelector(false);
        setShowFakeCall(true);
    };

    const callScripts: { [key: string]: { gender: 'male' | 'female'; script: string[] } } = {
        'Mom': {
            gender: 'female',
            script: [
                "Hey sweetie, are you on your way?",
                "I was just about to put dinner in the oven.",
                "Just wanted to check in. Let me know when you're close!",
                "Okay, drive safe! See you soon."
            ]
        },
        'Dad': {
            gender: 'male',
            script: [
                "Hi champ, just checking in.",
                "Did you remember to pick up the milk on your way home?",
                "We're all out.",
                "Alright, talk to you in a bit."
            ]
        },
        'Best Friend': {
            gender: 'female',
            script: [
                "OMG, you will not BELIEVE what just happened.",
                "Are you free to talk right now?",
                "I have to tell you everything, it's wild.",
                "Okay call me back as SOON as you can."
            ]
        },
        'Boyfriend': {
            gender: 'male',
            script: [
                "Hey babe, was just thinking about you.",
                "Are we still on for tonight?",
                "I was thinking we could grab that pizza you like.",
                "Can't wait to see you."
            ]
        },
        'Girlfriend': {
            gender: 'female',
            script: [
                "Hey, just calling to hear your voice.",
                "I miss you! What are you up to right now?",
                "Hope you're having a good day.",
                "Talk to you later, okay?"
            ]
        },
        'Unknown Number': {
            gender: 'male',
            script: [
                "We've been trying to reach you concerning your vehicle's extended warranty.",
                "This is your final notice.",
                "Please stay on the line to speak with a representative about your options.",
                "..."
            ]
        },
    };

    const speakInSequence = (lines: string[], voice: SpeechSynthesisVoice | null) => {
        if (!isSpeakingRef.current || lines.length === 0) {
            isSpeakingRef.current = false;
            return;
        }

        const utterance = new SpeechSynthesisUtterance(lines[0]);
        if (voice) {
            utterance.voice = voice;
        }
        
        utterance.onend = () => {
            setTimeout(() => {
                speakInSequence(lines.slice(1), voice);
            }, 1500); // 1.5 second pause for realism
        };
        
        utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
             // "interrupted" is a common event when speech is cancelled manually (e.g., hanging up).
             // We don't need to treat it as a critical error.
             if (e.error !== 'interrupted') {
                console.error("Speech synthesis error:", e.error);
             }
             isSpeakingRef.current = false;
        };

        window.speechSynthesis.speak(utterance);
    };

    const getVoicesPromise = (): Promise<SpeechSynthesisVoice[]> => {
        return new Promise(resolve => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length) {
                resolve(voices);
                return;
            }
            window.speechSynthesis.onvoiceschanged = () => {
                resolve(window.speechSynthesis.getVoices());
            };
        });
    };

    const handleAcceptCall = async () => {
        setShowFakeCall(false);
        setIsCallActive(true);
    
        const contactInfo = callScripts[fakeCallContact];
        if (!contactInfo) return;
    
        const { gender, script } = contactInfo;
        
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
    
            const voices = await getVoicesPromise();
            let selectedVoice: SpeechSynthesisVoice | null = null;
    
            const voiceFilter = (v: SpeechSynthesisVoice) => {
                const name = v.name.toLowerCase();
                const targetGender = gender === 'female' ? 'female' : 'male';
                return v.lang.startsWith('en') && ((v as any).gender === targetGender || name.includes(targetGender));
            }
            
            const preferredVoices = voices.filter(voiceFilter);
            selectedVoice = preferredVoices.find(v => v.name.includes('Google')) || preferredVoices[0] || null;
    
            if (!selectedVoice) {
                selectedVoice = voices.find(v => v.lang.startsWith('en')) || null;
            }
    
            isSpeakingRef.current = true;
            speakInSequence(script, selectedVoice);
        }
    };

    const handleHangUp = () => {
        setIsCallActive(false);
        if ('speechSynthesis' in window) {
            isSpeakingRef.current = false;
            window.speechSynthesis.cancel();
        }
    };

    const handleStartSharing = (durationInMinutes: number | null) => {
        if (!location) {
             setError('Location not available. Please enable location services and try again.');
             return;
        }
        
        setShowSharingOptions(false);
        setIsSharingLocation(true);
    
        if (durationInMinutes) {
            const endTime = Date.now() + durationInMinutes * 60 * 1000;
            setSharingEndTime(endTime);
        } else {
            setSharingEndTime(null);
            setRemainingTime('Sharing indefinitely');
        }
    };

    const fetchAiHelp = async (prompt: string) => {
        setView('tools');
        setIsLoading(true);
        setAiResponse('');
        try {
            const result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { tools: [{googleSearch: {}}] }
            });
            let finalResponse = result.text;
            const groundingChunks = result.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (groundingChunks && groundingChunks.length > 0) {
                const sources = groundingChunks
                    .map(chunk => chunk.web && chunk.web.uri ? `<div><a href="${chunk.web.uri}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue);">${chunk.web.title || chunk.web.uri}</a></div>` : null)
                    .filter(Boolean)
                    .join('');
                if (sources) {
                    finalResponse += '<br /><br /><strong>Sources:</strong><br />' + sources;
                }
            }
            setAiResponse(finalResponse);
        } catch (err) {
            console.error(err);
            setAiResponse('Sorry, I had trouble finding information. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleChatSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!chatInput.trim() || isLoading || !chatRef.current) return;

        const userMessage: ChatMessage = { role: 'user', text: chatInput };
        setChatHistory(prev => [...prev, userMessage]);
        setIsLoading(true);
        const currentInput = chatInput;
        setChatInput('');

        try {
            const response = await chatRef.current.sendMessage({ message: currentInput });
            const botMessage: ChatMessage = { role: 'bot', text: response.text };
            setChatHistory(prev => [...prev, botMessage]);
        } catch (err) {
            console.error("Chat Error:", err);
            const errorMessage: ChatMessage = { role: 'bot', text: 'Sorry, I am having trouble connecting. Please try again.' };
            setChatHistory(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const renderHome = () => (
        <div style={styles.content}>
            <h1 style={styles.title}>Guardian Angel</h1>
            <p style={styles.subtitle}>Your Personal Safety Companion</p>
            {error && <p style={styles.error}>{error}</p>}

            {isEmergency ? (
                <div style={styles.emergencyContainer}>
                    <h2 style={styles.emergencyHeader}>EMERGENCY MODE ACTIVE</h2>
                    <div style={styles.videoContainer}>
                        {isRecording && <video ref={videoRef} autoPlay muted playsInline style={styles.videoPreview}></video>}
                        <div style={styles.recordingIndicator}>
                            <i className="fas fa-circle" style={{ color: 'red', animation: 'pulse 1.5s infinite' }}></i> REC
                        </div>
                    </div>
                    <div ref={mapRef} style={styles.mapContainer}></div>
                    {location && (
                        <div style={styles.locationInfo}>
                            <p>Live Location:</p>
                            <p>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</p>
                            <button
                                style={styles.shareButton}
                                onClick={() => {
                                    const message = `Emergency! My location is https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
                                    if(navigator.share) {
                                        navigator.share({ title: 'Emergency Location', text: message });
                                    } else {
                                        navigator.clipboard.writeText(message);
                                        alert('Emergency message copied to clipboard!');
                                    }
                                }}
                            >
                                <i className="fas fa-share-alt"></i> Share Location
                            </button>
                        </div>
                    )}
                    <button style={styles.stopButton} onClick={handleStopEmergency}>
                        <i className="fas fa-hand-paper"></i> Stop Emergency
                    </button>
                    <p style={styles.recordingNotice}>Audio & Video are being recorded. The recording will be downloaded when you stop the emergency.</p>
                </div>
            ) : (
                <button style={styles.sosButton} onClick={handleSos} aria-label="Activate Emergency SOS">
                    <div style={styles.sosText}>SOS</div>
                </button>
            )}
        </div>
    );

    const renderTools = () => {
        const isLocationReady = !!(location?.latitude && location?.longitude);

        return (
            <div style={styles.content}>
                <h2 style={styles.pageTitle}>Safety Tools</h2>
                <div style={styles.toolGrid}>
                    <button
                        style={isLocationReady ? styles.toolButton : { ...styles.toolButton, ...styles.disabledButton }}
                        onClick={() => {
                            if (isLocationReady) {
                                fetchAiHelp(`Find the nearest police stations, government help offices, and public transport options near latitude ${location.latitude} and longitude ${location.longitude}`);
                            }
                        }}
                        disabled={!isLocationReady}
                        title={isLocationReady ? "Find help nearby" : "Location not yet available. Please wait."}
                    >
                        <i className="fas fa-building-shield" style={styles.toolIcon}></i>
                        <span>Find Help Nearby</span>
                    </button>
                     <button style={styles.toolButton} onClick={() => fetchAiHelp('Give me simple text-based self-defense tutorials.')}>
                        <i className="fas fa-user-shield" style={styles.toolIcon}></i>
                        <span>Self-Defense Tutorials</span>
                    </button>
                    <button style={styles.toolButton} onClick={() => setShowContactSelector(true)}>
                        <i className="fas fa-phone-alt" style={styles.toolIcon}></i>
                        <span>Fake Call</span>
                    </button>
                    <button
                        style={isLocationReady ? styles.toolButton : { ...styles.toolButton, ...styles.disabledButton }}
                        onClick={() => isLocationReady && setShowSharingOptions(true)}
                        disabled={!isLocationReady}
                        title={isLocationReady ? "Share your live location" : "Location not yet available. Please wait."}
                    >
                        <i className="fas fa-map-marker-alt" style={styles.toolIcon}></i>
                        <span>Share Location</span>
                    </button>
                </div>
                {isLoading && <div style={styles.loader}><i className="fas fa-spinner fa-spin"></i> Loading...</div>}
                {aiResponse && (
                    <div style={styles.aiResponse} dangerouslySetInnerHTML={{ __html: aiResponse.replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}>
                    </div>
                )}
            </div>
        );
    };

    const renderChat = () => (
         <div style={{ ...styles.content, ...styles.chatContainer }}>
            <h2 style={styles.pageTitle}>AI Safety Chat</h2>
            <div style={styles.chatWindow}>
                {chatHistory.map((msg, index) => (
                    <div key={index} style={msg.role === 'user' ? styles.userMessage : styles.botMessage}>
                        {msg.text}
                    </div>
                ))}
                {isLoading && chatHistory.length > 0 && (
                    <div style={styles.botMessage}>
                       <i className="fas fa-spinner fa-spin"></i>
                    </div>
                )}
            </div>
            <form onSubmit={handleChatSubmit} style={styles.chatInputForm}>
                <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask for advice..."
                    style={styles.chatInput}
                    disabled={isLoading}
                />
                <button type="submit" style={styles.sendButton} disabled={isLoading}>
                    <i className="fas fa-paper-plane"></i>
                </button>
            </form>
        </div>
    );
    
    const renderFakeCallSelector = () => (
        <div style={styles.modalOverlay}>
            <div style={styles.modalContent}>
                <h3 style={styles.modalTitle}>Choose a Caller</h3>
                <div style={styles.contactGrid}>
                    <button style={styles.contactButton} onClick={() => startFakeCall('Mom')}>Mom</button>
                    <button style={styles.contactButton} onClick={() => startFakeCall('Dad')}>Dad</button>
                    <button style={styles.contactButton} onClick={() => startFakeCall('Best Friend')}>Best Friend</button>
                    <button style={styles.contactButton} onClick={() => startFakeCall('Boyfriend')}>Boyfriend</button>
                    <button style={styles.contactButton} onClick={() => startFakeCall('Girlfriend')}>Girlfriend</button>
                    <button style={styles.contactButton} onClick={() => startFakeCall('Unknown Number')}>Unknown Number</button>
                </div>
                <button style={styles.modalCloseButton} onClick={() => setShowContactSelector(false)}>Cancel</button>
            </div>
        </div>
    );

    const renderFakeCall = () => (
        <div style={styles.fakeCallScreen}>
            <div style={styles.callerInfo}>
                <div style={styles.callerAvatar}><i className="fas fa-user"></i></div>
                <h3 style={styles.callerName}>{fakeCallContact}</h3>
                <p style={styles.callStatus}>incoming call...</p>
            </div>
             <audio src="https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg" autoPlay loop></audio>
            <div style={styles.callActions}>
                <button style={{...styles.callButton, ...styles.declineCall}} onClick={() => setShowFakeCall(false)} aria-label="Decline Call">
                    <i className="fas fa-phone-slash"></i>
                </button>
                <button style={{...styles.callButton, ...styles.acceptCall}} onClick={handleAcceptCall} aria-label="Accept Call">
                   <i className="fas fa-phone"></i>
                </button>
            </div>
        </div>
    );

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };

    const renderActiveCall = () => (
        <div style={styles.fakeCallScreen}>
            <div style={{...styles.callerInfo, marginTop: '40px'}}>
                <h3 style={styles.callerName}>{fakeCallContact}</h3>
                <p style={styles.callStatus}>{formatTime(callTimer)}</p>
            </div>
            
            <div style={styles.activeCallIcons}>
                <div style={styles.activeCallIcon}><i className="fas fa-microphone-slash"></i><span>Mute</span></div>
                <div style={styles.activeCallIcon}><i className="fas fa-th"></i><span>Keypad</span></div>
                <div style={styles.activeCallIcon}><i className="fas fa-volume-up"></i><span>Speaker</span></div>
                <div style={styles.activeCallIcon}><i className="fas fa-user-plus"></i><span>Add Call</span></div>
                <div style={styles.activeCallIcon}><i className="fas fa-video"></i><span>FaceTime</span></div>
                <div style={styles.activeCallIcon}><i className="fas fa-address-book"></i><span>Contacts</span></div>
            </div>

            <div style={{...styles.callActions, justifyContent: 'center' }}>
                <button style={{...styles.callButton, ...styles.declineCall}} onClick={handleHangUp} aria-label="Hang Up">
                    <i className="fas fa-phone-slash"></i>
                </button>
            </div>
        </div>
    );

    const renderShareOptions = () => (
        <div style={styles.modalOverlay}>
            <div style={styles.modalContent}>
                <h3 style={styles.modalTitle}>Share Live Location</h3>
                <p style={styles.modalDescription}>Choose how long you want to share your location for.</p>
                <div style={styles.shareOptionsGrid}>
                    <button style={styles.shareOptionButton} onClick={() => handleStartSharing(15)}>15 Minutes</button>
                    <button style={styles.shareOptionButton} onClick={() => handleStartSharing(30)}>30 Minutes</button>
                    <button style={styles.shareOptionButton} onClick={() => handleStartSharing(60)}>1 Hour</button>
                    <button style={styles.shareOptionButton} onClick={() => handleStartSharing(null)}>Indefinitely</button>
                </div>
                <button style={styles.modalCloseButton} onClick={() => setShowSharingOptions(false)}>Cancel</button>
            </div>
        </div>
    );

    const renderLocationSharing = () => (
        <div style={styles.content}>
            <div style={styles.sharingContainer}>
                <h2 style={styles.sharingHeader}>SHARING LOCATION</h2>
                <p style={styles.sharingStatus}>{remainingTime}</p>
                <div ref={mapRef} style={styles.mapContainer}></div>
                {location && (
                    <div style={styles.sharingActions}>
                        <button
                            style={styles.shareButton}
                            onClick={() => {
                                const message = `I'm sharing my live location with you. See where I am here: https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
                                if(navigator.share) {
                                    navigator.share({ title: 'My Live Location', text: message });
                                } else {
                                    navigator.clipboard.writeText(message);
                                    alert('Location sharing link copied to clipboard!');
                                }
                            }}
                        >
                            <i className="fas fa-share-alt"></i> Share Link
                        </button>
                        <button style={{...styles.stopButton, marginLeft: '15px'}} onClick={handleStopSharing}>
                            <i className="fas fa-stop-circle"></i> Stop Sharing
                        </button>
                    </div>
                )}
                <p style={styles.recordingNotice}>Your location is being shared. You can stop at any time.</p>
            </div>
        </div>
    );
    
    return (
        <div style={styles.appContainer}>
            <audio ref={sirenAudioRef} src="https://actions.google.com/sounds/v1/alarms/police_siren_close.ogg" loop />
            <main style={styles.mainContent}>
                {isCallActive ? renderActiveCall() :
                 showFakeCall ? renderFakeCall() : 
                 showContactSelector ? renderFakeCallSelector() :
                 isSharingLocation ? renderLocationSharing() :
                 showSharingOptions ? renderShareOptions() : (
                    <>
                        {view === 'home' && renderHome()}
                        {view === 'tools' && renderTools()}
                        {view === 'chat' && renderChat()}
                    </>
                )}
            </main>
            
            {!isCallActive && !showFakeCall && !showContactSelector && !isSharingLocation && !showSharingOptions && (
                <nav style={styles.nav}>
                    <button style={view === 'home' ? styles.navButtonActive : styles.navButton} onClick={() => setView('home')}>
                        <i className="fas fa-home"></i>
                        <span>Home</span>
                    </button>
                    <button style={view === 'tools' ? styles.navButtonActive : styles.navButton} onClick={() => { setView('tools'); setAiResponse(''); }}>
                        <i className="fas fa-toolbox"></i>
                        <span>Tools</span>
                    </button>
                    <button style={view === 'chat' ? styles.navButtonActive : styles.navButton} onClick={() => setView('chat')}>
                        <i className="fas fa-comments"></i>
                        <span>AI Chat</span>
                    </button>
                </nav>
            )}
        </div>
    );
};

const styles: { [key: string]: React.CSSProperties } = {
    appContainer: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--primary-bg)',
    },
    mainContent: {
        flex: 1,
        overflowY: 'auto',
        position: 'relative',
    },
    content: {
        padding: '20px',
        paddingBottom: '80px', // Extra space for nav bar
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
    },
    title: { fontSize: '2.5rem', marginBottom: '10px' },
    subtitle: { fontSize: '1rem', color: 'var(--secondary-text)', marginBottom: '40px' },
    pageTitle: { fontSize: '1.8rem', marginBottom: '20px', width: '100%' },
    error: { color: 'var(--danger-red)', backgroundColor: '#ff000020', padding: '10px', borderRadius: '8px', marginBottom: '15px' },
    sosButton: {
        width: '180px',
        height: '180px',
        borderRadius: '50%',
        backgroundColor: 'var(--danger-red)',
        border: '8px solid #ff000050',
        color: 'white',
        fontSize: '3.5rem',
        fontWeight: 'bold',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        boxShadow: '0 0 25px var(--danger-red)',
        transition: 'all 0.3s ease',
        animation: 'pulse 2s infinite',
    },
    sosText: { animation: 'shake 5s infinite ease-in-out', animationDelay: '2s' },
    emergencyContainer: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' },
    emergencyHeader: { color: 'var(--danger-red)', animation: 'pulse 1s infinite' },
    videoContainer: { position: 'relative', width: '100%', maxWidth: '300px', margin: '15px 0', borderRadius: '8px', overflow: 'hidden' },
    videoPreview: { width: '100%', height: 'auto', transform: 'scaleX(-1)' },
    recordingIndicator: { position: 'absolute', top: '10px', left: '10px', backgroundColor: 'rgba(0,0,0,0.6)', color: 'white', padding: '5px 10px', borderRadius: '5px', fontSize: '0.9rem', zIndex: 10 },
    mapContainer: {
        height: '200px',
        width: '100%',
        maxWidth: '400px',
        margin: '10px 0',
        borderRadius: '8px',
        border: '1px solid var(--tertiary-bg)'
    },
    locationInfo: { margin: '10px 0', fontSize: '1rem' },
    shareButton: { backgroundColor: 'var(--accent-blue)', color: 'white', border: 'none', padding: '12px 20px', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', marginTop: '10px' },
    stopButton: { backgroundColor: 'var(--accent-blue)', color: 'white', border: 'none', padding: '15px 30px', borderRadius: '8px', cursor: 'pointer', fontSize: '1.2rem', marginTop: '20px' },
    recordingNotice: { fontSize: '0.8rem', color: 'var(--secondary-text)', marginTop: '15px' },
    toolGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', width: '100%', marginBottom: '20px' },
    toolButton: { backgroundColor: 'var(--tertiary-bg)', color: 'var(--primary-text)', border: 'none', padding: '20px', borderRadius: '12px', cursor: 'pointer', fontSize: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' },
    disabledButton: {
        opacity: 0.6,
        cursor: 'not-allowed',
    },
    toolIcon: { fontSize: '2rem', color: 'var(--accent-blue)' },
    loader: { margin: '20px 0', fontSize: '1.2rem' },
    aiResponse: { backgroundColor: 'var(--tertiary-bg)', padding: '15px', borderRadius: '8px', textAlign: 'left', width: '100%', overflowWrap: 'break-word', whiteSpace: 'pre-wrap', color: 'var(--secondary-text)' },
    chatContainer: { paddingBottom: '70px', justifyContent: 'flex-end', },
    chatWindow: { width: '100%', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 0' },
    userMessage: { alignSelf: 'flex-end', backgroundColor: 'var(--accent-blue)', color: 'white', padding: '10px 15px', borderRadius: '15px 15px 0 15px', maxWidth: '80%' },
    botMessage: { alignSelf: 'flex-start', backgroundColor: 'var(--tertiary-bg)', padding: '10px 15px', borderRadius: '15px 15px 15px 0', maxWidth: '80%' },
    chatInputForm: { display: 'flex', width: '100%', padding: '10px 20px', position: 'absolute', bottom: '60px', left: '0', backgroundColor: 'var(--secondary-bg)' },
    chatInput: { flex: 1, backgroundColor: 'var(--tertiary-bg)', border: 'none', color: 'var(--primary-text)', padding: '12px', borderRadius: '20px 0 0 20px', fontSize: '1rem' },
    sendButton: { backgroundColor: 'var(--tertiary-bg)', border: 'none', color: 'var(--accent-blue)', padding: '12px 15px', borderRadius: '0 20px 20px 0', cursor: 'pointer', fontSize: '1.2rem' },
    // Fake Call Styles
    fakeCallScreen: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: '#000', zIndex: 100, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center', color: 'white' },
    callerInfo: { textAlign: 'center' },
    callerAvatar: { fontSize: '5rem', backgroundColor: '#555', width: '120px', height: '120px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '0 auto 20px auto' },
    callerName: { fontSize: '2rem', fontWeight: 'bold' },
    callStatus: { fontSize: '1.2rem', color: '#aaa', animation: 'pulse 1.5s infinite' },
    callActions: { display: 'flex', justifyContent: 'space-around', width: '100%', maxWidth: '300px' },
    callButton: { border: 'none', borderRadius: '50%', width: '70px', height: '70px', fontSize: '2rem', color: 'white', cursor: 'pointer' },
    declineCall: { backgroundColor: '#ff3b30' },
    acceptCall: { backgroundColor: '#34c759' },
    activeCallIcons: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '30px 20px',
        width: '100%',
        maxWidth: '280px',
        color: '#a0a0a0',
        cursor: 'pointer'
    },
    activeCallIcon: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        fontSize: '0.8rem',
    },
    // Contact Selector Modal & Location Share Modal
    modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 99,
    },
    modalContent: {
        backgroundColor: 'var(--secondary-bg)',
        padding: '25px',
        borderRadius: '12px',
        width: '90%',
        maxWidth: '350px',
        textAlign: 'center',
        boxShadow: '0 5px 15px rgba(0,0,0,0.5)',
    },
    modalTitle: {
        marginBottom: '20px',
        fontSize: '1.5rem',
        color: 'var(--primary-text)',
    },
    modalDescription: {
        color: 'var(--secondary-text)',
        marginBottom: '20px',
        fontSize: '1rem',
    },
    shareOptionsGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '15px',
    },
    shareOptionButton: {
        backgroundColor: 'var(--tertiary-bg)',
        color: 'var(--primary-text)',
        border: '1px solid #444',
        padding: '20px',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '1rem',
        transition: 'background-color 0.2s',
    },
    contactGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '15px',
    },
    contactButton: {
        backgroundColor: 'var(--tertiary-bg)',
        color: 'var(--primary-text)',
        border: '1px solid #444',
        padding: '15px',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '1rem',
        transition: 'background-color 0.2s',
    },
    modalCloseButton: {
        marginTop: '25px',
        backgroundColor: 'var(--danger-red)',
        color: 'white',
        border: 'none',
        padding: '12px 25px',
        borderRadius: '8px',
        cursor: 'pointer',
        width: '100%',
        fontSize: '1rem',
    },
    // Location Sharing Screen
    sharingContainer: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' },
    sharingHeader: { color: 'var(--accent-blue)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '5px'},
    sharingStatus: { color: 'var(--secondary-text)', marginBottom: '15px', fontSize: '1.1rem', minHeight: '20px'},
    sharingActions: {
        display: 'flex',
        justifyContent: 'center',
        marginTop: '20px',
    },
    // Navigation
    nav: {
        display: 'flex',
        justifyContent: 'space-around',
        backgroundColor: 'var(--tertiary-bg)',
        padding: '10px 0',
        borderTop: '1px solid #333',
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '480px',
        zIndex: 50,
    },
    navButton: {
        background: 'none',
        border: 'none',
        color: 'var(--secondary-text)',
        cursor: 'pointer',
        fontSize: '0.8rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
    },
    navButtonActive: {
        background: 'none',
        border: 'none',
        color: 'var(--accent-blue)',
        cursor: 'pointer',
        fontSize: '0.8rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
    },
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);