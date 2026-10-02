import OpenAI from 'openai';

// The AI features are optional per deployment: without OPENAI_API_KEY NOVA
// still runs and signs people in, and the AI routes answer 503 (see
// app.js's requireAi) instead of the whole app failing to start.
export function aiEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Created on first use, so importing this never needs the key.
let client = null;
export const openai = new Proxy(
  {},
  {
    get(_target, property) {
      if (!aiEnabled()) throw new Error('OPENAI_API_KEY is not set.');
      client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return client[property];
    },
  },
);
