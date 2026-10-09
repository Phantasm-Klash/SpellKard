# 签到 / 商城 接口契约（服务端与客户端并行实现的唯一依据）

本文件是两个并行 agent 的**共享契约**：服务端只按此实现，客户端只按此调用。
任何一方需要偏离，必须先改本文件并通知另一方。

通用约定（沿用 Gensoulkyo 既有风格）：

- 所有请求走 `/v1/...`，`POST` 用 JSON body，`GET` 无 body。
- 鉴权：`Authorization: Bearer <session_token>`（由 `/v1/auth/anonymous` 获得）。
- 业务信封：`/v1/checkin*` 与 `/v1/shop*` **不**要求 business envelope，
  与 `/v1/inventory`（GET，走 envelope）保持一致的写法：
  **GET 类读接口走 envelope，POST 类写接口不走**。实现时以 handler 里
  `routeUsesBusinessEnvelope` 为准，两边不要各自发明。
- 响应统一为 JSON 对象，成功带 `ok: true`，失败为
  `{ "ok": false, "error_code": "<code>", "message": "<msg>" }`。
- 错误码复用既有：`unauthorized`、`not_found`、`invalid_request`、
  `insufficient_funds`、`already_claimed`、`out_of_window`。

---

## 签到 Check-in

### `GET /v1/checkin`

查询签到状态。

```json
{
  "ok": true,
  "user_id": "u-...",
  "cycle_id": "2026-10",
  "days": [
    { "day": 1, "reward": { "gold": 100 }, "claimed": true,  "claimable": false },
    { "day": 2, "reward": { "gold": 150 }, "claimed": true,  "claimable": false },
    { "day": 3, "reward": { "gold": 200, "ticket": 1 }, "claimed": false, "claimable": true },
    { "day": 4, "reward": { "gold": 250 }, "claimed": false, "claimable": false }
  ],
  "streak": 2,
  "next_claimable_day": 3,
  "server_time_ms": 1700000000000
}
```

- `cycle_id`：按自然月分周期，格式 `YYYY-MM`。
- `days`：固定 7 天一轮（`day` 1..7）。
- `claimable`：**仅有一条**为 `true`，即轮到的下一天且今天未领。
- `streak`：连续签到天数，断签归零。

### `POST /v1/checkin/claim`

领取当天奖励。无 body（或空对象）。

```json
{
  "ok": true,
  "day": 3,
  "reward": { "gold": 200, "ticket": 1 },
  "wallet": { "gold": 700, "ticket": 1 },
  "streak": 3,
  "next_claimable_day": 4,
  "server_time_ms": 1700000000000
}
```

失败：`already_claimed`（今天已领）、`out_of_window`（轮次已过）。

### `GET /v1/shop`

商城列表。

```json
{
  "ok": true,
  "currency": "gold",
  "wallet": { "gold": 700, "ticket": 1 },
  "items": [
    {
      "item_id": "stamina_potion",
      "name": "Stamina Potion",
      "description": "Restores one ranked attempt.",
      "price": { "gold": 300 },
      "grants": { "item": "stamina_potion", "count": 1 },
      "stock": -1,
      "purchased": 0,
      "purchasable": true
    }
  ],
  "server_time_ms": 1700000000000
}
```

- `stock`：`-1` 表示无限。
- `purchasable`：库存 > 0 且钱包足够。
- `purchased`：本周期已购次数（用于限购显示）。

### `POST /v1/shop/purchase`

购买。body：

```json
{ "item_id": "stamina_potion", "count": 1 }
```

成功：

```json
{
  "ok": true,
  "item_id": "stamina_potion",
  "count": 1,
  "spent": { "gold": 300 },
  "wallet": { "gold": 400 },
  "inventory": { "stamina_potion": 1 },
  "server_time_ms": 1700000000000
}
```

失败：`insufficient_funds`、`not_found`（item 不存在）、`out_of_stock`。

---

## 客户端接入点

- `LobbyClient` 新增方法（全部返回 `T | null`，失败写 `lastError`）：
  - `fetchCheckin(): Promise<CheckinView | null>`
  - `claimCheckin(): Promise<CheckinClaimView | null>`
  - `fetchShop(): Promise<ShopView | null>`
  - `purchaseShopItem(itemId: string, count = 1): Promise<ShopPurchaseView | null>`
- 类型 `CheckinView` / `CheckinClaimView` / `ShopView` / `ShopItemView` /
  `ShopPurchaseView` 定义在 `core/net/lobby_client.ts`，字段与上面的 JSON **同名同形**。
- `LobbyScreen` 新增 `Checkin = 'checkin'`、`Shop = 'shop'`。
- `LobbyFlow` 新增 `openCheckin()` / `openShop()` 切屏，与 `claimCheckin()` / `purchaseItem()` 动作。

## 服务端落地位置

- 路由分发：`runtime/httpapi/handler.go`，紧跟现有 `/v1/activity/claim` 之后。
- 业务：`runtime/core/service.go`，方法 `Checkin(sessionToken)`、
  `ClaimCheckin(sessionToken)`、`Shop(sessionToken, ...)`、
  `PurchaseShopItem(sessionToken, raw)`。
- 类型：`runtime/core/types.go`。
- 存储：复用既有 `Storage`/`Wallet` 的读写模式，不新增依赖。
