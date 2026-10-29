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

## API баталгаажуулалт

`gateway/endpoints.js` доторх замууд хоёр төрөлтэй:
- **Баталгаатай** ("BLAZE API Document Guide" болон "API Changes 260519" баримтаас): `POST /api/v1/auth/tokens`, `…/tokens:re-issue`, `DELETE /api/v1/auth/tokens`, `GET /api/v1/servers/{serverId}/storages`, `GET /api/v1/event/logs`, `GET /api/v1/layouts`
- **Таамаг** (`swagger_yaml.txt` ирээгүй): `GET /api/v1/servers`, `GET /api/v1/channels`

Жинхэнэ сервер дээр шалгах:

```bash
node probe.js 10.10.20.11 admin        # нууц үгийг асууна
```

Ажиллуулсны дараа `probe-result.json` файл үүснэ. Файлд токен, нууц үг орохгүй. Энэ файлаар эсвэл `swagger_yaml.txt`-ээр замуудыг баталгаажуулна.

## Хийгээгүй (дараагийн шат)

- **Шууд дүрс.** RTSP-г go2rtc эсвэл MediaMTX-ээр WebRTC болгох, эсвэл BLAZE-ийн layout/web client-ийг холбох.
- **Хэрэглэгчийн эрхийн ялгаа.** Одоогоор gateway-д нэг админ эрх л байна.
