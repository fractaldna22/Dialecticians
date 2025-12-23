/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { create } from 'zustand';
import { Part, PartListUnion } from '@google/genai';
import { Agent, Lenin, Stalin, Trotsky, Kautsky, Hegel, Marx, Rosa, Engels, Mao, Zizek } from './presets/agents';

/**
 * User
 */
export type User = {
  name?: string;
  info?: string;
  customApiKey?: string;
  temperature: number;
  topP: number;
  speechTimeLimit: number;
};

export const useUser = create<
  {
    setName: (name: string) => void;
    setInfo: (info: string) => void;
    setCustomApiKey: (key: string) => void;
    setTemperature: (val: number) => void;
    setTopP: (val: number) => void;
    setSpeechTimeLimit: (val: number) => void;
  } & User
>(set => ({
  name: 'User',
  info: '',
  customApiKey: '',
  temperature: 1.5,
  topP: 0.95,
  speechTimeLimit: 240, // Increased to 60s to prevent mid-sentence cutoffs
  setName: name => set({ name }),
  setInfo: info => set({ info }),
  setCustomApiKey: key => set({ customApiKey: key }),
  setTemperature: val => set({ temperature: val }),
  setTopP: val => set({ topP: val }),
  setSpeechTimeLimit: val => set({ speechTimeLimit: val }),
}));

/**
 * Agents
 */
function getAgentById(id: string) {
  const { availablePersonal, availablePresets } = useAgent.getState();
  return (
    availablePersonal.find(agent => agent.id === id) ||
    availablePresets.find(agent => agent.id === id)
  );
}

export const useAgent = create<{
  current: Agent; // Selected for editing
  activeAgents: Agent[]; // The ones in the debate
  availablePresets: Agent[];
  availablePersonal: Agent[];
  setCurrent: (agent: Agent | string) => void;
  toggleActive: (agent: Agent) => void;
  addAgent: (agent: Agent) => void;
  update: (agentId: string, adjustments: Partial<Agent>) => void;
}>(set => ({
  current: Lenin,
  activeAgents: [Lenin, Stalin, Rosa, Zizek, Marx, Mao],
  availablePresets: [Lenin, Stalin, Trotsky, Kautsky, Hegel, Marx, Rosa, Engels, Mao, Zizek],
  availablePersonal: [],

  addAgent: (agent: Agent) => {
    set(state => ({
      availablePersonal: [...state.availablePersonal, agent],
      activeAgents: [...state.activeAgents, agent],
      current: agent,
    }));
  },
  toggleActive: (agent: Agent) => {
    set(state => {
      const isActive = state.activeAgents.find(a => a.id === agent.id);
      if (isActive) {
        return { activeAgents: state.activeAgents.filter(a => a.id !== agent.id) };
      }
      return { activeAgents: [...state.activeAgents, agent] };
    });
  },
  setCurrent: (agent: Agent | string) =>
    set({ current: typeof agent === 'string' ? getAgentById(agent) : agent }),
  update: (agentId: string, adjustments: Partial<Agent>) => {
    let agent = getAgentById(agentId);
    if (!agent) return;
    const updatedAgent = { ...agent, ...adjustments };
    set(state => ({
      availablePresets: state.availablePresets.map(a =>
        a.id === agentId ? updatedAgent : a
      ),
      availablePersonal: state.availablePersonal.map(a =>
        a.id === agentId ? updatedAgent : a
      ),
      activeAgents: state.activeAgents.map(a =>
        a.id === agentId ? updatedAgent : a
      ),
      current: state.current.id === agentId ? updatedAgent : state.current,
    }));
  },
}));

/**
 * UI
 */

export type TranscriptItem = {
  id: number;
  speaker: string;
  text: string;
  isUser?: boolean;
};

export type AudioHistoryItem = {
  mimeType: string;
  data: string; // Base64
}

