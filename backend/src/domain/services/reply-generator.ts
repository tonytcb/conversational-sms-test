// stub responder — swap for an LLM / rules engine
export function generateReply(inboundBody: string): string {
  const text = inboundBody.trim().toLowerCase();

  if (text.length === 0) {
    return "I didn't catch that — could you send your message again?";
  }
  if (/\b(hi|hello|hey|yo)\b/.test(text)) {
    return 'Hello! Thanks for reaching out. How can I help you today?';
  }
  if (/\bhelp\b/.test(text)) {
    return 'Sure — tell me what you need help with and I will do my best.';
  }
  if (/\b(bye|goodbye|thanks|thank you)\b/.test(text)) {
    return 'You are welcome! Have a great day. 👋';
  }
  if (text.includes('?')) {
    return `Good question. Here's what I can tell you about "${inboundBody.trim()}".`;
  }
  return `Got your message: "${inboundBody.trim()}". We'll get back to you shortly.`;
}
