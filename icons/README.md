# 媒體部門 App Icon

琥珀色底、白色螢幕外框，螢幕裡一個大勾：代表「媒體部門的確認清單」。
圖形只有螢幕和勾兩個元素，縮到標籤頁大小也認得出來。

- media-department.svg：方形滿版向量原稿（其他圖檔都由它輸出）。
- media-department-1024.png：1024 × 1024 方形滿版。
- apple-touch-icon.png：180 × 180，iPhone／iPad 加入主畫面用。
- icon-192.png、icon-512.png：Web App（manifest.webmanifest）用。
- icon-maskable-512.png：Android 可遮罩圖示，圖形縮在中央安全區，裁成圓形也不會切到。
- favicon.svg、favicon-32.png：瀏覽器標籤頁小圖示（圓角、四角透明）。

HTML 引用（每個頁面的 `<head>` 都已加入）：

```html
<link rel="icon" type="image/svg+xml" href="icons/favicon.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png" />
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png" />
<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png" />
<link rel="manifest" href="manifest.webmanifest" />
```
