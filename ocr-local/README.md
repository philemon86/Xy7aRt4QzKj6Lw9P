# 腓利門 FIND：拍商品 OCR 試驗
預設仍在瀏覽器使用 Tesseract.js（第一次需要下載程式及模型）；影像預設不傳到服務。新增 OCR 專用排序與人工確認。正式手動搜尋、條碼、語音、試算保持原流程。

## 選用 PaddleOCR（同一台電腦）
建議 Python 3.11 64 位元，依 PaddlePaddle 官方安裝頁選擇符合 CPU/作業系統的套件。
在專案根目錄執行：
```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r ocr-local/requirements.txt
.\.venv\Scripts\python.exe ocr-local/server.py
```
另開終端機在專案根目錄執行：
```powershell
py -3.11 -m http.server 8000 --bind 127.0.0.1
```
開啟 http://127.0.0.1:8000/?ocr=local 。首次使用 PaddleOCR 會下載模型。若服務失敗，回退瀏覽器辨識。服務只綁定 loopback，不開放 LAN；手機的 localhost 指向手機自己，不能直接連到收銀電腦。正式 HTTPS 網站可能受瀏覽器的本機網路權限限制，須另行驗證。不要直接公開此服務；若未來需要手機共用，應另設 HTTPS、驗證及速率限制。
執行 node --test tests/ocr-match.test.js 測試排序。尚需實拍測試 50 種商品、記錄 Top-1/Top-3、辨識耗時、無結果率及錯誤候選；不可因 OCR 自動加入試算。
NDLOCR-Lite 尚未整合；可在同一測試集另外評估。部署前檢查各模型及依賴授權。
