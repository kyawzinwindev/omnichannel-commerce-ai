import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGroq } from '@langchain/groq';
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private model: ChatGroq;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('groq.apiKey');
    const modelName = this.configService.get<string>('groq.model', 'llama-3.1-8b-instant');

    this.model = new ChatGroq({
      apiKey: apiKey || 'mock_key',
      model: modelName,
      temperature: 0.2,
    });
  }

  getModel(): ChatGroq {
    return this.model;
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
      const response = await this.model.invoke(formattedMessages);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error(`Groq LLM invocation failed: ${error.message}`);
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

    return await this.model.stream(formattedMessages);
  }
}
