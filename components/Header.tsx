
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useLiveAPIContext } from '../contexts/LiveAPIContext';
import { createNewAgent } from '../lib/presets/agents';
import { useAgent, useUI } from '../lib/state';
import c from 'classnames';
import { useEffect, useState } from 'react';

export default function Header() {
  const { showUserConfig, setShowUserConfig, setShowAgentEdit, setDebating, isDebating } = useUI();
  const { availablePresets, availablePersonal, addAgent, toggleActive, activeAgents, setCurrent } =
    useAgent();
  const { disconnect } = useLiveAPIContext();

  let [showRoomList, setShowRoomList] = useState(false);

  useEffect(() => {
    const handleGlobalClick = () => setShowRoomList(false);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  function addNewComrade() {
    disconnect();
    setDebating(false);
    const newGuy = createNewAgent();
    addAgent(newGuy);
    setCurrent(newGuy); // Select for editing
    setShowAgentEdit(true);
  }

  function handleEdit(agentId: string) {
    setCurrent(agentId);
    setShowAgentEdit(true);
  }

  return (
    <header>
      <div className="roomInfo">
        <div className="roomName">
          <button
            onClick={e => {
              e.stopPropagation();
              setShowRoomList(!showRoomList);
            }}
          >
            <h1 className={c({ active: showRoomList })}>
              The Dialecticians | Count: ({activeAgents.length})
              <span className="icon">arrow_drop_down</span>
            </h1>
          </button>
        </div>

        <div 
          className={c('roomList', { active: showRoomList })}
          onClick={(e) => e.stopPropagation()}
        >
          <p style={{fontSize: '12px', color: '#666', marginBottom: '10px'}}>
             Select comrades to join the debate pool.
          </p>
          <div>
            <h3>Dialecticians</h3>
            <ul>
              {availablePresets.map(agent => (
                  <li
                    key={agent.id}
                    className={c({ active: activeAgents.find(a => a.id === agent.id) })}
                    style={{display: 'flex', justifyContent: 'space-between'}}
                  >
                    <button onClick={() => toggleActive(agent)} style={{textAlign:'left'}}>
                      {activeAgents.find(a => a.id === agent.id) ? '✅' : '⬜️'} {agent.name}
                    </button>
                    <button onClick={() => handleEdit(agent.id)} className="icon" style={{width: 'auto'}}>edit</button>
                  </li>
                ))}
            </ul>
          </div>

          <div>
            <h3>Custom Comrades</h3>
            {
              <ul>
                {availablePersonal.length ? (
                  availablePersonal.map((agent) => (
                    <li key={agent.id} className={c({ active: activeAgents.find(a => a.id === agent.id) })}
                    style={{display: 'flex', justifyContent: 'space-between'}}>
                      <button onClick={() => toggleActive(agent)} style={{textAlign:'left'}}>
                      {activeAgents.find(a => a.id === agent.id) ? '✅' : '⬜️'} {agent.name}
                      </button>
                      <button onClick={() => handleEdit(agent.id)} className="icon" style={{width: 'auto'}}>edit</button>
                    </li>
                  ))
                ) : (
                  <p style={{padding: '10px'}}>None yet.</p>
                )}
              </ul>
            }
            <button
              className="newRoomButton"
              onClick={() => {
                addNewComrade();
              }}
            >
              <span className="icon">add</span>New Comrade
            </button>
          </div>
        </div>
      </div>
      
      <button
        className="userSettingsButton"
        onClick={() => setShowUserConfig(!showUserConfig)}
        style={{color: 'white', background: '#333', borderRadius: '50%', width: '40px', height: '40px', justifyContent: 'center'}}
      >
        <span className="icon">tune</span>
      </button>
    </header>
  );
}
