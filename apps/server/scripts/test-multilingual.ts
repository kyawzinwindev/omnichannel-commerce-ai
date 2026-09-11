import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/ai/chat.service';

async function testMultilingual() {
  console.log('\n===============================================================');
  console.log('  COMMERCE AI CHATBOT - MULTILINGUAL TONE & DIALECT TESTS');
  console.log('===============================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const chatService = app.get(ChatService);
  const tenantId = 'multilingual-test-tenant';

  console.log('▶ [1] Testing Burmese (မြန်မာဘာသာ)');
  console.log('  User: "မင်္ဂလာပါ ဖိနပ်တွေရှာချင်လို့ပါ"');
  const resBurmese = await chatService.processMessage(tenantId, 'မင်္ဂလာပါ ဖိနပ်တွေရှာချင်လို့ပါ');
  console.log(`  AI Reply: "${resBurmese.reply}"\n`);

  console.log('▶ [2] Testing Thai (ภาษาไทย)');
  console.log('  User: "สวัสดีครับ มีรองเท้าวิ่งไหมครับ"');
  const resThai = await chatService.processMessage(tenantId, 'สวัสดีครับ มีรองเท้าวิ่งไหมครับ');
  console.log(`  AI Reply: "${resThai.reply}"\n`);

  console.log('▶ [3] Testing English');
  console.log('  User: "Hello, do you have running shoes?"');
  const resEnglish = await chatService.processMessage(tenantId, 'Hello, do you have running shoes?');
  console.log(`  AI Reply: "${resEnglish.reply}"\n`);

  console.log('===============================================================');
  console.log('  MULTILINGUAL TESTS EXECUTED SUCCESSFULLY');
  console.log('===============================================================\n');

  await app.close();
  process.exit(0);
}

testMultilingual().catch((err) => {
  console.error('Multilingual test error:', err);
  process.exit(1);
});
