import { ChatStage, UserSessionState } from '../redis/session-state';
import { IntentType } from './intent.service';
import { OrderSummaryResult, ProductItem } from '../products/interfaces/store-provider.interface';

export interface PromptContextParams {
  intent: IntentType;
  session: UserSessionState;
  products?: ProductItem[];
  orderSummary?: OrderSummaryResult | null;
  searchQuery?: string | null;
  /** Last meaningful intent before this turn (what the bot was doing). */
  lastAction?: string | null;
  /** Product the customer was last exploring. */
  lastViewedProduct?: { id?: string; name: string } | null;
  /** Last assistant reply, truncated. */
  lastBotMessage?: string | null;
}

function buildSteeringBlock(params: PromptContextParams): string {
  const { session, lastAction, lastViewedProduct, lastBotMessage } = params;
  const { stage, cart, draftOrder } = session;
  const product = lastViewedProduct?.name || cart[cart.length - 1]?.name || null;

  const context = [
    `- Current stage: ${stage}`,
    `- Last action: ${lastAction || 'none'}`,
    `- Product being explored: ${product || 'none'}`,
    lastBotMessage ? `- Your previous message: "${lastBotMessage}"` : null,
  ]
    .filter(Boolean)
    .join('\n');

  let stageRule: string;
  if (stage === ChatStage.CONFIRMING_ORDER) {
    stageRule = `Order confirmation is pending. After your short acknowledgement, ask whether they want to proceed with the order confirmation or make changes.`;
  } else if (stage === ChatStage.COLLECTING_USER_INFO) {
    const missing: string[] = [];
    if (!draftOrder.name) missing.push('Full Name');
    if (!draftOrder.phone) missing.push('Phone Number');
    if (!draftOrder.address) missing.push('Shipping Address');
    stageRule = `Checkout details are incomplete. After your short acknowledgement, state clearly which specific field is still missing: ${missing.join(', ') || 'none'}.`;
  } else if (lastAction === IntentType.ADD_TO_CART || (cart.length > 0 && !product)) {
    stageRule = `The customer picked an item${product ? ` ("${product}")` : ''}. Keep it in mind, acknowledge their message, then ask how many they want (e.g. "ဒါနဲ့ ${product || '[Product Name]'} လေးကို အိတ်ထဲထည့်ဖို့ အရေအတွက် ဘယ်နှစ်ထည် ယူမလဲခင်ဗျာ (ဥပမာ- ၁ ထည်၊ ၂ ထည်)?").`;
  } else if (
    product &&
    (lastAction === IntentType.QUERY_PRODUCT ||
      lastAction === IntentType.GENERAL_CATALOG_QUERY ||
      lastAction === IntentType.CHIT_CHAT ||
      !lastAction)
  ) {
    stageRule = `The customer was browsing "${product}". Do NOT reset the product search. React warmly in one short phrase, then bridge back to that product (offer size, colour or more options), e.g. "ဟုတ်ပါတယ်ခင်ဗျာ။ စောစောက ကြည့်နေတဲ့ ${product} အတွက် အရွယ်အစား (Size) နဲ့ အရောင်လေးတွေ ထပ်ပြပေးရမလားခင်ဗျာ။"
If the message is a totally empty fragment ("ဟိုလေ", "အင်း"), gently ask: "ဟုတ်ကဲ့ခင်ဗျာ၊ ဘယ်လိုအထည်မျိုးလေး စိတ်ဝင်စားပါသလဲ၊ ${product} ဒါမှမဟုတ် တခြား brand တွေထဲက ရှာပေးရမလားခင်ဗျာ။"`;
  } else {
    stageRule = `No active product context. React in one short phrase, then ask what kind of product they are interested in, or offer to show the catalog.`;
  }

  return `\n\nCONVERSATION STEERING (the customer sent a fragment, filler, banter or off-topic remark):
${context}

RULES:
1. Acknowledge the customer's message or personality in ONE short, warm phrase. Never lecture or ignore it.
2. ALWAYS end by re-anchoring to the current goal below. Never leave the customer without a next step.
3. Do NOT reset, forget or restart the current context (stage, cart, product, draft order). Do NOT invent products.
4. Keep it to 1-3 short sentences in natural, polite conversational tone (Burmese: ခင်ဗျာ/ရှင့် particles); never sound robotic.
5. ${stageRule}`;
}

