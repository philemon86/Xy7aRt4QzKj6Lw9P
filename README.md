# 腓利門 POS V2 staging

獨立測試環境，正式站 `https://pos.pbooks.com.tw/` 及 GitHub Pages 的 main 分支不變。

## 正式版備份

- 來源：`philemon86/Xy7aRt4QzKj6Lw9P`
- 原始 commit：`0d4cdd7ecc1059eaa67b1cbbf529e0852390d407`
- 備份分支：`legacy-backup-20260906`
- 備份標籤：`legacy-pos-20260906`
- `legacy/index.html` 保留完整原始程式；Pilot 匯出核心在 `legacy/pilot-exporter.cjs`。
- 離線 Git bundle 另交付，包含完整歷史，已執行 bundle verify。

## 操作

書房由 `/` 登入後新增、查詢與開啟書展。每場有結帳、交易與營收、商品數量、計算機四個工作區。封存場次持續保留，可由書房重新開啟。書房使用藏青色，地方教會使用偏灰的藍灰色。

教會密碼由書房的「教會入口」設定，客戶代碼 AA01 對應 `/aa01`。伺服器每次請求驗證角色與場次所屬教會。515 筆客戶只使用代碼、名稱與會計匯出所需欄位，原客戶檔的地址、聯絡、餘額等欄位未發布。

所有場次的新加入商品依序採用「官網特價 → 原書展指定特價 → 官網一般售價」。官網售價低於官網定價時視為特價，不再重複套原折扣。沒有官網資料時沿用 CSV 定價與原折扣。既有成交單與已保存草稿不會自動重定價。

掃碼與名稱／代碼搜尋共用一個輸入欄。常用商品由搜尋結果的星號加入或移除，存入本場書展的雲端共用設定；不同場次分開。購物車使用精簡商品列與數量加減鈕，點「編輯」或連點商品兩下可修改單價、數量、折扣（79 為七九折），可套用同分類折扣。手動修改優先於預設特價。

日結介面改成純加減乘除計算機，可帶入本場有效交易的現金淨額，含混合付款與退款。計算不寫入交易。過去日結資料及備份相容 API 保留，完整場次備份仍可取得舊紀錄。

商品數量可不建立；建立時每行 `商品代碼,數量`。支援加減與設定數量，剩餘量為配置減有效訂單數量，負庫存不阻擋收銀。

## 保留的收銀功能

代碼／條碼與批次輸入、名稱搜尋、手動數量及負數退款、改價、分類折扣、指定商品折扣、四捨五入、現金／信用卡／LINE PAY／文化幣與現金複合付款、零元單、F7–F10、找零、捐贈／載具／統編與 Pilot 客戶對應、付款 QR 圖、熱感列印、修改付款、訂單備註、作廢與復原、刪除、原 JSON 備份還原、訂單 CSV、Pilot ERI CSV 與匯出前驗證。

原始運算與匯出程式透過 `scripts/build-legacy.mjs` 接上雲端 adapter，以 `public/checkout.css`、`scripts/register-cart.js`、`scripts/register-search.js` 重新排版收銀台。價格與計算機邏輯共用 `lib/pos-core.mjs`；建置 adapter 時產生瀏覽器版本。營運資料由 D1 保存。

## 保存與一致性

- Cloudflare D1 保存 events、churches、sessions、closings、audit、shop 與 settings。
- 每場 state 以訂單、草稿、參考數量與共用設定分鍵；提交採三方差異合併與資料庫 revision 比較交換。
- 兩筆不同訂單可並行保存；同一筆衝突回傳 409，避免靜默覆寫。
- 訂單用 UUID，重送相同 mutation 可重試。結帳在伺服器確認前不顯示完成，失敗保留本機 recovery 並提示重試，不能重複收款。
- 伺服器核對交易明細總額與付款總額。雲端更新的舊 state 由同一資料庫 trigger 原子寫入 audit；刪除與清空仍保留修訂紀錄。
- 草稿依裝置分開，成交單跨装置共用。每 15 秒讀取場次新狀態。
- 既有日結快照持續保存；介面已由計算機取代。完整場次備份包含場次、修訂與舊日結。
- Pilot ERI 由伺服器分配全域不重疊序號範圍；原 exporter schema 與驗證保留。
- 密碼以 PBKDF2 SHA-256 100,000 次雜湊，session cookie 為 HttpOnly / SameSite Strict / HTTPS Secure；登入有限速；變更教會密碼撤銷原 session。

## 商品同步

基礎資料為 2,126 件商品。首次由官網 sitemap 找到 1,009 個商品頁，成功解析 1,000 頁，比對 1,305 個商品代碼，9 頁未成功。未成功的資料保留原值。

抓取公開的 CYBERBIZ 商品結構化資料及商品 variant JSON，保存商品代碼、網站售價、定價、名稱、ISBN／條碼、圖片、來源 URL 與時間。checkout 僅取本地快取，不向官網抓價。

書房工作台開啟時，如快取超過 24 小時，會自動開始可續傳同步；「商品資料」亦可手動同步與暫停。進度存 D1；關閉工作台後同步暫停，重新開啟可繼續。若需全天無人值守排程，下一階段可在自有 hosting 設定 cron 呼叫同一同步邏輯。沒有假裝存在後台排程。

## 開發與部署

Node.js 22.13 以上；`npm ci`、`npm run dev`、`npm run build`。首次本機測試需將 `drizzle` SQL 套用至本機 D1。`ADMIN_PASSWORD_HASH` 應由密鑰設定管理，不得提交密碼或 `.env`。

`npm run db:generate` 產生 schema migration。初始 migration 含 audit trigger，未來 migration 必須保留。`.openai/hosting.json` 僅存 Sites ID 與 DB binding。部署封裝須包含 `dist/.openai/drizzle`。

資料匯入工具 `node scripts/seed.mjs <CSV目錄>` 僅輸出必要商品及客戶欄位。更新收銀台、價格核心或 adapter 後執行 `node scripts/build-legacy.mjs`。`node --test tests/checkout.test.mjs tests/state.test.mjs tests/pos-core.test.mjs legacy/tests/pilot-exporter.test.cjs` 執行運算、掃描處理、特價優先順序、常用商品、計算機與匯出回歸測試。

## 測試邊界

已以本機 D1 實測權限隔離、持久讀取、並行提交、重送、衝突、參考負庫存、伺服器總額驗證、ERI 全域分配、日結、audit 備份、封存寫入限制。原 Pilot 零元與退款回歸測試通過。

相機採原生 BarcodeDetector，沒有支援時使用 ZXing，全畫面辨識、連續對焦與可用時補光；同一條碼需移開約一秒後再進入。成功加入後顯示綠色動畫、短音與震動；查無商品顯示橙色提示及不同聲音，不修改購物車。音效及震動依瀏覽器支援，視覺提示持續提供。尚未以使用者的 USB／藍牙掃描器、手機相機、平板相機或熱感印表機進行實機驗收。

正式站歷史單在原收銀電腦的瀏覽器中，Git 備份不會包含 localStorage。請在原站匯出 JSON，於 V2 相應場次的「交易與營收 → 讀檔」匯入，確認筆數金額後再使用。沒有自動讀取或清除正式瀏覽器交易。

測試站預設私有，只供站點擁有者測試；教會密碼權限已實作。提供其他教會人員測試前，需調整測試站分享權限；不會因此切換正式網域。
