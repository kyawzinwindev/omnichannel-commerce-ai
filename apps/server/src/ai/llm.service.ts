import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGroq } from '@langchain/groq';
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

export const GROQ_INTENT_MODEL = 'openai/gpt-oss-20b';
export const GROQ_RESPONSE_MODEL = 'openai/gpt-oss-120b';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly intentModel: ReturnType<ChatGroq['bind']>;
  private readonly responseModel: ChatGroq;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('groq.apiKey') || process.env.GROQ_API_KEY;

    if (!apiKey) {
      this.logger.warn('GROQ_API_KEY is not set; LLM calls will fail.');
    }

    this.logger.log(
      `Initializing Groq LLM Service: Intent [${GROQ_INTENT_MODEL}], Response [${GROQ_RESPONSE_MODEL}]`,
    );

    // Intent classification: deterministic, strict JSON output (Groq JSON mode).
    this.intentModel = new ChatGroq({
      apiKey: apiKey || 'missing_groq_key',
      model: GROQ_INTENT_MODEL,
      temperature: 0.1,
      maxTokens: 300,
      maxRetries: 1,
    }).bind({ response_format: { type: 'json_object' } });

    // Customer-facing conversational replies.
    this.responseModel = new ChatGroq({
      apiKey: apiKey || 'missing_groq_key',
      model: GROQ_RESPONSE_MODEL,
      temperature: 0.3,
      maxTokens: 500,
      maxRetries: 1,
    });
  }

  getIntentModel() {
    return this.intentModel;
  }

  getResponseModel(): ChatGroq {
    return this.responseModel;
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
      const response = await this.responseModel.invoke(formattedMessages);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error(`Groq LLM invocation failed: ${error.message}`);
      throw error;
    }
  }
}
