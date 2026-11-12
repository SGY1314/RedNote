const local = require('./runtime.local');
const defaults = {
  gateway: 'unconfigured',
  developmentEditorCheck: false,
  apiBaseUrl: '',
};

if (local && local.gateway === 'development-cloud' && typeof local.apiBaseUrl === 'string') {
  defaults.gateway = 'development-cloud';
  defaults.apiBaseUrl = local.apiBaseUrl;
  defaults.developmentEditorCheck = local.developmentEditorCheck === true;
}
module.exports = Object.freeze(defaults);
