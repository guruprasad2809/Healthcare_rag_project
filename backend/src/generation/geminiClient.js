// Gemini LLM client (Google Gen AI SDK). The model ID comes from GEMINI_MODEL, so
// moving to a newer Gemini model is a one-line change in .env.
import { createLogger } from '../utils/logger.js';

const log = createLogger('gemini');

export class GeminiClient {
  /** @param {{apiKey: string, model: string, temperature: number, maxOutputTokens: number}} options */
  constructor(options, { client } = {}) {
    this.options = options;
    this.client = client || null;
  }

  get configured() {
    return Boolean(this.client || this.options.apiKey);
  }

  async getClient() {
    if (this.client) return this.client;
    if (!this.options.apiKey) {
      const error = new Error('GEMINI_API_KEY is not set. Add it to your .env file to generate answers.');
      error.status = 503;
      throw error;
    }
    const { GoogleGenAI } = await import('@google/genai');
    this.client = new GoogleGenAI({ apiKey: this.options.apiKey });
    return this.client;
  }

  /** @returns {Promise<string>} the model's answer text */
  async generate({ systemInstruction, prompt }) {
    const client = await this.getClient();
    try {
      const response = await client.models.generateContent({
        model: this.options.model,
        contents: prompt,
        config: {
          systemInstruction,
          temperature: this.options.temperature,
          maxOutputTokens: this.options.maxOutputTokens,
        },
      });
      return (response.text || '').trim();
    } catch (cause) {
      log.error(`Gemini request failed (model ${this.options.model}): ${cause.message}`);
      const error = new Error(`The Gemini request failed for model "${this.options.model}": ${cause.message}`);
      error.status = 502;
      throw error;
    }
  }
}
