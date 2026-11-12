const config = require('../../config/runtime');
const { parseScene } = require('../../utils/contract');
const { recentDrafts } = require('../../features/publish/recent-drafts');
const { referenceCards, getReference } = require('../../features/references/catalog');

Page({
  data: { networkCloud: config.gateway === 'development-cloud', opening: false, launchError: '', recentDrafts: [], referenceNotes: referenceCards() },
  openReference(event) {
    const reference = getReference(event.currentTarget.dataset.id);
    if (!reference || this.data.opening) return;
    this.setData({ opening: true, launchError: '' });
    xhs.navigateTo({ url: `/pages/publish/index?referenceId=${reference.id}`,
      fail: () => this.setData({ launchError: '暂时无法打开参考笔记，请重试。' }),
      complete: () => this.setData({ opening: false }),
    });
  },
  onShow() { this.refreshCards(); },
  refreshCards() {
    const recent = recentDrafts.list();
    this.setData({ recentDrafts: recent, referenceNotes: recent.concat(referenceCards()) });
  },
  openNote(event) {
    if (getReference(event.currentTarget.dataset.id)) this.openReference(event);
    else this.openRecent(event);
  },
  openRecent(event) {
    const ticket = recentDrafts.ticketFor(event.currentTarget.dataset.id);
    if (!ticket) {
      this.refreshCards();
      this.setData({ launchError: '参考素材已过期，请联系商家更新二维码。' });
      return;
    }
    this.onLoad({ scene: ticket });
  },
  onLoad(options = {}) {
    if (this.data.opening || !options.scene && !options.ticket) return;
    if (!this.data.networkCloud) { this.setData({ launchError: '暂时无法查看参考素材，请稍后重试。' }); return; }
    try {
      const ticket = parseScene(options);
      this.setData({ opening: true, launchError: '' });
      xhs.navigateTo({
        url: `/pages/publish/index?scene=${encodeURIComponent(ticket)}`,
        fail: () => this.setData({ launchError: '暂时无法打开参考笔记，请重新扫码。' }),
        complete: () => this.setData({ opening: false }),
      });
    } catch (_) { this.setData({ opening: false, launchError: '二维码无效，请联系商家更新后再扫码。' }); }
  },
});
