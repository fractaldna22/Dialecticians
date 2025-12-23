/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// KeynoteCompanion.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    GoogleGenAI,
    LiveConnectConfig,
    Modality,
    MediaResolution,
    Part,
    HarmCategory,
    HarmBlockThreshold,
    Type,
    TurnCoverage,
    ActivityEnd,
    ActivityStart,
    ActivityHandling,
    RealtimeInputConfig
} from '@google/genai';

import BasicFace from '../basic-face/BasicFace';
import { useAgent, useUI, useUser } from '../../../lib/state';
import { AudioStreamer } from '../../../lib/audio-streamer';
import { AudioRecorder } from '../../../lib/audio-recorder';
import {
    audioContext,
    encode,
    decode,
    float32ToInt16,
    resampleTo16k,
    parseRateFromMime,
    pcm16LEBytesToInt16,
    int16ToPCM16LEBytes,
    calculatePCM16RMS,
    concatUint8,
    processAudioToStandardFloat16kMono,
    resamplePCM16Mono
} from '../../../lib/utils';
import { Agent, USER_AGENT_ID } from '../../../lib/presets/agents';
import { GenAILiveClient } from '../../../lib/genai-live-client';
let seed = Math.floor(Math.random() * 99999)
// ==========================================
// 1. UTILITIES
// ==========================================
let turnstep = 0;

function decodeBase64ToUint8Array(b64: string): Uint8Array {
    return decode(b64);
}

async function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
}

export function toFullWidth(str) {
    return str.replace(/[!-~]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0xFEE0));
}

// ==========================================
// 2. AUDIO CONTEXT SINGLETON
// ==========================================
const API_KEY = process.env.API_KEY as string;

const AudioContextManager = {
    contextPromise: null as Promise<AudioContext> | null,
    get: () => {
        if (!AudioContextManager.contextPromise) {
            AudioContextManager.contextPromise = audioContext({
                id: 'shared-comrades-context',
                latencyHint: 'interactive',
            }).then((ctx) => {
                if (ctx.state === 'suspended') ctx.resume();
                return ctx;
            });
        }
        return AudioContextManager.contextPromise;
    },
};

// ==========================================
// 3. VISUALS
// ==========================================
const AgentFaceWrapper: React.FC<{ agent: Agent; volume: number; isSpeaking: boolean }> = ({
    agent,
    volume,
    isSpeaking,
}) => {
    const [imgFailed, setImgFailed] = useState(false);
    useEffect(() => { setImgFailed(false); }, [agent.avatar]);

    const effectiveVol = Math.sqrt(volume); // Using sqrt for better low-end sensitivity
    const scale = isSpeaking ? 1.05 + effectiveVol * 0.2 : 1.0;
    const dynamicOpacity = isSpeaking ? 0.9 + effectiveVol * 0.1 : 0.6;
    const glow = isSpeaking ? `0 0 ${40 + effectiveVol * 40}px ${agent.bodyColor}` : 'none';
    const border = isSpeaking ? `4px solid ${agent.bodyColor}` : '2px solid rgba(255,255,255,0.1)';

    return (
        <div style={{
            position: 'relative', width: '240px', height: '240px', display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.05s ease-out, opacity 0.2s ease-out',
            transform: `scale(${scale})`, opacity: dynamicOpacity, zIndex: isSpeaking ? 10 : 1,
            filter: isSpeaking ? 'none' : 'grayscale(80%) brightness(0.6)',
        }}>
            <div style={{
                position: 'relative', borderRadius: '50%', boxShadow: glow,
                transition: 'box-shadow 0.05s linear', padding: '6px',
                background: isSpeaking ? 'rgba(255,255,255,0.1)' : 'transparent',
            }}>
                {agent.id === 'stalin' && agent.avatar && !imgFailed ? (
                    <div style={{
                        width: '200px',
                        height: '200px',
                        backgroundImage: `url(${agent.avatar})`,
                        backgroundSize: '400% 100%',
                        backgroundPosition: `${Math.min(3, Math.floor(effectiveVol * 4)) * 33.33}% 0%`,
                        backgroundRepeat: 'no-repeat',
                        imageRendering: 'pixelated',
                        borderRadius: '10px'
                    }} />
                ) : agent.avatar && !imgFailed ? (
                    <img src={agent.avatar} alt={agent.name} onError={() => setImgFailed(true)}
                        style={{ width: '200px', height: '200px', objectFit: 'contain', imageRendering: 'pixelated', borderRadius: '10px' }} />
                ) : (
                    <BasicFace canvasRef={useRef(null)} color={agent.bodyColor} radius={100} volume={volume} />
                )}
            </div>
            <div style={{
                marginTop: '10px', background: isSpeaking ? agent.bodyColor : '#111', color: 'white',
                padding: '6px 12px', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold',
                fontFamily: 'monospace', textAlign: 'center', border: border, minWidth: '120px',
                boxShadow: '0 4px 10px rgba(0,0,0,0.6)', textShadow: '0 1px 3px black',
            }}>
                {agent.name}
            </div>
        </div>
    );
};

export async function analyze(setVols: any, nextAgent: any, ctx: AudioContext, streamer: AudioStreamer) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.1;
    if (streamer.gainNode) streamer.gainNode.connect(analyser);
    const volPoll = setInterval(() => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;

        // Improved normalization: Using a larger divisor for better range,
        // and a noise floor threshold to filter out silent jitter.
        const noiseFloor = 2.0;
        const normalized = Math.max(0, avg - noiseFloor) / 60;
        const norm = Math.min(1, normalized);

        setVols((prev: any) => ({ ...prev, [nextAgent.id]: norm }));
    }, 30);
    return volPoll;
}

// ==========================================
// 4. TYPES
// ==========================================
type AgentSessionState = {
    client: GenAILiveClient;
    turnCount: number;
    configSignature: string;
};

type AudioContextItem = {
    mimeType: string;
    data: string; // base64 of pcm16 bytes
};

