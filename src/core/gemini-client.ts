/**
 * Gemini API client wrapper with retry logic and error handling
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { logger } from '../utils/logger.js';

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
}

export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private maxRetries: number;

  constructor(config: GeminiConfig) {
    if (!config.apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }

    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: config.model || 'gemini-3-pro-preview',
    });
    this.maxRetries = config.maxRetries || 3;
  }

  /**
   * Generate text with retry logic
   */
  async generateText(prompt: string, systemInstruction?: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`Gemini API call attempt ${attempt}/${this.maxRetries}`);

        // Prepend system instruction to prompt if provided
        const fullPrompt = systemInstruction
          ? `${systemInstruction}\n\n${prompt}`
          : prompt;

        const result = await this.model.generateContent(fullPrompt);

        const response = result.response;
        const text = response.text();

        if (!text) {
          throw new Error('Empty response from Gemini API');
        }

        return text;
      } catch (error) {
        lastError = error as Error;
        logger.debug(`Gemini API error on attempt ${attempt}`, error);

        // If it's a rate limit error, wait with exponential backoff
        if (error instanceof Error && error.message.includes('429')) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.warn(`Rate limited. Waiting ${waitTime / 1000}s before retry...`);
          await this.sleep(waitTime);
        } else if (attempt < this.maxRetries) {
          // For other errors, short wait before retry
          await this.sleep(1000);
        }
      }
    }

    throw new Error(
      `Failed to get response from Gemini after ${this.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Generate structured JSON response
   */
  async generateJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
    const text = await this.generateText(prompt, systemInstruction);

    try {
      // Try to extract JSON from code blocks if present
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/```\n?([\s\S]*?)\n?```/);

      const jsonText = jsonMatch ? jsonMatch[1] : text;
      return JSON.parse(jsonText) as T;
    } catch (error) {
      logger.error('Failed to parse JSON response from Gemini', error as Error);
      logger.debug('Raw response:', text);
      throw new Error('Invalid JSON response from Gemini API');
    }
  }

  /**
   * Generate text with streaming (for long responses)
   */
  async *generateTextStream(prompt: string): AsyncGenerator<string> {
    const result = await this.model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        yield chunkText;
      }
    }
  }

  /**
   * Count tokens in a text (useful for context management)
   */
  async countTokens(text: string): Promise<number> {
    try {
      const result = await this.model.countTokens(text);
      return result.totalTokens;
    } catch (error) {
      logger.warn('Failed to count tokens, returning estimate');
      // Rough estimate: ~4 characters per token
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a Gemini client from environment variables
 */
export function createGeminiClient(): GeminiClient {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY environment variable is required. Get your API key from https://aistudio.google.com/app/apikey'
    );
  }

  return new GeminiClient({
    apiKey,
    model: process.env.GEMINI_MODEL || 'gemini-3-pro-preview',
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  });
}
