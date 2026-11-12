const config = require('../config/runtime');
const { DraftError } = require('../utils/contract');
const { createDevelopmentCloudGateway } = require('./development-cloud-gateway');

function createGateway(platform) {
  if (config.gateway === 'development-cloud') return createDevelopmentCloudGateway({ apiBaseUrl: config.apiBaseUrl, platform });
  throw new DraftError('unavailable', '暂未连接工作台，请稍后再试。');
}

module.exports = { createGateway };