// ==========================================
// 5. MAIN COMPONENT
// ==========================================
export default function KeynoteCompanion() {
    const { activeAgents } = useAgent();
    const {
        isDebating, transcript, addToTranscript, debateTopic, setDebateTopic,
        isChaosMode, userMessage, setUserMessage, systemPrompt, setSystemPrompt,
        nextSpeakerId, setNextSpeakerId, suggestedNextSpeakers, setSuggestedNextSpeakers,
        forceEndTurn, setForceEndTurn, debateSummary, setDebateSummary, allowSelfReply,
        conversationResetId, audioHistory, addAudioToHistory, isUserParticipating,
        setUserParticipating, isWaitingForUser, setIsWaitingForUser, clearAudioHistory,
        disableAudioAccumulation, setDisableAudioAccumulation, triggerUserInteraction,
        prevTopic, setPrevTopic, allSummaries, addSummary, setAllSummaries,
        disableSummaries, setDisableSummaries, clearTranscript
    } = useUI();

    const { customApiKey, name: userName, temperature, topP, speechTimeLimit } = useUser();
    const effectiveApiKey = customApiKey || API_KEY;

    const agentStatesRef = useRef<Map<string, AgentSessionState>>(new Map());
    const agentStreamersRef = useRef<Map<string, AudioStreamer>>(new Map());
    const lastSpeakerIdRef = useRef<string | null>(null);

    const audioRecorderRef = useRef<AudioRecorder>(new AudioRecorder());
    const userAudioAccumulatorRef = useRef<Uint8Array[]>([]);
    const userSpeechTextRef = useRef<string>('');
    const recognitionRef = useRef<any>(null);

    const [uploadedFileContext, setUploadedFileContext] = useState<{
        name: string; mimeType: string; data: string; durationSec?: number;
    } | null>(null);
    const prevApiKeyRef = useRef<string | null>(null);
    const isGeneratingSummaryRef = useRef(false);
    const lastSummaryLengthRef = useRef<number>(0);
    const [localTopic, setLocalTopic] = useState(debateTopic);

    const [agentVolumes, setAgentVolumes] = useState<Record<string, number>>({});
    const disableAudioAccumulationRef = useRef(disableAudioAccumulation);

    useEffect(() => {
        disableAudioAccumulationRef.current = disableAudioAccumulation;
    }, [disableAudioAccumulation]);

    const [speakingAgents, setSpeakingAgents] = useState<Set<string>>(new Set());
    const [isTopicExpanded, setIsTopicExpanded] = useState(false);
    const [transcriptRect, setTranscriptRect] = useState({ x: Math.max(20, window.innerWidth - 380), y: 100, w: 340, h: 400 });
    const [dragState, setDragState] = useState<{ isDragging: boolean; isResizing: boolean; startX: number; startY: number; startRect: typeof transcriptRect; } | null>(null);
    const transcriptBodyRef = useRef<HTMLDivElement>(null);
    const [showSummaries, setShowSummaries] = useState(false);
    const activeSessionsRef = useRef<Set<string>>(new Set());
    const agentCooldownsRef = useRef<Map<string, number>>(new Map());
    const skipTurnRef = useRef<boolean>(false);

    // Spotlight State
    const [spotlightAgentId, setSpotlightAgentId] = useState<string | null>(null);

    const userAgent: Agent = { id: USER_AGENT_ID, name: userName || 'User', personality: '', bodyColor: '#44ff44', voice: 'Puck' };

    // Update spotlight when speaking agents change
    useEffect(() => {
        if (speakingAgents.size > 0) {
            // Pick the first speaking agent (or prioritizing user)
            const ids = Array.from(speakingAgents);
            if (ids.includes(USER_AGENT_ID)) {
                setSpotlightAgentId(USER_AGENT_ID);
            } else {
                setSpotlightAgentId(ids[0]);
            }
        }
    }, [speakingAgents]);

    useEffect(() => {
        if (prevApiKeyRef.current !== effectiveApiKey && prevApiKeyRef.current !== null) {
            console.log('API Key changed, reset all agent sessions');
            agentStatesRef.current.forEach((state) => { try { state.client.disconnect(); } catch (e) { } });
            agentStatesRef.current.clear();
        }
        prevApiKeyRef.current = effectiveApiKey;
    }, [effectiveApiKey]);

    // Sync localTopic with global debateTopic if it changes from outside
    useEffect(() => {
        setLocalTopic(debateTopic);

        // LOG TOPIC CHANGE
        if (prevTopic && prevTopic !== debateTopic) {
            addToTranscript('SYSTEM', `changed topic from: "${prevTopic}"`, false);
        }
        setPrevTopic(debateTopic);
    }, [debateTopic]);

    // FORCE RESET sessions when topic changes
    useEffect(() => {
        console.log('[TopicChange] Resetting all agent sessions for new topic context');
        agentStatesRef.current.forEach((state) => { try { state.client.disconnect(); } catch (e) { } });
        agentStatesRef.current.clear();
        setForceEndTurn(true);
    }, [debateTopic]);

    useEffect(() => {
        if (conversationResetId > 0) {
            console.log('Deep Reset triggered. Clearing all agent sessions.');
            agentStatesRef.current.forEach((state) => { try { state.client.disconnect(); } catch (e) { } });
            agentStatesRef.current.clear();
            agentStreamersRef.current.forEach((s) => s.stop());
            agentStreamersRef.current.clear();
            activeSessionsRef.current.clear();
            lastSpeakerIdRef.current = null;
            lastSummaryLengthRef.current = 0;
            setSpeakingAgents(new Set());
            setSpotlightAgentId(null);
            setAgentVolumes({});
            //try { if (clearAudioHistory) clearAudioHistory(); } catch (e) { }
            //setUploadedFileContext(null);
            setDisableAudioAccumulation(true);
            try { disconnectMicrophone(); } catch (e) { }

            // Clear refs that might track state
            lastSummaryLengthRef.current = 0;
        }
    }, [conversationResetId]);

    useEffect(() => {
        if (forceEndTurn) {
            skipTurnRef.current = true;
            agentStreamersRef.current.forEach((streamer) => streamer.stop());
            agentStreamersRef.current.clear();
            const t = setTimeout(() => {
                useUI.getState().setForceEndTurn(false);
                skipTurnRef.current = false;
            }, 500);
            return () => clearTimeout(t);
        }
    }, [forceEndTurn]);

    useEffect(() => {
        if (transcriptBodyRef.current) transcriptBodyRef.current.scrollTop = transcriptBodyRef.current.scrollHeight;
    }, [transcript]);

    const handleMouseDown = useCallback((e: React.MouseEvent, type: 'drag' | 'resize') => {
        e.preventDefault(); e.stopPropagation();
        setDragState({ isDragging: type === 'drag', isResizing: type === 'resize', startX: e.clientX, startY: e.clientY, startRect: { ...transcriptRect } });
    }, [transcriptRect]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragState) return;
            if (dragState.isDragging) {
                setTranscriptRect({ ...transcriptRect, x: dragState.startRect.x + (e.clientX - dragState.startX), y: dragState.startRect.y + (e.clientY - dragState.startY) });
            } else if (dragState.isResizing) {
                setTranscriptRect({ ...transcriptRect, w: Math.max(200, dragState.startRect.w + (e.clientX - dragState.startX)), h: Math.max(150, dragState.startRect.h + (e.clientY - dragState.startY)) });
            }
        };
        const handleMouseUp = () => setDragState(null);
        if (dragState) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
        return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
    }, [dragState, transcriptRect]);

    const connectMicrophone = async () => {
        userAudioAccumulatorRef.current = [];
        userSpeechTextRef.current = '';

        // @ts-ignore
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            try {
                const recognition = new SpeechRecognition();
                recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US';
                recognition.onresult = (event: any) => {
                    let final = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) { if (event.results[i].isFinal) final += event.results[i][0].transcript; }
                    if (final) userSpeechTextRef.current += ' ' + final;
                };
                recognition.start(); recognitionRef.current = recognition;
            } catch (e) { console.warn('Speech Recognition failed', e); }
        }

        try {
            const recorder = audioRecorderRef.current;
            recorder.on('data', (base64) => {
                const bytes = decode(base64);
                userAudioAccumulatorRef.current.push(bytes);
            });
            recorder.on('volume', (vol) => {
                setAgentVolumes((prev) => ({ ...prev, [USER_AGENT_ID]: vol * 5 }));
            });
            await recorder.start();
        } catch (e) { console.error('Failed to connect microphone:', e); }
    };

    const disconnectMicrophone = () => {
        if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch (e) { } recognitionRef.current = null; }
        audioRecorderRef.current.stop();
        setAgentVolumes((prev) => ({ ...prev, [USER_AGENT_ID]: 0 }));
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const ab = await file.arrayBuffer();
            const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
            const buffer = await ac.decodeAudioData(ab);
            const pcm16kFloat = await processAudioToStandardFloat16kMono(buffer);
            const int16 = float32ToInt16(pcm16kFloat);
            const bytes = new Uint8Array(int16.buffer);
            const base64 = encode(bytes);
            try { if (clearAudioHistory) clearAudioHistory(); } catch (err) { }
            setDisableAudioAccumulation(true);
            setUploadedFileContext({ name: file.name, mimeType: 'audio/pcm;rate=16000', data: base64, durationSec: buffer.duration });
            alert(`Loaded ${file.name} (${buffer.duration.toFixed(3)}s)`);
        } catch (error) { console.error('Error processing audio:', error); alert('Failed to process audio file.'); }
        finally { if (e.target) e.target.value = ''; }
    };

    const clearUploadedContext = () => { setUploadedFileContext(null); setDisableAudioAccumulation(false); };

    const handleUserSend = () => {
        setIsWaitingForUser(false);
        setSpeakingAgents((prev) => { const next = new Set(prev); next.delete(USER_AGENT_ID); return next; });
        disconnectMicrophone();
        const spokenText = userSpeechTextRef.current.trim();
        if (uploadedFileContext) {
            const label = spokenText || `(Uploaded Audio: ${uploadedFileContext.name})`;
            addToTranscript(userName || 'User', label, true);
        } else if (userAudioAccumulatorRef.current.length > 0) {
            const fullUserBytes = concatUint8(userAudioAccumulatorRef.current);
            const base64User = encode(fullUserBytes);
            const transcriptText = spokenText || '(Audio Message)';
            addToTranscript(userName || 'User', transcriptText, true);
            if (!disableAudioAccumulationRef.current) addAudioToHistory({ mimeType: 'audio/pcm;rate=16000', data: base64User });
        } else if (spokenText) {
            addToTranscript(userName || 'User', spokenText, true);
        } else {
            addToTranscript(userName || 'User', '(No Audio)', true);
        }
        userAudioAccumulatorRef.current = [];
        userSpeechTextRef.current = '';
        lastSpeakerIdRef.current = USER_AGENT_ID;
        activeSessionsRef.current.delete(USER_AGENT_ID);
    };

    // ==========================================
    // SUMMARIZATION
    // ==========================================
    const generateSummary = async () => {
        const { activeAgents } = useAgent.getState();
        const { transcript, allSummaries, suggestedNextSpeakers, isUserParticipating, addSummary, setDebateSummary, setAllSummaries, setSuggestedNextSpeakers } = useUI.getState();
        if (transcript.length === 0) return;
        if (isGeneratingSummaryRef.current) return;
        if (disableSummaries) return;

        // SLIDING WINDOW LOGIC: Only summarize if we have enough new turns (e.g. at least one round of active agents)
        const unsummarizedCount = transcript.length - lastSummaryLengthRef.current;
        if (unsummarizedCount < activeAgents.length) return;

        try {
            isGeneratingSummaryRef.current = true;
            const summaryClient = new GoogleGenAI({ apiKey: effectiveApiKey, apiVersion: 'v1alpha' });

            // Check for Meta-Summarization trigger (every 10 summaries)
            if (allSummaries.length >= 10) {
                const metaPrompt = `
You are a debate archivist.
We have 10 accumulated summaries of the debate so far.
Please consolidate them into a single, cohesive narrative summary (under 400 words) that captures the entire evolution of the discussion.
Discard repetitive details but keep key arguments and shifting dynamics.
CRITICAL: Ensure clear attribution of arguments to specific speakers. Use their names. Be sure to include the user's arguments as well, attributing it to the user.

EXISTING SUMMARIES:
${allSummaries.join('\n\n')}

Return JSON with 'consolidatedSummary'.`;

                console.log('Triggering Meta-Summarization...');
                const metaResponse = await summaryClient.models.generateContent({
                    model: 'models/gemini-flash-lite-latest',
                    contents: [{ role: 'user', parts: [{ text: metaPrompt }] }],
                    config: {
                        temperature: 0.5,
                        responseMimeType: 'application/json',
                        responseSchema: { type: Type.OBJECT, properties: { consolidatedSummary: { type: Type.STRING } } }
                    }
                });

                if (metaResponse.text) {
                    const data = JSON.parse(metaResponse.text);
                    if (data.consolidatedSummary) {
                        setAllSummaries([data.consolidatedSummary]);
                        setDebateSummary(data.consolidatedSummary); // Update display
                        console.log('Meta-Summarization Complete.');
                    }
                }
            }

            // STANDARD SLIDING WINDOW SUMMARY
            // Only feed the UNSEEN turns to the summarizer
            const unseenTurns = transcript.slice(lastSummaryLengthRef.current);
            const now = Date.now();
            const agentsList = activeAgents.map((a) => {
                const last = agentCooldownsRef.current.get(a.id) || 0;
                const secondsAgo = last === 0 ? 'Never' : `${Math.floor((now - last) / 1000)}s ago`;
                return `${a.name} (ID: ${a.id}) - last spoke: ${secondsAgo}`;
            }).join('\n');

            const prompt = `
You are a debate moderator's assistant.
1) Read these NEW transcript lines (since the last summary).
2) Create a short, unique summary of JUST these new developments (under 100 words). Do not repeat old history. Focus on what just happened.
3) CRITICAL: You MUST explicitly name the speaker for every action or argument. NEVER say "The speaker" or "He/He" or "Them". ALWAYS use the exact name (e.g. "Lenin said...", "Stalin argued...").
4) Based on the FULL context (which you don't see but assume exists) and these new turns, plan the next 8 speaking turns.
CRITICAL: Ensure *ALL* speakers participants. Prioritize: ${suggestedNextSpeakers.length > 0 ? suggestedNextSpeakers[0] : 'least recent speakers'}.
Be sure to include the user's arguments as well, attributing it to the user.
AVAILABLE AGENTS:
${agentsList}
${isUserParticipating ? `USER PARTICIPANT: ${userName} (ID: ${USER_AGENT_ID})` : ''}

NEW TRANSCRIPT FRAGMENT:
${unseenTurns.map((t) => `${t.speaker}: ${t.text}`).join('\n')}

Return JSON with 'newFragmentSummary' and 'nextSpeakerIds' (array of strings).`;

            const response = await summaryClient.models.generateContent({
                model: 'models/gemini-flash-lite-latest',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    temperature: 1.0,
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            newFragmentSummary: { type: Type.STRING },
                            nextSpeakerIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ['newFragmentSummary', 'nextSpeakerIds'],
                    },
                },
            });

            if (!response.text) return;
            const data = JSON.parse(response.text);

            if (data.newFragmentSummary) {
                const fragment = String(data.newFragmentSummary);
                addSummary(fragment);
                setDebateSummary(fragment);
                lastSummaryLengthRef.current = transcript.length;
            }

            if (data.nextSpeakerIds && Array.isArray(data.nextSpeakerIds)) {
                const allParticipants: Agent[] = isUserParticipating ? [...activeAgents, userAgent] : [...activeAgents];
                const validIds = data.nextSpeakerIds.map((x: any) => String(x)).filter((id: string) => {
                    if (id === USER_AGENT_ID) return isUserParticipating;
                    return !!allParticipants.find((a) => a.id === id);
                });
                if (validIds.length > 0) {
                    setSuggestedNextSpeakers(validIds.slice(0, 10));
                }
            }
        } catch (e) {
            console.error('Summarization failed:', e);
        } finally {
            isGeneratingSummaryRef.current = false;
        }
    };

    // ==========================================
    // MAIN DEBATE LOOP
    // ==========================================
    useEffect(() => {
        let intervalId: number | undefined;

        const runCycle = async () => {
            const { activeAgents } = useAgent.getState();
            const { isDebating, isWaitingForUser, transcript, suggestedNextSpeakers, isChaosMode, isUserParticipating, nextSpeakerId, setNextSpeakerId, setSuggestedNextSpeakers, allowSelfReply } = useUI.getState();
            if (!isDebating || isWaitingForUser) return;
            if (activeAgents.length === 0) return;

            const maxConcurrency = isChaosMode ? activeAgents.length : 1;

            if (activeSessionsRef.current.size >= maxConcurrency) return;

            if (suggestedNextSpeakers.length <= 2 && !isGeneratingSummaryRef.current && transcript.length > 0) generateSummary();

            const allParticipants = isUserParticipating ? [...activeAgents, userAgent] : [...activeAgents];
            let nextAgent: Agent | undefined;

            if (nextSpeakerId) {
                const candidate = allParticipants.find((a) => a.id === nextSpeakerId);
                if (candidate && !activeSessionsRef.current.has(candidate.id)) { nextAgent = candidate; setNextSpeakerId(null); }
            } else if (suggestedNextSpeakers.length > 0) {
                const candidateId = suggestedNextSpeakers[0];
                const candidate = allParticipants.find((a) => a.id === candidateId);
                setSuggestedNextSpeakers(suggestedNextSpeakers.slice(1));
                if (candidate && !activeSessionsRef.current.has(candidate.id) && (allowSelfReply || candidate.id !== lastSpeakerIdRef.current)) nextAgent = candidate;
            }

            if (!nextAgent) {
                const now = Date.now();
                const available = allParticipants.filter((a) => {
                    if (activeSessionsRef.current.has(a.id)) return false;
                    if (!allowSelfReply && a.id === lastSpeakerIdRef.current) return false;
                    const last = agentCooldownsRef.current.get(a.id) || 0;
                    const cd = isChaosMode ? 500 : 1000;
                    return now - last > cd;
                });

                if (available.length === 0) return;

                // Weighted Random: Sort by time since last spoke (ascending means oldest timestamp first)
                // We want to pick people with small timestamps (long ago)
                available.sort((a, b) => {
                    const lastA = agentCooldownsRef.current.get(a.id) || 0;
                    const lastB = agentCooldownsRef.current.get(b.id) || 0;
                    return lastA - lastB; // Ascending: Oldest (Smallest timestamp) first
                });

                // Take top 50% least recently used
                const candidates = available.slice(0, Math.max(1, Math.ceil(available.length / 2)));

                nextAgent = candidates[Math.floor(Math.random() * candidates.length)];
            }

            if (!nextAgent) return;

            if (nextAgent.id === USER_AGENT_ID) {
                activeSessionsRef.current.add(USER_AGENT_ID); setSpeakingAgents((prev) => new Set(prev).add(USER_AGENT_ID));
                setIsWaitingForUser(true); connectMicrophone(); return;
            }

            // AGENT TURN
            let streamer: AudioStreamer | null = null;
            let volPoll: any;

            try {
                activeSessionsRef.current.add(nextAgent.id);
                disconnectMicrophone();
                const ctx = await AudioContextManager.get();
                streamer = new AudioStreamer(ctx);
                agentStreamersRef.current.set(nextAgent.id, streamer);
                volPoll = await analyze(setAgentVolumes, nextAgent, ctx, streamer);

                // =================================================================
                // FIXED SESSION MANAGEMENT (Reset on Config Change or 4 Turns or Idle)
                // =================================================================
                const currentConfigSignature = [
                    nextAgent.id,
                    nextAgent.voice,
                    temperature,
                    topP,
                    nextAgent.personality.substring(0, 30),
                    debateTopic
                ].join('|');

                let agentState = agentStatesRef.current.get(nextAgent.id);
                let shouldReset = false;
                let resetReason = '';

                // Check Idle Timeout (2 minutes)
                const lastUsedTime = agentCooldownsRef.current.get(nextAgent.id) || 0;
                const IDLE_TIMEOUT = 2 * 60 * 1000;

                if (agentState) {
                    if (agentState.turnCount >= activeAgents.length) { shouldReset = true; resetReason = 'Turn Limit'; }
                    else if (agentState.configSignature !== currentConfigSignature) { shouldReset = true; resetReason = 'Config Changed'; }
                    else if (lastUsedTime > 0 && Date.now() - lastUsedTime > IDLE_TIMEOUT) { shouldReset = true; resetReason = 'Idle Timeout'; }
                }

                if (shouldReset && agentState) {
                    console.log(`[Session] Resetting ${nextAgent.name} (${resetReason})`);
                    try { agentState.client.disconnect(); } catch (e) { }
                    agentStatesRef.current.delete(nextAgent.id);
                    agentState = undefined;
                    seed = Math.floor(Math.random() * 99999)
                }

                if (!agentState) {
                    agentState = { client: new GenAILiveClient(effectiveApiKey), turnCount: 0, configSignature: currentConfigSignature };
                    agentStatesRef.current.set(nextAgent.id, agentState);
                    if (agentStatesRef.current.size > 6) {
                        const oldestId = agentStatesRef.current.keys().next().value;
                        if (oldestId && oldestId !== nextAgent.id) {
                            try { agentStatesRef.current.get(oldestId)?.client.disconnect(); } catch (e) { }
                            agentStatesRef.current.delete(oldestId);
                        }
                    }
                }

                agentState.turnCount++;
                const client = agentState.client;

                await new Promise<void>(async (resolve, reject) => {
                    // --- WATCHDOG SETUP (TWO-STAGE) ---
                    let speechWatchdog: NodeJS.Timeout | null = null;
                    let connectionWatchdog: NodeJS.Timeout | null = null;

                    const cleanup = () => {
                        if (speechWatchdog) clearTimeout(speechWatchdog);
                        if (connectionWatchdog) clearTimeout(connectionWatchdog);
                        (client as any).removeAllListeners('audio'); (client as any).removeAllListeners('transcription');
                        (client as any).removeAllListeners('turncomplete'); (client as any).removeAllListeners('interrupted');
                        (client as any).removeAllListeners('close'); (client as any).removeAllListeners('error');
                        (client as any).removeAllListeners('open');
                    };

                    // 1. Connection/Upload Safety Net (Generous timeout for file uploading)
                    const contextDuration = uploadedFileContext?.durationSec || 0;
                    const uploadSafetyMargin = (contextDuration * 2) + 120;

                    connectionWatchdog = setTimeout(() => {
                        console.warn(`[Watchdog] Connection/Upload timeout for ${nextAgent!.name}`);
                        if (streamer) streamer.stop();
                        cleanup();
                        reject(new Error('Connection/Upload Timeout'));
                    }, uploadSafetyMargin * 1000);

                    const speechConfig = (nextAgent as any).voiceClone
                        ? { voiceConfig: { replicatedVoiceConfig: { mimeType: (nextAgent as any).voiceClone.mimeType, voiceSampleAudio: (nextAgent as any).voiceClone.voiceSampleAudio } } }
                        : { voiceConfig: { prebuiltVoiceConfig: { voiceName: nextAgent!.voice } } };

                    // 1. Build Historical Context from Summaries
                    let ctx1 = ""
                    if (allSummaries.length > 0) {
                        ctx1 += `--- PREVIOUS DEBATE CHAPTERS (Summary of Past Events) ---\n${allSummaries.join('\n\n')}\n\n`;
                    }

                    // 2. Build Immediate Context (Active Agents Length + a bit more buffer)
                    const RECENT_TURN_COUNT = Math.max(5, activeAgents.length + 2);
                    const recentTranscript = transcript.slice(-4);
                    const recentText = recentTranscript.map((t) => `${t.speaker}: "${t.text}"`).join('\n');

                    ctx1 += `--- IMMEDIATE CONTEXT (Respond to this directly) ---: \n${recentText}`;
                    let sysText =
                         `--- DEBATE CONTEXT ---\n\nYou are provided with a summary of the debate history and the very last turn:\n\n'''${ctx1}'''\n\nLATEST TOPIC:\n\n ${debateTopic}\n\n-- CHARACTER IDENTITY ---\n\nYou are ${nextAgent!.name}.\n${nextAgent!.personality}\n\n--- SYSTEM INSTRUCTIONS ---\n\nSpeak in English -- but with the accents of your native country as per the personality prompt.\nBe Original and constantly Novel, no repeating the same lines. Act realistic and normal.\nBegin your response with "Dear comrades, I have been following your exchange closely... <Your unique live take based on your principles and analysis>".`
                            


                    const config: LiveConnectConfig = {
                        responseModalities: [Modality.AUDIO],
                        outputAudioTranscription: {},
                        inputAudioTranscription: {},
                        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
                        seed: seed,
                        speechConfig: speechConfig as any,
                        thinkingConfig: { includeThoughts: false, thinkingBudget: 0 },
                        realtimeInputConfig: {
                            turnCoverage: TurnCoverage.TURN_INCLUDES_ALL_INPUT,
                            automaticActivityDetection: { disabled: true }
                        },
                        activityHandling: ActivityHandling.NO_INTERRUPTION,
                        // @ts-ignore
                        safetySettings: [
                            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        ],
                        systemInstruction: { role: 'system', parts: [{ text: sysText}] },
                        temperature: temperature,
                        topP: topP,
                        topK: 95,
                        enableAffectiveDialog: true,
                        maxOutputTokens: 4096,
                        contextWindowCompression: {
                            triggerTokens: '30000',
                            slidingWindow: { targetTokens: '25000' },
                        },
                    } as any;

                    let currentTurnAudioChunks: Uint8Array[] = [];
                    let currentTurnAudioRate = 24000;
                    let currentTurnText = '';
                    let hasVisualsStarted = false;

                    const skipCheckInterval = setInterval(() => {
                        if (skipTurnRef.current) {
                            console.log(`Skipping turn for ${nextAgent?.name}`);
                            if (currentTurnText.trim()) {
                                addToTranscript(nextAgent!.name, currentTurnText.trim(), false);
                            }
                            cleanup(); if (streamer) streamer.stop(); clearInterval(skipCheckInterval); resolve();
                        }
                    }, 100);

                    (client as any).on('audio', async (data: ArrayBuffer) => {
                        if (!hasVisualsStarted) {
                            hasVisualsStarted = true;
                            setSpeakingAgents((prev) => new Set(prev).add(nextAgent!.id));

                            // --- START REAL SPEECH WATCHDOG NOW ---
                            if (connectionWatchdog) clearTimeout(connectionWatchdog);

                            const limit = speechTimeLimit || 60;
                            speechWatchdog = setTimeout(() => {
                                console.warn(`[Watchdog] Speech limit (${limit}s) reached for ${nextAgent!.name}`);
                                if (streamer) streamer.stop(); // Stop audio immediately

                                // FIX: Save whatever text we have so far
                                if (currentTurnText.trim()) {
                                    addToTranscript(nextAgent!.name, currentTurnText.trim(), false);
                                }

                                cleanup();
                                resolve();
                            }, limit * 1000);
                        }

                        const uint8Data = new Uint8Array(data);
                        currentTurnAudioChunks.push(uint8Data);
                        currentTurnAudioRate = parseRateFromMime((client as any).lastOutputAudioMimeType, 24000);
                        streamer?.addPCM16(uint8Data);
                    });

                    (client as any).on('transcription', (text: string) => {
                        if (!text.startsWith('[USER]')) currentTurnText += text;
                    });

                    const triggerResponse = async () => {
                        if ((client as any).status !== 'connected') throw new Error('Client disconnected');

                        let ctxText = '';
                        if (userMessage) { ctxText += `\n[USER INTERJECTION]: "${userMessage}"\n`; setUserMessage(null); }

                        const usingUploadedContext = !!uploadedFileContext;
                        let audioItemToSend: AudioContextItem | null = null;
                        if (usingUploadedContext) {
                            audioItemToSend = { mimeType: uploadedFileContext!.mimeType, data: uploadedFileContext!.data };
                        } else if (!disableAudioAccumulation && audioHistory.length > 0) {
                            const lastItem = audioHistory[audioHistory.length - 1];
                            audioItemToSend = lastItem as any;
                        }

                        if (audioItemToSend) {
                            let pcmBytes = decodeBase64ToUint8Array(audioItemToSend.data);
                            const originalLen = pcmBytes.length;

                            // Appending 2s of silence (64000 bytes at 16kHz) to improve model turn detection
                            const silence = new Uint8Array(64000);
                            const padded = new Uint8Array(originalLen + silence.length);
                            padded.set(pcmBytes);
                            padded.set(silence, originalLen);
                            pcmBytes = padded;

                            console.log(`[FastUpload] Original: ${originalLen} -> New: ${pcmBytes.length} bytes (incl. 2s silence)...`);



                            const CHUNK_SIZE = Math.floor(pcmBytes.buffer.byteLength / 5);//Math.floor(pcmBytes.buffer.byteLength / 5);
                            await client.sendRealtimeInput({ activityStart: {} })
                            for (let off = 0; off < pcmBytes.length; off += CHUNK_SIZE) {
                                const end = Math.min(off + CHUNK_SIZE, pcmBytes.length);
                                const chunk = pcmBytes.slice(off, end);
                                const base64Chunk = encode(chunk);
                                await sleep(50)
                                await client.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data: base64Chunk } });
                            }
                            //await sleep(1000)    


                            console.log(`[FastUpload] Complete.`);
                        }

                        // Commit Turn
                        console.log("Committing turn via text message.");
                        await sleep(1000)
                        if (ctxText) {

                            await (client as any).send([{ text: ctxText }], true);
                            await client.sendRealtimeInput({ activityEnd: {} })
                        } else {
                            await (client as any).send([{ text: ' ' }], true);
                            await sleep(500)
                            await client.sendRealtimeInput({ activityEnd: {} });//
                        }
                    };

                    (client as any).on('open', () => {
                        setTimeout(() => { triggerResponse().catch((e) => { cleanup(); clearInterval(skipCheckInterval); reject(e); }); }, 200);
                    });

                    (client as any).on('turncomplete', () => {
                        if (currentTurnAudioChunks.length > 0 && !disableAudioAccumulationRef.current && !uploadedFileContext) {
                            const fullBytes = concatUint8(currentTurnAudioChunks);
                            const pcmSrc = pcm16LEBytesToInt16(fullBytes);
                            const pcm16k = resamplePCM16Mono(pcmSrc, currentTurnAudioRate || 24000, 16000);
                            const base64Audio16k = encode(int16ToPCM16LEBytes(pcm16k));
                            addAudioToHistory({ mimeType: 'audio/pcm;rate=16000', data: base64Audio16k });
                        }
                        if (currentTurnText.trim()) addToTranscript(nextAgent!.name, currentTurnText.trim(), false);
                        if (streamer && !skipTurnRef.current) {
                            streamer.onComplete = () => { cleanup(); clearInterval(skipCheckInterval); resolve(); };
                            streamer.complete();
                        } else { cleanup(); clearInterval(skipCheckInterval); resolve(); }
                    });

                    (client as any).on('error', (e: any) => {
                        // FIX: Save partial text on error too
                        if (currentTurnText.trim()) addToTranscript(nextAgent!.name, currentTurnText.trim(), false);
                        cleanup();
                        if (streamer) streamer.stop();
                        clearInterval(skipCheckInterval);
                        reject(e);
                    });

                    (client as any).on('close', () => {
                        // FIX: Save partial text on close too
                        if (currentTurnText.trim()) addToTranscript(nextAgent!.name, currentTurnText.trim(), false);
                        cleanup();
                        if (streamer) streamer.stop();
                        clearInterval(skipCheckInterval);
                        resolve();
                    });

                    try {
                        if ((client as any).status === 'connected') { await triggerResponse(); } else { await (client as any).connect(config); }
                    } catch (e) { cleanup(); if (streamer) streamer.stop(); clearInterval(skipCheckInterval); reject(e); }
                });

                if (streamer) { await sleep(500); streamer.stop(); agentStreamersRef.current.delete(nextAgent.id); }
                if (volPoll) clearInterval(volPoll);
                agentCooldownsRef.current.set(nextAgent.id, Date.now());
                lastSpeakerIdRef.current = nextAgent.id;
                setAgentVolumes((prev) => ({ ...prev, [nextAgent.id]: 0 }));
                activeSessionsRef.current.delete(nextAgent.id);
                setSpeakingAgents((prev) => { const next = new Set(prev); next.delete(nextAgent!.id); return next; });
                turnstep++;

            } catch (err) {
                const streamerToStop = agentStreamersRef.current.get(nextAgent!.id);
                if (streamerToStop) streamerToStop.stop();
                agentStreamersRef.current.delete(nextAgent!.id);
                activeSessionsRef.current.delete(nextAgent!.id);
                setSpeakingAgents((prev) => { const next = new Set(prev); next.delete(nextAgent!.id); return next; });
            }
        };

        if (isDebating) { intervalId = window.setInterval(runCycle, isChaosMode ? 400 : 1000); }
        return () => { if (intervalId) clearInterval(intervalId); };
    }, [
        isDebating, isChaosMode, debateTopic, userMessage, activeAgents, effectiveApiKey, temperature, topP, systemPrompt, speechTimeLimit, nextSpeakerId, debateSummary, allowSelfReply, conversationResetId, suggestedNextSpeakers, audioHistory, userName, isUserParticipating, isWaitingForUser, uploadedFileContext, disableAudioAccumulation
    ]);

    // ==========================================
    // RENDER
    // ==========================================
    const displayAgents = isUserParticipating ? [...activeAgents, userAgent] : activeAgents;

    // Get the agent object for the spotlight (if any)
    const spotlightAgent = spotlightAgentId
        ? (spotlightAgentId === USER_AGENT_ID ? userAgent : activeAgents.find(a => a.id === spotlightAgentId))
        : null;

    return (
        <div className="keynote-companion" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', position: 'relative', background: 'transparent', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', zIndex: 500 }}>
                <div style={{ padding: '12px 20px', background: isChaosMode ? 'linear-gradient(90deg, #500000, #300000)' : 'rgba(0,0,0,0.85)', borderBottom: '1px solid rgba(255,255,255,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)', transition: 'all 0.3s ease' }}>
                    <div style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'center', cursor: 'pointer', userSelect: 'none', maxWidth: '100%', overflow: 'hidden' }} onClick={(e) => { e.stopPropagation(); setIsTopicExpanded(!isTopicExpanded); }}>
                        <span style={{ fontWeight: 'bold', color: '#ff8888', marginRight: '10px', flexShrink: 0 }}>TOPIC:</span>
                        <span style={{ color: 'white', fontSize: '18px', fontWeight: '500', marginRight: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '800px', display: 'inline-block' }}>{debateTopic}</span>
                        <span className="icon" style={{ color: '#aaa', fontSize: '20px', flexShrink: 0 }}>{isTopicExpanded ? 'expand_less' : 'expand_more'}</span>
                    </div>
                    {isTopicExpanded && (
                        <div style={{ marginTop: '15px', width: '100%', maxWidth: '700px', display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '10px', animation: 'fadeIn 0.3s ease-in-out' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ color: '#888', fontSize: '12px', fontWeight: 'bold' }}>DEBATE TOPIC (Press Enter to Commit)</label>
                                <input
                                    type="text"
                                    value={localTopic}
                                    onChange={(e) => setLocalTopic(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { setDebateTopic(localTopic); triggerUserInteraction(); } }}
                                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid #444', color: 'white', padding: '8px', borderRadius: '4px' }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <label style={{ color: '#888', fontSize: '12px', fontWeight: 'bold' }}>SYSTEM INSTRUCTIONS</label>
                                <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={4} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid #444', color: 'white', padding: '8px', borderRadius: '4px', resize: 'vertical' }} />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
                                <input
                                    type="checkbox"
                                    id="disableAudioAccumulation"
                                    checked={disableAudioAccumulation}
                                    onChange={(e) => setDisableAudioAccumulation(e.target.checked)}
                                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                />
                                <label htmlFor="disableAudioAccumulation" style={{ color: 'white', fontSize: '14px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    PAUSE AUDIO ACCUMULATION (Temporary)
                                </label>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
                                <input
                                    type="checkbox"
                                    id="disableSummaries"
                                    checked={disableSummaries}
                                    onChange={(e) => setDisableSummaries(e.target.checked)}
                                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                />
                                <label htmlFor="disableSummaries" style={{ color: 'white', fontSize: '14px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    DISABLE AUTO-SUMMARIES
                                </label>
                            </div>

                            {uploadedFileContext && (
                                <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px', borderRadius: '10px', border: '1px solid rgba(68,255,68,0.6)', background: 'rgba(0, 50, 0, 0.25)' }}>
                                    <div style={{ color: '#aaffaa', fontSize: '12px' }}>
                                        <div style={{ fontWeight: 'bold', color: '#44ff44' }}>UPLOADED AUDIO CONTEXT ACTIVE</div>
                                        <div style={{ color: '#cfcfcf' }}>Using: {uploadedFileContext.name} {typeof uploadedFileContext.durationSec === 'number' ? ` (${uploadedFileContext.durationSec.toFixed(2)}s)` : ''}</div>
                                        <div style={{ color: '#9a9a9a' }}>While this is active, the app will NOT accumulate any new audio history. Remove it to resume normal debate memory.</div>
                                    </div>
                                    <button onClick={clearUploadedContext} style={{ background: '#44ff44', color: 'black', border: 'none', borderRadius: '10px', padding: '10px 14px', cursor: 'pointer', fontWeight: 'bold' }}>REMOVE</button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="main-app-area" style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', width: '100%' }}>

                {/* NEW 9:16 SPOTLIGHT SECTION (Pushing Grid to Right) */}
                <div style={{
                    flex: '0 0 auto',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingLeft: '20px',
                    paddingRight: '20px',
                    paddingTop: '80px', // Clear header
                    zIndex: 50
                }}>
                    <div className="phone-frame" style={{
                        width: '360px',
                        height: '640px',
                        border: '4px solid #222',
                        borderRadius: '20px',
                        background: '#000',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        paddingTop: '60px',
                        position: 'relative',
                        boxShadow: '0 0 40px rgba(0,0,0,0.6)',
                        flexShrink: 0
                    }}>
                        <div style={{ position: 'absolute', top: '20px', left: '0', width: '100%', textAlign: 'center', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 'bold' }}>
                            Live Feed
                        </div>

                        {spotlightAgent ? (
                            <AgentFaceWrapper
                                key={spotlightAgent.id}
                                agent={spotlightAgent}
                                volume={agentVolumes[spotlightAgent.id] || 0}
                                isSpeaking={speakingAgents.has(spotlightAgent.id)}
                            />
                        ) : (
                            <div style={{ marginTop: '120px', color: '#444', fontSize: '14px', fontStyle: 'italic' }}>Waiting for speaker...</div>
                        )}

                        {/* Subtitle Area Placeholder */}
                        <div style={{
                            position: 'absolute',
                            bottom: '0',
                            left: '0',
                            width: '100%',
                            height: '35%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#333',
                            fontSize: '10px',
                            background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
                            pointerEvents: 'none'
                        }}>
                            {/* Space for subs */}
                        </div>
                    </div>
                </div>

                {/* SCROLLABLE GRID */}
                <div className="agents-container" style={{
                    flex: 1,
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    alignItems: 'center',
                    alignContent: 'center',
                    gap: '20px',
                    padding: '80px 20px 100px',
                    height: '100%',
                    overflowY: 'auto'
                }}>
                    {displayAgents.map((agent) => (
                        // Hide agent in main grid if they are currently in the spotlight box
                        <div key={agent.id} style={{ display: agent.id === spotlightAgentId ? 'none' : 'block' }}>
                            <AgentFaceWrapper agent={agent} volume={agentVolumes[agent.id] || 0} isSpeaking={speakingAgents.has(agent.id)} />
                        </div>
                    ))}
                    {isWaitingForUser && (
                        <div style={{ position: 'absolute', bottom: '120px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0, 50, 100, 0.9)', padding: '20px', borderRadius: '16px', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', boxShadow: '0 0 30px rgba(0, 100, 200, 0.6)', zIndex: 100, border: '2px solid #44ff44', minWidth: '340px' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '18px', color: '#44ff44' }}>YOUR TURN</div>
                            <div style={{ width: '100%', height: '20px', background: '#111', borderRadius: '10px', overflow: 'hidden', border: '1px solid #333' }}>
                                <div style={{ height: '100%', background: 'linear-gradient(90deg, #44ff44, #88ff88)', width: `${Math.min(100, (agentVolumes[USER_AGENT_ID] || 0) * 800)}%`, transition: 'width 0.05s' }} />
                            </div>
                            <div style={{ fontSize: '12px', color: '#aaa', textAlign: 'center' }}>
                                Microphone is active. Speak now, or upload a file.
                                {uploadedFileContext ? (<div style={{ marginTop: '6px', color: '#aaffaa' }}>Uploaded audio context is active (no new audio history will be saved).</div>) : null}
                            </div>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                <label className="button" style={{ fontSize: '12px', padding: '8px 16px', cursor: 'pointer', background: '#333', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                    <span className="icon">upload_file</span> Upload Audio
                                    <input type="file" accept="audio/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                                </label>
                                {uploadedFileContext && (<button className="button" onClick={clearUploadedContext} style={{ fontSize: '12px', padding: '8px 16px', background: '#44ff44', color: 'black', fontWeight: 'bold', border: 'none', borderRadius: '10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}> <span className="icon">cancel</span> Remove Upload </button>)}
                                <button className="button primary" onClick={handleUserSend} style={{ fontSize: '14px', padding: '8px 24px', background: '#44ff44', color: 'black', fontWeight: 'bold', border: 'none', borderRadius: '10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}> <span className="icon">send</span> SEND RESPONSE </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="transcript-container" onMouseDown={(e) => handleMouseDown(e, 'drag')} style={{ position: 'absolute', left: transcriptRect.x, top: transcriptRect.y, width: transcriptRect.w, height: transcriptRect.h, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)', border: '1px solid #444', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 100 }}>
                    <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#ccc' }}>LIVE TRANSCRIPT</span>
                            <button
                                onClick={() => clearTranscript()}
                                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
                                onMouseOver={(e) => e.currentTarget.style.color = '#ff6666'}
                                onMouseOut={(e) => e.currentTarget.style.color = '#888'}
                                title="Clear History"
                            >
                                <span className="icon" style={{ fontSize: '16px' }}>delete_sweep</span>
                            </button>
                        </div>
                        <div style={{ width: '10px', height: '10px', background: speakingAgents.size > 0 ? '#4f4' : '#666', borderRadius: '50%', boxShadow: speakingAgents.size > 0 ? '0 0 10px #4f4' : 'none' }} />
                    </div>
                    <div ref={transcriptBodyRef} style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {transcript.map((item) => (
                            <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: item.isUser ? 'flex-end' : 'flex-start' }}>
                                <span style={{ fontSize: '10px', color: item.isUser ? '#88ccff' : '#ff8888', fontWeight: 'bold' }}>{item.speaker}</span>
                                <div style={{ background: item.isUser ? 'rgba(0, 100, 200, 0.3)' : 'rgba(255, 255, 255, 0.1)', padding: '6px 10px', borderRadius: item.isUser ? '12px 0 12px 12px' : '0 12px 12px 12px', fontSize: '13px', lineHeight: '1.4', maxWidth: '100%' }}>{item.text}</div>
                            </div>
                        ))}
                        {transcript.length === 0 && <div style={{ textAlign: 'center', color: '#666', fontSize: '12px', marginTop: '20px', fontStyle: 'italic' }}>Waiting for debate to start...</div>}
                    </div>
                    <div onMouseDown={(e) => handleMouseDown(e, 'resize')} style={{ position: 'absolute', bottom: 0, right: 0, width: '15px', height: '15px', cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, #666 50%)', opacity: 0.5 }} />
                </div>
            </div>

            <div style={{ position: 'absolute', bottom: '20px', left: '20px', zIndex: 200, display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }} onClick={(e) => e.stopPropagation()}>
                <label style={{ fontSize: '12px', padding: '10px 16px', cursor: 'pointer', background: 'rgba(0,0,0,0.75)', color: 'white', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)', display: 'inline-flex', alignItems: 'center', gap: '8px', backdropFilter: 'blur(10px)', boxShadow: '0 8px 20px rgba(0,0,0,0.45)', fontWeight: 'bold', userSelect: 'none' }}>
                    <span className="icon">upload_file</span> UPLOAD AUDIO
                    <input type="file" accept="audio/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                </label>
                <div onClick={(e) => { e.stopPropagation(); setShowSummaries(!showSummaries); }} style={{ fontSize: '12px', padding: '10px 16px', cursor: 'pointer', background: 'rgba(0,0,0,0.75)', color: 'white', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)', display: 'inline-flex', alignItems: 'center', gap: '8px', backdropFilter: 'blur(10px)', boxShadow: '0 8px 20px rgba(0,0,0,0.45)', fontWeight: 'bold', userSelect: 'none' }}>
                    <span className="icon">article</span> SUMMARIES ({allSummaries.length})
                </div>
                {uploadedFileContext && (
                    <div style={{ padding: '10px 12px', borderRadius: '12px', border: '1px solid rgba(68,255,68,0.6)', background: 'rgba(0, 50, 0, 0.25)', color: 'white', maxWidth: '320px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ fontSize: '12px', color: '#aaffaa', lineHeight: 1.2 }}>
                            <div style={{ fontWeight: 'bold', color: '#44ff44' }}>UPLOAD CONTEXT ACTIVE</div>
                            <div style={{ color: '#cfcfcf', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploadedFileContext.name}</div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); clearUploadedContext(); }} style={{ marginLeft: 'auto', background: '#44ff44', color: 'black', border: 'none', borderRadius: '10px', padding: '8px 10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>REMOVE</button>
                    </div>
                )}
            </div>

            {/* SUMMARIES MODAL */}
            {showSummaries && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '600px', maxHeight: '80vh', background: 'rgba(10, 10, 15, 0.95)', border: '1px solid #444', borderRadius: '16px', zIndex: 600, display: 'flex', flexDirection: 'column', boxShadow: '0 0 50px rgba(0,0,0,0.8)', backdropFilter: 'blur(20px)' }}>
                    <div style={{ padding: '15px 20px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '16px', fontWeight: 'bold', color: 'white' }}>DEBATE SUMMARIES</span>
                        <button onClick={() => setShowSummaries(false)} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '20px' }}>&times;</button>
                    </div>
                    <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        {allSummaries.length === 0 ? (
                            <div style={{ color: '#666', fontStyle: 'italic', textAlign: 'center' }}>No summaries generated yet.</div>
                        ) : (
                            allSummaries.map((summary, i) => (
                                <div key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '8px', border: '1px solid #333' }}>
                                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.5', color: '#ddd' }}>{summary}</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}