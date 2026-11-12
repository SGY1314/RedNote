const states = new Map([
  ['已发布', 'published'], ['审核中', 'submitted'],
  ['审核不通过', 'rejected'], ['审核未通过', 'rejected'], ['未通过', 'rejected'],
]);

export function publicationState(labels) {
  const found = new Set(labels.map(text => states.get(text.trim())).filter(Boolean));
  if (found.size !== 1) throw Error('page_changed');
  return [...found][0];
}

export async function readPublicationState(row) {
  // Read only dedicated status elements. Never classify the whole work row:
  // its title/caption can legitimately contain words such as 审核不通过.
  const labels = await row.evaluate(root => Array.from(root.querySelectorAll(
    '[role="status"], [data-status], [class*="status"], [class*="Status"]',
  )).filter(node => {
    if (node.closest('a, h1, h2, h3, h4, [contenteditable], [class*="title"], [class*="Title"], [class*="caption"], [class*="Caption"]')) return false;
    const style = getComputedStyle(node);
    return node.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  }).map(node => node.innerText || ''));
  return publicationState(labels);
}
