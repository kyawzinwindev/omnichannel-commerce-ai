import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatGroq } from '@langchain/groq';
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { Runnable } from '@langchain/core/runnables';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private primaryModel: ChatGoogleGenerativeAI;
  private fallbackModel: ChatGroq;
  private modelWithFallback: Runnable;

  constructor(private readonly configService: ConfigService) {
    const googleApiKey =
      this.configService.get<string>('google.apiKey') ||
      this.configService.get<string>('GOOGLE_API_KEY') ||
      process.env.GOOGLE_API_KEY ||
      'mock_google_key';
    const geminiModelName =
      this.configService.get<string>('google.model') ||
      this.configService.get<string>('GEMINI_MODEL') ||
      'gemini-2.5-flash';

    const groqApiKey =
      this.configService.get<string>('groq.apiKey') ||
      this.configService.get<string>('GROQ_API_KEY') ||
      process.env.GROQ_API_KEY ||
      'mock_groq_key';
    const groqModelName =
      this.configService.get<string>('groq.model') ||
      this.configService.get<string>('GROQ_MODEL') ||
      'openai/gpt-oss-20b';

    this.logger.log(
      `Initializing LLM Service: Primary [Google ${geminiModelName}], Fallback [Groq ${groqModelName}]`,
    );

    this.primaryModel = new ChatGoogleGenerativeAI({
      apiKey: googleApiKey,
      model: geminiModelName,
      temperature: 0.3,
      maxOutputTokens: 500,
      maxRetries: 0,
    });

    this.fallbackModel = new ChatGroq({
      apiKey: groqApiKey,
      model: groqModelName,
      temperature: 0.3,
      maxTokens: 500,
      maxRetries: 0,
    });

    const fallbacks = [this.fallbackModel];

    this.modelWithFallback = this.primaryModel.withFallbacks({
      fallbacks,
    });
  }

  getModel(): Runnable {
    return this.modelWithFallback;
  }

  getPrimaryModel(): ChatGoogleGenerativeAI {
    return this.primaryModel;
  }

  getFallbackModel(): ChatGroq {
    return this.fallbackModel;
  }

  async generateResponse(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    const formattedMessages: BaseMessage[] = messages.map((msg) => {
      switch (msg.role) {
        case 'system':
          return new SystemMessage(msg.content);
        case 'user':
          return new HumanMessage(msg.content);
        case 'assistant':
          return new AIMessage(msg.content);
      }
    });

    try {
      const response: any = await this.modelWithFallback.invoke(formattedMessages);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error(`LLM invocation failed across primary and fallback: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stream response for real-time widget interactions
   */
  async streamResponse(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ) {
    const formattedMessages: BaseMessage[] = messages.map((msg) => {
      switch (msg.role) {
        case 'system':
          return new SystemMessage(msg.content);
        case 'user':
          return new HumanMessage(msg.content);
        case 'assistant':
          return new AIMessage(msg.content);
      }
    });

    return await this.modelWithFallback.stream(formattedMessages);
  }
}
