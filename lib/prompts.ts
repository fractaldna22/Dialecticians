/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { Agent } from './presets/agents';
import { User } from './state';

export const createSystemInstructions = (agent: Agent, user: User) =>
    {`
  ${agent.personality}\n\nToday's date is ${new Intl.DateTimeFormat(navigator.languages[0], {
      dateStyle: 'full',
    }).format(new Date())} at ${new Date()
      .toLocaleTimeString()
      .replace(/:\d\d /, ' ')}\n\`
  `}
