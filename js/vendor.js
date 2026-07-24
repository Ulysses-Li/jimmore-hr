import * as bootstrap from "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/+esm";
export { bootstrap };

if (!document.querySelector('link[data-bootstrap-css]')) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css";
  stylesheet.dataset.bootstrapCss = "";
  document.head.prepend(stylesheet);
}

// Live Server 與正式網站共用同一套瀏覽器原生模組，不需要 Vite 才能執行。
window.bootstrap = bootstrap;
