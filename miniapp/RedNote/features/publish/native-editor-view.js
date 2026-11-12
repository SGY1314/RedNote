const payloadFields = ['officialTitle', 'officialContent', 'officialTags', 'officialMediaInfo'];
const emptyPayload = () => Object.fromEntries(payloadFields.map(key => [key, '']));

// Native properties must finish rendering before the component is mounted.
// When the native editor backgrounds this page, retain its frozen parameters
// until return: revoking a grant must not erase text during the native handoff.
function createNativeEditorView(page) {
  let revision = 0, visible = true, disposed = false;
  const write = (patch, done) => { if (!disposed) page.setData(patch, done); };
  return {
    apply(patch) {
      if (disposed) return;
      if (patch.officialAvailable === true) {
        if (!visible) return;
        const request = ++revision;
        const staged = { ...patch, officialAvailable: false, officialMounted: false };
        write(staged, () => {
          if (!disposed && visible && request === revision) write({ officialMounted: true, officialAvailable: true });
        });
        return;
      }
      if (patch.officialAvailable === false) {
        revision++;
        if (!visible) {
          const retained = { ...patch };
          for (const key of payloadFields) delete retained[key];
          write(retained);
        } else write({ ...patch, officialMounted: false });
      } else write(patch);
    },
    hide() { visible = false; revision++; },
    show() {
      if (disposed || visible) return;
      visible = true; revision++;
      write({ officialAvailable: false, officialMounted: false, ...emptyPayload() });
    },
    dispose() { disposed = true; revision++; },
  };
}

module.exports = { createNativeEditorView };
