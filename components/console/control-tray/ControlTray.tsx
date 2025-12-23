
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import cn from 'classnames';

import React, { memo, ReactNode, useState, useRef, useEffect } from 'react';
import { useUI, useAgent } from '../../../lib/state';

export type ControlTrayProps = {
  children?: ReactNode;
};

type InputMode = 'reply' | 'topic';

function ControlTray({ children }: ControlTrayProps) {
  const {
    isDebating, setDebating,
    addToTranscript, triggerUserInteraction,
    setDebateTopic,
    isChaosMode, setChaosMode,
    allowSelfReply, setAllowSelfReply,
    setUserMessage,
    setNextSpeakerId, nextSpeakerId,
    setForceEndTurn, clearTranscript,
    isUserParticipating, setUserParticipating
  } = useUI();

  const { activeAgents } = useAgent();
  const [inputText, setInputText] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('reply');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    if (inputMode === 'topic') {
      const newTopic = inputText;
      setDebateTopic(newTopic);
      addToTranscript("System", `TOPIC CHANGED TO: ${newTopic}`, true);
      setForceEndTurn(true);
      triggerUserInteraction(); // Interrupts for immediate topic change
    } else {
      // Reply mode - Queue message for next turn, do not interrupt current speaker
      setUserMessage(inputText);
      addToTranscript("User", inputText, true);
    }

    setInputText('');
    if (!isDebating) setDebating(true);
  };

  // Keyboard shortcut for pausing (optional, but good for UX)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement !== inputRef.current) {
        // prevent scrolling
        // e.preventDefault(); 
        // setDebating(!isDebating);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDebating, setDebating]);

  return (
    <section className="control-tray" style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      alignItems: 'center',
      padding: '10px',
      background: 'rgba(0,0,0,0.8)',
      borderRadius: '24px 24px 0 0',
      width: '100%',
      maxWidth: '900px'
    }}>
      <div className={cn('connection-container', { connected: isDebating })} style={{ flexDirection: 'row', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>

        {/* Controls: Start/Stop, Chaos, Skip, Next Speaker */}
        <div className="connection-button-container" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className={cn('action-button connect-toggle', { connected: isDebating })}
            onClick={() => setDebating(!isDebating)}
            style={{ width: '50px', height: '50px', fontSize: '2em', borderRadius: '50%' }}
            title={isDebating ? "Pause Debate" : "Start Debate"}
          >
            <span className="material-symbols-outlined filled">
              {isDebating ? 'stop' : 'play_arrow'}
            </span>
          </button>

          <button
            className={cn('action-button', { connected: isUserParticipating })}
            onClick={() => setUserParticipating(!isUserParticipating)}
            style={{
              width: '40px', height: '40px',
              borderRadius: '50%',
              borderColor: isUserParticipating ? '#44ff44' : 'transparent',
              color: isUserParticipating ? '#44ff44' : 'inherit'
            }}
            title={isUserParticipating ? "Leave Debate (Stop Listening)" : "Join Debate (Enable Microphone)"}
          >
            <span className="material-symbols-outlined filled">
              {isUserParticipating ? 'record_voice_over' : 'voice_over_off'}
            </span>
          </button>

          <button
            className={cn('action-button', { connected: isChaosMode })}
            onClick={() => setChaosMode(!isChaosMode)}
            style={{ width: '40px', height: '40px', fontSize: '1.5em', borderRadius: '50%', borderColor: isChaosMode ? '#ff4600' : 'transparent', color: isChaosMode ? '#ff4600' : 'inherit' }}
            title={isChaosMode ? "Disable Chaos Mode" : "Enable Chaos Mode"}
          >
            <span className="material-symbols-outlined filled">
              bolt
            </span>
          </button>

          <button
            className={cn('action-button', { connected: allowSelfReply })}
            onClick={() => setAllowSelfReply(!allowSelfReply)}
            style={{ width: '40px', height: '40px', fontSize: '1.5em', borderRadius: '50%', borderColor: allowSelfReply ? '#44ff44' : 'transparent', color: allowSelfReply ? '#44ff44' : 'inherit' }}
            title={allowSelfReply ? "Disable Self-Reply (Single Agent)" : "Enable Self-Reply (Single Agent)"}
          >
            <span className="material-symbols-outlined filled">
              repeat_one
            </span>
          </button>

          <button
            className="action-button"
            onClick={() => setForceEndTurn(true)}
            style={{ width: '40px', height: '40px', borderRadius: '50%' }}
            title="End Current Turn"
          >
            <span className="material-symbols-outlined">skip_next</span>
          </button>

          <button
            className="action-button"
            onClick={(e) => {
              setForceEndTurn(true); // Stop current speaker immediately
              clearTranscript();
            }}
            style={{ width: '40px', height: '40px', borderRadius: '50%' }}
            title="Clear Transcript (Fresh Start)"
          >
            <span className="material-symbols-outlined">delete_sweep</span>
          </button>

          <select
            value={nextSpeakerId || ''}
            onChange={(e) => setNextSpeakerId(e.target.value || null)}
            style={{
              background: '#333',
              color: 'white',
              border: '1px solid #555',
              padding: '5px',
              borderRadius: '8px',
              maxWidth: '120px',
              fontSize: '12px'
            }}
          >
            <option value="">Next: Auto</option>
            {activeAgents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
            {isUserParticipating && <option value="USER_PARTICIPANT">Myself</option>}
          </select>
        </div>

        {/* Input Area */}
        <div style={{ display: 'flex', flex: 1, gap: '0', maxWidth: '550px', flexDirection: 'column' }}>
          <div style={{ display: 'flex', marginBottom: '4px' }}>
            <button
              onClick={() => setInputMode('reply')}
              style={{
                flex: 1,
                background: inputMode === 'reply' ? '#444' : '#222',
                color: inputMode === 'reply' ? 'white' : '#888',
                border: '1px solid #444',
                borderBottom: 'none',
                borderRadius: '8px 0 0 0',
                fontSize: '12px',
                padding: '4px',
                fontWeight: 'bold'
              }}>
              Reply (Queue)
            </button>
            <button
              onClick={() => setInputMode('topic')}
              style={{
                flex: 1,
                background: inputMode === 'topic' ? '#444' : '#222',
                color: inputMode === 'topic' ? 'white' : '#888',
                border: '1px solid #444',
                borderBottom: 'none',
                borderRadius: '0 8px 0 0',
                fontSize: '12px',
                padding: '4px',
                fontWeight: 'bold'
              }}>
              Set Topic (Interrupt)
            </button>
          </div>
          <form onSubmit={handleSend} style={{ display: 'flex', gap: '10px', width: '100%' }}>
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={inputMode === 'reply' ? "Interject..." : "Change topic..."}
              style={{
                flex: 1,
                background: '#333',
                border: '1px solid #555',
                borderRadius: '0 0 0 8px',
                padding: '0 16px',
                color: 'white',
                height: '50px',
                minWidth: '200px'
              }}
            />
            <button
              type="submit"
              className="action-button"
              style={{ width: '50px', height: '50px', background: '#333', border: '1px solid #555', borderRadius: '0 0 8px 0' }}
            >
              <span className="material-symbols-outlined">send</span>
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

export default memo(ControlTray);
