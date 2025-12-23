
// lib/hooks/useSpeech.ts
import React, { useEffect, useRef, useState } from 'react';

// Declaration to avoid TS errors if types aren't available
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}
let txt = ""
export function useSpeechRecognition() {
    
     
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.warn("Speech recognition not supported in this browser.");
        return;
    }

    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          txt = e.results[i][0].transcript.trim();
           
        }
      }
    };

    rec.onerror = (e: any) => {
        console.error("Speech recognition error", e);
    }

    try {
        rec.start();
    } catch(e) {
        console.error("Failed to start recognition", e);
    }
    return {recognition: rec?rec:null, txt: txt}
} 