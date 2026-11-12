/** Separate display text from source hashtags without changing the collected note. */
export function splitNoteText(
  text: string | null | undefined = "",
  sourceTopics: string[] | null | undefined = [],
) {
  const topics = new Set(
    (sourceTopics ?? [])
      .map((topic) => topic.replace(/\[话题\]/g, "").replace(/^#+|#+$/g, "").trim())
      .filter(Boolean),
  );
  let body = (text ?? "").replace(/#([^#\r\n]+?)\[话题\]#/g, (_, topic: string) => {
    topics.add(topic.trim());
    return "";
  });
  for (const topic of [...topics].sort((a, b) => b.length - a.length)) {
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    body = body.replace(
      new RegExp(`#${escaped}#?(?=$|[\\s#，。！？、,;；.!?])`, "gu"),
      "",
    );
  }
  const trailingTopics = body.match(/(?:^|\s)(?:#[\p{L}\p{N}_-]+#?\s*)+$/u);
  if (trailingTopics) {
    for (const match of trailingTopics[0].matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
      topics.add(match[1]);
    }
    body = body.slice(0, trailingTopics.index);
  }
  return {
    body: body
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    topics: [...topics],
  };
}
