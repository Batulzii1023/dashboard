# Client VMS · BLAZE кластер

Hanwha Vision **BLAZE** VMS серверүүдийг IP хаяг болон хэрэглэгчээр нь нэвтэрч нэмээд, бүх сервер болон камерыг нэг кластер болгон харуулна.

```
Хөтөч ──► gateway (Node, LAN дээр) ──HTTPS:8000 + Bearer token──► BLAZE сервер 1..N
```

Хөтөч BLAZE руу шууд хандахгүй, учир нь self-signed сертификат, CORS, дотоод IP-ийн хязгаарлалт саад болдог. Gateway нь серверт нэвтэрч, токеныг шинэчилж, өгөгдлийг нэгтгэнэ. Нууц үгийг `data/servers.json` файлд AES-256-GCM-ээр шифрлэж хадгална. Нууц үг хөтөч рүү очихгүй.

## Ажиллуулах (Node 18+, нэмэлт сан шаардлагагүй)

```bash
cd client-vms/gateway
GATEWAY_SECRET='урт-нууц-хэллэг' node server.js        # http://127.0.0.1:8090
```

| Орчны хувьсагч | Тайлбар |
|---|---|
| `GATEWAY_SECRET` | **Заавал.** Хадгалсан нууц үгийг шифрлэх түлхүүр. Солибол хадгалсан серверүүдийг дахин нэмнэ |
| `HOST` / `PORT` | Анхдагч `127.0.0.1:8090`. Бусад компьютерт нээх бол `HOST=0.0.0.0` |
| `GATEWAY_USER` / `GATEWAY_PASS` | UI-д нэвтрэх Basic auth. `HOST=0.0.0.0` үед заавал тохируулна |
| `BLAZE_TLS_VERIFY=1` | BLAZE сертификатыг шалгах (анхдагчаар шалгахгүй, self-signed) |
| `BLAZE_MOCK=1` | Сервергүйгээр жишээ өгөгдлөөр турших |
| `CACHE_MS` | Кластерын кэшийн хугацаа, анхдагч 15000 |

## Ашигладаг BLAZE API (Blaze API Document v1, swagger 26.05.19)

| Зорилго | Endpoint |
|---|---|
| Нэвтрэх | `POST /api/v1/auth/tokens` — `{userName, userPassword, passwordEncrypted:"plain"}` |
| Токен шинэчлэх | `POST /api/v1/auth/tokens:re-issue` (Bearer = refresh token, амжилтгүй бол дахин нэвтэрнэ) |
| Гарах | `POST /api/v1/auth/tokens:delete-token` — `{refreshToken}` |
| Систем, сервер, төхөөрөмж, суваг | `GET /api/v1:batch` (нэг хүсэлтээр) |
| Бичлэгийн бодит төлөв | `GET /api/v1/channels/recording-status?channelId=a,b,c` |
| Диск (ГБ, SMART төлөв) | `GET /api/v1/servers/{id}/storages` |
| CPU / RAM | `GET /api/v1/servers/{id}/health-monitoring/usage` |
| Үйл явдал | `GET /api/v1/event/logs?limit=30&sort=timestamp:desc` |
| Камерын зураг | `GET /api/v1/channels/{id}/thumbnail?quality=low&fixHeightSize=270` |

Төлвийн хөрвүүлэлт: суваг `Ok` нь ногоон, `NetworkError`/`Unauthorized` нь улаан, `Deleted` нь саарал. Сервер `status=Ok` ба `state≠FAIL` бол хэвийн. Нэг BLAZE кластерын хэд хэдэн серверийг тус тусад нь нэмбэл `systemId`-аар таньж давхар тоолохгүй.

Жинхэнэ сервер дээр шалгах:

```bash
node probe.js 10.10.20.11 admin        # нууц үгийг асууна → probe-result.json (токен, нууц үг, серийн дугаар хасагдсан)
```

## Хийгээгүй (дараагийн шат)

- **Шууд видео.** Одоогоор 3 секунд тутам шинэчлэгдэх thumbnail л харуулна. Бүрэн видеонд сувгийн `mediaProfileInfo[].rtspUrl`-ийг go2rtc эсвэл MediaMTX-ээр WebRTC болгоно.
- **Хэрэглэгчийн эрхийн ялгаа.** Одоогоор gateway-д нэг админ эрх л байна.
