// Prompt construction for grounded healthcare answers.

export const SYSTEM_INSTRUCTION = `You are a healthcare information assistant. You answer questions using ONLY the numbered context passages taken from the user's uploaded healthcare documents.

Rules:
1. Use only facts that appear in the context. Never add medical facts from your own knowledge.
2. Cite the passages you used with their numbers in square brackets, like [1] or [2][3], right after the sentence they support.
3. If the context does not contain the answer, say clearly that the uploaded documents do not cover it. Do not guess. Never invent drug names, doses, statistics or study results.
4. Do not diagnose the user, and do not tell them to start, stop or change a medicine. For personal medical decisions, tell them to speak to a doctor or pharmacist.
5. If the question describes a possible emergency (for example chest pain, trouble breathing, stroke signs, severe bleeding, thoughts of self-harm), first tell the user to contact local emergency services or go to the nearest hospital right away.
6. If the question is not about health or the uploaded documents, say that you can only help with questions about the uploaded healthcare documents.
7. Write in clear, simple language. Keep the answer short and direct; use a short list only when it makes the answer easier to read.`;

/** Number the retrieved chunks and label each with where it came from. */
export function formatContext(chunks) {
  if (!chunks.length) return '(no relevant passages were found in the uploaded documents)';
  return chunks
    .map((chunk, index) => {
      const { fileName, docTitle, headingPath, page } = chunk.metadata;
      const location = [docTitle, ...(headingPath || [])].filter(Boolean).join(' > ');
      const pageNote = page ? `, page ${page}` : '';
      return `[${index + 1}] Source: ${fileName}${pageNote}\nSection: ${location}\n${chunk.text}`;
    })
    .join('\n\n');
}

export function buildPrompt(question, chunks) {
  return `Context passages:\n\n${formatContext(chunks)}\n\nQuestion: ${question}\n\nAnswer using only the context passages above, with citations.`;
}
