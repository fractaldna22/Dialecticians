/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useRef } from 'react';
import {
  Agent,
  AGENT_COLORS,
  INTERLOCUTOR_VOICE,
  INTERLOCUTOR_VOICES,
  INTERLOCUTOR_VOICES2,
} from '../lib/presets/agents';
import Modal from './Modal';
import c from 'classnames';
import { useAgent, useUI } from '../lib/state';
import { encode, float32ToInt16, resampleTo16k } from '../lib/utils';
 
export default function EditAgent() {
  const agent = useAgent(state => state.current);
  const updateAgent = useAgent(state => state.update);
  const nameInput = useRef(null);
  const { setShowAgentEdit } = useUI();

  function onClose() {
    setShowAgentEdit(false);
  }

  function updateCurrentAgent(adjustments: Partial<Agent>) {
    updateAgent(agent.id, adjustments);
  }
  
  const handleVoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        
        let pcmData = audioBuffer.getChannelData(0); // Take first channel
        if (audioBuffer.sampleRate !== 16000) {
           pcmData = await resampleTo16k(pcmData, audioBuffer.sampleRate);
        }
        
        const int16Data = float32ToInt16(pcmData);
        const base64Audio = encode(new Uint8Array(int16Data.buffer));

        updateCurrentAgent({
            voiceClone: {
                mimeType: "audio/pcm;rate=16000",
                voiceSampleAudio: base64Audio
            }
        });
    } catch (error) {
        console.error("Error processing voice sample:", error);
        alert("Failed to process audio file. Please try a different file.");
    }
  };

  return (
    <Modal onClose={() => onClose()}>
      <div className="editAgent">
        <div>
          <form>
            <div>
              <input
                className="largeInput"
                type="text"
                placeholder="Name"
                value={agent.name}
                onChange={e => updateCurrentAgent({ name: e.target.value })}
                ref={nameInput}
              />
            </div>

            <div>
              <label>
                Personality
                <textarea
                  value={agent.personality}
                  onChange={e =>
                    updateCurrentAgent({ personality: e.target.value })
                  }
                  rows={7}
                  placeholder="How should I act? Whatʼs my purpose? How would you describe my personality?"
                />
              </label>
            </div>
          </form>
        </div>

        <div>
          <div>
            <ul className="colorPicker">
              {AGENT_COLORS.map((color, i) => (
                <li
                  key={i}
                  className={c({ active: color === agent.bodyColor })}
                >
                  <button
                    style={{ backgroundColor: color }}
                    onClick={() => updateCurrentAgent({ bodyColor: color })}
                  />
                </li>
              ))}
            </ul>
          </div>
          <div className="voicePicker" style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
            <div style={{display: 'flex', flexDirection: 'column', gap: '5px'}}>
                <label>Prebuilt Voice</label>
                <select
                  value={agent.voice}
                  onChange={e => {
                    if (agent.voiceClone) {
                      if (
                        !confirm(
                          'Switching to a prebuilt voice will clear your uploaded voice clone. Continue?'
                        )
                      ) {
                        return;
                      }
                    }

                    updateCurrentAgent({
                      voice: e.target.value as INTERLOCUTOR_VOICE,
                      voiceClone: undefined
                    });
                  }}
                  disabled={!!agent.voiceClone}
                >
                  {Object.entries(INTERLOCUTOR_VOICES2).map(([gender, voices]) => (
                    <optgroup key={gender} label={gender}>
                      {voices.map(voice => (
                        <option key={voice} value={voice}>
                          {voice}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>

            </div>
            
            <div style={{borderTop: '1px solid #444', paddingTop: '10px'}}>
                <label>Or Clone Voice (Upload Audio)</label>
                {agent.voiceClone ? (
                    <div style={{display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px', background: '#1a1a1a', padding: '8px', borderRadius: '4px'}}>
                        <span style={{color: '#4f4', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px'}}>
                            <span className="material-symbols-outlined" style={{fontSize: '16px'}}>check_circle</span>
                            Custom Voice Active
                        </span>
                        <button 
                            onClick={() => updateCurrentAgent({ voiceClone: undefined })}
                            className="button"
                            style={{fontSize: '11px', padding: '4px 8px', marginLeft: 'auto', background: '#333'}}
                        >
                            Clear
                        </button>
                    </div>
                ) : (
                    <div style={{marginTop: '5px'}}>
                         <input 
                            type="file" 
                            accept="audio/*" 
                            onChange={handleVoiceUpload}
                            style={{fontSize: '12px'}}
                        />
                        <p style={{fontSize: '10px', color: '#666', marginTop: '4px'}}>Supports MP3, WAV, FLAC. Best results with clear speech.</p>
                    </div>
                )}
            </div>
          </div>
        </div>
        <button onClick={() => onClose()} className="button primary">
          Let’s go!
        </button>
      </div>
    </Modal>
  );
}