const { DraftError } = require('../../utils/contract');
const { getReference } = require('./catalog');

function referenceSource(options = {}) {
  if (options.scene || options.ticket || !Object.prototype.hasOwnProperty.call(options, 'referenceId')) return null;
  if (typeof options.referenceId !== 'string') throw new DraftError('invalid', '参考笔记不存在。');
  const reference = getReference(options.referenceId);
  if (!reference) throw new DraftError('invalid', '参考笔记不存在。');
  return reference;
}

module.exports = { referenceSource };
