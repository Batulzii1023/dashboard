// BLAZE API endpoint-ууд — "Blaze API Document v1 (swagger_yaml.txt, 26.05.19)"-ийн дагуу.
module.exports = {
  // body: { userName, userPassword, passwordEncrypted: plain|encrypted|hashed }
  // 200:  { accessToken, accessTokenExpiryPeriod(сек), refreshToken, refreshTokenExpiryPeriod(сек), isTemporary }
  login: { method: 'POST', path: '/api/v1/auth/tokens' },
  // bearerAuth, body байхгүй. Bearer-т refresh token-ийг өгнө (spec-д тодорхой заагаагүй; амжилтгүй бол дахин нэвтэрнэ)
  refresh: { method: 'POST', path: '/api/v1/auth/tokens:re-issue' },
  // body: { refreshToken }
  logout: { method: 'POST', path: '/api/v1/auth/tokens:delete-token' },

  // Системийн бүх нөөц нэг дор: system, servers[], devices[], channels[], groups, logicalItems …
  batch: { method: 'GET', path: '/api/v1:batch' },
  // ?channelId=uuid,uuid → { servers: [{ channels: [{ channelId, recordingStatus }] }] }
  recordingStatus: { method: 'GET', path: '/api/v1/channels/recording-status' },
  // { disks: [{ path, totalCapacity(ГБ), availableCapacity(ГБ), isLowCapacity, isSystemStorage, enabled, status OK|At Risk|Fail }] }
  storages: { method: 'GET', path: '/api/v1/servers/{id}/storages' },
  // { cpu, totalMemory, usedMemory, disks[], networkInterfaces[] }
  usage: { method: 'GET', path: '/api/v1/servers/{id}/health-monitoring/usage' },
  // ?limit&sort=timestamp:desc → { logs: [{ trigger, triggerText, sourceName, sourceType, startTime(ms), channels[] }] }
  events: { method: 'GET', path: '/api/v1/event/logs' },
  // image/jpeg; ?fixHeightSize=&quality=low — time орхивол live frame
  thumbnail: { method: 'GET', path: '/api/v1/channels/{id}/thumbnail' }
};
