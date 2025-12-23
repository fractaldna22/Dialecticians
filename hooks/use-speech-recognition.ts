
import { useState, useEffect, useRef, useCallback } from 'react';

export interface SpeechRecognitionResult {
    transcript: string;
    isFinal: boolean;
}

export function useSpeechRecognition() {
    const [transcript, setTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        
        // @ts-ignore - Vendor prefixes
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event: any) => {
                let finalTranscript = '';
                let interimTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }

                if (finalTranscript) {
                    // Update state with final result so consumer can react
                    setTranscript(prev => finalTranscript); // Just return the new chunk, logic handled in consumer
                }
            };

            recognition.onend = () => {
                // Auto-restart if we intended to keep listening
                if (isListening) {
                    try {
                        recognition.start();
                    } catch (e) {
                        setIsListening(false);
                    }
                }
            };

            recognition.onerror = (event: any) => {
                console.warn('Speech recognition error', event.error);
            };

            recognitionRef.current = recognition;
        }
    }, [isListening]);

    const start = useCallback(() => {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.start();
                setIsListening(true);
            } catch (e) {
                // Already started or error
                setIsListening(true);
            }
        }
    }, []);

    const stop = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
    }, []);

    return { transcript, isListening, start, stop, setTranscript };
}