export let useUI = create<{
  showUserConfig: boolean;
  setShowUserConfig: (show: boolean) => void;
  showAgentEdit: boolean;
  setShowAgentEdit: (show: boolean) => void;
  isDebating: boolean;
  setDebating: (isDebating: boolean) => void;
  isChaosMode: boolean;
  setChaosMode: (isChaosMode: boolean) => void;
  allowSelfReply: boolean;
  setAllowSelfReply: (allow: boolean) => void;
  transcript: TranscriptItem[];
  addToTranscript: (speaker: string, text: string, isUser?: boolean) => void;
  clearTranscript: () => void;
  conversationResetId: number; // Signal to force reset backend sessions
  lastUserInteraction: number;
  triggerUserInteraction: () => void;
  debateTopic: string;
  setDebateTopic: (topic: string) => void;
  userMessage: string | null;
  setUserMessage: (msg: string | null) => void;
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;

  // Audio Context (Sliding Window)
  audioHistory: AudioHistoryItem[];
  addAudioToHistory: (item: AudioHistoryItem) => void;
  clearAudioHistory: () => void;

  nextSpeakerId: string | null;
  setNextSpeakerId: (id: string | null) => void;
  suggestedNextSpeakers: string[];
  setSuggestedNextSpeakers: (ids: string[]) => void;
  forceEndTurn: boolean;
  setForceEndTurn: (force: boolean) => void;
  debateSummary: string;
  setDebateSummary: (summary: string) => void;
  isUserParticipating: boolean;
  setUserParticipating: (participating: boolean) => void;

  // New State for Manual User Turn
  isWaitingForUser: boolean;
  setIsWaitingForUser: (waiting: boolean) => void;

  disableAudioAccumulation: boolean;
  setDisableAudioAccumulation: (val: boolean) => void;

  prevTopic: string | null;
  setPrevTopic: (topic: string | null) => void;

  allSummaries: string[];
  addSummary: (summary: string) => void;
  setAllSummaries: (summaries: string[]) => void;

  disableSummaries: boolean;
  setDisableSummaries: (val: boolean) => void;
}>(set => ({
  showUserConfig: false,
  setShowUserConfig: (show: boolean) => set({ showUserConfig: show }),

  showAgentEdit: false,
  setShowAgentEdit: (show: boolean) => set({ showAgentEdit: show }),

  isDebating: false,
  setDebating: (isDebating: boolean) => set({ isDebating }),

  isChaosMode: false,
  setChaosMode: (isChaosMode: boolean) => set({ isChaosMode }),

  allowSelfReply: false,
  setAllowSelfReply: (allow) => set({ allowSelfReply: allow }),

  transcript: [],
  addToTranscript: (speaker, text, isUser = false) => set(state => {
    const newItem = { id: state.transcript.length + 1, speaker, text, isUser };
    return { transcript: [...state.transcript, newItem] };
  }),

  conversationResetId: 0,
  clearTranscript: () => set(state => ({
    transcript: [],
    debateSummary: "",
    audioHistory: [],
    conversationResetId: state.conversationResetId + 1,
    suggestedNextSpeakers: [],
    isWaitingForUser: false,
    userMessage: null,
    nextSpeakerId: null,
    isDebating: false, // STOP THE DEBATE
    isUserParticipating: false, // Reset user participation
    prevTopic: null,
    allSummaries: [],
    forceEndTurn: true, // NEW: Force end current turn immediately
  })),

  lastUserInteraction: 0,
  triggerUserInteraction: () => set({ lastUserInteraction: Date.now() }),

  debateTopic: "The Future of the Revolution",
  setDebateTopic: (topic: string) => set({ debateTopic: topic }),

  userMessage: null,
  setUserMessage: (msg) => set({ userMessage: msg }),

  systemPrompt: ` `,
  setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),

  audioHistory: [],
  addAudioToHistory: (item) => set(state => {
    // Keep last 4 audio turns for context window
    const newHistory = [...state.audioHistory, item];
    if (newHistory.length > 2) newHistory.shift();
    return { audioHistory: newHistory };
  }),

  clearAudioHistory: () => set({ audioHistory: [] }),

  nextSpeakerId: null,
  setNextSpeakerId: (id) => set({ nextSpeakerId: id }),

  suggestedNextSpeakers: [],
  setSuggestedNextSpeakers: (ids) => set({ suggestedNextSpeakers: ids }),

  forceEndTurn: false,
  setForceEndTurn: (force) => set({ forceEndTurn: force }),

  debateSummary: "",
  setDebateSummary: (summary) => set({ debateSummary: summary }),

  isUserParticipating: false,
  setUserParticipating: (participating) => set({ isUserParticipating: participating }),

  isWaitingForUser: false,
  setIsWaitingForUser: (waiting) => set({ isWaitingForUser: waiting }),

  disableAudioAccumulation: true,
  setDisableAudioAccumulation: (val) => set({ disableAudioAccumulation: val }),

  prevTopic: null,
  setPrevTopic: (topic) => set({ prevTopic: topic }),

  allSummaries: [],
  addSummary: (summary) => set(state => ({ allSummaries: [...state.allSummaries, summary] })),
  setAllSummaries: (summaries) => set({ allSummaries: summaries }),

  disableSummaries: false,
  setDisableSummaries: (val) => set({ disableSummaries: val }),
}));