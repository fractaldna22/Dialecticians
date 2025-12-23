/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Content,
  GoogleGenAI,
  LiveCallbacks,
  LiveClientToolResponse,
  LiveConnectConfig,
  LiveServerContent,
  LiveServerMessage,
  LiveServerToolCall,
  LiveServerToolCallCancellation,
  Part,
  Session,
  LiveClientSetup,
  ActivityEnd,
  ActivityStart,
  ActivityHandling
} from '@google/genai';


// --- INTERNAL HELPERS ---
// integrate the provided ActivityHandling interface, ActivityStart and ActivityEnd types provided by genai
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

type Listener = (...args: any[]) => void;

class EventEmitter<T extends Record<string, Listener>> {
  private listeners: { [K in keyof T]?: T[K][] } = {};

  on<K extends keyof T>(event: K, listener: T[K]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]?.push(listener);
  }

  off<K extends keyof T>(event: K, listener: T[K]): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event]?.filter((l) => l !== listener);
  }

  emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): void {
    this.listeners[event]?.forEach((listener) => listener(...args));
  }

  removeAllListeners(event?: keyof T): void {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
  }
}

// --- CLIENT IMPLEMENTATION ---

export interface StreamingLog {
  count?: number;
  data?: unknown;
  date: Date;
  message: string | object;
  type: string;
}


export interface LiveClientEventTypes {
  audio: (data: ArrayBuffer) => void;
  close: (event: CloseEvent) => void;
  content: (data: LiveServerContent) => void;
  error: (e: ErrorEvent) => void;
  log: (log: StreamingLog) => void;
  open: () => void;
  setupcomplete: () => void;
  toolcall: (toolCall: LiveServerToolCall) => void;
  toolcallcancellation: (toolcallCancellation: LiveServerToolCallCancellation) => void;
  turncomplete: () => void;
  transcription: (text: string) => void;
  [key: string]: (...args: any[]) => void;
}

type RealtimeInputParams = Parameters<Session['sendRealtimeInput']>[0];

export class GenAILiveClient extends EventEmitter<LiveClientEventTypes> {
  public model: string = 'models/gemini-2.5-flash-native-audio-preview-09-2025';
  public lastOutputAudioMimeType: string = 'audio/pcm;rate=24000';
  protected client: GoogleGenAI;
  protected session?: Session;

  private _status: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
  public get status() {
    return this._status;
  }

