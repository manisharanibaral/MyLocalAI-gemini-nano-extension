// What the panel sends to Ollama's /api/chat, and the token counts it reports back.
"use strict";

// ===================== MESSAGES =====================
// chatHistory already ends with the message being answered (sendMessage stores it first).
// Only that message carries its images: older ones keep their text plus a short note, since
// re-sending every screenshot on every turn makes each request large and each reply slow.
// Earlier turns are kept newest first until the context budget is used up, so the system
// prompt and the new message always fit.
function ollamaChatMessages(history) {
  const turns = history.filter(m => m.role === "user" || m.role === "assistant");
  const latest = turns.at(-1);
  const earlier = turns.slice(0, -1).map(ollamaTextMessage).filter(m => m.content.trim());
  const kept = newestTurnsWithin(earlier, ollamaHistoryBudgetChars(latest));
  const messages = [{ role: "system", content: getSystemPrompt() }, ...kept];
  if (latest) messages.push(ollamaLatestMessage(latest));
  return messages;
}

// Only the selected answer (already in `content`) belongs in the prompt; the unused
// alternatives (variants) and the saved reasoning would just fill the model's context.
function ollamaTextMessage(message) {
  const content = messageText(message);
  const imageCount = message.images?.length || 0;
  return { role: message.role, content: imageCount ? `${content}\n\n${earlierImagesNote(imageCount)}` : content };
}

// Ollama takes a message's images as an array of base64 strings, as history keeps them.
function ollamaLatestMessage(message) {
  const content = messageText(message);
  return message.images?.length ? { role: message.role, content, images: message.images } : { role: message.role, content };
}

// Tells the model images were part of the chat, so "the picture above" still makes sense.
function earlierImagesNote(count) {
  return count === 1 ? "(1 image was shown earlier.)" : `(${count} images were shown earlier.)`;
}

// Characters left for earlier turns once the system prompt, the new message (its images
// included) and room for the reply are taken out of OLLAMA_CONTEXT_TOKENS.
function ollamaHistoryBudgetChars(latest) {
  const replyTokens = getAnswerTokenCap({ thinking: ollamaThinkingEnabled() }) || OLLAMA_REPLY_RESERVE_TOKENS;
  const imageTokens = (latest?.images?.length || 0) * OLLAMA_TOKENS_PER_IMAGE;
  const fixedChars = getSystemPrompt().length + (latest ? messageText(latest).length : 0);
  const freeTokens = OLLAMA_CONTEXT_TOKENS - replyTokens - imageTokens - Math.ceil(fixedChars / CHARS_PER_TOKEN);
  return Math.max(0, freeTokens) * CHARS_PER_TOKEN;
}

// ===================== OPTIONS =====================
// Thinking is used only when the model can do it and the user turned it on in settings.
function ollamaThinkingEnabled() {
  return modelSupportsThinking && ollamaThinkingSelect.value === "on";
}

function ollamaRequestBody(model, history) {
  const thinking = ollamaThinkingEnabled();
  const body = {
    model,
    messages: ollamaChatMessages(history),
    stream: true,
    options: {
      temperature: parseFloat(tempSlider.value),
      top_k: parseInt(topkSlider.value, 10),
      num_ctx: OLLAMA_CONTEXT_TOKENS,
    },
  };
  // A thinking model thinks by default in newer Ollama versions, so "off" is sent explicitly.
  if (modelSupportsThinking) body.think = thinking;
  const tokenCap = getAnswerTokenCap({ thinking });
  if (tokenCap) body.options.num_predict = tokenCap;
  return body;
}

// ===================== TOKEN COUNTS =====================
// Ollama's last stream frame (done: true) says how many tokens it read and wrote.
function ollamaUsageFromFrame(frame) {
  if (!frame?.done || typeof frame.prompt_eval_count !== "number") return null;
  return { input: frame.prompt_eval_count, output: frame.eval_count || 0 };
}

function rememberOllamaUsage(chatId, usage) {
  if (usage) lastOllamaUsage = { chatId, ...usage };
}

// Footer text for Ollama: the latest reply's token counts, or the message count until a
// reply in this chat has reported them.
function ollamaFooterText() {
  const usage = lastOllamaUsage?.chatId === currentSessionId ? lastOllamaUsage : null;
  if (!usage) return `${chatHistory.length} messages`;
  return `${usage.input.toLocaleString()} in · ${usage.output.toLocaleString()} out tokens`;
}
