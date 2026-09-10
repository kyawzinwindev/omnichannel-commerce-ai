import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IntentService } from './intent.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const intentService = app.get(IntentService);

  // Use CLI arguments if provided, otherwise run test suite
  const userArgs = process.argv.slice(2).join(' ').trim();

  const testInputs = userArgs
    ? [userArgs]
    : [
        'Hi, good morning!',
        'Can you show me your running shoes in blue?',
        'Where is my order #ORD-98234?',
        'Please add this white shirt to my shopping cart',
        'What is the meaning of life?',
      ];

  console.log('\n=============================================');
  console.log('  COMMERCE AI INTENT RECOGNITION ENGINE TEST');
  console.log('=============================================\n');

  for (const input of testInputs) {
    console.log(`Input: "${input}"`);
    const result = await intentService.classifyIntent(input);
    console.log('Classified Output:');
    console.log(JSON.stringify(result, null, 2));
    console.log('---------------------------------------------');
  }

  await app.close();
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
