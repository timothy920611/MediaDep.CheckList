# 媒體部門 App Icon

以螢幕、麥克風與音訊電平整合成單一符號，配上暖白底色、石墨黑輪廓與琥珀橘音訊線條。

- media-department-1024.png：1024 × 1024 方形滿版圖檔（原稿）。
- apple-touch-icon.png：180 × 180，iPhone／iPad 加入主畫面用。
- icon-192.png、icon-512.png：Web App（manifest.webmanifest）用，512 也當作 Android 可遮罩圖示。
- favicon-32.png：32 × 32 瀏覽器標籤頁小圖示。

HTML 引用（每個頁面的 `<head>` 都已加入）：

```html
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png" />
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png" />
<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png" />
<link rel="manifest" href="manifest.webmanifest" />
```

圖形來源：透過 better-icons 取得 Lucide 的 mic-audio-lines，調整比例、線條與構圖後整合進原創螢幕外框。Lucide 授權見 LUCIDE-LICENSE.txt。
https://lucide.dev/icons/mic-audio-lines
