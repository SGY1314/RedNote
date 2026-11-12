const config = require('../../config/runtime');
const { createGateway } = require('../../services/gateway');
const { createPublishController } = require('../../features/publish/controller');
const { statusView } = require('../../features/publish/presentation');
const { createDynamicEditorCheck } = require('../../features/publish/editor-check');
const { createNativeEditorView } = require('../../features/publish/native-editor-view');
const { websitePatch, mediaKey, mediaReady } = require('../../features/publish/website-view');
const { parseScene } = require('../../utils/contract');
const { draftFields, changeDraft, pageEdits } = require('../../features/publish/draft-editor');
const { createTextHandoff, handoffFields } = require('../../features/publish/text-handoff');
const { recentDrafts } = require('../../features/publish/recent-drafts');
const { customerPatch, editorMessage } = require('../../features/publish/customer-messages');
const { createPublishEntry } = require('../../features/publish/publish-entry');
const { referenceSource } = require('../../features/references/source');
const { createReferenceGateway } = require('../../services/reference-gateway');

Page({
  data: {
    status: 'loading', statusTitle: '正在载入', statusDescription: '', busy: true,
    snapshot: null, media: [], mediaCount: 0, currentMedia: 1,
    canClaim: false, canOpen: false, canCancel: false, isError: false,
    networkCloud: false, referenceMode: false,
    ...draftFields(null), ...handoffFields(), galleryOpen: false, editingTopics: false,
    editorCheckEnabled: false, editorBusy: false, editorError: '', editorMessage: '', editorChecks: [], allImagesReady: false,
    officialAvailable: false, officialMounted: false, officialTitle: '', officialContent: '', officialMediaInfo: '', officialTags: '',
  },
  onLoad(options) {
    try {
      const reference = referenceSource(options || {});
      const gateway = reference ? createReferenceGateway({ reference, apiBaseUrl: config.apiBaseUrl, platform: xhs }) : createGateway(xhs);
      const networkCloud = gateway.kind === 'development-cloud';
      const editorCheckEnabled = (networkCloud || reference && gateway.canPublish) && config.developmentEditorCheck === true;
      this.loadedMedia = new Set(); this.snapshotStamp = '';
      this.scanTicket = parseScene(options || {});
      this.nativeEditorView = createNativeEditorView(this);
      this.textHandoff = createTextHandoff({ platform: xhs, view: () => this.data, onChange: patch => this.setData(patch) });
      this.setData({ networkCloud, editorCheckEnabled: !!editorCheckEnabled, referenceMode: !!reference });
      this.editorCheck = createDynamicEditorCheck({ enabled: editorCheckEnabled, platform: xhs,
        readSession: async () => { if (gateway.verifyEditorMedia) await gateway.verifyEditorMedia(); return gateway.refresh(); },
        view: () => ({ snapshot: this.data.snapshot, status: this.data.status,
          mediaReady: this.data.allImagesReady, edits: pageEdits(this.data) }),
        onChange: patch => {
          const copy = Object.prototype.hasOwnProperty.call(patch, 'editorError') ? { editorMessage: editorMessage(patch.editorError) } : {};
          this.nativeEditorView.apply({ ...patch, ...copy });
          this.textHandoff.observe();
          if (this.publishEntry) this.publishEntry.observe();
        } });
      this.publishEntry = createPublishEntry({
        view: () => ({ ...this.data, enabled: this.data.editorCheckEnabled, mediaReady: this.data.allImagesReady, edits: pageEdits(this.data) }),
        claim: () => this.controller.act('claim'), prepare: () => this.editorCheck.prepare(),
      });
      this.controller = createPublishController({ gateway, onChange: patch => this.applyPreview(patch) });
      this.controller.load(options || {});
    } catch (error) { this.setData(customerPatch(statusView(error.code || 'error', error.message))); }
  },
  onShow() {
    if (this.textHandoff) this.textHandoff.show();
    if (this.nativeEditorView) this.nativeEditorView.show();
    if (this.publishEntry) this.publishEntry.resume();
    if (this.controller) { this.controller.resume(); this.controller.checkExpiry(); this.controller.refresh(); }
    this.stopExpiryTimer();
    this.expiryTimer = setInterval(() => { if (this.controller) this.controller.checkExpiry(); if (this.editorCheck) this.editorCheck.tick(); }, 1000);
    this.refreshTimer = setInterval(() => { if (this.controller) this.controller.refresh(); }, 2000);
  },
  onHide() { if (this.textHandoff) this.textHandoff.hide(); this.stopExpiryTimer(); if (this.publishEntry) this.publishEntry.pause(); if (this.nativeEditorView) this.nativeEditorView.hide(); if (this.controller) this.controller.pause(); if (this.editorCheck) this.editorCheck.hide(); },
  onUnload() {
    this.disposed = true;
    this.stopExpiryTimer();
    if (this.publishEntry) this.publishEntry.dispose();
    if (this.controller) this.controller.dispose();
    if (this.editorCheck) this.editorCheck.dispose();
    if (this.nativeEditorView) this.nativeEditorView.dispose();
    if (this.textHandoff) this.textHandoff.dispose();
  },
  stopExpiryTimer() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.expiryTimer = null; this.refreshTimer = null;
  },
  onMediaChange(event) { this.setData({ currentMedia: event.detail.current + 1 }); },
  openGallery(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.media[index];
    if (item && !item.isVideo && !item.placeholder) this.setData({ currentMedia: index + 1, galleryOpen: true });
  },
  closeGallery() { this.setData({ galleryOpen: false }); },
  editTopics() { if (this.data.snapshot && !this.data.isError && !this.data.busy) this.setData({ editingTopics: !this.data.editingTopics }); },
  finishTopics() { this.setData({ editingTopics: false }); },
  onDraftInput(event) {
    const patch = changeDraft(event.currentTarget.dataset.field, event.detail.value);
    if (!Object.keys(patch).length || !this.data.snapshot || this.data.isError) return;
    if (this.editorCheck) this.editorCheck.invalidate();
    this.setData(patch);
    if (this.textHandoff) this.textHandoff.observe();
    recentDrafts.remember({ ticket: this.scanTicket, snapshot: this.data.snapshot,
      expiresAt: this.data.expiresAt, edits: pageEdits(this.data) });
    if (this.publishEntry) this.publishEntry.observe();
  },
  copyDraft() {
    if (this.textHandoff) return this.textHandoff.copy();
  },
  applyPreview(patch) {
    if (Object.prototype.hasOwnProperty.call(patch, 'snapshot')) {
      const next = JSON.stringify(patch.snapshot);
      if (next !== this.snapshotStamp) {
        this.loadedMedia.clear(); this.snapshotStamp = next;
        patch = { ...patch, ...draftFields(patch.snapshot, recentDrafts.editsFor(this.scanTicket, patch.snapshot)), galleryOpen: false, editingTopics: false };
      }
    }
    this.setData(customerPatch(this.data.editorCheckEnabled ? websitePatch(patch) : patch));
    this.updateMediaReadiness();
    if (this.editorCheck) this.editorCheck.observe();
    if (this.textHandoff) this.textHandoff.observe();
    if (this.data.networkCloud && this.data.snapshot && ['scanned', 'claimed'].includes(this.data.status)) {
      recentDrafts.remember({ ticket: this.scanTicket, snapshot: this.data.snapshot, expiresAt: this.data.expiresAt });
    }
    if (['expired', 'revoked', 'cancelled', 'invalid'].includes(this.data.status)) recentDrafts.forget(this.scanTicket);
    if (this.publishEntry) this.publishEntry.observe();
  },
  updateMediaReadiness() {
    this.setData({ allImagesReady: mediaReady(this.data.snapshot, this.data.media, this.loadedMedia || new Set()) });
    if (this.publishEntry) this.publishEntry.observe();
  },
  onMediaLoaded(event) {
    const item = this.data.media[Number(event.currentTarget.dataset.index)];
    if (!item || item.asset_id !== event.currentTarget.dataset.asset || item.preview_url !== event.currentTarget.dataset.url) return;
    this.loadedMedia.add(mediaKey(item)); this.updateMediaReadiness();
  },
  onMediaError(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.media[index];
    if (!item || item.asset_id !== event.currentTarget.dataset.asset || item.preview_url !== event.currentTarget.dataset.url) return;
    this.loadedMedia.delete(mediaKey(item));
    this.setData({ [`media[${index}].placeholder`]: true }); this.updateMediaReadiness();
    if (this.editorCheck) this.editorCheck.invalidate('有素材未成功加载，请重新载入稿件后核对。');
  },
  retryEditor() {
    if (!this.data.allImagesReady) { this.retry(); return; }
    if (this.editorCheck) this.editorCheck.invalidate();
    if (this.publishEntry) this.publishEntry.observe();
  },
  retry() { if (this.editorCheck) this.editorCheck.hide(); if (this.controller) this.controller.load(); },
  goHome() { xhs.reLaunch({ url: '/pages/index/index' }); },
  onOfficialError(event) {
    if (this.editorCheck) this.editorCheck.invalidate(event.detail && event.detail.errMsg || '原生编辑器暂时无法打开');
  },
});
