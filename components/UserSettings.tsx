
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import Modal from './Modal';
import { useUI, useUser } from '../lib/state';

export default function UserSettings() {
  const { 
    name, info, setName, setInfo,
    customApiKey, setCustomApiKey,
    temperature, setTemperature,
    topP, setTopP,
    speechTimeLimit, setSpeechTimeLimit
  } = useUser();
  const { setShowUserConfig } = useUI();

  function updateClient() {
    setShowUserConfig(false);
  }

  return (
    <Modal onClose={() => setShowUserConfig(false)}>
      <div className="userSettings">
        <p>
          This is a simple tool that allows you to design, test, and banter with
          custom AI characters on the fly.
        </p>

        <form
          onSubmit={e => {
            e.preventDefault();
            setShowUserConfig(false);
            updateClient();
          }}
        >
          <p>Settings:</p>

          <div>
            <p>Your name</p>
            <input
              type="text"
              name="name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="What do you like to be called?"
            />
          </div>

          <div>
            <p>Your info</p>
            <textarea
              rows={3}
              name="info"
              value={info}
              onChange={e => setInfo(e.target.value)}
              placeholder="Things we should know about you… Likes, dislikes, hobbies, interests, favorite movies, books, tv shows, foods, etc."
            />
          </div>
          
          <hr style={{borderColor: '#444'}}/>

          <div>
            <p>Google API Key (Optional)</p>
            <input
              type="password"
              name="customApiKey"
              value={customApiKey || ''}
              onChange={e => setCustomApiKey(e.target.value)}
              placeholder="Enter key to override default..."
              style={{fontSize: '14px', fontFamily: 'monospace'}}
            />
          </div>

          <div style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
             <div className="checkbox">
                <div style={{flex: 1}}>
                    <p style={{fontSize: '14px', marginBottom: '5px'}}>Temperature: {temperature}</p>
                    <input 
                        type="range" 
                        min="0" 
                        max="2" 
                        step="0.01" 
                        value={temperature} 
                        onChange={e => setTemperature(parseFloat(e.target.value))} 
                        style={{width: '100%'}}
                    />
                </div>
             </div>
             
             <div className="checkbox">
                <div style={{flex: 1}}>
                    <p style={{fontSize: '14px', marginBottom: '5px'}}>Top P: {topP}</p>
                    <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.01" 
                        value={topP} 
                        onChange={e => setTopP(parseFloat(e.target.value))} 
                        style={{width: '100%'}}
                    />
                </div>
             </div>

             <div className="checkbox">
                <div style={{flex: 1}}>
                    <p style={{fontSize: '14px', marginBottom: '5px'}}>Max Speech Time: {speechTimeLimit > 0 ? `${speechTimeLimit}s` : 'Unlimited'}</p>
                    <input 
                        type="range" 
                        min="5" 
                        max="999" 
                        step="5" 
                        value={speechTimeLimit} 
                        onChange={e => setSpeechTimeLimit(parseInt(e.target.value))} 
                        style={{width: '100%'}}
                    />
                    <p style={{fontSize: '10px', color: '#666', marginTop: '2px'}}>Cuts off audio after this duration.</p>
                </div>
             </div>
          </div>

          <button className="button primary">Let’s go!</button>
        </form>
      </div>
    </Modal>
  );
}
