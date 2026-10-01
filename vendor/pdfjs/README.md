# PDF.js 3.11.174

來源：npm `pdfjs-dist@3.11.174` 的 `legacy/build/pdf.min.js`、`legacy/build/pdf.worker.min.js`（legacy 版：舊一點的 iPhone / Android 也能用）（Apache License 2.0，見 `LICENSE`）。

## 本站的修改

`pdf.worker.min.js` 改了一行：開檔時不再等 `checkLastPage`，改在背景執行。

```diff
- await a.ensureDoc("checkLastPage",[e]);
+ a.ensureDoc("checkLastPage",[e]).catch((()=>{}));
```

原因：`checkLastPage` 會先讀到最後一頁，確認頁數正確。Word 輸出的 PDF 頁面樹是平的，
要走到最後一頁得把每一頁的頁面物件都讀一遍，而它們散在整份檔案裡，等於要下載整份才能顯示第一頁。
改成背景執行後，只要抓到開頭和結尾幾段就能先畫出第一頁。

換新版 PDF.js 時記得重做這個修改，並把 `sw.js` 的 `LIB_CACHE` 改成新版本號。
