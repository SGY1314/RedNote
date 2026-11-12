function createDemoDraft(kind = 'image', now = Date.now()) {
  const media = (kind === 'video' ? [0] : [0, 1]).map(index => ({
    asset_id: `demo-${kind}-${index + 1}`,
    kind,
    mime: kind === 'video' ? 'video/mp4' : 'image/jpeg',
    sha256: String(index + 1).repeat(64),
    preview_url: `https://example.invalid/rednote/${kind}-${index + 1}.${kind === 'video' ? 'mp4' : 'jpg'}`,
    width: 1080,
    height: 1440,
    duration: kind === 'video' ? 12 : 0,
    size: 0,
  }));
  return {
    schema_version: 1,
    mode: 'development',
    ticket: `demo-${kind}`,
    expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
    snapshot: {
      publication_id: `demo-publication-${kind}`,
      version_id: 'demo-version-1',
      title: kind === 'video' ? '把周末留给慢生活' : '把灵感留在日常里',
      body: '让创作从一件小事开始。\n\n一杯温热的咖啡，一束窗边的光，把今天喜欢的瞬间认真记录下来。\n\n这是本机开发示例，你可以预览内容、演练领取与取消。',
      topics: ['日常灵感', '慢生活'],
      media,
      fingerprint: `development-demo-${kind}-v1`,
    },
  };
}

module.exports = { createDemoDraft };
