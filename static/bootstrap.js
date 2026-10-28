// A classic script can explain file:// startup errors before loading ES modules.
(() => {
  const appUrl = new URL("./app.js", document.currentScript.src);
  const showNotice = (title, message) => {
    document.querySelector("#startup-title").textContent = title;
    document.querySelector("#startup-message").textContent = message;
    document.querySelector("#startup-notice").hidden = false;
    document.querySelector("#status").textContent = message;
  };

  if (location.protocol === "file:") {
    showNotice("請透過本機網址開啟專案", "目前直接開啟了 HTML 檔案，瀏覽器無法載入這個專案所需的 JavaScript 模組。請先啟動專案，再透過下方網址開啟。");
    document.querySelector("#start").disabled = true;
    return;
  }

  if (!window.isSecureContext) {
    showNotice("目前網址不支援攝影機權限", "請在這台電腦使用 localhost，或使用部署後的 HTTPS 網址。圖片按鈕仍可操作。");
  }

  import(appUrl.href).catch((error) => {
    console.error("Application startup failed:", error);
    showNotice("網頁功能未能載入", "請確認從專案網址開啟，並使用 Chrome 或 Edge 重新整理。若使用預覽伺服器，請確認 JavaScript 模組能正確載入。");
    document.querySelector("#start").disabled = true;
  });
})();
