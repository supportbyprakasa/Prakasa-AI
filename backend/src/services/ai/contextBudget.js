// How much internal context and chat history one request may carry.
// API providers bill per token, so they keep the conservative profile. Claude Team is a
// flat subscription with a very large window, so it gets whole documents and long chats.

const STANDARD_BUDGET = Object.freeze({
  itemChars: 6000,
  documentChars: 5000,
  totalContextChars: 14000,
  historyMessages: 20,
  historyChars: 16000,
});

const LARGE_CONTEXT_PROVIDERS = new Set(['claude_team']);

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function largeBudget() {
  const totalContextChars = positiveInt(process.env.AI_LARGE_CONTEXT_CHARS, 300000);
  return {
    itemChars: 20000,
    documentChars: totalContextChars,
    totalContextChars,
    historyMessages: 50,
    historyChars: positiveInt(process.env.AI_LARGE_HISTORY_CHARS, 80000),
  };
}

function contextBudgetFor(providerName) {
  return LARGE_CONTEXT_PROVIDERS.has(providerName) ? largeBudget() : { ...STANDARD_BUDGET };
}

module.exports = { STANDARD_BUDGET, contextBudgetFor };