export function buildStageAwareSystemPrompt(params: PromptContextParams): string {
  const { intent, session, products, orderSummary, searchQuery } = params;
  const { stage, cart, draftOrder } = session;
  const isDrift = intent === IntentType.CHIT_CHAT || intent === IntentType.UNKNOWN;
  const steering = isDrift ? buildSteeringBlock(params) : '';

  const languageInstruction = `\n\nLANGUAGE & TONE GUIDELINES:
- Detect the language of the customer's message and respond fluently in the matching language (Burmese, Thai, or English).
- English: Natural, friendly, and concise.
- Burmese (မြန်မာဘာသာ): Use natural, polite, and grammatically standard Burmese with polite particles (ခင်ဗျာ/ရှင့်).
- Thai (ภาษาไทย): Use natural, polite, and friendly Thai with proper polite particles (ค่ะ/ครับ).
- Retain exact product names, IDs, numbers, and prices while speaking in the customer's preferred language.`;

  const formatInstruction = `\n\nOUTPUT FORMAT (channel-agnostic, applies to Telegram, Viber and Messenger):
- Reply with ONE single message in plain text. No HTML, no tables, no headings, no bold/italic markers (**, __, #).
- For product lists use one line per item: "- Name - $Price (In Stock / Out of Stock)", with a blank line between sections.
- Never repeat the same list or information twice in a reply.
- When listing products, end with one short line telling the customer to reply with the product name and quantity to order.`;

  let prompt = `You are a helpful and efficient E-Commerce AI Assistant.
Current Chat Stage: ${stage}`;

  // 1. CONFIRMING_ORDER Stage
  if (stage === ChatStage.CONFIRMING_ORDER) {
    const cartSummary =
      cart.length > 0
        ? cart.map((c) => `- ${c.name} (Qty: ${c.quantity}) - $${(c.price * c.quantity).toFixed(2)}`).join('\n')
        : '- 1x Selected Store Item';
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    prompt += `\n\nORDER CONFIRMATION STAGE:
All customer details have been collected:
- Recipient Name: ${draftOrder.name || 'Provided'}
- Phone: ${draftOrder.phone || 'Provided'}
- Shipping Address: ${draftOrder.address || 'Provided'}

Order Items:
${cartSummary}
Total Amount: $${total.toFixed(2)}

INSTRUCTIONS:
1. Present the order summary concisely.
2. Ask for the customer's final confirmation to place the order (e.g. "Reply 'Yes' to confirm and place your order, or let me know if you would like to edit anything.").
3. Do NOT ask for name, phone, or address again as they are already provided.`;

    prompt += steering + formatInstruction + languageInstruction;
    return prompt;
  }

  // 2. COLLECTING_USER_INFO Stage
  if (stage === ChatStage.COLLECTING_USER_INFO) {
    const missing: string[] = [];
    if (!draftOrder.name) missing.push('Full Name');
    if (!draftOrder.phone) missing.push('Phone Number');
    if (!draftOrder.address) missing.push('Shipping Address');

    const provided: string[] = [];
    if (draftOrder.name) provided.push(`Name: ${draftOrder.name}`);
    if (draftOrder.phone) provided.push(`Phone: ${draftOrder.phone}`);
    if (draftOrder.address) provided.push(`Address: ${draftOrder.address}`);

    prompt += `\n\nCOLLECTING USER INFO STAGE:
${provided.length > 0 ? `Already collected: ${provided.join(', ')}` : 'No details collected yet.'}
Missing required fields: ${missing.length > 0 ? missing.join(', ') : 'None'}

INSTRUCTIONS:
1. Acknowledge any newly provided details briefly.
2. Ask ONLY for the missing fields (${missing.join(', ')}).
3. Keep the message extremely concise and clear. Do NOT generate long prose or unnecessary paragraphs.`;

    prompt += steering + formatInstruction + languageInstruction;
    return prompt;
  }

  // 3. IDLE Stage with Specific Intents
  switch (intent) {
    case IntentType.GENERAL_CATALOG_QUERY: {
      let catalogText = 'Our store offers a curated selection of premium gear, footwear, drinkware, and lifestyle items.';
      if (products && products.length > 0) {
        catalogText = products
          .map((p, i) => `${i + 1}. ${p.name} - $${p.price} (${p.inStock ? 'In Stock' : 'Out of Stock'})`)
          .join('\n');
      }

      prompt += `\n\nGENERAL CATALOG QUERY:
Available Products in Store:
${catalogText}

INSTRUCTIONS:
1. Briefly showcase the top available items with names and prices.
2. Invite the customer to let you know which item they are interested in.
3. Keep the reply friendly, welcoming, and concise.`;
      break;
    }

    case IntentType.QUERY_PRODUCT: {
      if (products && products.length > 0) {
        const productList = products
          .map(
            (p, idx) =>
              `${idx + 1}. Product: "${p.name}"\n   Price: $${p.price}\n   Stock: ${p.inStock ? 'In Stock' : 'Out of Stock'}\n   Description: ${p.description || 'N/A'}\n   Attributes: ${JSON.stringify(p.attributes || {})}`,
          )
          .join('\n\n');

        prompt += `\n\nRELEVANT PRODUCTS FOUND:
${productList}

INSTRUCTIONS:
1. Return item details (Name, Price, Stock Status).
2. Highlight key features in 1-2 friendly sentences.
3. Ask for the quantity in a single concise sentence (e.g. "How many would you like to add to your cart?").`;
      } else {
        prompt += `\n\nNO MATCHING PRODUCTS FOUND for query "${searchQuery || 'requested item'}".
INSTRUCTIONS:
1. Politely let the customer know we couldn't find an exact match in our catalog.
2. Offer to help them find a similar category or alternative item.`;
      }
      break;
    }

    case IntentType.CHECK_ORDER: {
      if (orderSummary) {
        const itemsList = (orderSummary.items || [])
          .map(
            (item, idx) =>
              `${idx + 1}. ${item.name} (Qty: ${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}`,
          )
          .join('\n');

        prompt += `\n\nORDER SUMMARY DETAILS FOR #${orderSummary.orderNumber}:
Status: ${orderSummary.status.toUpperCase()}
Customer Name: ${orderSummary.customerName || 'Valued Customer'}
Shipping Address: ${orderSummary.shippingAddress || 'N/A'}
Order Date: ${orderSummary.orderDate || 'Recent'}
Items:
${itemsList}
Total Amount: $${orderSummary.totalAmount.toFixed(2)}

INSTRUCTIONS:
1. Provide a reassuring and clear status update for order #${orderSummary.orderNumber}.
2. Confirm the order status (${orderSummary.status}), recipient name, address, and total amount.
3. Keep the response concise and friendly.`;
      } else {
        prompt += `\n\nNo order record was found for ID "${searchQuery || 'provided ID'}".
INSTRUCTIONS:
1. Politely ask the customer to double-check their order number or provide their purchase email.`;
      }
      break;
    }

    case IntentType.CANCEL_ORDER: {
      prompt += `\n\nORDER CANCELLED:
The current draft order process has been cancelled and reset.
INSTRUCTIONS:
1. Confirm politely that the order has been cancelled and the cart is reset.
2. Ask how else you can assist them today.`;
      break;
    }

    case IntentType.CONFIRM_ORDER: {
      if (orderSummary) {
        prompt += `\n\nORDER PLACED SUCCESSFULLY:
Order Number: #${orderSummary.orderNumber}
Total: $${orderSummary.totalAmount.toFixed(2)}
Customer: ${orderSummary.customerName}
Address: ${orderSummary.shippingAddress}

INSTRUCTIONS:
1. Thank the customer enthusiastically for their purchase!
2. Confirm their order has been placed with Order ID #${orderSummary.orderNumber}.
3. State that they will receive shipping updates shortly.`;
      } else {
        prompt += `\n\nORDER CONFIRMATION:
Acknowledge the order placement warmly and confirm order details.`;
      }
      break;
    }

    case IntentType.GREETING: {
      prompt += `\n\nCUSTOMER GREETING:
INSTRUCTIONS:
Respond warmly and introduce yourself as the AI store assistant. Ask how you can help them with products, recommendations, or orders in 1-2 short sentences.`;
      break;
    }

    case IntentType.CHIT_CHAT:
    case IntentType.UNKNOWN:
    default: {
      prompt += `\n\nGENERAL QUERY:
INSTRUCTIONS:
Respond politely, acknowledge their message, and let them know you can assist with product search, cart orders, and order status updates.`;
      prompt += steering || buildSteeringBlock(params);
      break;
    }
  }

  prompt += formatInstruction + languageInstruction;
  return prompt;
}