  constructor(apiKey: string, model?: string) {
    super();
    if (model) this.model = model;

    this.client = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: { apiVersion: 'v1alpha' },
    });
  }

  public async connect(config: LiveConnectConfig): Promise<boolean> {
    if (this._status === 'connected' || this._status === 'connecting') {
      return false;
    }

    this._status = 'connecting';

    const callbacks: LiveCallbacks = {
      //@ts-ignore
      onopen: this.onOpen.bind(this),
      //@ts-ignore
      onmessage: this.onMessage.bind(this),
      //@ts-ignore
      onerror: this.onError.bind(this),
      //@ts-ignore
      onclose: this.onClose.bind(this)
    };

    try {
      this.session = await this.client.live.connect({
        model: this.model,
        config: { ...config },
        callbacks,
      });
    } catch (e) {
      console.error('Error connecting to GenAI Live:', e);
      this._status = 'disconnected';
      this.session = undefined;
      return false;
    }

    this._status = 'connected';
    return true;
  }

  public disconnect() {
    if (this.session) {
      try {
        this.session.close();
      } catch (e) {
        console.warn('Error closing session', e);
      }
    }
    this.session = undefined;
    this._status = 'disconnected';

    console.log('client.close', `Disconnected`);
    return true;
  }

  public send(parts: Part | Part[], turnComplete: boolean = true) {
    if (this._status !== 'connected' || !this.session) {
      this.emit('error', new ErrorEvent('Client is not connected'));
      return;
    }
    const partsArray = Array.isArray(parts) ? parts : [parts];
    const content: Content = { role: 'user', parts: partsArray };

    try {
      this.session.sendClientContent({ turns: [content], turnComplete });
      console.log(`client.send`, { partsCount: partsArray.length, turnComplete });
    } catch (e) {
      console.error('Failed to send client content', e);
      this.emit('error', new ErrorEvent('Failed to send content'));
    }
  }

  public async sendRealtimeInput(params: RealtimeInputParams): Promise<void> {
    if (this._status !== 'connected' || !this.session) {
      this.emit('error', new ErrorEvent('Client is not connected'));
      return;
    }

    try {

      this.session.sendRealtimeInput(params);

      // Don't log full audio data, it spans the console
      // const logParams = params.audio ? { ...params, audio: '(binary)' } : params;
      // console.log(`client.realtimeInput`, logParams);
    } catch (e) {
      console.error('Failed to send realtime input', e);
      this.emit('error', new ErrorEvent('Failed to send realtime input'));
    }
  }

  public async sendAudioStreamEnd(): Promise<void> {
    if (this._status !== 'connected' || !this.session) return;
    try {
      this.session.sendRealtimeInput({ activityEnd: {} });

      this.log(`client.realtimeInput`, { activityEnd: {} });
    } catch (e) {
      console.warn('Failed to send audio stream end', e);
    }
  }

  public sendToolResponse(toolResponse: LiveClientToolResponse) {
    if (this._status !== 'connected' || !this.session) {
      this.emit('error', new ErrorEvent('Client is not connected'));
      return;
    }

    try {
      if (toolResponse.functionResponses && toolResponse.functionResponses.length) {
        this.session.sendToolResponse({
          functionResponses: toolResponse.functionResponses!,
        });
      }
      this.log(`client.toolResponse`, { toolResponse });
    } catch (e) {
      console.error('Failed to send tool response', e);
    }
  }

  protected onMessage(message: LiveServerMessage) {
    if (message.setupComplete) {
      this.emit('setupcomplete');
      return;
    }
    if (message.toolCall) {
      this.log('server.toolCall', message);
      this.emit('toolcall', message.toolCall);
      return;
    }
    if (message.toolCallCancellation) {
      this.log('receive.toolCallCancellation', message);
      this.emit('toolcallcancellation', message.toolCallCancellation);
      return;
    }

    if (message.serverContent) {
      const { serverContent } = message;

      // @ts-ignore
      if (serverContent.outputTranscription && serverContent.outputTranscription.text) {
        // @ts-ignore
        this.emit('transcription', serverContent.outputTranscription.text);
      }

      // @ts-ignore
      if (serverContent.inputAudioTranscription && serverContent.inputAudioTranscription.text) {
        // @ts-ignore
        this.emit('transcription', `[USER]${serverContent.inputAudioTranscription.text}`);
      }

      if ('interrupted' in serverContent && serverContent.interrupted) {
        this.log('receive.serverContent', 'interrupted');
        this.emit('interrupted');
        return;
      }

      if ('turnComplete' in serverContent && serverContent.turnComplete) {
        this.log('server.send', 'turnComplete');
        this.emit('turncomplete');
      }

      if (serverContent.modelTurn) {
        const parts: Part[] = serverContent.modelTurn.parts || [];
        const audioParts = parts.filter((p) => p.inlineData?.mimeType?.startsWith('audio/pcm'));

        if (audioParts.length > 0 && audioParts[0].inlineData?.mimeType) {
          this.lastOutputAudioMimeType = audioParts[0].inlineData.mimeType;
        }

        const base64s = audioParts.map((p) => p.inlineData?.data);

        base64s.forEach((b64) => {
          if (b64) {
            const data = base64ToArrayBuffer(b64);
            this.emit('audio', data);
            this.log(`server.audio`, `buffer (${data.byteLength})`);
          }
        });

        const otherParts = parts.filter((p) => !audioParts.includes(p));
        if (otherParts.length > 0) {
          const content: LiveServerContent = { modelTurn: { parts: otherParts } };
          this.emit('content', content);
          this.log(`server.content`, message);
        }
      }
    }
  }

  protected onError(e: ErrorEvent) {
    this._status = 'disconnected';
    const errorDetails = {
      message: e.message || 'Unknown WebSocket Error',
      // @ts-ignore
      details: e.error || 'No additional details',
      timeStamp: e.timeStamp,
    };
    console.error('GenAI Client Error Details:', errorDetails);
    console.error(`server.${e.type}`, `GenAI Live Error: ${errorDetails.message}`);
    this.emit('error', e);
  }

  protected onOpen() {
    this._status = 'connected';
    this.emit('open');
  }

  protected onClose(e: CloseEvent) {
    this._status = 'disconnected';
    const reason = e.reason ? `with reason: ${e.reason}` : '';
    this.log(`server.${e.type}`, `disconnected ${reason}`);
    this.emit('close', e);
  }

  protected log(type: string, message: string | object) {
    this.emit('log', {
      type,
      message,
      date: new Date(),
    });
  }
}