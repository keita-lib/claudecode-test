const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

export async function decomposeTask({ apiKey, title, projectName, deadline }) {
  if (!apiKey) throw new Error('Gemini APIキーが設定されていません');

  const prompt = `あなたは優秀なプロジェクトマネージャーです。
以下のタスクをWBS（作業分解構造）に分解し、次のアクションを提案してください。

タスク: ${title}
${projectName ? `案件: ${projectName}` : ''}
${deadline ? `期限: ${deadline}` : ''}

以下のJSON形式のみで回答してください（説明文は不要）:
{
  "subtasks": ["具体的なサブタスク1", "サブタスク2", "サブタスク3"],
  "nextAction": "今すぐ取り掛かるべき最初のアクション",
  "improvedTitle": "タイトルが曖昧な場合のみ改善案（問題なければ元のタイトルをそのまま）"
}`;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `APIエラー: ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  try {
    return JSON.parse(text);
  } catch {
    // JSON抽出を試みる
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AIの応答を解析できませんでした');
  }
}
