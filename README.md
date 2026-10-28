# 手勢偵測與圖片播放器

GitHub 儲存庫：[20261028_gesture](https://github.com/helina2026ai-code/20261028_gesture)。

左側使用攝影機即時偵測手勢，右側顯示圖片，以 FastAPI 提供網頁。Python 3.14、uv 與 pip 依賴已整理，提供 Render 部署設定及 GitHub Actions 測試。

```powershell
uv sync --frozen
uv run --frozen python main.py
```

啟動後開啟 <http://localhost:8000>。部署流程請見 [GitHub 與 Render 部署指南](docs/部署指南.md)。

## 圖片播放功能

| 手勢 | 對應動作 | 按鈕／鍵盤 |
| --- | --- | --- |
| 張開手掌向左移 | 上一張 | 上一張／← |
| 張開手掌向右移 | 下一張 | 下一張／→ |
| 只伸出食指，停留約半秒 | 第一張 | 第一張／Home |
| 只伸出小指，停留約半秒 | 最後一張 | 最後一張／End |
| 張開手掌，手心／手背翻面 | 目前圖片左右鏡像翻轉，再翻一次還原 | 左右翻轉 |
| 單手張開後握拳，停留約半秒 | 目前圖片上下鏡像翻轉，再握拳一次還原 | 上下翻轉 |
| 雙手張開後向左右拉開／靠近 | 放大／縮小圖片，範圍 100%–300% | 放大／縮小 |
| 雙手張開，一高一低 | 隨兩手高低差旋轉圖片 | 左轉／右轉 |

左右方向以畫面的鏡像預覽為準。首尾不循環；手勢觸發後冷卻 900 毫秒，食指與小指持續比出只觸發一次，需收回約 200 毫秒再重新比出。原有四種換圖手勢維持單手操作。

新增翻面互動支援單手與雙手入鏡：先將張開的手掌穩定朝向鏡頭，再從手心翻到手背，或從手背翻回手心。新的一面穩定約 200 毫秒後觸發圖片左右翻轉動畫。任一隻手都可觸發，雙手同時翻面只翻一次，停住不會反覆觸發；每次翻面後冷卻 900 毫秒。翻手時暫停換圖判定，避免同時換圖。圖片各自記住鏡像方向，切換圖片後再回來會保留；更換整組圖片時重設。雙手交疊或追蹤不明確時重新建立朝向基準。

內建五張原創 SVG 風景範例，提供圖片標題、張數、頁碼選擇與載入失敗提示。可選取多張 JPG／PNG／WebP／GIF／AVIF 本機圖片，依檔名排序播放；圖片使用瀏覽器 object URL，不上傳、不儲存，重新整理後回到範例。無攝影機或未授權時仍可使用按鈕與鍵盤。

新增單手握拳互動：先張開手掌穩定至少 200 毫秒，再握拳停留約 450 毫秒，即可上下翻轉目前圖片。持續握拳只觸發一次，每次操作後冷卻 900 毫秒；再次觸發前需重新張開。初始直接握拳、雙手握拳或手部追蹤中斷都不會直接觸發。上下與左右鏡像方向獨立，可同時套用，各圖片分別記住狀態。握拳使用現有 MediaPipe 模型的 `Closed_Fist` 分類，信心門檻 0.65，不需安裝新套件。

新增雙手縮放／旋轉：兩隻手保持張開並稍停，建立位置基準後，向左右拉開放大、靠近縮小；調整雙手高低差即可旋轉。以鏡像預覽為準，畫面右側手較低時順時針旋轉、較高時逆時針。放下手、遮擋、雙手交叉或翻面時暫停縮放／旋轉並保留效果，重新入鏡會建立新基準。使用移動死區與平滑處理降低抖動。各圖片記住獨立的縮放、旋轉及鏡像狀態，「還原大小／角度」只將縮放還原 100%、角度還原 0°。放大、旋轉超出圖片展示框的部分會裁切。

詳細操作請見 [操作指南](docs/操作指南.md)，實機驗收請見 [驗收清單](docs/驗收清單.md)。

## 架構規劃

```text
使用者瀏覽器
  ├─ getUserMedia：取得使用者同意後開啟攝影機
  ├─ MediaPipe Tasks Vision：在瀏覽器執行手部偵測與手勢分類
  ├─ GestureController：以關節角度判斷食指／小指，以掌心軌跡判斷左右移動
  ├─ HandFlipController：分別追蹤兩隻手，以掌面法向量與停留判定偵測翻面
  ├─ FistController：單手張開後握拳，切換圖片上下鏡像
  ├─ TwoHandController：以雙手水平距離與高低差控制縮放、旋轉
  └─ Canvas／HTML：左側呈現骨架與手勢狀態，右側呈現圖片與播放按鈕
          ↑ 提供網頁、JavaScript、CSS
Render Web Service
  └─ FastAPI + Uvicorn，並提供 /health 健康檢查
```

攝影機畫面在使用者裝置處理，本專案沒有影像上傳或儲存功能。Render 雲端服務無法藉由 `cv2.VideoCapture(0)` 開啟使用者電腦的攝影機，因此將攝影機與辨識放在瀏覽器。

模型最多偵測兩隻手，換圖維持單手，翻面可使用單手或雙手。小指不是預訓練模型的預設手勢類別，因此使用模型輸出的 21 個手部座標自行判斷手指伸直／彎曲；不需重新訓練模型。拇指位置不列入食指／小指的判斷條件，另三根手指需彎曲。手掌移動以掌心五個關鍵點的平均位置計算，採鏡像方向，並過濾小幅抖動、過慢移動、過大的垂直位移與追蹤中斷。

## 規劃流程

| 階段 | 工作內容 | 驗收重點／目前狀態 |
| --- | --- | --- |
| 1. 定義範圍 | 四種換圖控制、左右／上下鏡像、雙手縮放與旋轉 | 已實作 |
| 2. 建立環境 | Python 3.14、uv、FastAPI、Uvicorn、鎖定套件版本 | 已建立 pyproject.toml、uv.lock、requirements.txt |
| 3. 建立網頁 | 左側攝影機、右側圖片、四個操作按鈕、範例及本機圖片 | 已實作 |
| 4. 串接辨識 | 骨架、手指角度、掌心軌跡、停留判定、冷卻與持續手勢鎖定 | 已實作；限制約 15 次／秒推論 |
| 5. 功能驗收 | 方向、首尾邊界、重複觸發、雙手干擾、權限拒絕、斷線與重啟 | 提供自動測試及實機驗收清單；辨識準確度仍需實機驗收 |
| 6. Render 部署 | 推送 Git 儲存庫，建立 Web Service，設定建置與啟動命令 | 已提供 render.yaml；尚未部署 |
| 7. 上線驗收與擴充 | HTTPS、行動裝置、首次載入與不同裝置測試 | 完成驗收後再評估 Web Worker、自訂模型、事件紀錄 |

## 套件安裝清單

| 類別 | 套件／資源 | 本次版本 | 用途 | 安裝方式 |
| --- | --- | --- | --- | --- |
| Python 必要 | fastapi | 0.162.0 | 提供網頁與健康檢查 | 已列入 requirements.txt |
| Python 必要 | uvicorn | 0.54.0 | ASGI HTTP 伺服器 | 已列入 requirements.txt |
| 瀏覽器必要 | @mediapipe/tasks-vision | 0.10.21 | 手部與手勢辨識、WASM 執行環境 | 網頁從固定版本 CDN 載入 |
| 模型必要 | gesture_recognizer.task | float16/1 | 預訓練手勢模型 | 網頁從 Google 模型儲存空間下載 |

`requirements.txt` 由 `uv.lock` 匯出，包含所有間接依賴及確切版本，例如 Starlette、Pydantic、AnyIO。Python 端不需額外安裝 MediaPipe、OpenCV、NumPy、TensorFlow、Jinja2 或資料庫套件。瀏覽器版本的 MediaPipe 與 Python 套件是不同安裝途徑。

目前採 CDN，不需要 Node.js、npm 或前端打包流程。如果未來改成自行打包，再安裝 `npm install @mediapipe/tasks-vision@0.10.21` 並調整前端載入路徑。正式環境可評估將模型與 WASM 一起自行託管，減少對外部 CDN 的依賴。

## 本機安裝與執行

建議沿用 uv，在專案根目錄執行：

```powershell
uv sync --frozen
uv run --frozen python main.py
```

開啟 <http://localhost:8000>，按「開啟攝影機」並允許攝影機權限；按「停止偵測」會釋放攝影機。

Windows 也可雙擊 `啟動專案.cmd` 啟動，使用期間請保持終端機視窗開啟。首頁會自動轉到 `/static/index.html`。請使用瀏覽器網址開啟；直接雙擊 HTML 檔案會顯示啟動提示，因 `file://` 無法正常載入此專案的 JavaScript 模組。

如果使用 pip，請擇一操作，不要與 uv 的安裝方式混用：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

開發時需要自動重新載入，可執行：

```powershell
uv run --frozen uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

模型、JavaScript 與 WASM 首次載入需要網際網路。攝影機需安全來源：本機可用 localhost；部署後使用 HTTPS。手機存取電腦的區域網路 HTTP 位址通常不符合安全來源要求。

## Render 部署

1. 將專案推送至 GitHub、GitLab 或 Bitbucket 儲存庫。
2. 在 Render 建立 Python Web Service 並連接儲存庫；亦可透過 Blueprint 使用本專案的 `render.yaml`。
3. 確認以下設定。方案及區域依實際需求選擇。

| 設定 | 值 |
| --- | --- |
| Root Directory | 專案所在目錄；本專案若在儲存庫根目錄則留白 |
| Runtime | Python |
| Plan | Free（render.yaml 已指定） |
| Python | 由根目錄 `.python-version` 指定為 3.14 系列 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |

4. 部署後開啟 Render 提供的 HTTPS 網址，確認首頁、模型下載與攝影機權限正常。
5. 以 `/health` 回傳 `{"status":"ok"}` 確認後端運作；此檢查不代表攝影機與辨識已通過驗收。

不需要設定資料庫或影像儲存空間。`$PORT` 是 Render 注入的環境變數，上述啟動命令用於 Render；Windows 本機直接使用 `python main.py`。

## 檔案結構與維護

```text
main.py                 FastAPI 入口、首頁重新導向、靜態檔案與健康檢查
啟動專案.cmd            Windows 啟動捷徑
static/index.html       繁體中文操作介面
static/bootstrap.js     本機檔案／不安全網址提示與模組啟動
static/style.css        響應式版面
static/app.js           攝影機、模型載入、圖片操作與骨架繪製
static/gesture-controller.mjs 手指判定、滑動追蹤、冷卻與觸發鎖定
static/hand-flip-controller.mjs 雙手追蹤、掌面方向與翻面觸發
static/fist-controller.mjs 單手握拳、停留確認與重新張開判定
static/two-hand-controller.mjs 雙手位置基準、縮放、旋轉與平滑處理
static/gallery.mjs      圖片清單與切換邊界邏輯
static/images/          五張原創 SVG 範例圖片
tests/gesture-controller.test.mjs 手勢控制與圖片邊界邏輯測試
tests/hand-flip.test.mjs   翻面辨識、雙手去重及各圖片鏡像狀態測試
tests/fist-controller.test.mjs 握拳防重複觸發與上下／左右組合測試
tests/two-hand-controller.test.mjs 雙手縮放旋轉、追蹤中斷及各圖片視圖測試
docs/操作指南.md         操作方式、圖片替換與手勢參數
docs/驗收清單.md         攝影機與部署的人工驗收流程
docs/部署指南.md         GitHub 上傳與 Render 設定
.github/workflows/ci.yml GitHub 自動測試與依賴一致性檢查
pyproject.toml          專案資訊與直接依賴
uv.lock                 uv 鎖定完整依賴
requirements.txt        Render／pip 安裝清單
.python-version         Python 版本
render.yaml             Render 部署設定
```

更新依賴後同步匯出部署清單：

```powershell
uv lock
uv export --locked --no-dev --no-emit-project --no-hashes --output-file requirements.txt
```

自動測試使用 Node.js 內建測試工具，不需安裝 npm 套件，僅開發驗證時需要 Node.js：

```powershell
node --test tests/gesture-controller.test.mjs tests/hand-flip.test.mjs tests/fist-controller.test.mjs tests/two-hand-controller.test.mjs
uv run --frozen python -m unittest discover -s tests -p "test_*.py"
```

目前推論在瀏覽器主執行緒進行，低階裝置仍可能卡頓，後續可移至 Web Worker。幾何判定及自動測試不能代表真實模型的辨識正確率；實際效果需以使用場景的手勢、光源、遮擋與裝置測試。

## 官方參考

- [MediaPipe Web 手勢辨識指南](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js)
- [Render FastAPI 部署指南](https://render.com/docs/deploy-fastapi)
- [Render Python 版本設定](https://render.com/docs/python-version)
- [MDN 攝影機 API 與安全來源要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
