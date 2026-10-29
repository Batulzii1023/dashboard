// BLAZE API endpoint тохиргоо.
// [баталгаатай] = "BLAZE API Document Guide / API Changes (260519)"-д тодорхой бичигдсэн.
// [таамаг]      = swagger_yaml.txt ирээгүй тул таамаглал. probe.js-ээр шалгаад шаардлагатай бол засна.
module.exports = {
  // Нэвтрэх: POST { userName, userPassword, passwordEncrypted: "plain" }
  // Хариу:  { accessToken, expiresInAccessToken, refreshToken, expiresInRefreshToken, isTemporary }  [баталгаатай]
  login: { method: 'POST', path: '/api/v1/auth/tokens' },
  // Токен шинэчлэх  [зам баталгаатай, body таамаг]
  refresh: { method: 'POST', path: '/api/v1/auth/tokens:re-issue', body: (refreshToken) => ({ refreshToken }) },
  // Гарах  [баталгаатай]
  logout: { method: 'DELETE', path: '/api/v1/auth/tokens' },

  // Системийн серверүүд  [таамаг]
  servers: { method: 'GET', path: '/api/v1/servers' },
  // Камер / суваг  [таамаг — event/logs "channelIds" параметрээс сувгийн UUID байдаг нь баталгаатай]
  channels: { method: 'GET', path: '/api/v1/channels' },
  // Серверийн диск  [баталгаатай] — disks[].isLowCapacity
  storages: { method: 'GET', path: '/api/v1/servers/{serverId}/storages' },
  // Үйл явдлын лог  [зам баталгаатай; хугацааны параметрийн нэр таамаг]
  events: { method: 'GET', path: '/api/v1/event/logs', query: { limit: 50 } },
  // Layout  [баталгаатай]
  layouts: { method: 'GET', path: '/api/v1/layouts' },

  // probe.js шалгах нэмэлт таамаг замууд
  probeExtra: [
    '/api/v1/system', '/api/v1/system/info', '/api/v1/system/licenses',
    '/api/v1/devices', '/api/v1/cameras', '/api/v1/channels/status',
    '/api/v1/server', '/api/v1/servers/status', '/api/v1/health',
    '/api/v1/users', '/api/v1/user-roles', '/api/v1/audit/logs?limit=5',
    '/api/v1/event/rules', '/api/v1/maps'
  ]
};
